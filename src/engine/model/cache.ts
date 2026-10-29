// Model cache (FR-03.6, FR-03.8) — the Cache-API store for model bytes and
// runtime wasm, keyed by absolute URL under the cache name
// `zipscribe-models` (settings.yml § storage; FR-03.6 invariant).
//
// Verification doctrine (FR-03.6 + unit-03 Risks "checksum on every cache
// read"):
// - ON WRITE: `ensureOffline` fetches every `files[].path` (URLs pinned to
//   `resolve/<revision>/…` via `modelFileUrl`, never `main`) AND every
//   `runtimeWasm` path (resolved against `selfOrigin`), verifies each body
//   against the registry SHA-256/bytes, and only then puts — an all-or-nothing
//   sequence, so a failure/abort leaves NO partial entries (CC-03.5).
// - ON READ: `matchCached` re-hashes every cache hit and `listCached`
//   re-verifies before reporting `offlineReady` (Safari-quota eviction and
//   silent corruption both surface as a miss / not-ready, never as loaded
//   bytes). A `matchCached` mismatch EVICTES the entry and rejects
//   `CACHE_CORRUPT` so the caller can re-download exactly once.
// - `ModelSpec.runtimeWasm` carries no registry checksum (same-origin assets,
//   FR-03.8 "double caching of wasm is acceptable"), so `matchCached(url, "")`
//   — any non-64-hex expectation — is the documented presence-only read for
//   those entries; there is nothing to verify against.
//
// Rejections are `ModelFailure` (Error carrying `error: EngineError`,
// architecture.md § Worker protocol): NETWORK (retryable) on fetch/stream
// failure, CACHE_CORRUPT on SHA/size mismatch, CANCELLED on abort,
// QUOTA_EXCEEDED when the store rejects a put, ENGINE_INTERNAL otherwise.
// SECURITY-03: failures carry codes only — never URLs or content.
//
// Engine purity: pure TypeScript over injected deps (`ModelCacheDeps`); no DOM
// globals are *required* — the production defaults (Cache API, fetch,
// `navigator.storage.estimate`, `location.origin`) are read lazily through
// `globalThis` only when the dep is absent, so the module runs headless with
// everything injected (WebCrypto via `globalThis.crypto.subtle` is the one
// capability assumed present, as in the frozen tests).

import type { EngineError, EngineErrorCode } from '@engine/protocol'
import { MODEL_REGISTRY, modelFileUrl } from './registry'
import type { ModelSpec } from './registry'

/** Cache name invariant (FR-03.6 / settings.yml storage). */
export const MODEL_CACHE_NAME = 'zipscribe-models' as const

export interface FetchInit {
  signal?: AbortSignal
}
export type FetchImpl = (url: string, init?: FetchInit) => Promise<Response>

/**
 * Minimal `Cache`-API surface (structurally satisfied by
 * `src/test-support/fake-storage.ts` `createFakeCache()`), keyed by absolute
 * URL. The production default wraps `caches.open(MODEL_CACHE_NAME)`.
 */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>
  put(key: string, body: Uint8Array<ArrayBuffer>): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface ModelCacheDeps {
  registry?: Record<string, ModelSpec>
  fetchImpl?: FetchImpl
  /** Injected store (tests); defaults to the real Cache API under MODEL_CACHE_NAME. */
  cacheStore?: CacheLike
  /** Base origin for `runtimeWasm` paths (`new URL(path, selfOrigin)`). */
  selfOrigin?: string
  /** `navigator.storage.estimate` (tests stub it over the fake store). */
  storageEstimate?: () => Promise<{ usage: number; quota: number }>
}

export interface CachedEntry {
  id: string
  /** Total cached bytes: every model file AND every runtimeWasm entry. */
  bytes: number
  offlineReady: boolean
  /** epoch ms of the last successful SHA-256 verification. */
  verifiedAt: number
}

export interface ModelCache {
  ensureOffline(id: string, opts?: { signal?: AbortSignal }): Promise<void>
  listCached(): Promise<CachedEntry[]>
  removeCached(id: string): Promise<void>
  matchCached(url: string, sha256: string): Promise<Uint8Array<ArrayBuffer> | undefined>
  putCached(url: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>
  deleteCached(url: string): Promise<void>
  storageEstimate(): Promise<{ usage: number; quota: number }>
}

const SHA256_HEX = /^[0-9a-f]{64}$/

/** Rejection value: Error carrying the wire-shaped `EngineError` (d.ts § ModelFailure). */
class ModelFailure extends Error {
  readonly error: EngineError
  constructor(code: EngineErrorCode, retryable: boolean) {
    super(`model cache failure: ${code}`)
    this.name = 'ModelFailure'
    this.error = { code, retryable }
  }
}

/** SHA-256 of `bytes` as lowercase hex (WebCrypto; matches the registry pins). */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function isQuota(error: unknown): boolean {
  return error instanceof Error && error.name === 'QuotaExceededError'
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new ModelFailure('CANCELLED', false)
}

/** Fetch/stream failures are NETWORK (retryable); aborts are CANCELLED. */
function downloadFailure(error: unknown): ModelFailure {
  if (isAbort(error)) return new ModelFailure('CANCELLED', false)
  return new ModelFailure('NETWORK', true)
}

/** Store-side failures: quota is honest and terminal, aborts CANCELLED. */
function storeFailure(error: unknown): ModelFailure {
  if (isAbort(error)) return new ModelFailure('CANCELLED', false)
  if (isQuota(error)) return new ModelFailure('QUOTA_EXCEEDED', false)
  return new ModelFailure('ENGINE_INTERNAL', false)
}

async function readBody(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await response.arrayBuffer())
}

