// CC-301.1 (L1): the Chrome adapter with a scripted Translator/LanguageDetector
// global — availability mapping, user-gesture gating, per-pair LRU ≤ 4 with
// destroy-on-eviction, pending-create dedupe (user-initiated never joins a
// background one), strict failures + `UnknownError` destroy-and-rebuild.
// The adapter is the only module touching `self.Translator` (FR-301.2).
import { afterEach, describe, expect, test } from 'vitest'
import { createChromeTranslationEngine } from '@engine/translate/chrome-translator'

interface FakeInstance {
  translate(input: string): Promise<string>
  destroy(): void
  destroyed: boolean
  failNext?: { name: string }
}

interface CreateRecord {
  sourceLanguage: string
  targetLanguage: string
  monitor?: (m: { addEventListener: (t: string, cb: (e: { loaded: number; total: number }) => void) => void }) => void
  emitProgress?: (loaded: number, total: number) => void
}

interface Harness {
  instances: FakeInstance[]
  creates: CreateRecord[]
  pending: { resolve: (i: FakeInstance) => void; reject: (e: unknown) => void }[]
  pendingDetector: { resolve: (i: { detect: () => Promise<{ detectedLanguage: string; confidence: number }[]>; destroy(): void }) => void }[]
  api: unknown
  detectorAvailable: boolean
}

function installFakeTranslator(options: { availability?: string; blockCreates?: boolean; blockDetectorCreate?: boolean; createRejects?: { name?: string; value?: unknown }; detector?: boolean; detectResults?: { detectedLanguage: string; confidence: number }[]; userAgent?: string; userActivation?: boolean } = {}): Harness {
  const harness: Harness = { instances: [], creates: [], pending: [], pendingDetector: [], api: null, detectorAvailable: options.detector ?? false }
  const availability = options.availability ?? 'available'
  const g = globalThis as Record<string, unknown>
  const makeInstance = (): FakeInstance => {
    const instance: FakeInstance = {
      destroyed: false,
      async translate(input: string) {
        if (instance.failNext !== undefined) {
          const error = new Error('boom')
          error.name = instance.failNext.name
          throw error
        }
        return `tr:${input}`
      },
      destroy() {
        instance.destroyed = true
      },
    }
    return instance
  }
  g.Translator = {
    async availability() {
      return availability
    },
    async create(init: CreateRecord) {
      harness.creates.push(init)
      const instance = makeInstance()
      if (options.blockCreates === true) {
        return new Promise<FakeInstance>((resolve, reject) => harness.pending.push({ resolve, reject }))
      }
      if (options.createRejects !== undefined) {
        const rejection = options.createRejects
        if (rejection.value !== undefined) throw rejection.value
        const error = new Error('create failed')
        error.name = rejection.name ?? 'Error'
        throw error
      }
      init.monitor?.({
        addEventListener: (_t, cb) => {
          harness.creates[harness.creates.length - 1]!.emitProgress = (loaded: number, total: number) => cb({ loaded, total })
        },
      })
      harness.instances.push(instance)
      return instance
    },
  }
  if (harness.detectorAvailable) {
    g.LanguageDetector = {
      async availability() {
        return 'available'
      },
      create() {
        const instance = {
          async detect() {
            return options.detectResults ?? [{ detectedLanguage: 'fr', confidence: 0.83 }]
          },
          destroy() {
            instance.destroyed = true
          },
          destroyed: false,
        }
        if (options.blockDetectorCreate === true) {
          return new Promise((resolve) => harness.pendingDetector.push({ resolve }))
        }
        return Promise.resolve(instance)
      },
    }
  } else {
    delete g.LanguageDetector
  }
  // Node 24 exposes `navigator` as a getter-only global — define it as a
  // configurable own property instead of assigning.
  Object.defineProperty(g, 'navigator', { value: { userAgent: options.userAgent ?? 'Mozilla/5.0 (Macintosh) Chrome/138', userActivation: { isActive: options.userActivation ?? true } }, configurable: true })
  return harness
}

function uninstall() {
  const g = globalThis as Record<string, unknown>
  delete g.Translator
  delete g.LanguageDetector
  if (Object.hasOwn(g, 'navigator')) delete g.navigator
}

