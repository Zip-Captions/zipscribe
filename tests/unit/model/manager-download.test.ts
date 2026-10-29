// CC-03.5 + CC-03.7 (L2): network-drop and confirmation/corruption gates of
// the model manager, over the injected fetch + fake Cache API seams.
//
// Contract: US-1.1.2 — network drop mid-download → `model:error`
// `{code:'NETWORK', retryable:true}` and no partial cache entry (no
// zero-length/half-length entries). US-1.1.4 / FR-03.4 — a model with
// `approxBytes > 100_000_000` emits `model:confirm-required {bytes}` and moves
// ZERO bytes until `confirmDownload` (FR-03.4 gate at 100 MB, zip-captions
// catalog convention). US-1.1.2 — SHA-256 tamper on a cached file →
// `model:error CACHE_CORRUPT` → corrupt entry evicted → exactly ONE automatic
// re-download; a second mismatch surfaces the error with no loop.
import { describe, expect, test } from 'vitest'
import { createManagerScenario, failureOf, waitFor } from './fakes'
import type { ModelManagerEvent } from '@engine/protocol'

function eventsOf(events: ModelManagerEvent[], t: ModelManagerEvent['t']): ModelManagerEvent[] {
  return events.filter((event) => event.t === t)
}

function errorsWithCode(events: ModelManagerEvent[], code: string): ModelManagerEvent[] {
  return eventsOf(events, 'model:error').filter((event) => (event as { error: { code: string } }).error.code === code)
}

describe('CC-03.5: network drop mid-download', () => {
  test('CC-03.5: stream drops mid-download → model:error NETWORK retryable, NO partial cache entry', async () => {
    const scene = await createManagerScenario({ id: 'drop-mid@55555555', fileSizes: [4096, 8192, 4096] })
    const droppedUrl = scene.made.modelUrls[1] as string
    scene.fetch.streamFailUrls.add(droppedUrl)
    const rejection = await scene.manager.loadModel(scene.made.spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(rejection, 'loadModel rejects on network drop').toBeDefined()
    expect(failureOf(rejection)?.code, 'EngineError code').toBe('NETWORK')
    expect(failureOf(rejection)?.retryable, 'network errors are retryable').toBe(true)
    const errors = errorsWithCode(scene.events, 'NETWORK')
    expect(errors.length, 'model:error emitted').toBe(1)
    expect((errors[0] as { error: { retryable: boolean } }).error.retryable).toBe(true)
    expect(scene.handle.store.stored.has(droppedUrl), 'failed file left NO partial (or zero-length) entry').toBe(false)
    expect(eventsOf(scene.events, 'model:ready').length, 'never announced ready').toBe(0)
  })

  test('CC-03.5: fetch rejection (host unreachable) → NETWORK retryable, cache stays empty', async () => {
    const scene = await createManagerScenario({ id: 'drop-all@66666666', fileSizes: [4096] })
    for (const url of [...scene.made.modelUrls, ...scene.made.wasmUrls]) scene.fetch.failUrls.add(url)
    const rejection = await scene.manager.loadModel(scene.made.spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureOf(rejection)?.code).toBe('NETWORK')
    expect(failureOf(rejection)?.retryable).toBe(true)
    expect(scene.handle.store.stored.size, 'no entries — not even for files that completed before the drop').toBe(0)
  })

  test('CC-03.5: retry after drop completes (retryable:true is honest)', async () => {
    const scene = await createManagerScenario({ id: 'retry-drop@77777777', fileSizes: [4096, 8192] })
    const brokenUrl = scene.made.modelUrls[0] as string
    scene.fetch.failUrls.add(brokenUrl)
    await expect(scene.manager.loadModel(scene.made.spec.id)).rejects.toBeDefined()
    scene.fetch.failUrls.delete(brokenUrl)
    await scene.manager.loadModel(scene.made.spec.id)
    expect(eventsOf(scene.events, 'model:ready').length, 'ready after retry').toBe(1)
    expect(scene.handle.store.stored.has(brokenUrl), 'complete file cached on retry').toBe(true)
  })
})

describe('CC-03.7: > 100 MB confirmation gate', () => {
  test('CC-03.7: approxBytes > 100 MB → model:confirm-required {bytes}, zero bytes fetched until confirmDownload', async () => {
    const scene = await createManagerScenario({ id: 'gated-large@88888888', fileSizes: [4096], approxBytes: 150_000_000 })
    const pending = scene.manager.loadModel(scene.made.spec.id)
    let settled = false
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    )
    await waitFor(() => eventsOf(scene.events, 'model:confirm-required').length > 0)
    const confirm = eventsOf(scene.events, 'model:confirm-required')[0] as { model: string; bytes: number }
    expect(confirm.model).toBe(scene.made.spec.id)
    expect(confirm.bytes, 'payload carries the declared bytes').toBe(150_000_000)
    expect(scene.fetch.calls.length, 'ZERO bytes fetched before confirmation').toBe(0)
    expect(settled, 'load is held pending').toBe(false)
    scene.manager.confirmDownload(scene.made.spec.id)
    await pending
    expect(scene.fetch.calls.length, 'download proceeded after confirmation').toBeGreaterThan(0)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })

  test('CC-03.7: model under the gate downloads without confirmation', async () => {
    const scene = await createManagerScenario({ id: 'small-free@99999999', fileSizes: [4096, 8192], approxBytes: 70_000_000 })
    await scene.manager.loadModel(scene.made.spec.id)
    expect(eventsOf(scene.events, 'model:confirm-required').length, 'no gate below 100 MB').toBe(0)
    expect(eventsOf(scene.events, 'model:ready').length).toBe(1)
  })
})

