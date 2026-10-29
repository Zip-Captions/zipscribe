// L1 module tests for the model cache (FR-03.6, FR-03.8). The acceptance gate
// for CC-03.4 is the frozen suite `tests/unit/model/cache.test.ts`; these are
// the source-adjacent unit tests required by knowledge/conventions.md for
// every engine module — they also keep the module covered in child runs where
// the frozen suites are excluded (vitest.config child-safety list), so every
// verification/abort/quota/default-dep branch is exercised here.
//
// Independent oracle: the SHA-256 vectors below are the published NIST values
// for "abc" and the empty string (not produced by the module under test).
// SECURITY-03: only binary noise / ASCII fixtures are served.
import { describe, expect, test } from 'vitest'
import { createModelCache, MODEL_CACHE_NAME, sha256Hex } from '@engine/model/cache'
import type { CacheLike, FetchImpl, ModelCacheDeps } from '@engine/model/cache'
import { MODEL_REGISTRY, modelFileUrl } from '@engine/model/registry'
import type { ModelSpec } from '@engine/model/registry'

const ABC = new TextEncoder().encode('abc')
const ABC_SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const SELF = 'https://app.test'
const WASM_PATH = '/wasm/unit-test.wasm'
const WASM_BYTES = new Uint8Array([7, 6, 5, 4])

const zeroEstimate = (): Promise<{ usage: number; quota: number }> => Promise.resolve({ usage: 0, quota: 0 })

function makeSpec(overrides: Partial<ModelSpec> = {}): ModelSpec {
  return {
    id: 'unit-test-model@01234567',
    engine: 'transformers-whisper',
    repo: 'zipscribe-unit/test-model',
    revision: '0123456789abcdef0123456789abcdef01234567',
    files: [{ path: 'onnx/abc.onnx', sha256: ABC_SHA, bytes: 3 }],
    approxBytes: 7,
    languages: ['*'],
    punctuation: false,
    confidence: false,
    languageDetect: true,
    timestampMode: 'word-native',
    license: 'Apache-2.0',
    tierHint: 'T2',
    runtimeWasm: [WASM_PATH],
    enOnly: false,
    ...overrides,
  }
}

function urlOf(spec: ModelSpec, path: string): string {
  return `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${path}`
}

function flip(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const copy = bytes.slice()
  const first = copy[0] ?? 0
  copy[0] = first ^ 0xff
  return copy
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
}

function namedError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name })
}

function failureCode(rejection: unknown): string | undefined {
  if (typeof rejection === 'object' && rejection !== null && 'error' in rejection) {
    const error = rejection.error
    if (typeof error === 'object' && error !== null && 'code' in error) return (error as { code: string }).code
  }
  return undefined
}

interface SpyStore extends CacheLike {
  stored: Map<string, Uint8Array<ArrayBuffer>>
  puts: string[]
  deletes: string[]
}

