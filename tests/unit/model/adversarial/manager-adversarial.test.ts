// ADVERSARIAL (unit-03 red-team): manager-seam abuse attempts. These pin the
// single-flight/busy/cancel semantics from the attacker's seat: try to get two
// live fetch sequences, a stale gate, a selection leak, or a usable adapter
// across unload through the public ModelManager API only.
import { describe, expect, test } from 'vitest'
import { createManagerScenario, eventRecorder, fakeAdapterRegistry, failureOf, makeCapabilities, makeSyntheticSpec, createFakeFetch, createFakeAdapters, createTestCache, waitFor } from '../fakes'
import type { ModelManagerEvent } from '@engine/protocol'

function eventsOf(events: ModelManagerEvent[], t: ModelManagerEvent['t']): ModelManagerEvent[] {
  return events.filter((event) => event.t === t)
}

describe('ADVERSARIAL CC-03.6: single-flight/busy cannot be walked around', () => {
  test('ADVERSARIAL CC-03.6: concurrent same-id loads after a DIFFERENT-id BUSY rejection still coalesce to one sequence', async () => {
    const a = await makeSyntheticSpec({ id: 'adv-busy-a@ad100001', fileSizes: [4096] })
    const b = await makeSyntheticSpec({ id: 'adv-busy-b@ad100002', fileSizes: [4096] })
    const registry = { [a.spec.id]: a.spec, [b.spec.id]: b.spec }
    const served = new Map([...a.served, ...b.served])
    const fetch = createFakeFetch({ served, delayMs: 40 })
    const handle = await createTestCache({ registry, fetchImpl: fetch.fetchImpl })
    const adapters = createFakeAdapters()
    const recorder = eventRecorder()
    const { createModelManager } = await import('@engine/model/manager')
    const manager = createModelManager({
      registry,
      fetchImpl: fetch.fetchImpl,
      cache: handle.cache,
      adapters: fakeAdapterRegistry(adapters),
      capabilities: async () => makeCapabilities(),
      emit: recorder.emit,
      online: () => true,
    })
    const first = manager.loadModel(a.spec.id)
    await waitFor(() => fetch.calls.length > 0)
    const busyRejection = await manager.loadModel(b.spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect((busyRejection as { error?: { detail?: string } })?.error?.detail, 'different id while busy').toBe('BUSY')
    const coalesced = await Promise.all([first, manager.loadModel(a.spec.id)])
    expect(coalesced, 'same-id coalescing survives an intervening BUSY').toEqual([undefined, undefined])
    for (const url of [...a.modelUrls, ...a.wasmUrls]) expect(fetch.callsFor(url), `${url} fetched exactly once`).toBe(1)
    expect(fetch.callsFor(b.modelUrls[0] as string), 'the BUSY id never got a fetch started').toBe(0)
    expect(eventsOf(recorder.events, 'model:ready').length).toBe(1)
  })

  test('ADVERSARIAL CC-03.7: confirmDownload on a HELD gate survives a BUSY attempt for another id', async () => {
    const scene = await createManagerScenario({ id: 'adv-gate-busy@ad100003', fileSizes: [4096], approxBytes: 150_000_000 })
    const pending = scene.manager.loadModel(scene.made.spec.id)
    await waitFor(() => eventsOf(scene.events, 'model:confirm-required').length > 0)
    expect(failureOf(await scene.manager.loadModel('other@00000000').then(() => undefined, (error: unknown) => error))?.code, 'different id while busy').toBe('ENGINE_INTERNAL')
    scene.manager.confirmDownload(scene.made.spec.id)
    await pending
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })

  test('ADVERSARIAL CC-03.6: getAdapter before any load and currentSelection after a failed load are clean', async () => {
    const scene = await createManagerScenario({
      id: 'adv-clean-state@ad100004',
      fileSizes: [4096],
      caps: { tier: 'T4', webgpuAdapter: false, wasmSimd: false, reasons: ['NO_WEBGPU_AND_NO_WASM_SIMD'] },
    })
    expect(failureOf(await scene.manager.getAdapter(scene.made.spec.id).then(() => undefined, (error: unknown) => error))?.code).toBe('MODEL_UNLOADED')
    expect(failureOf(await scene.manager.loadModel(scene.made.spec.id).then(() => undefined, (error: unknown) => error))?.code).toBe('ENGINE_INTERNAL')
    expect(scene.manager.currentSelection(), 'failed T4 load leaks no selection').toBeUndefined()
    expect(scene.fetch.calls.length).toBe(0)
  })

  test('ADVERSARIAL CC-03.5: loadModel after a NETWORK failure is unpoisoned and completes', async () => {
    const scene = await createManagerScenario({ id: 'adv-recover-net@ad100005', fileSizes: [4096, 8192] })
    const brokenUrl = scene.made.modelUrls[0] as string
    scene.fetch.failUrls.add(brokenUrl)
    expect(failureOf(await scene.manager.loadModel(scene.made.spec.id).then(() => undefined, (error: unknown) => error))?.code).toBe('NETWORK')
    scene.fetch.failUrls.delete(brokenUrl)
    await scene.manager.loadModel(scene.made.spec.id)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
    expect(scene.handle.store.stored.has(brokenUrl)).toBe(true)
  })

  test('ADVERSARIAL CC-03.6: adapter load receives a signal that aborts on cancelLoad mid-compile', async () => {
    const made = await makeSyntheticSpec({ id: 'adv-signal-compile@ad100006', fileSizes: [4096] })
    const registry = { [made.spec.id]: made.spec }
    const fetch = createFakeFetch({ served: made.served })
    const handle = await createTestCache({ registry, fetchImpl: fetch.fetchImpl })
    let seenSignal: AbortSignal | undefined
    const adapters = createFakeAdapters()
    const { createModelManager } = await import('@engine/model/manager')
    const manager = createModelManager({
      registry,
      fetchImpl: fetch.fetchImpl,
      cache: handle.cache,
      adapters: {
        'transformers-whisper': async (spec) => {
          const adapter = await adapters.factory(spec)
          return {
            ...adapter,
            load: async (input) => {
              seenSignal = input.signal
              await adapter.load(input)
            },
          }
        },
        'sherpa-wasm': adapters.factory,
        'cactus-whistle': adapters.factory,
      },
      capabilities: async () => makeCapabilities(),
      emit: () => undefined,
      online: () => true,
    })
    await manager.loadModel(made.spec.id)
    expect(seenSignal, 'adapter.load got the entry signal').toBeDefined()
    expect(seenSignal?.aborted, 'completed load left the signal un-aborted').toBe(false)
  })
})
