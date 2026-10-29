// Model manager (FR-03.4, FR-03.5) — the lifecycle orchestrator over the
// registry, the cache and injected engine adapters:
//   loadModel(id)  single-flight per id: capability gate → cache-first read
//                  (`cache.matchCached`, SHA re-verified on read per cache.ts)
//                  → >100 MB confirm gate → ONE download sequence
//                  (`cache.ensureOffline` — the fetch/verify/put owner, so a
//                  drop or abort leaves no partial entries) → `model:progress`
//                  (phase download then compile/warm-up) → `model:ready`.
//   confirmDownload / cancelLoad / unload / getAdapter / currentSelection.
//
// Why the download sequence is delegated to `cache.ensureOffline`: it is the
// single owner of URL planning (model files AND same-origin `runtimeWasm`,
// which only the cache can resolve — `ModelManagerDeps` carries no origin),
// SHA-256 verification and all-or-nothing puts (FR-03.6 / CC-03.5). The
// manager therefore reads verified bytes via `matchCached` and never caches
// unverified bytes itself; `fetchImpl` stays on the deps for DI symmetry with
// `ModelCacheDeps` (the engine adapters own any engine-specific fetching).
//
// Semantics pinned by the frozen unit-03 suite:
// - T4 capabilities (from `deps.capabilities`, i.e. `probeCapabilities` in
//   production) reject `ModelFailure` `ENGINE_INTERNAL` with the reason codes
//   in `detail` and attempt ZERO fetches (US-1.1.1 blocked state).
// - offline (`deps.online()` false) + not fully cached → `notice`
//   `OFFLINE_MODEL_MISSING` + reject `NETWORK`, no fetch attempted (US-03.1).
// - `approxBytes > largeDownloadConfirmBytes` (default 100 MB,
//   `LARGE_DOWNLOAD_CONFIRM_BYTES`) → `model:confirm-required {bytes}` and
//   zero bytes fetched until `confirmDownload(id)` resumes the SAME in-flight
//   sequence (single-flight ⇒ one sequence, not two).
// - corrupt cache entry → `model:error` `CACHE_CORRUPT` emitted at eviction
//   (cache.ts evicts inside `matchCached`), then exactly ONE re-download; a
//   second mismatch (network serves corrupt bytes too) surfaces
//   `CACHE_CORRUPT` with bounded fetches — no retry loop (CC-03.7).
// - `cancelLoad()` → the AbortSignal reaches `cache.ensureOffline`'s fetches
//   and `adapter.load`; rejection is `CANCELLED`; nothing partial is cached.
// - `unload()` → `adapter.unload()`; afterwards `getAdapter`/engine use
//   rejects `MODEL_UNLOADED`; `loadModel` again reloads from cache (CC-03.6).
//
// SECURITY-03: rejections and `detail` carry codes/numbers only — never model
// ids, URLs or content. Engine purity (FR-03.5): no SDK imports here — engine
// glue arrives ONLY through the injected `adapters` factory; no DOM globals
// are required (the `navigator.onLine` default is read lazily via
// `globalThis` when `online` is not injected).

import type { Device, EngineError, EngineErrorCode, ModelEvent, Notice } from '@engine/protocol'
import { tierSelector } from './capability'
import type { Capabilities, TierSelection } from './capability'
import type { ModelCache } from './cache'
import { MODEL_REGISTRY } from './registry'
import { modelFileUrl } from './registry'
import type { EngineKind, ModelSpec } from './registry'

/** > 100 MB confirmation gate (zip-captions catalog convention, US-1.1.4). */
export const LARGE_DOWNLOAD_CONFIRM_BYTES = 100_000_000

export interface AdapterLoadInput {
  spec: ModelSpec
  device: Device
  /** Verified model bytes keyed by `ModelFile.path`. */
  files: Record<string, Uint8Array<ArrayBuffer>>
  signal: AbortSignal
}

/** Engine SDK glue injected at the manager seam (fake in tests, FR-03.5). */
export interface EngineAdapter {
  load(input: AdapterLoadInput): Promise<void>
  invoke(method: string, payload?: unknown): Promise<unknown>
  unload(): Promise<void>
}

export type AdapterFactory = (spec: ModelSpec) => EngineAdapter | Promise<EngineAdapter>

export interface ModelManagerDeps {
  registry?: Record<string, ModelSpec>
  /** DI symmetry with `ModelCacheDeps`; the download sequence runs through `cache.ensureOffline`. */
  fetchImpl?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>
  cache: ModelCache
  /** One factory per EngineKind the manager must serve (FR-03.5 seam). */
  adapters: Partial<Record<EngineKind, AdapterFactory>>
  /** Main-thread capability source (`probeCapabilities` in production). */
  capabilities: () => Promise<Capabilities>
  emit?: (event: ModelManagerEvent) => void
  /** Offline probe; default `globalThis.navigator?.onLine ?? true`. */
  online?: () => boolean
  largeDownloadConfirmBytes?: number
}