function spyStore(initial: Iterable<readonly [string, Uint8Array<ArrayBuffer>]> = []): SpyStore {
  const stored = new Map(initial)
  return {
    stored,
    puts: [],
    deletes: [],
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

function stubFetch(planMap: Map<string, Uint8Array<ArrayBuffer>>, opts: { fail?: string[]; corrupt?: string[] } = {}): { impl: FetchImpl; urls: string[] } {
  const urls: string[] = []
  const impl: FetchImpl = (url, init) => {
    urls.push(url)
    if (init?.signal?.aborted === true) return Promise.reject(abortError())
    if (opts.fail?.includes(url) === true) return Promise.reject(new TypeError('network drop (simulated)'))
    const body = planMap.get(url)
    if (body === undefined) return Promise.reject(new Error(`unexpected fetch ${url}`))
    return Promise.resolve(new Response(opts.corrupt?.includes(url) === true ? flip(body) : body.slice()))
  }
  return { impl, urls }
}

function servedPlan(spec: ModelSpec, origin = SELF): Map<string, Uint8Array<ArrayBuffer>> {
  const entries = new Map<string, Uint8Array<ArrayBuffer>>()
  for (const file of spec.files) entries.set(urlOf(spec, file.path), ABC)
  for (const path of spec.runtimeWasm) entries.set(new URL(path, origin).href, WASM_BYTES)
  return entries
}

function cacheFor(spec: ModelSpec, opts: { fail?: string[]; corrupt?: string[]; store?: SpyStore; origin?: string } = {}) {
  const served = servedPlan(spec, opts.origin ?? SELF)
  const fetch = stubFetch(served, { ...(opts.fail === undefined ? {} : { fail: opts.fail }), ...(opts.corrupt === undefined ? {} : { corrupt: opts.corrupt }) })
  const store = opts.store ?? spyStore()
  const deps: ModelCacheDeps = { registry: { [spec.id]: spec }, fetchImpl: fetch.impl, cacheStore: store, selfOrigin: opts.origin ?? SELF, storageEstimate: zeroEstimate }
  return { cache: createModelCache(deps), store, fetch, served }
}

describe('sha256Hex (WebCrypto, lowercase hex)', () => {
  test('matches published NIST vectors', async () => {
    expect(await sha256Hex(ABC)).toBe(ABC_SHA)
    expect(await sha256Hex(new Uint8Array(0))).toBe(EMPTY_SHA)
  })
})

describe('ensureOffline (FR-03.8 write path)', () => {
  test('fetches every model file URL and every runtimeWasm URL exactly once, then caches all', async () => {
    const spec = makeSpec()
    const { cache, store, fetch } = cacheFor(spec)
    await cache.ensureOffline(spec.id)
    const expected = [urlOf(spec, 'onnx/abc.onnx'), new URL(WASM_PATH, SELF).href].sort()
    expect([...new Set(fetch.urls)].sort(), 'exact URL set').toEqual(expected)
    expect(fetch.urls.length, 'no duplicate fetches').toBe(expected.length)
    expect(urlOf(spec, 'onnx/abc.onnx')).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//)
    for (const url of expected) expect(store.stored.has(url), `${url} cached`).toBe(true)
  })

  test('SHA mismatch rejects CACHE_CORRUPT and puts NOTHING (no partial entries)', async () => {
    const spec = makeSpec({
      files: [
        { path: 'onnx/abc.onnx', sha256: ABC_SHA, bytes: 3 },
        { path: 'onnx/bad.onnx', sha256: '0'.repeat(64), bytes: 4 },
      ],
    })
    const served = servedPlan(spec)
    served.set(urlOf(spec, 'onnx/bad.onnx'), new Uint8Array([1, 2, 3, 4]))
    const fetch = stubFetch(served)
    const store = spyStore()
    const cache = createModelCache({ registry: { [spec.id]: spec }, fetchImpl: fetch.impl, cacheStore: store, selfOrigin: SELF, storageEstimate: zeroEstimate })
    const rejection = await cache.ensureOffline(spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureCode(rejection)).toBe('CACHE_CORRUPT')
    expect(store.stored.size, 'the honest file was NOT put either — all-or-nothing').toBe(0)
  })

  test('declared-bytes mismatch rejects CACHE_CORRUPT even when the SHA would pass', async () => {
    const spec = makeSpec({ files: [{ path: 'onnx/abc.onnx', sha256: ABC_SHA, bytes: 4 }] })
    const { cache, store } = cacheFor(spec)
    const rejection = await cache.ensureOffline(spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureCode(rejection), 'registry bytes are part of verification').toBe('CACHE_CORRUPT')
    expect(store.stored.size).toBe(0)
  })

  test('uppercase registry checksums are normalized (still verifies honest bytes)', async () => {
    const spec = makeSpec({ files: [{ path: 'onnx/abc.onnx', sha256: ABC_SHA.toUpperCase(), bytes: 3 }] })
    const { cache, store } = cacheFor(spec)
    await cache.ensureOffline(spec.id)
    expect(store.stored.has(urlOf(spec, 'onnx/abc.onnx'))).toBe(true)
  })

  test('fetch failure rejects NETWORK retryable, store stays empty', async () => {
    const spec = makeSpec()
    const url = urlOf(spec, 'onnx/abc.onnx')
    const { cache, store } = cacheFor(spec, { fail: [url] })
    const rejection = await cache.ensureOffline(spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureCode(rejection)).toBe('NETWORK')
    expect((rejection as { error: { retryable: boolean } }).error.retryable).toBe(true)
    expect(store.stored.size).toBe(0)
  })

  test('pre-aborted signal rejects CANCELLED before any fetch', async () => {
    const spec = makeSpec()
    const { cache, fetch } = cacheFor(spec)
    const controller = new AbortController()
    controller.abort()
    const rejection = await cache.ensureOffline(spec.id, { signal: controller.signal }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureCode(rejection)).toBe('CANCELLED')
    expect(fetch.urls.length, 'zero fetches attempted').toBe(0)
  })

  test('mid-flight abort rejects CANCELLED and caches nothing', async () => {
    const spec = makeSpec()
    const store = spyStore()
    const hang: FetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortError()), { once: true })
      })
    const cache = createModelCache({ registry: { [spec.id]: spec }, fetchImpl: hang, cacheStore: store, selfOrigin: SELF, storageEstimate: zeroEstimate })
    const controller = new AbortController()
    const pending = cache.ensureOffline(spec.id, { signal: controller.signal })
    controller.abort()
    const rejection = await pending.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureCode(rejection)).toBe('CANCELLED')
    expect(store.stored.size).toBe(0)
  })

  test('unknown model id rejects ENGINE_INTERNAL', async () => {
    const spec = makeSpec()
    const { cache, fetch } = cacheFor(spec)
    const rejection = await cache.ensureOffline('nope@00000000').then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureCode(rejection)).toBe('ENGINE_INTERNAL')
    expect(fetch.urls.length).toBe(0)
  })

  test('store quota rejection surfaces as QUOTA_EXCEEDED', async () => {
    const spec = makeSpec()
    const store = spyStore()
    store.put = () => Promise.reject(namedError('QuotaExceededError', 'quota'))
    const { cache } = cacheFor(spec, { store })
    const rejection = await cache.ensureOffline(spec.id).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureCode(rejection)).toBe('QUOTA_EXCEEDED')
  })
})