describe('CC-03.7: SHA-256 tamper → CACHE_CORRUPT + bounded re-download', () => {
  test('CC-03.7: cached file tampered → CACHE_CORRUPT emitted, entry evicted, EXACTLY ONE re-download, then ready', async () => {
    const scene = await createManagerScenario({ id: 'cache-tamper@12121212', fileSizes: [4096, 8192] })
    const tamperedUrl = scene.made.modelUrls[0] as string
    const honest = scene.made.served.get(tamperedUrl)
    if (honest === undefined) throw new Error('plan lost its own bytes')
    const tampered = honest.slice()
    tampered[0] = (tampered[0] ?? 0) ^ 0xff
    await scene.handle.store.put(tamperedUrl, tampered)
    await scene.manager.loadModel(scene.made.spec.id)
    expect(errorsWithCode(scene.events, 'CACHE_CORRUPT').length, 'CACHE_CORRUPT surfaced as model:error').toBe(1)
    expect(scene.fetch.callsFor(tamperedUrl), 'exactly one automatic re-download of the corrupt file').toBe(1)
    expect(scene.handle.store.stored.has(tamperedUrl), 're-downloaded (verified) copy cached again').toBe(true)
    const stored = scene.handle.store.stored.get(tamperedUrl)
    expect(stored !== undefined && [...stored].join() === [...honest].join(), 'evicted + replaced with verified bytes').toBe(true)
    expect(eventsOf(scene.events, 'model:ready').length, 'recovery completes').toBe(1)
  })

  test('CC-03.7: second mismatch (network also corrupt) surfaces the error — fetch count stays bounded, no loop', async () => {
    const scene = await createManagerScenario({ id: 'net-tamper@34343434', fileSizes: [4096, 8192] })
    const url = scene.made.modelUrls[0] as string
    const honest = scene.made.served.get(url)
    if (honest === undefined) throw new Error('plan lost its own bytes')
    const tampered = honest.slice()
    tampered[0] = (tampered[0] ?? 0) ^ 0xff
    await scene.handle.store.put(url, tampered)
    scene.fetch.corruptUrls.add(url)
    const rejection = await scene.manager.loadModel(scene.made.spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureOf(rejection)?.code, 'error surfaced, not swallowed').toBe('CACHE_CORRUPT')
    expect(errorsWithCode(scene.events, 'CACHE_CORRUPT').length, 'error also emitted as model:event').toBeGreaterThanOrEqual(1)
    expect(scene.fetch.callsFor(url), 'one eviction re-download attempted, then gave up — no retry loop').toBe(1)
    expect(scene.handle.store.stored.has(url), 'corrupt bytes never cached').toBe(false)
    expect(eventsOf(scene.events, 'model:ready').length, 'never ready').toBe(0)
  })
})
