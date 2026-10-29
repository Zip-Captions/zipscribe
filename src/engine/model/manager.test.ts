// L1 module tests for the model manager (FR-03.4, FR-03.5). The acceptance
// gate for CC-03.5/CC-03.6/CC-03.7 is the frozen `tests/unit/model/manager-*.test.ts`
// suites; these are the source-adjacent unit tests required by
// knowledge/conventions.md for every engine module — they also keep the module
// covered in child runs where the frozen suites are excluded (vitest.config
// child-safety list), so event ordering, single-flight, cancel, the confirm
// gate, the tamper re-download internals and the default-dep branches are all
// exercised here.
//
// Everything is injected (registry/cache/adapters/capabilities/online/emit) —
// no network, no DOM globals, binary-noise bytes only (SECURITY-03).
import { describe, expect, test } from 'vitest'
import { createModelManager, LARGE_DOWNLOAD_CONFIRM_BYTES } from './manager'
import type { AdapterFactory, EngineAdapter, ModelManagerDeps, ModelManagerEvent } from './manager'
import { createModelCache, sha256Hex } from './cache'
import type { CacheLike } from './cache'
import type { Capabilities } from './capability'
import type { ModelSpec } from './registry'

const SELF = 'https://app.test'
const WASM_PATH = '/wasm/mgr-test.wasm'