describe('listCached (FR-03.8 report + FR-03.6 read-time verification)', () => {
  test('one row per registry id even when nothing is cached', async () => {
    const spec = makeSpec()
    const { cache } = cacheFor(spec)
    const entries = await cache.listCached()
    expect(entries).toEqual([{ id: spec.id, bytes: 0, offlineReady: false, verifiedAt: 0 }])
  })

  test('offlineReady true with model+wasm bytes and a fresh verifiedAt once everything is stored', async () => {
    const spec = makeSpec()
    const { cache } = cacheFor(spec)
    await cache.ensureOffline(spec.id)
    const before = Date.now()
    const entry = (await cache.listCached())[0]
    expect(entry).toBeDefined()
    expect(entry?.offlineReady).toBe(true)
    expect(entry?.bytes).toBe(ABC.byteLength + WASM_BYTES.byteLength)
    expect(entry?.verifiedAt).toBeGreaterThanOrEqual(before)
  })

  test('missing runtimeWasm entry → offlineReady false', async () => {
    const spec = makeSpec()
    const { cache, store } = cacheFor(spec)
    await cache.ensureOffline(spec.id)
    store.stored.delete(new URL(WASM_PATH, SELF).href)
    const entry = (await cache.listCached())[0]
    expect(entry?.offlineReady, 'wasm is part of offline readiness').toBe(false)
    expect(entry?.verifiedAt).toBe(0)
  })

  test('tampered stored bytes → offlineReady false, entry left in place (reporting is non-destructive)', async () => {
    const spec = makeSpec()
    const { cache, store } = cacheFor(spec)
    await cache.ensureOffline(spec.id)
    store.stored.set(urlOf(spec, 'onnx/abc.onnx'), flip(ABC))
    const entry = (await cache.listCached())[0]
    expect(entry?.offlineReady, 'verified means re-hashed on read').toBe(false)
    expect(store.stored.has(urlOf(spec, 'onnx/abc.onnx')), 'listCached does not evict').toBe(true)
  })
})

