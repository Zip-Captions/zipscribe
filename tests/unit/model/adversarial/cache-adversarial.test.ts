// ADVERSARIAL (unit-03 red-team, adversary session): cache/confirm/cancel edge
// attacks beyond the frozen suites. Each test here is a counterexample attempt:
// it passes only if the enforcement is real (a half-written cache entry, a
// stale abort signal poisoning a reload, or a confirm gate that checks
// anything other than the declared `approxBytes` would turn it red).
//
// Provenance of each probe (see the adversary report):
//  - half-stream drop must leave NO entry (CC-03.5, stronger than the frozen
//    "the dropped URL is absent" — here: NO URL in the store at all, and the
//    dropped URL must not exist at half length).
//  - cancelLoad() followed by an immediate reload must not be poisoned by the
//    aborted AbortSignal of the first attempt (CC-03.6).
//  - the >100 MB confirm gate keys off `spec.approxBytes` ONLY (registry-lies
//    scenario — pinned so a silent re-check regression is visible).
//  - listCached/removeCached/ensureOffline interleavings stay honest (FR-03.8).
//  - storageEstimate is pure stub delegation (no consistency enforcement —
//    pinned as documented behavior).
//  - runtimeWasm entries are presence-only on read (FR-03.8 "nothing to verify
//    against") — pinned, incl. a size-equal tamper.
import { describe, expect, test } from 'vitest'
import { createManagerScenario, createTestCache, failureOf, flipFirstByte, makeSyntheticSpec, waitFor } from '../fakes'
import { createFakeFetch } from '../fakes'
import type { ModelManagerEvent } from '@engine/protocol'

function eventsOf(events: ModelManagerEvent[], t: ModelManagerEvent['t']): ModelManagerEvent[] {
  return events.filter((event) => event.t === t)
}

describe('ADVERSARIAL CC-03.5: half-stream drop leaves no trace', () => {
  test('ADVERSARIAL CC-03.5: fetch streams half the bytes then rejects → NO entry at any length, store empty', async () => {
    const scene = await createManagerScenario({ id: 'adv-half-drop@ad000001', fileSizes: [8192, 4096], chunkSize: 4096 })
    const droppedUrl = scene.made.modelUrls[0] as string
    scene.fetch.streamFailUrls.add(droppedUrl)
    const rejection = await scene.manager.loadModel(scene.made.spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureOf(rejection)?.code).toBe('NETWORK')
    expect(scene.handle.store.stored.has(droppedUrl), 'dropped URL present at all').toBe(false)
    const half = scene.handle.store.stored.get(droppedUrl)
    expect(half, 'no half-length (chunkSize=4096 of 8192) entry').toBeUndefined()
    for (const url of [...scene.made.modelUrls, ...scene.made.wasmUrls]) {
      expect(scene.handle.store.stored.has(url), `no entry for ${url} either — all-or-nothing`).toBe(false)
    }
    expect(scene.handle.store.stored.size, 'store completely empty').toBe(0)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
  })

  test('ADVERSARIAL CC-03.5: abort mid-ensureOffline (bytes fetched, before puts) leaves the store empty', async () => {
    const made = await makeSyntheticSpec({ id: 'adv-abort-put@ad000002', fileSizes: [4096, 8192], wasmSize: 2048 })
    const registry = { [made.spec.id]: made.spec }
    const fetch = createFakeFetch({ served: made.served, delayMs: 30 })
    const handle = await createTestCache({ registry, fetchImpl: fetch.fetchImpl })
    const controller = new AbortController()
    const pending = handle.cache.ensureOffline(made.spec.id, { signal: controller.signal })
    await waitFor(() => fetch.calls.length > 0)
    controller.abort()
    const rejection = await pending.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureOf(rejection)?.code, 'abort before the put phase → CANCELLED').toBe('CANCELLED')
    expect(handle.store.stored.size, 'no entries — the verify-then-put split is honored').toBe(0)
  })
})