interface Planned {
  url: string
  /** Registry checksum; `undefined` for runtimeWasm (nothing to verify against). */
  sha256?: string
  expectedBytes?: number
}

function planEntries(spec: ModelSpec, origin: string): Planned[] {
  const planned: Planned[] = spec.files.map((file) => ({ url: modelFileUrl(spec, file), sha256: file.sha256, expectedBytes: file.bytes }))
  for (const path of spec.runtimeWasm) planned.push({ url: new URL(path, origin).href })
  return planned
}

async function verifies(entry: Planned, bytes: Uint8Array<ArrayBuffer>): Promise<boolean> {
  if (entry.sha256 === undefined) return true
  if (entry.expectedBytes !== undefined && bytes.byteLength !== entry.expectedBytes) return false
  return (await sha256Hex(bytes)) === entry.sha256.toLowerCase()
}

const defaultFetch: FetchImpl = (url, init) => globalThis.fetch(url, init)

interface StorageEstimateLike {
  estimate(): Promise<{ usage?: number; quota?: number }>
}

async function defaultEstimate(): Promise<{ usage: number; quota: number }> {
  const storage = (globalThis as unknown as { navigator?: { storage?: StorageEstimateLike } }).navigator?.storage
  const result = storage === undefined ? undefined : await storage.estimate()
  return { usage: result?.usage ?? 0, quota: result?.quota ?? 0 }
}

interface CacheStorageLike {
  open(cacheName: string): Promise<Cache>
}

/** Production `CacheLike` over the real Cache API (`caches.open(MODEL_CACHE_NAME)`). */
function realCacheStore(): CacheLike {
  const caches = (globalThis as unknown as { caches?: CacheStorageLike }).caches
  let opening: Promise<Cache | undefined> | undefined
  const open = (): Promise<Cache | undefined> => {
    if (caches === undefined) return Promise.resolve(undefined)
    opening ??= caches.open(MODEL_CACHE_NAME).catch(() => undefined)
    return opening
  }
  return {
    match: async (key) => (await open())?.match(key),
    put: async (key, body) => {
      const cache = await open()
      if (cache !== undefined) await cache.put(key, new Response(body))
    },
    delete: async (key) => (await open())?.delete(key) ?? false,
  }
}

export function createModelCache(deps: ModelCacheDeps): ModelCache {
  const registry = deps.registry ?? MODEL_REGISTRY
  const fetchImpl = deps.fetchImpl ?? defaultFetch
  const store = deps.cacheStore ?? realCacheStore()
  const selfOrigin = deps.selfOrigin ?? (globalThis as unknown as { location?: { origin?: string } }).location?.origin ?? 'http://localhost'
  const estimate = deps.storageEstimate ?? defaultEstimate

  async function ensureOffline(id: string, opts?: { signal?: AbortSignal }): Promise<void> {
    const signal = opts?.signal
    const spec = registry[id]
    if (spec === undefined) throw new ModelFailure('ENGINE_INTERNAL', false)
    const plan = planEntries(spec, selfOrigin)
    throwIfAborted(signal)
    // Fetch + verify EVERYTHING first; put only when all bytes are honest —
    // a failure or abort mid-sequence therefore leaves no partial entries.
    const verified = await Promise.all(
      plan.map(async (entry): Promise<{ url: string; bytes: Uint8Array<ArrayBuffer> }> => {
        let bytes: Uint8Array<ArrayBuffer>
        try {
          bytes = await readBody(await fetchImpl(entry.url, { signal }))
        } catch (error) {
          throw downloadFailure(error)
        }
        if (!(await verifies(entry, bytes))) throw new ModelFailure('CACHE_CORRUPT', true)
        return { url: entry.url, bytes }
      }),
    )
    throwIfAborted(signal)
    for (const { url, bytes } of verified) {
      try {
        await store.put(url, bytes)
      } catch (error) {
        throw storeFailure(error)
      }
    }
  }

  async function listCached(): Promise<CachedEntry[]> {
    const entries: CachedEntry[] = []
    for (const spec of Object.values(registry)) {
      let bytes = 0
      let offlineReady = true
      for (const entry of planEntries(spec, selfOrigin)) {
        const response = await store.match(entry.url)
        if (response === undefined) {
          offlineReady = false
          continue
        }
        const body = await readBody(response)
        bytes += body.byteLength
        if (!(await verifies(entry, body))) offlineReady = false
      }
      entries.push({ id: spec.id, bytes, offlineReady, verifiedAt: offlineReady ? Date.now() : 0 })
    }
    return entries
  }

  async function removeCached(id: string): Promise<void> {
    const spec = registry[id]
    if (spec === undefined) return
    for (const entry of planEntries(spec, selfOrigin)) await store.delete(entry.url)
  }

  async function matchCached(url: string, sha256: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const response = await store.match(url)
    if (response === undefined) return undefined
    const bytes = await readBody(response)
    const expected = sha256.toLowerCase()
    if (SHA256_HEX.test(expected) && (await sha256Hex(bytes)) !== expected) {
      await store.delete(url)
      throw new ModelFailure('CACHE_CORRUPT', true)
    }
    return bytes
  }

  async function putCached(url: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    try {
      await store.put(url, bytes)
    } catch (error) {
      throw storeFailure(error)
    }
  }

  async function deleteCached(url: string): Promise<void> {
    await store.delete(url)
  }

  return { ensureOffline, listCached, removeCached, matchCached, putCached, deleteCached, storageEstimate: () => estimate() }
}
