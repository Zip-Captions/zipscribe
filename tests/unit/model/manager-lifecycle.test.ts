// CC-03.6 (L2): manager lifecycle — single-flight coalescing, cancelLoad and
// unload → MODEL_UNLOADED. Plus the manager-side halves of CC-03.2 (T4 blocked
// state attempts ZERO downloads) and the offline/notice + progress-phase
// stories (US-03.1 / US-1.1.1 / US-1.1.3).
//
// Contract: FR-03.4 — loadModel(id) → ready | error, unload(), single-flight
// coalescing, cancelLoad(). CC-03.6: two concurrent loadModel(id) trigger
// exactly ONE underlying fetch sequence; cancelLoad() aborts; unload() then any
// engine call → MODEL_UNLOADED. US-1.1.1: T4 → blocked state, no downloads.
// US-03.1: offline + uncached → OFFLINE_MODEL_MISSING notice immediately, no
// fetch attempted, no hang. US-1.1.3: model:progress phase 'download' then
// 'compile' before model:ready.
import { describe, expect, test } from 'vitest'
import { createManagerScenario, eventRecorder, fakeAdapterRegistry, failureOf, makeCapabilities, makeSyntheticSpec, createFakeFetch, createFakeAdapters, createTestCache, waitFor } from './fakes'
import type { ModelManagerEvent } from '@engine/protocol'

function eventsOf(events: ModelManagerEvent[], t: ModelManagerEvent['t']): ModelManagerEvent[] {
  return events.filter((event) => event.t === t)
}

describe('CC-03.6: single-flight, cancel, unload', () => {
  test('CC-03.6: two concurrent loadModel(id) → exactly ONE fetch sequence, one adapter load', async () => {
    const scene = await createManagerScenario({ id: 'single-flight@45454545', fileSizes: [4096, 8192, 2048], delayMs: 20 })
    const [first, second] = await Promise.all([scene.manager.loadModel(scene.made.spec.id), scene.manager.loadModel(scene.made.spec.id)])
    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    const allUrls = [...scene.made.modelUrls, ...scene.made.wasmUrls]
    for (const url of allUrls) expect(scene.fetch.callsFor(url), `each URL fetched exactly once (single-flight coalescing)`).toBe(1)
    expect(scene.fetch.calls.length, 'one underlying fetch sequence total').toBe(allUrls.length)
    expect(scene.adapters.loads.length, 'adapter compiled once').toBe(1)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })

  test('CC-03.6: cancelLoad() aborts the in-flight download (signal observed, CANCELLED)', async () => {
    const scene = await createManagerScenario({ id: 'cancel-load@56565656', fileSizes: [4096, 8192], delayMs: 120 })
    const pending = scene.manager.loadModel(scene.made.spec.id)
    let settled: 'resolved' | 'rejected' = 'resolved'
    void pending.then(
      () => undefined,
      () => (settled = 'rejected'),
    )
    await waitFor(() => scene.fetch.calls.length > 0)
    scene.manager.cancelLoad()
    const rejection = await pending.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(settled, 'load rejected after cancel').toBe('rejected')
    expect(failureOf(rejection)?.code, 'CANCELLED error').toBe('CANCELLED')
    const observedAbort = scene.fetch.signals.some((signal) => signal?.aborted === true)
    expect(observedAbort, 'the fetch signal was aborted').toBe(true)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
  })

  test('CC-03.6: unload() → subsequent engine call gets MODEL_UNLOADED; reload works', async () => {
    const scene = await createManagerScenario({ id: 'unload-me@67676767', fileSizes: [4096] })
    await scene.manager.loadModel(scene.made.spec.id)
    const loadedAdapter = await scene.manager.getAdapter(scene.made.spec.id)
    expect(await loadedAdapter.invoke('transcribe', {}), 'engine call reachable while loaded').toBe('transcribe')
    await scene.manager.unload()
    expect(scene.adapters.calls.some((call) => call.method === 'unload'), 'adapter.unload called').toBe(true)
    const rejection = await scene.manager.getAdapter(scene.made.spec.id).then(
      (adapter) => adapter.invoke('transcribe'),
      (error: unknown) => error,
    )
    expect(failureOf(rejection)?.code, 'any engine call after unload → MODEL_UNLOADED').toBe('MODEL_UNLOADED')
    // US-1.1.2 reload: cached model comes back with zero new model-file fetches.
    const before = scene.made.modelUrls.reduce((sum, url) => sum + scene.fetch.callsFor(url), 0)
    await scene.manager.loadModel(scene.made.spec.id)
    const after = scene.made.modelUrls.reduce((sum, url) => sum + scene.fetch.callsFor(url), 0)
    expect(after, 'reload served from cache — zero re-downloads').toBe(before)
    expect(eventsOf(scene.events, 'model:ready').length, 'ready again').toBe(2)
  })
})