async function flush(predicate: () => boolean, maxRounds = 40): Promise<void> {
  for (let i = 0; i < maxRounds && !predicate(); i++) await new Promise((r) => setTimeout(r, 0))
  if (!predicate()) throw new Error('flush: condition never became true')
}

afterEach(() => uninstall())

describe('CC-301.1: adapter availability mapping (US-301.2)', () => {
  test('CC-301.1: no Translator API on desktop → { available: false, reason: "browser" }', () => {
    uninstall()
    ;(globalThis as Record<string, unknown>).navigator = { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140' }
    const engine = createChromeTranslationEngine()
    expect(engine.isAvailable()).toEqual({ available: false, reason: 'browser' })
    engine.dispose()
  })

  test('CC-301.1: mobile UA explains the absence as "mobile"', () => {
    uninstall()
    ;(globalThis as Record<string, unknown>).navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' }
    const engine = createChromeTranslationEngine()
    expect(engine.isAvailable()).toEqual({ available: false, reason: 'mobile' })
    engine.dispose()
  })

  test('CC-301.1: availability() passes the four API states through', async () => {
    for (const state of ['unavailable', 'downloadable', 'downloading', 'available'] as const) {
      installFakeTranslator({ availability: state })
      const engine = createChromeTranslationEngine()
      expect(await engine.availability('en', 'fr')).toBe(state)
      engine.dispose()
    }
  })
})

describe('CC-301.1: user-gesture gating (US-301.1)', () => {
  test('CC-301.1: downloadable pair + userInitiated=false → "downloadable", NO create call, NO throw', async () => {
    const h = installFakeTranslator({ availability: 'downloadable' })
    const engine = createChromeTranslationEngine()
    const result = await engine.ensurePair('en', 'fr', { userInitiated: false })
    expect(result).toBe('downloadable')
    expect(h.creates, 'background request never creates (no NotAllowedError path)').toEqual([])
    engine.dispose()
  })

  test('CC-301.1: downloadable + userInitiated=true without activation → NOT_ALLOWED, no create', async () => {
    const h = installFakeTranslator({ availability: 'downloadable', userActivation: false })
    const engine = createChromeTranslationEngine()
    await expect(engine.ensurePair('en', 'fr', { userInitiated: true })).rejects.toMatchObject({ code: 'NOT_ALLOWED' })
    expect(h.creates).toEqual([])
    engine.dispose()
  })

  test('CC-301.1: user-initiated download reports progress 0–100 through onProgress', async () => {
    const h = installFakeTranslator({ availability: 'downloadable' })
    const engine = createChromeTranslationEngine()
    const percents: number[] = []
    const promise = engine.ensurePair('en', 'fr', { userInitiated: true, onProgress: (p) => percents.push(p) })
    await flush(() => h.creates.length > 0)
    h.creates[0]?.emitProgress?.(0, 100)
    h.creates[0]?.emitProgress?.(50, 100)
    h.creates[0]?.emitProgress?.(100, 100)
    await expect(promise).resolves.toBe('ready')
    expect(percents, 'download progress mapped to 0–100').toEqual([0, 50, 100])
    engine.dispose()
  })
})

describe('CC-301.1: per-pair LRU with destroy-on-eviction', () => {
  test('CC-301.1: cap 4 — the least-recently-used instance is destroyed on the 5th pair', async () => {
    const h = installFakeTranslator()
    const engine = createChromeTranslationEngine()
    const targets = ['fr', 'es', 'de', 'it'] as const
    for (const t of targets) await engine.translate('en', t, 'x', new AbortController().signal)
    expect(h.instances.length).toBe(4)
    expect(h.instances.every((i) => !i.destroyed)).toBe(true)
    // touch 'fr' to make it recent, then push 'pt' in
    await engine.translate('en', 'fr', 'y', new AbortController().signal)
    await engine.translate('en', 'pt', 'x', new AbortController().signal)
    const survivors = h.instances.filter((i) => !i.destroyed)
    expect(survivors.length, 'LRU cap holds at 4').toBe(4)
    expect(h.instances[1]?.destroyed, "'es' (oldest untouched) was evicted and destroyed").toBe(true)
    engine.dispose()
    expect(h.instances.every((i) => i.destroyed), 'dispose destroys everything').toBe(true)
  })
})

describe('CC-301.1: pending-create dedupe', () => {
  test('CC-301.1: two concurrent user-initiated requests share ONE create', async () => {
    const h = installFakeTranslator({ blockCreates: true })
    const engine = createChromeTranslationEngine()
    const a = engine.ensurePair('en', 'fr', { userInitiated: true })
    const b = engine.ensurePair('en', 'fr', { userInitiated: true })
    await flush(() => h.pending.length === 1)
    h.pending[0]!.resolve({ translate: async (t: string) => t, destroy: () => undefined, destroyed: false })
    await Promise.all([a, b])
    expect(h.creates.length, 'deduped').toBe(1)
    engine.dispose()
  })

  test('CC-301.1: a user-initiated request NEVER joins a pending background create', async () => {
    const h = installFakeTranslator({ availability: 'downloading', blockCreates: true })
    const engine = createChromeTranslationEngine()
    // background-class pending create (pair already 'downloading')
    const background = engine.ensurePair('en', 'fr', { userInitiated: false })
    await flush(() => h.pending.length === 1)
    // a user-initiated request must NOT join the background pending — its own create
    const user = engine.ensurePair('en', 'fr', { userInitiated: true })
    await flush(() => h.pending.length === 2)
    const instance = { translate: async (t: string) => t, destroy: () => undefined }
    h.pending.forEach((p) => p.resolve(instance as never))
    await Promise.all([background, user])
    expect(h.creates.length, 'background pending + user request ⇒ two creates').toBe(2)

    // same-class requests DO dedupe: two background requests share one create
    const base = h.pending.length
    const createsBase = h.creates.length
    const b1 = engine.ensurePair('en', 'es', { userInitiated: false })
    await flush(() => h.pending.length === base + 1)
    const b2 = engine.ensurePair('en', 'es', { userInitiated: false })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.pending.length, 'background joins background pending (one new create)').toBe(base + 1)
    h.pending.forEach((p) => p.resolve(instance as never))
    await Promise.all([b1, b2])
    expect(h.creates.length, 'deduped second request reuses the pending create').toBe(createsBase + 1)
    engine.dispose()
  })
})

