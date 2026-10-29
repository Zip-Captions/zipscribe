// Unit-03 test doubles (test-author-owned; mirrors the src/test-support/
// conventions — shared fakes only, no production code, no network):
//
//  - seeded pseudo-random model bytes (SECURITY-03: binary noise, never
//    transcript-like text), with SHA-256 via node:crypto,
//  - synthetic ModelSpec factory using the frozen registry shapes,
//  - fetch stub (per-URL bodies, network-drop, mid-stream drop, corruption,
//    abort support) recording every call,
//  - instrumented CacheLike (structural superset of
//    src/test-support/fake-storage createFakeCache — the production code must
//    work against that exact shape too),
//  - fake engine adapter (the injected SDK seam), fake Capabilities builder.

import { createHash } from 'node:crypto'
import type { Capabilities } from '@engine/model/capability'
import type { CacheLike, FetchImpl, ModelCache, ModelCacheDeps } from '@engine/model/cache'
import type { EngineKind, ModelFile, ModelSpec } from '@engine/model/registry'
import type { AdapterFactory, EngineAdapter } from '@engine/model/manager'
import type { ModelManagerEvent } from '@engine/protocol'

// No DOM lib in the test tsconfig — `Response` comes from @types/node/undici.
type ResponseBody = ConstructorParameters<typeof Response>[0]

/** Deterministic seeded PRNG (mulberry32 over an FNV-1a seed hash). */
export function prngBytes(seed: string, length: number): Uint8Array {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let state = h >>> 0
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    out[i] = (t ^ (t >>> 14)) >>> 24
  }
  return out
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex')
}

export const HF_HOST = 'https://huggingface.co'
/** Frozen URL shape: `https://huggingface.co/<repo>/resolve/<revision>/<path>`. */
export function fileUrl(repo: string, revision: string, path: string): string {
  return `${HF_HOST}/${repo}/resolve/${revision}/${path}`
}

export const SELF_ORIGIN = 'https://zipscribe.test'

export const FAKE_REVISION = '0123456789abcdef0123456789abcdef01234567'

export interface SyntheticSpecResult {
  spec: ModelSpec
  /** URL → honest bytes the network should serve (model files + runtime wasm). */
  served: Map<string, Uint8Array>
  /** registry file URL list (resolve/<revision>/… shape). */
  modelUrls: string[]
  /** self-origin runtimeWasm URL list. */
  wasmUrls: string[]
  totalBytes: number
}

export interface SyntheticSpecOptions {
  id: string
  engine?: EngineKind
  repo?: string
  revision?: string
  fileSizes?: number[]
  wasmPaths?: string[]
  wasmSize?: number
  approxBytes?: number
  minDeviceMemGB?: number
}

/**
 * A synthetic ModelSpec whose declared SHA-256s match seeded PRNG bytes — the
 * verification path under test runs real SHA-256 over these.
 */
export async function makeSyntheticSpec(opts: SyntheticSpecOptions): Promise<SyntheticSpecResult> {
  const engine = opts.engine ?? 'transformers-whisper'
  const repo = opts.repo ?? `zipscribe-test/${opts.id.split('@')[0] ?? 'model'}`
  const revision = opts.revision ?? FAKE_REVISION
  const sizes = opts.fileSizes ?? [4096, 8192]
  const files: ModelFile[] = []
  const served = new Map<string, Uint8Array>()
  const modelUrls: string[] = []
  let totalBytes = 0
  for (const [index, size] of sizes.entries()) {
    const path = `onnx/part-${index}.onnx`
    const bytes = prngBytes(`${opts.id}/${path}`, size)
    files.push({ path, sha256: await sha256Hex(bytes), bytes: size })
    const url = fileUrl(repo, revision, path)
    served.set(url, bytes)
    modelUrls.push(url)
    totalBytes += size
  }
  const wasmPaths = opts.wasmPaths ?? ['/wasm/fake-runtime.wasm']
  const wasmSize = opts.wasmSize ?? 2048
  const wasmUrls: string[] = []
  for (const path of wasmPaths) {
    const bytes = prngBytes(`${opts.id}/${path}`, wasmSize)
    served.set(new URL(path, SELF_ORIGIN).href, bytes)
    wasmUrls.push(new URL(path, SELF_ORIGIN).href)
    totalBytes += wasmSize
  }
  const spec: ModelSpec = {
    id: opts.id,
    engine,
    repo,
    revision,
    files,
    approxBytes: opts.approxBytes ?? totalBytes,
    languages: ['*'],
    punctuation: false,
    confidence: false,
    languageDetect: true,
    timestampMode: 'word-native',
    license: 'Apache-2.0',
    tierHint: 'T2',
    runtimeWasm: wasmPaths,
    enOnly: false,
    ...(opts.minDeviceMemGB === undefined ? {} : { minDeviceMemGB: opts.minDeviceMemGB }),
  }
  return { spec, served, modelUrls, wasmUrls, totalBytes }
}