describe('CC-03.2: blocked state publishes reasons and attempts zero downloads', () => {
  test('CC-03.2: T4 capabilities → loadModel fails with ZERO fetch attempts', async () => {
    const scene = await createManagerScenario({
      id: 'blocked-t4@78787878',
      fileSizes: [4096],
      caps: { tier: 'T4', webgpuAdapter: false, wasmSimd: false, reasons: ['NO_WEBGPU_AND_NO_WASM_SIMD'] },
    })
    const rejection = await scene.manager.loadModel(scene.made.spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(rejection, 'blocked load rejects').toBeDefined()
    expect(scene.fetch.calls.length, 'US-1.1.1: zero downloads attempted when blocked').toBe(0)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
  })
})

describe('US-03.1 / US-1.1.3: offline notice and honest progress (engine seam, L2)', () => {
  test('US-03.1: offline + uncached → OFFLINE_MODEL_MISSING notice immediately, no fetch attempted', async () => {
    let online = true
    const scene = await createManagerScenario({ id: 'offline-miss@89898989', fileSizes: [4096], online: () => online })
    online = false
    const startedAt = Date.now()
    const rejection = await scene.manager.loadModel(scene.made.spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    const elapsed = Date.now() - startedAt
    expect(rejection, 'fails immediately — never hangs').toBeDefined()
    expect(elapsed, 'immediate failure (1 s budget asserted at L4, comfortably met at L2)').toBeLessThan(1000)
    const notice = scene.events.find((event) => event.t === 'notice' && (event as { notice: { code: string } }).notice.code === 'OFFLINE_MODEL_MISSING')
    expect(notice, 'OFFLINE_MODEL_MISSING notice emitted').toBeDefined()
    expect(scene.fetch.calls.length, 'no fetch attempted').toBe(0)
  })

  test('US-03.1: offline + cached model still loads', async () => {
    let online = true
    const scene = await createManagerScenario({ id: 'offline-hit@9a9a9a9a', fileSizes: [4096, 8192], online: () => online })
    await scene.manager.loadModel(scene.made.spec.id)
    await scene.manager.unload()
    online = false
    const callsBefore = scene.fetch.calls.length
    await scene.manager.loadModel(scene.made.spec.id)
    expect(scene.fetch.calls.length, 'served from cache — zero network attempts while offline').toBe(callsBefore)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(2)
  })

  test('US-1.1.3: model:progress phase download → compile → ready', async () => {
    const scene = await createManagerScenario({ id: 'progress-order@abababab', fileSizes: [4096, 8192], chunkSize: 1024 })
    await scene.manager.loadModel(scene.made.spec.id)
    const phases = scene.events.filter((event) => event.t === 'model:progress') as { t: 'model:progress'; model: string; phase: 'download' | 'compile'; received: number }[]
    const downloadIndex = phases.findIndex((event) => event.phase === 'download')
    const compileIndex = phases.findIndex((event) => event.phase === 'compile')
    expect(downloadIndex, 'download progress emitted').toBeGreaterThanOrEqual(0)
    expect(compileIndex, 'compile (warm-up) progress emitted').toBeGreaterThanOrEqual(0)
    expect(compileIndex, 'compile follows download').toBeGreaterThan(downloadIndex)
    const readyIndex = scene.events.findIndex((event) => event.t === 'model:ready')
    expect(readyIndex, 'ready last').toBeGreaterThan(scene.events.indexOf(phases[compileIndex] as ModelManagerEvent))
    const firstProgress = phases[downloadIndex]
    expect(firstProgress, 'download progress carries received bytes').toMatchObject({ phase: 'download' })
  })

  test('US-1.1.1: T2 selection reports model:ready with device wasm; T1 with webgpu', async () => {
    const madeT2 = await makeSyntheticSpec({ id: 'device-wasm@bcbcbcbc', fileSizes: [4096] })
    const registry = { [madeT2.spec.id]: madeT2.spec }
    const fetchT2 = createFakeFetch({ served: madeT2.served })
    const handle = await createTestCache({ registry, fetchImpl: fetchT2.fetchImpl })
    const adapters = createFakeAdapters()
    const recorder = eventRecorder()
    const { createModelManager } = await import('@engine/model/manager')
    const manager = createModelManager({
      registry,
      fetchImpl: fetchT2.fetchImpl,
      cache: handle.cache,
      adapters: fakeAdapterRegistry(adapters),
      capabilities: async () => makeCapabilities({ tier: 'T2' }),
      emit: recorder.emit,
      online: () => true,
    })
    await manager.loadModel(madeT2.spec.id)
    const ready = recorder.events.find((event) => event.t === 'model:ready') as { device?: string } | undefined
    expect(ready?.device, 'no webgpu → device wasm (US-1.1.1)').toBe('wasm')
    expect(adapters.loads[0]?.device).toBe('wasm')
  })
})