describe('ADVERSARIAL CC-03.6: reload after cancel/unload is not poisoned', () => {
  test('ADVERSARIAL CC-03.6: cancelLoad() then immediate loadModel → second load uses a FRESH (un-aborted) signal and completes', async () => {
    const scene = await createManagerScenario({ id: 'adv-cancel-reload@ad000003', fileSizes: [4096, 8192], delayMs: 40 })
    const first = scene.manager.loadModel(scene.made.spec.id)
    await waitFor(() => scene.fetch.calls.length > 0)
    scene.manager.cancelLoad()
    const rejection = await first.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureOf(rejection)?.code).toBe('CANCELLED')
    const firstSignals = [...scene.fetch.signals]
    await scene.manager.loadModel(scene.made.spec.id)
    const secondSignals = scene.fetch.signals.slice(firstSignals.length)
    expect(secondSignals.length, 'second attempt issued fetches').toBeGreaterThan(0)
    for (const signal of secondSignals) {
      expect(signal, 'second-attempt fetches carry a signal').toBeDefined()
      expect(signal?.aborted, 'stale abort signal did NOT poison the reload').toBe(false)
    }
    expect(eventsOf(scene.events, 'model:ready').length, 'exactly one ready (the reload)').toBe(1)
    for (const url of [...scene.made.modelUrls, ...scene.made.wasmUrls]) {
      expect(scene.handle.store.stored.has(url), `${url} cached by the reload`).toBe(true)
    }
  })

  test('ADVERSARIAL CC-03.6: load → unload → load → unload → load on the same id, zero re-downloads after the first', async () => {
    const scene = await createManagerScenario({ id: 'adv-reload-cycle@ad000004', fileSizes: [4096] })
    await scene.manager.loadModel(scene.made.spec.id)
    const afterFirst = scene.fetch.calls.length
    await scene.manager.unload()
    await scene.manager.loadModel(scene.made.spec.id)
    await scene.manager.unload()
    await scene.manager.loadModel(scene.made.spec.id)
    expect(scene.fetch.calls.length, 'cache-served reloads fetched nothing').toBe(afterFirst)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(3)
    expect(scene.adapters.calls.filter((call) => call.method === 'unload').length, 'each unload reached the adapter').toBe(2)
  })

  test('ADVERSARIAL CC-03.6: cancelLoad twice and confirmDownload with nothing in flight are no-ops', async () => {
    const scene = await createManagerScenario({ id: 'adv-cancel-noop@ad000005', fileSizes: [4096] })
    expect(() => scene.manager.cancelLoad(), 'cancelLoad with nothing in flight').not.toThrow()
    expect(() => scene.manager.confirmDownload('adv-cancel-noop@ad000005'), 'confirm with nothing in flight').not.toThrow()
    await expect(scene.manager.loadModel(scene.made.spec.id)).resolves.toBeUndefined()
  })

  test('ADVERSARIAL CC-03.6: unload() during an in-flight load cancels it and leaves the manager reusable', async () => {
    const scene = await createManagerScenario({ id: 'adv-unload-mid@ad000006', fileSizes: [4096], delayMs: 60 })
    const pending = scene.manager.loadModel(scene.made.spec.id)
    await waitFor(() => scene.fetch.calls.length > 0)
    await scene.manager.unload()
    const rejection = await pending.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureOf(rejection), 'in-flight load rejected by unload').toBeDefined()
    expect(eventsOf(scene.events, 'model:ready').length).toBe(0)
    await expect(scene.manager.loadModel(scene.made.spec.id), 'manager reusable after unload-cancel').resolves.toBeUndefined()
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })
})

describe('ADVERSARIAL CC-03.7: the confirm gate trusts the registry', () => {
  test('ADVERSARIAL CC-03.7: approxBytes UNDER the gate with actual fetched bytes far OVER it — no confirm is required (registry-lies scenario, pinned)', async () => {
    // Threshold 1 000 bytes; spec declares approxBytes 900 (under) while the
    // plan actually fetches 14 336 bytes (over). The gate fires on the
    // DECLARED value only (spec US-1.1.4 keys off "a model > 100 MB" as
    // catalogued; no re-check of real bytes is required). This test pins that
    // decision so a future silent re-check — or a gate that accidentally keys
    // off actual bytes — cannot ship unnoticed.
    const scene = await createManagerScenario({
      id: 'adv-registry-lie@ad000007',
      fileSizes: [8192, 4096],
      wasmSize: 2048,
      approxBytes: 900,
      largeDownloadConfirmBytes: 1_000,
    })
    await scene.manager.loadModel(scene.made.spec.id)
    expect(eventsOf(scene.events, 'model:confirm-required').length, 'declared bytes under gate → no gate').toBe(0)
    expect(scene.fetch.calls.length, 'bytes beyond the threshold were fetched without confirmation').toBeGreaterThan(0)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })

  test('ADVERSARIAL CC-03.7: confirm-gate hold, cancelLoad, then reload with opts.confirmed → ready without a second gate', async () => {
    const scene = await createManagerScenario({ id: 'adv-gate-cancel-reload@ad000008', fileSizes: [4096], approxBytes: 150_000_000 })
    const first = scene.manager.loadModel(scene.made.spec.id)
    await waitFor(() => eventsOf(scene.events, 'model:confirm-required').length > 0)
    expect(scene.fetch.calls.length, 'zero bytes moved while held').toBe(0)
    scene.manager.cancelLoad()
    expect(failureOf(await first.then(() => undefined, (error: unknown) => error))?.code).toBe('CANCELLED')
    await scene.manager.loadModel(scene.made.spec.id, { confirmed: true })
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
    expect(scene.fetch.calls.length, 'confirmed reload downloaded').toBeGreaterThan(0)
  })
})