export interface FakeFetchOptions {
  /** URL → bytes served. Unknown URL → throw (a fetch outside the plan is a defect). */
  served: Map<string, Uint8Array>
  /** URLs whose fetch rejects with a TypeError (network drop). */
  failUrls?: Set<string>
  /** URLs whose response stream errors AFTER the first chunk (mid-download drop). */
  streamFailUrls?: Set<string>
  /** URLs served with tampered bytes (first byte flipped) — corrupt download. */
  corruptUrls?: Set<string>
  /** Chunk size for streamed bodies (drives model:progress). */
  chunkSize?: number
  /** Artificial per-fetch latency (lets cancelLoad() abort an in-flight fetch). */
  delayMs?: number
}

export interface FakeFetch {
  fetchImpl: FetchImpl
  /** Every fetch call URL in call order (single-flight / redownload counts). */
  calls: string[]
  /** AbortSignals handed to fetch, in call order. */
  signals: (AbortSignal | undefined)[]
  callsFor(url: string): number
  /** Mutable at call time (drop, then recover, scenarios). */
  failUrls: Set<string>
  corruptUrls: Set<string>
  streamFailUrls: Set<string>
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll `condition` until true (fails the caller's assertion budget otherwise). */
export async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met within budget')
    await sleep(10)
  }
}

function raceAbort<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (!signal) return work()
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    work().then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

export function createFakeFetch(opts: FakeFetchOptions): FakeFetch {
  const chunkSize = opts.chunkSize ?? 4096
  const calls: string[] = []
  const signals: (AbortSignal | undefined)[] = []
  const failUrls = new Set(opts.failUrls ?? [])
  const corruptUrls = new Set(opts.corruptUrls ?? [])
  const streamFailUrls = new Set(opts.streamFailUrls ?? [])
  const fetchImpl: FetchImpl = (url, init) =>
    raceAbort(init?.signal, async () => {
      calls.push(url)
      signals.push(init?.signal)
      if (opts.delayMs !== undefined && opts.delayMs > 0) await sleep(opts.delayMs)
      if (failUrls.has(url)) throw new TypeError('network drop (simulated)')
      const planned = opts.served.get(url)
      if (planned === undefined) throw new Error(`unexpected fetch ${url} (outside test plan)`)
      const body = corruptUrls.has(url) ? flipFirstByte(planned) : planned
      if (streamFailUrls.has(url)) {
        let sent = 0
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= chunkSize) {
              controller.error(new TypeError('connection reset mid-download'))
              return
            }
            const end = Math.min(chunkSize, body.byteLength)
            controller.enqueue(body.slice(0, end))
            sent = end
          },
        })
        return new Response(stream as unknown as ResponseBody, { status: 200 })
      }
      const chunks: Uint8Array[] = []
      for (let offset = 0; offset < body.byteLength; offset += chunkSize) chunks.push(body.slice(offset, offset + chunkSize))
      if (chunks.length === 0) chunks.push(new Uint8Array(0))
      let index = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index < chunks.length) controller.enqueue(chunks[index++] as Uint8Array)
          else controller.close()
        },
      })
      return new Response(stream as unknown as ResponseBody, { status: 200 })
    })
  return {
    fetchImpl,
    calls,
    signals,
    callsFor: (url) => calls.filter((call) => call === url).length,
    failUrls,
    corruptUrls,
    streamFailUrls,
  }
}

export function flipFirstByte(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice()
  const first = copy[0] ?? 0
  copy[0] = first ^ 0xff
  return copy
}

/** CacheLike + introspection; structural shape stays compatible with createFakeCache(). */
export interface FakeCacheStore extends CacheLike {
  /** URL → stored bytes (for "no partial entry" / eviction / usage assertions). */
  stored: Map<string, Uint8Array>
  storedBytes(): number
}

export function createFakeCacheStore(): FakeCacheStore {
  const stored = new Map<string, Uint8Array>()
  return {
    stored,
    match: async (key) => {
      const hit = stored.get(key)
      return hit === undefined ? undefined : new Response(hit as unknown as ResponseBody)
    },
    put: async (key, body) => {
      stored.set(key, body.slice())
    },
    delete: async (key) => stored.delete(key),
    storedBytes: () => [...stored.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0),
  }
}

export interface FakeCacheHandle {
  cache: ModelCache
  store: FakeCacheStore
  deps: ModelCacheDeps
  estimateUsage: () => number
}

/**
 * Builds the ModelCache under test with the instrumented store and an estimate
 * stub backed by the store itself (so "estimate drops by their size" measures
 * the real eviction, CC-03.4).
 */
export async function createTestCache(deps: Pick<ModelCacheDeps, 'registry' | 'fetchImpl'>): Promise<FakeCacheHandle> {
  const store = createFakeCacheStore()
  const cacheDeps: ModelCacheDeps = {
    ...deps,
    cacheStore: store,
    selfOrigin: SELF_ORIGIN,
    storageEstimate: async () => ({ usage: store.storedBytes(), quota: 10_000_000_000 }),
  }
  const { createModelCache } = await import('@engine/model/cache')
  return {
    cache: createModelCache(cacheDeps),
    store,
    deps: cacheDeps,
    estimateUsage: () => store.storedBytes(),
  }
}