describe('matchCached (FR-03.6 verified read path)', () => {
  test('hit with matching SHA returns the bytes; miss returns undefined', async () => {
    const spec = makeSpec()
    const { cache, store } = cacheFor(spec)
    const url = urlOf(spec, 'onnx/abc.onnx')
    expect(await cache.matchCached(url, ABC_SHA), 'miss').toBeUndefined()
    store.stored.set(url, ABC)
    expect(await cache.matchCached(url, ABC_SHA)).toEqual(ABC)
    expect(await cache.matchCached(url, ABC_SHA.toUpperCase()), 'caller hex case is normalized').toEqual(ABC)
  })

  test('SHA mismatch evicts the corrupt entry and rejects CACHE_CORRUPT', async () => {
    const spec = makeSpec()
    const { cache, store } = cacheFor(spec)
    const url = urlOf(spec, 'onnx/abc.onnx')
    store.stored.set(url, flip(ABC))
    const rejection = await cache.matchCached(url, ABC_SHA).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failureCode(rejection)).toBe('CACHE_CORRUPT')
    expect(store.stored.has(url), 'corrupt entry evicted so a re-download can land').toBe(false)
    expect(await cache.matchCached(url, ABC_SHA), 'now a clean miss').toBeUndefined()
  })

  test('presence-only read (no registry checksum, e.g. runtimeWasm) returns bytes without verification', async () => {
    const spec = makeSpec()
    const { cache, store } = cacheFor(spec)
    const url = new URL(WASM_PATH, SELF).href
    store.stored.set(url, flip(WASM_BYTES))
    expect(await cache.matchCached(url, ''), 'non-hex expectation = presence-only contract').toEqual(flip(WASM_BYTES))
  })
})

describe('putCached / deleteCached / removeCached / storageEstimate', () => {
  test('putCached and deleteCached operate on the store; store failures map to codes', async () => {
    const spec = makeSpec()
    const { cache, store } = cacheFor(spec)
    await cache.putCached('https://x.test/a', WASM_BYTES)
    expect(store.stored.get('https://x.test/a')).toEqual(WASM_BYTES)
    await cache.deleteCached('https://x.test/a')
    expect(store.stored.has('https://x.test/a')).toBe(false)
    const quotaStore = spyStore()
    quotaStore.put = () => Promise.reject(namedError('QuotaExceededError', 'quota'))
    const quotaCache = createModelCache({ registry: {}, cacheStore: quotaStore, storageEstimate: zeroEstimate })
    expect(
      failureCode(
        await quotaCache.putCached('https://x.test/b', WASM_BYTES).then(
          () => undefined,
          (e: unknown) => e,
        ),
      ),
    ).toBe('QUOTA_EXCEEDED')
    const boomStore = spyStore()
    boomStore.put = () => Promise.reject(new Error('disk on fire'))
    const boomCache = createModelCache({ registry: {}, cacheStore: boomStore, storageEstimate: zeroEstimate })
    expect(
      failureCode(
        await boomCache.putCached('https://x.test/c', WASM_BYTES).then(
          () => undefined,
          (e: unknown) => e,
        ),
      ),
    ).toBe('ENGINE_INTERNAL')
    const abortStore = spyStore()
    abortStore.put = () => Promise.reject(abortError())
    const abortCache = createModelCache({ registry: {}, cacheStore: abortStore, storageEstimate: zeroEstimate })
    expect(
      failureCode(
        await abortCache.putCached('https://x.test/d', WASM_BYTES).then(
          () => undefined,
          (e: unknown) => e,
        ),
      ),
    ).toBe('CANCELLED')
  })

  test('removeCached deletes model file AND runtimeWasm entries; unknown id is a no-op', async () => {
    const spec = makeSpec()
    const { cache, store } = cacheFor(spec)
    await cache.ensureOffline(spec.id)
    await cache.removeCached(spec.id)
    expect(store.stored.size, 'everything evicted').toBe(0)
    const deletesBefore = store.deletes.length
    await cache.removeCached('nope@00000000')
    expect(store.deletes.length, 'unknown id deletes nothing').toBe(deletesBefore)
  })

  test('storageEstimate delegates to the injected stub', async () => {
    const spec = makeSpec()
    const { cache } = cacheFor(spec)
    expect(await cache.storageEstimate()).toEqual({ usage: 0, quota: 0 })
    const stubbed = createModelCache({ registry: {}, storageEstimate: () => Promise.resolve({ usage: 42, quota: 99 }) })
    expect(await stubbed.storageEstimate()).toEqual({ usage: 42, quota: 99 })
  })
})