function prng(seed: string, length: number): Uint8Array<ArrayBuffer> {
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

function flip(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const copy = bytes.slice()
  const first = copy[0] ?? 0
  copy[0] = first ^ 0xff
  return copy
}

function urlOf(repo: string, revision: string, path: string): string {
  return `https://huggingface.co/${repo}/resolve/${revision}/${path}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met within budget')
    await sleep(1)
  }
}

function makeCapabilities(overrides: Partial<Capabilities> = {}): Capabilities {
  return { tier: 'T2', webgpuAdapter: false, wasmSimd: true, audioDecoder: true, audioEncoder: true, videoEncoder: true, deviceMemGB: null, online: true, reasons: [], ...overrides }
}

interface MadeSpec {
  spec: ModelSpec
  served: Map<string, Uint8Array<ArrayBuffer>>
  modelUrls: string[]
  wasmUrl: string
}

async function makeSpec(id: string, fileSizes: number[] = [64, 128], approxBytes?: number): Promise<MadeSpec> {
  const repo = `zipscribe-unit/${id.split('@')[0] ?? 'model'}`
  const revision = '0123456789abcdef0123456789abcdef01234567'
  const files = [] as ModelSpec['files']
  const served = new Map<string, Uint8Array<ArrayBuffer>>()
  const modelUrls: string[] = []
  for (const [index, size] of fileSizes.entries()) {
    const path = `onnx/part-${index}.onnx`
    const bytes = prng(`${id}/${path}`, size)
    files.push({ path, sha256: await sha256Hex(bytes), bytes: size })
    served.set(urlOf(repo, revision, path), bytes)
    modelUrls.push(urlOf(repo, revision, path))
  }
  const wasmBytes = prng(`${id}${WASM_PATH}`, 32)
  const wasmUrl = new URL(WASM_PATH, SELF).href
  served.set(wasmUrl, wasmBytes)
  const spec: ModelSpec = {
    id,
    engine: 'transformers-whisper',
    repo,
    revision,
    files,
    approxBytes: approxBytes ?? fileSizes.reduce((a, b) => a + b, 0),
    languages: ['*'],
    punctuation: false,
    confidence: false,
    languageDetect: true,
    timestampMode: 'word-native',
    license: 'Apache-2.0',
    tierHint: 'T2',
    runtimeWasm: [WASM_PATH],
    enOnly: false,
  }
  return { spec, served, modelUrls, wasmUrl }
}

interface FakeFetch {
  fetchImpl: NonNullable<ModelManagerDeps['fetchImpl']>
  calls: string[]
  signals: (AbortSignal | undefined)[]
  failUrls: Set<string>
  corruptUrls: Set<string>
  delayMs: number
  callsFor(url: string): number
}

function makeFetch(served: Map<string, Uint8Array<ArrayBuffer>>): FakeFetch {
  const fake: FakeFetch = {
    fetchImpl: (url, init) => {
      fake.calls.push(url)
      fake.signals.push(init?.signal)
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal
        const onAbort = (): void => {
          clearTimeout(timer)
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          if (fake.failUrls.has(url)) return reject(new TypeError('network drop (simulated)'))
          const planned = served.get(url)
          if (planned === undefined) return reject(new Error(`unexpected fetch ${url} (outside test plan)`))
          resolve(new Response(fake.corruptUrls.has(url) ? flip(planned) : planned))
        }, fake.delayMs)
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted === true) onAbort()
      })
    },
    calls: [],
    signals: [],
    failUrls: new Set<string>(),
    corruptUrls: new Set<string>(),
    delayMs: 0,
    callsFor: (url) => fake.calls.filter((call) => call === url).length,
  }
  return fake
}

function makeStore(): CacheLike & { stored: Map<string, Uint8Array<ArrayBuffer>> } {
  const stored = new Map<string, Uint8Array<ArrayBuffer>>()
  return {
    stored,
    match: (key) => {
      const hit = stored.get(key)
      return Promise.resolve(hit === undefined ? undefined : new Response(hit.slice()))
    },
    put: (key, body) => {
      stored.set(key, body.slice())
      return Promise.resolve()
    },
    delete: (key) => Promise.resolve(stored.delete(key)),
  }
}

type RecordingAdapter = EngineAdapter & { unloads: number }

interface AdapterRecorder {
  factory: AdapterFactory
  adapters: RecordingAdapter[]
  loads: { spec: ModelSpec; device: string; files: Record<string, Uint8Array>; signal: AbortSignal }[]
  failLoad: boolean
}

function makeAdapters(): AdapterRecorder {
  const adapters: RecordingAdapter[] = []
  const loads: AdapterRecorder['loads'] = []
  const recorder: AdapterRecorder = {
    factory: () => {
      const adapter: RecordingAdapter = {
        unloads: 0,
        load: (input) => {
          if (recorder.failLoad) return Promise.reject(new Error('adapter compile failed (simulated)'))
          loads.push({ spec: input.spec, device: input.device, files: input.files, signal: input.signal })
          return Promise.resolve()
        },
        invoke: (method) => Promise.resolve(method),
        unload: () => {
          adapter.unloads += 1
          return Promise.resolve()
        },
      }
      adapters.push(adapter)
      return adapter
    },
    adapters,
    loads,
    failLoad: false,
  }
  return recorder
}

function failureOf(rejection: unknown): { code: string; retryable: boolean; detail?: string } | undefined {
  if (typeof rejection !== 'object' || rejection === null || !('error' in rejection)) return undefined
  const error: unknown = rejection.error
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const candidate = error as { code: string; retryable: boolean; detail?: string }
  return { code: candidate.code, retryable: candidate.retryable === true, ...(candidate.detail === undefined ? {} : { detail: candidate.detail }) }
}

function rejectCode(promise: Promise<unknown>): Promise<{ code: string; retryable: boolean; detail?: string } | undefined> {
  return promise.then(
    () => undefined,
    (error: unknown) => failureOf(error),
  )
}

interface Scenario {
  events: ModelManagerEvent[]
  fetch: FakeFetch
  store: CacheLike & { stored: Map<string, Uint8Array<ArrayBuffer>> }
  adapters: AdapterRecorder
}

function makeScenario(
  made: MadeSpec[],
  options: { caps?: Partial<Capabilities>; online?: () => boolean; confirmThreshold?: number; omitEmit?: boolean; omitOnline?: boolean; omitRegistry?: boolean; adapters?: AdapterRecorder } = {},
): { manager: ReturnType<typeof createModelManager>; scene: Scenario } {
  const registry: Record<string, ModelSpec> = {}
  const served = new Map<string, Uint8Array<ArrayBuffer>>()
  for (const m of made) {
    registry[m.spec.id] = m.spec
    for (const [url, bytes] of m.served) served.set(url, bytes)
  }
  const fetch = makeFetch(served)
  const store = makeStore()
  const cache = createModelCache({ registry: options.omitRegistry ? undefined : registry, fetchImpl: fetch.fetchImpl, cacheStore: store, selfOrigin: SELF })
  const adapters = options.adapters ?? makeAdapters()
  const events: ModelManagerEvent[] = []
  const deps: ModelManagerDeps = {
    ...(options.omitRegistry ? {} : { registry }),
    fetchImpl: fetch.fetchImpl,
    cache,
    adapters: { 'transformers-whisper': adapters.factory, 'sherpa-wasm': adapters.factory },
    capabilities: () => Promise.resolve(makeCapabilities(options.caps)),
    ...(options.omitEmit ? {} : { emit: (event: ModelManagerEvent) => void events.push(event) }),
    ...(options.omitOnline ? {} : { online: options.online ?? (() => true) }),
    ...(options.confirmThreshold === undefined ? {} : { largeDownloadConfirmBytes: options.confirmThreshold }),
  }
  return { manager: createModelManager(deps), scene: { events, fetch, store, adapters } }
}

function eventsOf(events: ModelManagerEvent[], t: ModelManagerEvent['t']): ModelManagerEvent[] {
  return events.filter((event) => event.t === t)
}

function errorsWithCode(events: ModelManagerEvent[], code: string): { error: { code: string; retryable: boolean } }[] {
  return eventsOf(events, 'model:error').filter((event) => (event as { error: { code: string } }).error.code === code) as { error: { code: string; retryable: boolean } }[]
}

describe('CC-03.6 / US-1.1.3: load lifecycle, progress order, single-flight, unload', () => {
  test('CC-03.6: fresh load emits download → compile → ready, hands verified bytes to the adapter', async () => {
    const made = await makeSpec('lifecycle@11111111', [64, 128])
    const { manager, scene } = makeScenario([made])
    await manager.loadModel(made.spec.id)
    const phases = scene.events.filter((event) => event.t === 'model:progress') as { phase: string; received: number }[]
    expect(
      phases.map((event) => event.phase),
      'phase order',
    ).toEqual(['download', 'download', 'compile'])
    expect(phases[1]?.received, 'cumulative received bytes across files').toBe(192)
    expect(scene.events.indexOf(scene.events.find((event) => event.t === 'model:ready') as ModelManagerEvent), 'ready last').toBe(scene.events.length - 1)
    const load = scene.adapters.loads[0]
    expect(load?.device).toBe('wasm')
    expect(load?.spec.id).toBe(made.spec.id)
    expect([...(load?.files['onnx/part-0.onnx'] ?? [])], 'verified bytes handed to the adapter').toEqual([...(made.served.get(made.modelUrls[0] as string) ?? [])])
    expect(load?.signal).toBeInstanceOf(AbortSignal)
    expect(manager.currentSelection()).toMatchObject({ model: made.spec.id, tier: 'T2', device: 'wasm', engine: 'transformers-whisper' })
  })

  test('CC-03.6: two concurrent loadModel(same id) coalesce into one fetch sequence and one adapter load', async () => {
    const made = await makeSpec('coalesce@22222222', [64, 128])
    const { manager, scene } = makeScenario([made])
    await Promise.all([manager.loadModel(made.spec.id), manager.loadModel(made.spec.id)])
    expect(scene.fetch.calls.length, 'one underlying sequence: 2 files + 1 wasm').toBe(3)
    expect(scene.adapters.adapters.length, 'adapter created once').toBe(1)
    expect(scene.adapters.loads.length, 'adapter compiled once').toBe(1)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })

  test('CC-03.6: concurrent load of a different id while busy rejects ENGINE_INTERNAL', async () => {
    const first = await makeSpec('busy-a@33333333')
    const second = await makeSpec('busy-b@44444444')
    const { manager, scene } = makeScenario([first, second])
    scene.fetch.delayMs = 20
    const pending = manager.loadModel(first.spec.id)
    await waitFor(() => scene.fetch.calls.length > 0)
    expect(await rejectCode(manager.loadModel(second.spec.id))).toMatchObject({ code: 'ENGINE_INTERNAL', detail: 'BUSY' })
    scene.fetch.delayMs = 0
    await expect(pending).resolves.toBeUndefined()
  })

  test('CC-03.6: unload → adapter.unload, then MODEL_UNLOADED; reload from cache with zero fetches', async () => {
    const made = await makeSpec('unload-me@55555555', [64])
    const { manager, scene } = makeScenario([made])
    await manager.loadModel(made.spec.id)
    const adapter = await manager.getAdapter(made.spec.id)
    expect(await adapter.invoke('transcribe', {})).toBe('transcribe')
    await manager.unload()
    expect(scene.adapters.adapters[0]?.unloads, 'adapter.unload called').toBe(1)
    expect(await rejectCode(manager.getAdapter(made.spec.id))).toMatchObject({ code: 'MODEL_UNLOADED' })
    const before = scene.fetch.calls.length
    await manager.loadModel(made.spec.id)
    expect(scene.fetch.calls.length, 'cache-served reload — zero fetches').toBe(before)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(2)
  })

  test('CC-03.6: unload is idempotent; unload without load is a no-op', async () => {
    const made = await makeSpec('unload-twice@66666666', [64])
    const { manager, scene } = makeScenario([made])
    await manager.unload()
    await manager.loadModel(made.spec.id)
    await manager.unload()
    await manager.unload()
    expect(scene.adapters.adapters[0]?.unloads).toBe(1)
  })

  test('CC-03.6: getAdapter for a different id rejects MODEL_UNLOADED; replacing a loaded model unloads the previous adapter', async () => {
    const a = await makeSpec('model-a@77777777', [64])
    const b = await makeSpec('model-b@88888888', [64])
    const { manager, scene } = makeScenario([a, b])
    await manager.loadModel(a.spec.id)
    expect(await rejectCode(manager.getAdapter(b.spec.id))).toMatchObject({ code: 'MODEL_UNLOADED' })
    await manager.loadModel(b.spec.id)
    expect(scene.adapters.adapters[0]?.unloads, 'previous adapter unloaded on replace').toBe(1)
    expect(await (await manager.getAdapter(b.spec.id)).invoke('ping')).toBe('ping')
    expect(manager.currentSelection()?.model).toBe(b.spec.id)
  })
})

describe('CC-03.7: confirmation gate', () => {
  test('CC-03.7: approxBytes above the gate emits confirm-required with declared bytes and holds pending until confirmDownload', async () => {
    const made = await makeSpec('gated@99999999', [64], 150_000_000)
    const { manager, scene } = makeScenario([made])
    let settled = false
    const pending = manager.loadModel(made.spec.id).then(
      () => (settled = true),
      () => (settled = true),
    )
    await waitFor(() => eventsOf(scene.events, 'model:confirm-required').length > 0)
    const confirm = eventsOf(scene.events, 'model:confirm-required')[0] as { model: string; bytes: number }
    expect(confirm).toMatchObject({ model: made.spec.id, bytes: 150_000_000 })
    expect(scene.events.indexOf(confirm as ModelManagerEvent), 'confirm is the first event').toBe(0)
    expect(scene.fetch.calls.length, 'zero bytes fetched while unconfirmed').toBe(0)
    expect(settled, 'held pending').toBe(false)
    manager.confirmDownload(made.spec.id)
    await expect(pending).resolves.toBeTruthy()
    expect(scene.fetch.calls.length, 'download resumed in the same sequence').toBeGreaterThan(0)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })

  test('CC-03.7: default gate is 100 MB — approxBytes exactly at the constant is not gated', async () => {
    const made = await makeSpec('edge-gate@aaaaaaaa', [64], LARGE_DOWNLOAD_CONFIRM_BYTES)
    const { manager, scene } = makeScenario([made])
    await manager.loadModel(made.spec.id)
    expect(eventsOf(scene.events, 'model:confirm-required').length).toBe(0)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })

  test('CC-03.7: deps.largeDownloadConfirmBytes override and opts.confirmed both skip the gate', async () => {
    const made = await makeSpec('override-gate@bbbbbbbb', [64], 150_000_000)
    const overridden = makeScenario([made], { confirmThreshold: 200_000_000 })
    await overridden.manager.loadModel(made.spec.id)
    expect(eventsOf(overridden.scene.events, 'model:confirm-required').length).toBe(0)

    const preConfirmed = makeScenario([made])
    await preConfirmed.manager.loadModel(made.spec.id, { confirmed: true })
    expect(eventsOf(preConfirmed.scene.events, 'model:confirm-required').length, 'opts.confirmed pre-authorises').toBe(0)
    expect(eventsOf(preConfirmed.scene.events, 'model:ready').length).toBe(1)
  })

  test('CC-03.7: cancelLoad during the confirm gate rejects CANCELLED (abort reaches the waiting gate)', async () => {
    const made = await makeSpec('gate-cancel@cccccccc', [64], 150_000_000)
    const { manager, scene } = makeScenario([made])
    const pending = manager.loadModel(made.spec.id)
    await waitFor(() => eventsOf(scene.events, 'model:confirm-required').length > 0)
    manager.cancelLoad()
    expect(await rejectCode(pending)).toMatchObject({ code: 'CANCELLED' })
    expect(scene.fetch.calls.length).toBe(0)
  })

  test('CC-03.7: confirmDownload with no matching in-flight load is a no-op', async () => {
    const made = await makeSpec('no-confirm@dddddddd', [64])
    const { manager } = makeScenario([made])
    manager.confirmDownload('nope@00000000')
    manager.confirmDownload(made.spec.id)
    await expect(manager.loadModel(made.spec.id)).resolves.toBeUndefined()
  })
})

describe('CC-03.5: download failures leave no partial cache', () => {
  test('CC-03.5: fetch drop → NETWORK retryable emitted + rejected, store untouched, retry completes', async () => {
    const made = await makeSpec('drop@eeeeeeee', [64, 128])
    const { manager, scene } = makeScenario([made])
    scene.fetch.failUrls.add(made.modelUrls[0] as string)
    const rejection = await rejectCode(manager.loadModel(made.spec.id))
    expect(rejection).toMatchObject({ code: 'NETWORK', retryable: true })
    expect(errorsWithCode(scene.events, 'NETWORK').length, 'single model:error NETWORK').toBe(1)
    expect(scene.store.stored.size, 'no partial entries — not even completed files').toBe(0)
    scene.fetch.failUrls.clear()
    await manager.loadModel(made.spec.id)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
    expect(scene.fetch.callsFor(made.modelUrls[0] as string), 'failed file refetched once on retry').toBe(2)
    expect(scene.store.stored.has(made.modelUrls[0] as string)).toBe(true)
  })

  test('CC-03.5: corrupt download is never cached — bounded to one fetch, surfaces CACHE_CORRUPT', async () => {
    const made = await makeSpec('net-corrupt@ffffffff', [64])
    const { manager, scene } = makeScenario([made])
    scene.fetch.corruptUrls.add(made.modelUrls[0] as string)
    expect(await rejectCode(manager.loadModel(made.spec.id))).toMatchObject({ code: 'CACHE_CORRUPT' })
    expect(scene.fetch.callsFor(made.modelUrls[0] as string), 'no retry loop').toBe(1)
    expect(scene.store.stored.has(made.modelUrls[0] as string), 'corrupt bytes never cached').toBe(false)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
  })

  test('CC-03.6: cancelLoad mid-download aborts the fetch signal, rejects CANCELLED, caches nothing', async () => {
    const made = await makeSpec('cancel@12121212', [64, 128])
    const { manager, scene } = makeScenario([made])
    scene.fetch.delayMs = 40
    const pending = manager.loadModel(made.spec.id)
    await waitFor(() => scene.fetch.calls.length > 0)
    manager.cancelLoad()
    expect(await rejectCode(pending)).toMatchObject({ code: 'CANCELLED' })
    expect(
      scene.fetch.signals.some((signal) => signal?.aborted === true),
      'the fetch signal was aborted',
    ).toBe(true)
    expect(scene.store.stored.size, 'nothing partial cached').toBe(0)
    expect(errorsWithCode(scene.events, 'CANCELLED').length).toBe(1)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
    scene.fetch.delayMs = 0
    await expect(manager.loadModel(made.spec.id)).resolves.toBeUndefined()
    expect(eventsOf(scene.events, 'model:ready').length, 'a cancelled load does not poison the manager').toBe(1)
  })
})

describe('CC-03.7: tampered cache → CACHE_CORRUPT + bounded re-download', () => {
  test('CC-03.7: tampered cached file → CACHE_CORRUPT emitted once, evicted, exactly one re-download, ready', async () => {
    const made = await makeSpec('tamper@13131313', [64, 128])
    const { manager, scene } = makeScenario([made])
    const tamperedUrl = made.modelUrls[0] as string
    await scene.store.put(tamperedUrl, flip(made.served.get(tamperedUrl) as Uint8Array<ArrayBuffer>))
    await manager.loadModel(made.spec.id)
    expect(errorsWithCode(scene.events, 'CACHE_CORRUPT').length, 'exactly one CACHE_CORRUPT model:error').toBe(1)
    expect(scene.fetch.callsFor(tamperedUrl), 'exactly one automatic re-download').toBe(1)
    expect([...(scene.store.stored.get(tamperedUrl) ?? [])], 'replaced with verified bytes').toEqual([...(made.served.get(tamperedUrl) ?? [])])
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })

  test('CC-03.7: cache AND network corrupt → error surfaces, one eviction re-download, no loop', async () => {
    const made = await makeSpec('both-corrupt@14141414', [64])
    const { manager, scene } = makeScenario([made])
    const url = made.modelUrls[0] as string
    await scene.store.put(url, flip(made.served.get(url) as Uint8Array<ArrayBuffer>))
    scene.fetch.corruptUrls.add(url)
    expect(await rejectCode(manager.loadModel(made.spec.id))).toMatchObject({ code: 'CACHE_CORRUPT' })
    expect(errorsWithCode(scene.events, 'CACHE_CORRUPT').length).toBeGreaterThanOrEqual(1)
    expect(scene.fetch.callsFor(url), 'bounded — no retry loop').toBe(1)
    expect(scene.store.stored.has(url), 'corrupt bytes never cached').toBe(false)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
  })
})

describe('CC-03.2 / US-03.1: capability + offline gates, adapter seam, defaults', () => {
  test('CC-03.2: T4 capabilities → ENGINE_INTERNAL with reasons, ZERO fetches', async () => {
    const made = await makeSpec('blocked@15151515', [64])
    const { manager, scene } = makeScenario([made], { caps: { tier: 'T4', webgpuAdapter: false, wasmSimd: false, reasons: ['NO_WEBGPU_AND_NO_WASM_SIMD'] } })
    expect(await rejectCode(manager.loadModel(made.spec.id))).toMatchObject({ code: 'ENGINE_INTERNAL', detail: 'NO_WEBGPU_AND_NO_WASM_SIMD' })
    expect(scene.fetch.calls.length).toBe(0)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
    expect(manager.currentSelection(), 'nothing selected when blocked').toBeUndefined()
  })

  test('CC-03.2: unknown model id → ENGINE_INTERNAL UNKNOWN_MODEL with zero fetches (default registry branch)', async () => {
    const made = await makeSpec('known@16161616', [64])
    const { manager, scene } = makeScenario([made], { omitRegistry: true })
    expect(await rejectCode(manager.loadModel('missing@00000000'))).toMatchObject({ code: 'ENGINE_INTERNAL', detail: 'UNKNOWN_MODEL' })
    expect(scene.fetch.calls.length).toBe(0)
  })

  test('US-03.1: offline + uncached → OFFLINE_MODEL_MISSING notice + NETWORK rejection, no fetch attempted', async () => {
    const made = await makeSpec('offline-miss@17171717', [64])
    const { manager, scene } = makeScenario([made], { online: () => false })
    expect(await rejectCode(manager.loadModel(made.spec.id))).toMatchObject({ code: 'NETWORK', retryable: true })
    const notice = scene.events.find((event) => event.t === 'notice' && (event as { notice: { code: string } }).notice.code === 'OFFLINE_MODEL_MISSING')
    expect(notice, 'notice emitted').toBeDefined()
    expect(scene.fetch.calls.length).toBe(0)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
  })

  test('US-03.1: offline + fully cached (model AND runtime wasm) loads with zero fetches', async () => {
    const made = await makeSpec('offline-hit@18181818', [64])
    let online = true
    const { manager, scene } = makeScenario([made], { online: () => online })
    await manager.loadModel(made.spec.id)
    await manager.unload()
    online = false
    const before = scene.fetch.calls.length
    await manager.loadModel(made.spec.id)
    expect(scene.fetch.calls.length).toBe(before)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(2)
  })

  test('FR-03.8: model cached but runtime wasm missing → refill via ensureOffline before ready', async () => {
    const made = await makeSpec('wasm-refill@19191919', [64])
    const { manager, scene } = makeScenario([made])
    for (const url of made.modelUrls) await scene.store.put(url, made.served.get(url) as Uint8Array<ArrayBuffer>)
    await manager.loadModel(made.spec.id)
    expect(scene.fetch.callsFor(made.wasmUrl), 'missing wasm fetched once').toBe(1)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })

  test('FR-03.5: no adapter factory for the model engine → ENGINE_INTERNAL, zero fetches', async () => {
    const made = await makeSpec('no-adapter@1a1a1a1a', [64])
    const registry: Record<string, ModelSpec> = { [made.spec.id]: made.spec }
    const fetch = makeFetch(made.served)
    const cache = createModelCache({ registry, fetchImpl: fetch.fetchImpl, cacheStore: makeStore(), selfOrigin: SELF })
    const events: ModelManagerEvent[] = []
    const manager = createModelManager({ registry, fetchImpl: fetch.fetchImpl, cache, adapters: {}, capabilities: () => Promise.resolve(makeCapabilities()), emit: (event) => void events.push(event), online: () => true })
    expect(await rejectCode(manager.loadModel(made.spec.id))).toMatchObject({ code: 'ENGINE_INTERNAL', detail: 'NO_ADAPTER' })
    expect(fetch.calls.length).toBe(0)
  })

  test('FR-03.5: adapter compile failure surfaces ENGINE_INTERNAL with no ready event', async () => {
    const made = await makeSpec('fail-load@1b1b1b1b', [64])
    const adapters = makeAdapters()
    adapters.failLoad = true
    const { manager, scene } = makeScenario([made], { adapters })
    expect(await rejectCode(manager.loadModel(made.spec.id))).toMatchObject({ code: 'ENGINE_INTERNAL' })
    expect(errorsWithCode(scene.events, 'ENGINE_INTERNAL').length).toBe(1)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
  })

  test('FR-03.4: opts.device overrides the tier-derived device on compile and ready', async () => {
    const made = await makeSpec('device-override@1c1c1c1c', [64])
    const { manager, scene } = makeScenario([made])
    await manager.loadModel(made.spec.id, { device: 'webgpu' })
    expect((scene.events.find((event) => event.t === 'model:ready') as { device?: string })?.device).toBe('webgpu')
    expect(scene.adapters.loads[0]?.device).toBe('webgpu')
    expect(manager.currentSelection()?.device).toBe('webgpu')
  })

  test('FR-03.4: injected-dependency defaults (no emit, no online, default onLine) still complete a load', async () => {
    const made = await makeSpec('defaults@1d1d1d1d', [64])
    const { manager, scene } = makeScenario([made], { omitEmit: true, omitOnline: true })
    await expect(manager.loadModel(made.spec.id)).resolves.toBeUndefined()
    expect(scene.adapters.loads.length).toBe(1)
  })
})