describe('CC-301.1: strict failures + UnknownError rebuild', () => {
  test('CC-301.1: translate failure destroys the instance; next attempt rebuilds', async () => {
    const h = installFakeTranslator()
    const engine = createChromeTranslationEngine()
    await engine.translate('en', 'fr', 'ok', new AbortController().signal)
    const first = h.instances[0]!
    first.failNext = { name: 'UnknownError' }
    await expect(engine.translate('en', 'fr', 'boom', new AbortController().signal)).rejects.toMatchObject({ code: 'TRANSLATE_FAILED', retryable: true, detail: 'UNKNOWN' })
    expect(first.destroyed, 'poisoned instance destroyed on failure (zip-captions recovery)').toBe(true)
    const rebuilt = await engine.translate('en', 'fr', 'again', new AbortController().signal)
    expect(rebuilt).toBe('tr:again')
    expect(h.instances.length, 'rebuilt instance created').toBe(2)
    engine.dispose()
  })

  test('CC-301.1: abort → CANCELLED not retryable (before create and API-level)', async () => {
    const h = installFakeTranslator()
    const engine = createChromeTranslationEngine()
    const controller = new AbortController()
    controller.abort()
    await expect(engine.translate('en', 'fr', 'x', controller.signal)).rejects.toMatchObject({ code: 'CANCELLED', retryable: false })
    await engine.translate('en', 'fr', 'warm', new AbortController().signal)
    h.instances[0]!.failNext = { name: 'AbortError' } // the API itself aborting
    await expect(engine.translate('en', 'fr', 'x', new AbortController().signal)).rejects.toMatchObject({ code: 'CANCELLED', retryable: false })
    engine.dispose()
  })

  test('FR-301.2: failure errors carry codes/NAMEs only — never the text', async () => {
    const h = installFakeTranslator()
    const engine = createChromeTranslationEngine()
    h.instances.length = 0
    await engine.translate('en', 'fr', 'warm', new AbortController().signal)
    h.instances[0]!.failNext = { name: 'SecurityError CANARY-never-log' }
    const error = await engine.translate('en', 'fr', 'secret caption text', new AbortController().signal).catch((e: unknown) => e)
    expect(JSON.stringify(error)).not.toContain('CANARY')
    expect(JSON.stringify(error)).not.toContain('secret')
    engine.dispose()
  })
})