describe('production defaults (deps absent → lazy globalThis reads)', () => {
  test('Cache API absent (headless): default store is a graceful miss/no-op and estimate falls back to zeros', async () => {
    const cache = createModelCache({ registry: {} })
    expect(await cache.matchCached('https://x.test/a', '')).toBeUndefined()
    await cache.putCached('https://x.test/a', ABC)
    expect(await cache.matchCached('https://x.test/a', '')).toBeUndefined()
    await cache.deleteCached('https://x.test/a')
    expect(await cache.storageEstimate(), 'no navigator.storage in Node → honest zeros').toEqual({ usage: 0, quota: 0 })
  })

  test('caches.open wrapper: opens MODEL_CACHE_NAME, round-trips through Response', async () => {
    const backing = new Map<string, Uint8Array<ArrayBuffer>>()
    const opened: string[] = []
    const inner = {
      match: (key: string) => {
        const hit = backing.get(key)
        return Promise.resolve(hit === undefined ? undefined : new Response(hit.slice()))
      },
      put: async (key: string, response: Response) => {
        backing.set(key, new Uint8Array(await response.arrayBuffer()))
      },
      delete: (key: string) => Promise.resolve(backing.delete(key)),
    }
    const previous = (globalThis as unknown as { caches?: unknown }).caches
    ;(globalThis as unknown as { caches?: unknown }).caches = {
      open: (name: string) => {
        opened.push(name)
        return Promise.resolve(inner)
      },
    }
    try {
      const cache = createModelCache({ registry: {}, storageEstimate: zeroEstimate })
      await cache.putCached('https://x.test/wasm', WASM_BYTES)
      expect(opened, 'production store opens the zipscribe-models cache').toEqual([MODEL_CACHE_NAME])
      expect(await cache.matchCached('https://x.test/wasm', '')).toEqual(WASM_BYTES)
      await cache.deleteCached('https://x.test/wasm')
      expect(await cache.matchCached('https://x.test/wasm', '')).toBeUndefined()
    } finally {
      ;(globalThis as unknown as { caches?: unknown }).caches = previous
    }
  })

  test('default fetchImpl + default registry route through modelFileUrl resolve shapes', async () => {
    const id = Object.keys(MODEL_REGISTRY)[0] as string
    const urls: string[] = []
    const previous = globalThis.fetch
    globalThis.fetch = (input: Parameters<typeof globalThis.fetch>[0]) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      return Promise.resolve(new Response(new Uint8Array([0, 1, 2, 3])))
    }
    try {
      const cache = createModelCache({})
      const rejection = await cache.ensureOffline(id).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(failureCode(rejection), 'registry pins vs wrong bytes on the DEFAULT registry path').toBe('CACHE_CORRUPT')
      expect(
        urls.some((url) => /^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//.test(url)),
        'default fetch used modelFileUrl shapes',
      ).toBe(true)
    } finally {
      globalThis.fetch = previous
    }
  })

  test('default selfOrigin follows location.origin when present, else http://localhost', async () => {
    const spec = makeSpec()
    const fetch = stubFetch(servedPlan(spec, 'https://node.test'))
    const deps: ModelCacheDeps = { registry: { [spec.id]: spec }, fetchImpl: fetch.impl, cacheStore: spyStore(), storageEstimate: zeroEstimate }
    const previous = (globalThis as unknown as { location?: unknown }).location
    ;(globalThis as unknown as { location?: unknown }).location = { origin: 'https://node.test' }
    try {
      await createModelCache(deps).ensureOffline(spec.id)
      expect(fetch.urls).toContain(new URL(WASM_PATH, 'https://node.test').href)
    } finally {
      ;(globalThis as unknown as { location?: unknown }).location = previous
    }
    const bare = stubFetch(servedPlan(spec, 'http://localhost'))
    await createModelCache({ ...deps, fetchImpl: bare.impl }).ensureOffline(spec.id)
    expect(bare.urls, 'no location at all → documented http://localhost base').toContain('http://localhost/wasm/unit-test.wasm')
  })

  test('default storageEstimate passes navigator.storage.estimate through (absent fields → 0)', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { value: { storage: { estimate: () => Promise.resolve({ usage: 123 }) } }, configurable: true })
    try {
      expect(await createModelCache({ registry: {} }).storageEstimate()).toEqual({ usage: 123, quota: 0 })
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'navigator', descriptor)
      else delete (globalThis as unknown as { navigator?: unknown }).navigator
    }
  })
})

describe('registry integration (modelFileUrl shape)', () => {
  test('planned model URLs equal modelFileUrl over the same spec', () => {
    const spec = makeSpec()
    const file = spec.files[0]
    if (file === undefined) throw new Error('fixture spec lost its file')
    expect(urlOf(spec, file.path)).toBe(modelFileUrl(spec, file))
  })
})