export interface FakeAdapterCall {
  method: 'load' | 'invoke' | 'unload'
  payload?: unknown
}

export interface FakeAdapterHandle {
  factory: AdapterFactory
  adapters: EngineAdapter[]
  calls: FakeAdapterCall[]
  /** Load inputs handed to adapter.load (files map inspection, CC-03.6/3.7). */
  loads: { spec: ModelSpec; device: string; files: Record<string, Uint8Array> }[]
  /** Set true to make adapter.load reject (engine compile failure). */
  failLoad: boolean
}

export function createFakeAdapters(): FakeAdapterHandle {
  const adapters: EngineAdapter[] = []
  const calls: FakeAdapterCall[] = []
  const loads: { spec: ModelSpec; device: string; files: Record<string, Uint8Array> }[] = []
  const handle: FakeAdapterHandle = {
    factory: () => {
      const adapter: EngineAdapter = {
        load: async (input) => {
          calls.push({ method: 'load', payload: input })
          if (handle.failLoad) throw new Error('adapter compile failed (simulated)')
          loads.push({ spec: input.spec, device: input.device, files: input.files })
        },
        invoke: async (method, payload) => {
          calls.push({ method: 'invoke', payload })
          return method
        },
        unload: async () => {
          calls.push({ method: 'unload' })
        },
      }
      adapters.push(adapter)
      return adapter
    },
    adapters,
    calls,
    loads,
    failLoad: false,
  }
  return handle
}

/** Every EngineKind served by the same recording fake (DI at the SDK seam). */
export function fakeAdapterRegistry(handle: FakeAdapterHandle): Partial<Record<EngineKind, AdapterFactory>> {
  return { 'transformers-whisper': handle.factory, 'sherpa-wasm': handle.factory, 'cactus-whistle': handle.factory }
}

export function makeCapabilities(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    tier: 'T2',
    webgpuAdapter: false,
    wasmSimd: true,
    audioDecoder: true,
    audioEncoder: true,
    videoEncoder: true,
    deviceMemGB: null,
    online: true,
    reasons: [],
    ...overrides,
  }
}

export function eventRecorder(): { events: ModelManagerEvent[]; emit: (event: ModelManagerEvent) => void } {
  const events: ModelManagerEvent[] = []
  return { events, emit: (event) => events.push(event) }
}

export interface ManagerScenarioOptions extends SyntheticSpecOptions, Omit<FakeFetchOptions, 'served'> {
  caps?: Partial<Capabilities>
  online?: () => boolean
  /** Skip the confirm gate without exercising it (large models under test). */
  largeDownloadConfirmBytes?: number
}

export interface ManagerScenario {
  made: SyntheticSpecResult
  handle: FakeCacheHandle
  fetch: FakeFetch
  adapters: FakeAdapterHandle
  events: ModelManagerEvent[]
  manager: import('@engine/model/manager').ModelManager
}

/** Registry + cache + fetch + adapters + manager wired at the DI seams. */
export async function createManagerScenario(options: ManagerScenarioOptions): Promise<ManagerScenario> {
  const made = await makeSyntheticSpec(options)
  const registry = { [made.spec.id]: made.spec }
  const fetch = createFakeFetch({
    served: made.served,
    ...(options.failUrls === undefined ? {} : { failUrls: options.failUrls }),
    ...(options.streamFailUrls === undefined ? {} : { streamFailUrls: options.streamFailUrls }),
    ...(options.corruptUrls === undefined ? {} : { corruptUrls: options.corruptUrls }),
    ...(options.chunkSize === undefined ? {} : { chunkSize: options.chunkSize }),
    ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
  })
  const handle = await createTestCache({ registry, fetchImpl: fetch.fetchImpl })
  const adapters = createFakeAdapters()
  const recorder = eventRecorder()
  const { createModelManager } = await import('@engine/model/manager')
  const manager = createModelManager({
    registry,
    fetchImpl: fetch.fetchImpl,
    cache: handle.cache,
    adapters: fakeAdapterRegistry(adapters),
    capabilities: async () => makeCapabilities(options.caps),
    emit: recorder.emit,
    online: options.online ?? (() => true),
    ...(options.largeDownloadConfirmBytes === undefined ? {} : { largeDownloadConfirmBytes: options.largeDownloadConfirmBytes }),
  })
  return { made, handle, fetch, adapters, events: recorder.events, manager }
}

/** Extract `.error` from a rejection value (ModelFailure shape). */
export function failureOf(rejection: unknown): { code: string; retryable: boolean } | undefined {
  if (typeof rejection === 'object' && rejection !== null && 'error' in rejection) {
    const error = (rejection as { error: unknown }).error
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const candidate = error as { code?: unknown; retryable?: unknown }
      if (typeof candidate.code === 'string') return { code: candidate.code, retryable: candidate.retryable === true }
    }
  }
  return undefined
}