describe('FR-301.2 / US-301.4: LanguageDetector', () => {
  test('US-301.4: absent detector → detectLanguage resolves null (caller asks the user)', async () => {
    installFakeTranslator({ detector: false })
    const engine = createChromeTranslationEngine()
    await expect(engine.detectLanguage('bonjour')).resolves.toBeNull()
    engine.dispose()
  })

  test('US-301.4: detector present → top BCP-47 result with confidence', async () => {
    installFakeTranslator({ detector: true })
    const engine = createChromeTranslationEngine()
    await expect(engine.detectLanguage('bonjour')).resolves.toEqual({ language: 'fr', confidence: 0.83 })
    engine.dispose()
  })
})

describe('CC-301.1: adapter no-API and unsupported paths (SECURITY-03 codes only)', () => {
  test('CC-301.1: no Translator API → isAvailable true side, availability "unavailable", ensurePair/translate throw NO_API', async () => {
    uninstall()
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true })
    const engine = createChromeTranslationEngine()
    expect(engine.isAvailable()).toEqual({ available: false, reason: 'browser' })
    expect(await engine.availability('en', 'fr')).toBe('unavailable')
    await expect(engine.ensurePair('en', 'fr', { userInitiated: true })).rejects.toMatchObject({ code: 'PAIR_UNAVAILABLE', detail: 'NO_API' })
    await expect(engine.translate('en', 'fr', 'x', new AbortController().signal)).rejects.toMatchObject({ code: 'PAIR_UNAVAILABLE', detail: 'NO_API' })
    engine.dispose()
  })

  test('CC-301.1: pair unavailable → ensurePair + translate both throw PAIR_UNSUPPORTED', async () => {
    installFakeTranslator({ availability: 'unavailable' })
    const engine = createChromeTranslationEngine()
    await expect(engine.ensurePair('en', 'fr', { userInitiated: true })).rejects.toMatchObject({ code: 'PAIR_UNAVAILABLE', detail: 'PAIR_UNSUPPORTED' })
    await expect(engine.translate('en', 'fr', 'x', new AbortController().signal)).rejects.toMatchObject({ code: 'PAIR_UNAVAILABLE', detail: 'PAIR_UNSUPPORTED' })
    engine.dispose()
  })

  test('CC-301.1: isAvailable with the API present → { available: true }', () => {
    installFakeTranslator()
    const engine = createChromeTranslationEngine()
    expect(engine.isAvailable()).toEqual({ available: true })
    engine.dispose()
  })
})

