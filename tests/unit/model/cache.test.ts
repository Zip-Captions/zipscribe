// CC-03.4 (L1/L2): ensureOffline / listCached / removeCached against a fake
// Cache API + navigator.storage.estimate stub.
//
// Contract: FR-03.8 — `ensureOffline(id)` fetches every `files[].path` AND
// every `runtimeWasm` path (same-origin), SHA-256-verifies against the
// registry and caches; `listCached()` → `{id, bytes, offlineReady,
// verifiedAt}` with correct bytes; `removeCached(id)` deletes the entries and
// `navigator.storage.estimate()` usage drops by their size. FR-03.6 — cache
// name `zipscribe-models`, URLs `resolve/<revision>/…`. SECURITY-03: served
// bytes are seeded PRNG noise, never transcript-like text.
import { describe, expect, test } from 'vitest'
import { MODEL_CACHE_NAME } from '@engine/model/cache'
import { createFakeFetch, createTestCache, makeSyntheticSpec } from './fakes'
import type { SyntheticSpecOptions, SyntheticSpecResult } from './fakes'

async function scenario(options: SyntheticSpecOptions): Promise<{ made: SyntheticSpecResult; handle: Awaited<ReturnType<typeof createTestCache>>; fetch: ReturnType<typeof createFakeFetch> }> {
  const made = await makeSyntheticSpec(options)
  const registry = { [made.spec.id]: made.spec }
  const fetch = createFakeFetch({ served: made.served })
  const handle = await createTestCache({ registry, fetchImpl: fetch.fetchImpl })
  return { made, handle, fetch }
}

describe('CC-03.4: offline model cache over the fake Cache API', () => {
  test('CC-03.4: cache name is zipscribe-models (FR-03.6)', () => {
    expect(MODEL_CACHE_NAME).toBe('zipscribe-models')
  })

  test('CC-03.4: ensureOffline fetches every model file AND every runtimeWasm path', async () => {
    const { made, handle, fetch } = await scenario({
      id: 'offline-fixture@11111111',
      fileSizes: [4096, 8192, 512],
      wasmPaths: ['/wasm/ort-fake.wasm', '/wasm/ort-fake.mjs', '/wasm/engine-glue.js'],
      wasmSize: 2048,
    })
    await handle.cache.ensureOffline(made.spec.id)
    const expected = [...made.modelUrls, ...made.wasmUrls].sort()
    expect([...new Set(fetch.calls)].sort(), 'exact URL set (model files + runtime wasm)').toEqual(expected)
    for (const url of made.modelUrls) {
      expect(url, 'model files use the resolve/<revision>/ shape').toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//)
      expect(handle.store.stored.has(url), `${url} cached`).toBe(true)
    }
    for (const url of made.wasmUrls) expect(handle.store.stored.has(url), `${url} (runtime wasm) cached`).toBe(true)
  })

  test('CC-03.4: ensureOffline SHA-256-verifies before caching — corrupt bytes never land in the store', async () => {
    const made = await makeSyntheticSpec({ id: 'corrupt-offline@22222222', fileSizes: [4096, 8192] })
    const registry = { [made.spec.id]: made.spec }
    const corruptUrl = made.modelUrls[1] as string
    const fetch = createFakeFetch({ served: made.served, corruptUrls: new Set([corruptUrl]) })
    const handle = await createTestCache({ registry, fetchImpl: fetch.fetchImpl })
    const rejection = await handle.cache.ensureOffline(made.spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(rejection, 'ensureOffline rejects on SHA mismatch').toBeDefined()
    expect((rejection as { error?: { code?: string } })?.error?.code).toBe('CACHE_CORRUPT')
    expect(handle.store.stored.has(corruptUrl), 'no corrupt/partial entry cached').toBe(false)
  })

  test('CC-03.4: listCached reports {id, bytes, offlineReady: true} with correct bytes', async () => {
    const { made, handle } = await scenario({ id: 'list-cached@33333333', fileSizes: [4096, 8192], wasmSize: 2048 })
    const before = await handle.cache.listCached()
    expect(before.find((entry) => entry.id === made.spec.id)?.offlineReady, 'not cached yet').toBe(false)
    await handle.cache.ensureOffline(made.spec.id)
    const entries = await handle.cache.listCached()
    const entry = entries.find((candidate) => candidate.id === made.spec.id)
    expect(entry, 'row reported').toBeDefined()
    expect(entry?.offlineReady).toBe(true)
    expect(entry?.bytes, 'bytes = every model file + every runtime wasm byte').toBe(made.totalBytes)
    expect(Number.isFinite(entry?.verifiedAt ?? NaN), 'verifiedAt epoch ms').toBe(true)
  })

  test('CC-03.4: removeCached deletes the entries and the storage estimate drops by their size', async () => {
    const { made, handle } = await scenario({ id: 'remove-cached@44444444', fileSizes: [4096, 8192], wasmSize: 2048 })
    await handle.cache.ensureOffline(made.spec.id)
    const usageBefore = (await handle.cache.storageEstimate()).usage
    expect(usageBefore, 'estimate is backed by the store').toBe(made.totalBytes)
    await handle.cache.removeCached(made.spec.id)
    const usageAfter = (await handle.cache.storageEstimate()).usage
    expect(usageAfter, 'estimate drops by exactly the removed model size').toBe(usageBefore - made.totalBytes)
    for (const url of [...made.modelUrls, ...made.wasmUrls]) expect(handle.store.stored.has(url), `${url} evicted`).toBe(false)
    const entries = await handle.cache.listCached()
    expect(entries.find((entry) => entry.id === made.spec.id)?.offlineReady, 'no longer offline-ready').toBe(false)
  })
})