describe('ADVERSARIAL FR-03.8: cache races and stub drift stay honest', () => {
  test('ADVERSARIAL CC-03.4: listCached racing removeCached never throws and ends not-ready', async () => {
    const made = await makeSyntheticSpec({ id: 'adv-race-list@ad000009', fileSizes: [4096, 8192], wasmSize: 2048 })
    const registry = { [made.spec.id]: made.spec }
    const fetch = createFakeFetch({ served: made.served })
    const handle = await createTestCache({ registry, fetchImpl: fetch.fetchImpl })
    await handle.cache.ensureOffline(made.spec.id)
    const [entries] = await Promise.all([handle.cache.listCached(), handle.cache.removeCached(made.spec.id)])
    expect(entries.length, 'one row per registry id even mid-race').toBe(1)
    const final = await handle.cache.listCached()
    expect(final.find((entry) => entry.id === made.spec.id)?.offlineReady, 'eventually not-ready').toBe(false)
  })

  test('ADVERSARIAL CC-03.4: removeCached racing ensureOffline leaves ONLY verified bytes (or none)', async () => {
    const made = await makeSyntheticSpec({ id: 'adv-race-remove@ad000010', fileSizes: [4096, 8192], wasmSize: 2048 })
    const registry = { [made.spec.id]: made.spec }
    const fetch = createFakeFetch({ served: made.served, delayMs: 20 })
    const handle = await createTestCache({ registry, fetchImpl: fetch.fetchImpl })
    const removal = handle.cache.removeCached(made.spec.id)
    await handle.cache.ensureOffline(made.spec.id)
    await removal
    // Whatever interleaving happened, every stored model entry must still verify.
    for (const [index, url] of made.modelUrls.entries()) {
      const stored = handle.store.stored.get(url)
      if (stored === undefined) continue
      const expected = made.spec.files[index]?.sha256 as string
      const bytes = await handle.cache.matchCached(url, expected)
      expect(bytes !== undefined, `${url} (if present) verifies`).toBe(true)
    }
  })

  test('ADVERSARIAL CC-03.4: storageEstimate is pure stub delegation — drift is NOT detected (pinned)', async () => {
    const made = await makeSyntheticSpec({ id: 'adv-estimate-drift@ad000011', fileSizes: [4096] })
    const registry = { [made.spec.id]: made.spec }
    const fetch = createFakeFetch({ served: made.served })
    const store = (await createTestCache({ registry, fetchImpl: fetch.fetchImpl })).store
    const cache = (await import('@engine/model/cache')).createModelCache({
      registry,
      fetchImpl: fetch.fetchImpl,
      cacheStore: store,
      selfOrigin: 'https://zipscribe.test',
      storageEstimate: async () => ({ usage: 42, quota: 1 }),
    })
    await cache.ensureOffline(made.spec.id)
    const estimate = await cache.storageEstimate()
    expect(estimate.usage, 'the stub value is passed through untouched, even though the store holds real bytes').toBe(42)
    expect(estimate.quota).toBe(1)
  })

  test('ADVERSARIAL FR-03.8: presence-only wasm reads return a size-equal tamper undetected (pinned doctrine)', async () => {
    const made = await makeSyntheticSpec({ id: 'adv-wasm-tamper@ad000012', fileSizes: [4096], wasmSize: 4096 })
    const registry = { [made.spec.id]: made.spec }
    const fetch = createFakeFetch({ served: made.served })
    const handle = await createTestCache({ registry, fetchImpl: fetch.fetchImpl })
    const wasmUrl = made.wasmUrls[0] as string
    const honest = made.served.get(wasmUrl) as Uint8Array
    await handle.cache.putCached(wasmUrl, flipFirstByte(honest))
    const bytes = await handle.cache.matchCached(wasmUrl, '')
    expect(bytes !== undefined, 'presence-only read (no registry checksum) accepts the tampered wasm').toBe(true)
    expect([...(bytes as Uint8Array)], '…and hands back the tampered bytes — FR-03.8 doctrine (no checksum exists to verify against)').toEqual([...flipFirstByte(honest)])
    // Contrast: a model file under the SAME size-equal tamper is rejected.
    const modelUrl = made.modelUrls[0] as string
    const modelHonest = made.served.get(modelUrl) as Uint8Array
    const modelSha = made.spec.files[0]?.sha256 as string
    await handle.cache.putCached(modelUrl, flipFirstByte(modelHonest))
    await expect(handle.cache.matchCached(modelUrl, modelSha), 'model files DO get SHA-verified on read').rejects.toMatchObject({ error: { code: 'CACHE_CORRUPT' } })
  })
})