describe('CC-301.1: create failures — DOWNLOAD_FAILED vs TRANSLATE_FAILED with whitelisted name tokens', () => {
  test('CC-301.1: create rejects while downloading → DOWNLOAD_FAILED retryable with CREATE:UNKNOWN', async () => {
    installFakeTranslator({ availability: 'downloading', createRejects: { name: 'UnknownError' } })
    const engine = createChromeTranslationEngine()
    await expect(engine.ensurePair('en', 'fr', { userInitiated: true })).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED', retryable: true, detail: 'CREATE:UNKNOWN' })
    engine.dispose()
  })

  test('CC-301.1: create rejects (available) → TRANSLATE_FAILED with token per whitelisted NAME', async () => {
    for (const [name, token] of [
      ['AbortError', 'ABORTED'],
      ['NotSupportedError', 'NOT_SUPPORTED'],
      ['InvalidStateError', 'INVALID_STATE'],
      ['SecurityError leaks-content', 'API'],
    ] as const) {
      uninstall()
      installFakeTranslator({ createRejects: { name } })
      const engine = createChromeTranslationEngine()
      await expect(engine.ensurePair('en', 'fr', { userInitiated: true })).rejects.toMatchObject({ code: 'TRANSLATE_FAILED', retryable: true, detail: `CREATE:${token}` })
      engine.dispose()
    }
  })

  test('FR-301.2: non-Error throw from create → CREATE:API, content never leaks', async () => {
    uninstall()
    installFakeTranslator({ createRejects: { value: 'raw browser message CANARY-never-log' } })
    const engine = createChromeTranslationEngine()
    const error = await engine.ensurePair('en', 'fr', { userInitiated: true }).catch((e: unknown) => e)
    expect(JSON.stringify(error)).toContain('CREATE:API')
    expect(JSON.stringify(error)).not.toContain('CANARY')
    engine.dispose()
  })

  test('FR-301.2: downloadprogress total=0 clamps to 100 without division by zero', async () => {
    const h = installFakeTranslator({ availability: 'downloadable' })
    const engine = createChromeTranslationEngine()
    const percents: number[] = []
    const promise = engine.ensurePair('en', 'fr', { userInitiated: true, onProgress: (p) => percents.push(p) })
    await flush(() => h.creates.length > 0 && h.creates[0]!.emitProgress !== undefined)
    h.creates[0]!.emitProgress!(50, 0)
    await expect(promise).resolves.toBe('ready')
    expect(percents).toEqual([100])
    engine.dispose()
  })
})

describe('CC-301.1: translate-time abort and detector paths', () => {
  test('CC-301.1: abort while instance.translate in flight → CANCELLED + poisoned instance dropped', async () => {
    const controller = new AbortController()
    uninstall()
    const g = globalThis as Record<string, unknown>
    Object.defineProperty(g, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/138', userActivation: { isActive: true } }, configurable: true })
    const created: { destroyed: boolean }[] = []
    g.Translator = {
      async availability() {
        return 'available'
      },
      async create() {
        const instance = {
          destroyed: false,
          async translate() {
            controller.abort() // the user cancels WHILE the API call is pending
            await new Promise((r) => setTimeout(r, 0))
            return 'too late'
          },
          destroy() {
            instance.destroyed = true
            created.push(instance)
          },
        }
        return instance
      },
    }
    const engine = createChromeTranslationEngine()
    await expect(engine.translate('en', 'fr', 'x', controller.signal)).rejects.toMatchObject({ code: 'CANCELLED', retryable: false, detail: 'ABORTED' })
    expect(created.length, 'instance dropped on late abort').toBe(1)
    engine.dispose()
  })

  test('US-301.4: concurrent detections share ONE detector create', async () => {
    const h = installFakeTranslator({ detector: true, blockDetectorCreate: true })
    const engine = createChromeTranslationEngine()
    const a = engine.detectLanguage('bonjour')
    const b = engine.detectLanguage('guten tag')
    await flush(() => h.pendingDetector.length === 1)
    const instance = {
      async detect() {
        return [{ detectedLanguage: 'fr', confidence: 0.7 }]
      },
      destroy() {},
    }
    h.pendingDetector.forEach((p) => p.resolve(instance))
    await expect(a).resolves.toEqual({ language: 'fr', confidence: 0.7 })
    await expect(b).resolves.toEqual({ language: 'fr', confidence: 0.7 })
    engine.dispose()
  })

  test('US-301.4: empty detector results → null', async () => {
    installFakeTranslator({ detector: true, detectResults: [] })
    const engine = createChromeTranslationEngine()
    await expect(engine.detectLanguage('123')).resolves.toBeNull()
    engine.dispose()
  })

  test('US-301.4: detector create rejects → null, never blocks the caller', async () => {
    uninstall()
    const g = globalThis as Record<string, unknown>
    Object.defineProperty(g, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/138' }, configurable: true })
    g.LanguageDetector = {
      availability: async () => 'available',
      create: () => Promise.reject(new Error('detector down')),
    }
    const engine = createChromeTranslationEngine()
    await expect(engine.detectLanguage('bonjour')).resolves.toBeNull()
    await expect(engine.detectLanguage('still fine')).resolves.toBeNull()
    engine.dispose()
  })
})