export interface LoadOptions {
  device?: Device
  /** Pre-confirmed > 100 MB download (skips the confirm-required gate). */
  confirmed?: boolean
}

/** `ModelEvent` plus the content-free `notice` channel (JobEvent's notice arm). */
export type ModelManagerEvent = ModelEvent | { t: 'notice'; jobId?: string; notice: Notice }

/** Rejection value carried by manager rejections: an Error exposing `error: EngineError`. */
export interface ModelFailure {
  error: EngineError
}

export interface ModelManager {
  loadModel(id: string, opts?: LoadOptions): Promise<void>
  confirmDownload(id: string): void
  cancelLoad(): void
  unload(): Promise<void>
  getAdapter(id: string): Promise<EngineAdapter>
  /** The tier selection actually used for the last/current load. */
  currentSelection(): TierSelection | undefined
}

/** Rejection value: Error carrying the wire-shaped `EngineError` (d.ts § ModelFailure). */
class ModelFailureImpl extends Error implements ModelFailure {
  readonly error: EngineError
  constructor(code: EngineErrorCode, retryable: boolean, detail?: string) {
    super(`model manager failure: ${code}`)
    this.name = 'ModelFailure'
    this.error = { code, retryable, ...(detail === undefined ? {} : { detail }) }
  }
}

function isModelFailure(value: unknown): value is ModelFailure {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error: unknown = value.error
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return typeof error.code === 'string'
}

function isCorrupt(value: unknown): boolean {
  return isModelFailure(value) && value.error.code === 'CACHE_CORRUPT'
}

function abortFailure(): ModelFailureImpl {
  return new ModelFailureImpl('CANCELLED', false)
}

function failureOf(error: unknown): ModelFailureImpl {
  if (isModelFailure(error)) {
    const { code, retryable, detail } = error.error
    return new ModelFailureImpl(code, retryable, detail)
  }
  if (error instanceof Error && error.name === 'AbortError') return abortFailure()
  return new ModelFailureImpl('ENGINE_INTERNAL', false)
}

function mapToSelectorFailure(error: unknown, caps: Capabilities): ModelFailureImpl {
  if (caps.tier === 'T4') return new ModelFailureImpl('ENGINE_INTERNAL', false, caps.reasons.join(',') || 'T4_BLOCKED')
  const message = error instanceof Error ? error.message : ''
  if (message.includes('MEMORY')) return new ModelFailureImpl('ENGINE_INTERNAL', false, 'MEMORY_GATE')
  return new ModelFailureImpl('ENGINE_INTERNAL', false, 'UNKNOWN_MODEL')
}

interface LoadEntry {
  id: string
  controller: AbortController
  settled: boolean
  resolve: (() => void) | null
  promise: Promise<void>
}

const noopEmit: (event: ModelManagerEvent) => void = () => undefined

function defaultOnline(): boolean {
  const nav = (globalThis as unknown as { navigator?: { onLine?: boolean } }).navigator
  return nav?.onLine ?? true
}

export function createModelManager(deps: ModelManagerDeps): ModelManager {
  const registry = deps.registry ?? MODEL_REGISTRY
  const emit = deps.emit ?? noopEmit
  const isOnline = deps.online ?? defaultOnline
  const confirmThreshold = deps.largeDownloadConfirmBytes ?? LARGE_DOWNLOAD_CONFIRM_BYTES

  let inFlight: LoadEntry | null = null
  let loaded: { id: string; adapter: EngineAdapter } | null = null
  let selection: TierSelection | undefined

  async function runLoad(entry: LoadEntry, id: string, opts?: LoadOptions): Promise<void> {
    const signal = entry.controller.signal
    try {
      const spec = registry[id]
      if (spec === undefined) throw new ModelFailureImpl('ENGINE_INTERNAL', false, 'UNKNOWN_MODEL')

      const caps = await deps.capabilities()
      let selectionNow: TierSelection
      try {
        selectionNow = tierSelector(caps, { userModel: id, registry })
      } catch (error) {
        throw mapToSelectorFailure(error, caps)
      }
      const device: Device = opts?.device ?? selectionNow.device

      // Cache-first read: `matchCached` re-hashes every hit and evicts +
      // rejects CACHE_CORRUPT on mismatch (cache.ts) — verified bytes only.
      const fileBytes = new Map<string, Uint8Array<ArrayBuffer>>()
      for (const file of spec.files) {
        try {
          const bytes = await deps.cache.matchCached(modelFileUrl(spec, file), file.sha256)
          if (bytes !== undefined) fileBytes.set(file.path, bytes)
        } catch (error) {
          if (!isCorrupt(error)) throw error
          emit({ t: 'model:error', model: id, error: { code: 'CACHE_CORRUPT', retryable: true } })
        }
      }

      if (loaded !== null && loaded.id !== id) {
        const previous = loaded
        loaded = null
        try {
          await previous.adapter.unload()
        } catch {
          // replacing a dead session must not block the new load
        }
      }
      const factory = deps.adapters[spec.engine]
      if (factory === undefined) throw new ModelFailureImpl('ENGINE_INTERNAL', false, 'NO_ADAPTER')

      const totalModelBytes = spec.files.reduce((sum, file) => sum + file.bytes, 0)
      let received = 0
      let announcedConfirm = false

      const awaitConfirm = (): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          const onAbort = (): void => reject(abortFailure())
          signal.addEventListener('abort', onAbort, { once: true })
          entry.resolve = (): void => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          }
          if (signal.aborted) reject(abortFailure())
        })

      // One download sequence when anything is missing: offline fails fast
      // with the OFFLINE_MODEL_MISSING notice (no fetch attempted); otherwise
      // the >100 MB gate holds this SAME in-flight sequence (no second
      // sequence) until confirmDownload/opts.confirmed.
      for (;;) {
        if (fileBytes.size === spec.files.length) {
          const row = (await deps.cache.listCached()).find((candidate) => candidate.id === id)
          if (row !== undefined && row.offlineReady) break
        }
        if (!isOnline()) {
          emit({ t: 'notice', notice: { code: 'OFFLINE_MODEL_MISSING' } })
          throw new ModelFailureImpl('NETWORK', true, 'OFFLINE_MODEL_MISSING')
        }
        if (!announcedConfirm && opts?.confirmed !== true && spec.approxBytes > confirmThreshold) {
          announcedConfirm = true
          emit({ t: 'model:confirm-required', model: id, bytes: spec.approxBytes })
          await awaitConfirm()
        }
        await deps.cache.ensureOffline(id, { signal })
        for (const file of spec.files) {
          if (fileBytes.has(file.path)) continue
          const bytes = await deps.cache.matchCached(modelFileUrl(spec, file), file.sha256)
          if (bytes === undefined) throw new ModelFailureImpl('CACHE_CORRUPT', true)
          fileBytes.set(file.path, bytes)
          received += bytes.byteLength
          emit({ t: 'model:progress', model: id, phase: 'download', received, total: totalModelBytes })
        }
        break
      }

      const files: Record<string, Uint8Array<ArrayBuffer>> = {}
      for (const file of spec.files) {
        const bytes = fileBytes.get(file.path)
        if (bytes === undefined) throw new ModelFailureImpl('CACHE_CORRUPT', true)
        files[file.path] = bytes
      }

      emit({ t: 'model:progress', model: id, phase: 'compile', received: totalModelBytes, total: totalModelBytes })
      const adapter = await factory(spec)
      await adapter.load({ spec, device, files, signal })
      loaded = { id, adapter }
      selection = { engine: selectionNow.engine, model: selectionNow.model, tier: selectionNow.tier, device }
      emit({ t: 'model:ready', model: id, device })
    } catch (error) {
      const failure = failureOf(error)
      emit({ t: 'model:error', model: id, error: failure.error })
      throw failure
    } finally {
      entry.settled = true
      if (inFlight === entry) inFlight = null
    }
  }

  function loadModel(id: string, opts?: LoadOptions): Promise<void> {
    if (inFlight !== null) {
      if (inFlight.id === id) return inFlight.promise
      return Promise.reject(new ModelFailureImpl('ENGINE_INTERNAL', false, 'BUSY'))
    }
    const entry: LoadEntry = { id, controller: new AbortController(), settled: false, resolve: null, promise: Promise.resolve() }
    inFlight = entry
    entry.promise = runLoad(entry, id, opts)
    return entry.promise
  }

  function confirmDownload(id: string): void {
    if (inFlight !== null && inFlight.id === id) inFlight.resolve?.()
  }

  function cancelLoad(): void {
    if (inFlight === null) return
    const entry = inFlight
    entry.controller.abort()
    entry.resolve?.()
  }

  async function unload(): Promise<void> {
    if (inFlight !== null && !inFlight.settled) {
      const entry = inFlight
      entry.controller.abort()
      entry.resolve?.()
      await entry.promise.catch(() => undefined)
    }
    const current = loaded
    if (current === null) return
    loaded = null
    await current.adapter.unload()
  }

  function getAdapter(id: string): Promise<EngineAdapter> {
    return loaded !== null && loaded.id === id ? Promise.resolve(loaded.adapter) : Promise.reject(new ModelFailureImpl('MODEL_UNLOADED', false))
  }

  function currentSelection(): TierSelection | undefined {
    return selection
  }

  return { loadModel, confirmDownload, cancelLoad, unload, getAdapter, currentSelection }
}

export type { EngineError }
