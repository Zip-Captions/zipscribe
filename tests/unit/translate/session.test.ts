// CC-301.1 (L1): TranslationSession semantics with a scripted engine —
// visible-first order, ≤ 20-block batches with a macrotask yield, text cache
// ≤ 500, ≤ 3 attempts per block, generation discard, cancel ≤ 500 ms,
// pass-through, `'\n'` → space normalization, one aggregated failure warning.
import { describe, expect, test, vi } from 'vitest'
import { createTranslationSession, BATCH_SIZE, MAX_ATTEMPTS, TEXT_CACHE_LIMIT } from '@engine/translate/session'
import { sourceHash } from '@engine/translate/track'
import { normalizeForTranslate } from '@engine/translate/plan'
import type { TranslationEngine } from '@engine/translate/engine'
import type { EngineError } from '@engine/protocol'
import type { CaptionBlock, Project } from '@engine/model'
import { block, joinWords, sampleProject, speaker, word } from '../editor/helpers/fixture-project'

const SPEAKERS = [speaker('SPK_1', 'Speaker 1', '#4c8dff')]

function blocks(count: number, texts?: string[]): CaptionBlock[] {
  return Array.from({ length: count }, (_, i) => {
    const text = texts?.[i] ?? `sentence number ${i}`
    return block(`blk_${i}`, i * 2, i * 2 + 1.9, 'SPK_1', [word(text, i * 2, i * 2 + 1.9)])
  })
}

function projectWith(count: number, texts?: string[]): Project {
  return sampleProject({ language: 'en', blocks: blocks(count, texts), speakers: SPEAKERS, translations: [{ language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: {} }] })
}

interface Script {
  /** Resolve latency per translate call (ms as a promise timer — NOT used in node tests; delays are modelled by call-order control). */
  calls: string[]
  translate: (src: string, tgt: string, text: string, signal: AbortSignal) => Promise<string>
  failures: Map<string, number>
  failTimes: number
  detected: Map<string, string>
  engine: TranslationEngine
  ensurePairResult: 'ready' | 'downloadable'
  ensurePairCalls: [string, string, boolean][]
}

function scriptedEngine(partial: { translate?: Script['translate']; detected?: Map<string, string>; ensurePairResult?: 'ready' | 'downloadable' } = {}): Script {
  const script: Script = {
    calls: [],
    failures: new Map(),
    failTimes: 0,
    detected: partial.detected ?? new Map(),
    ensurePairResult: partial.ensurePairResult ?? 'ready',
    ensurePairCalls: [],
    translate: partial.translate ?? (async (_s, _t, text) => `fr:${text}`),
    engine: null as unknown as TranslationEngine,
  }
  script.engine = {
    isAvailable: () => ({ available: true }),
    availability: async () => 'available',
    ensurePair: async (source, target, opts) => {
      script.ensurePairCalls.push([source, target, opts.userInitiated])
      return script.ensurePairResult
    },
    translate: async (source, target, text, signal) => {
      script.calls.push(text)
      const failed = (script.failures.get(text) ?? 0) < script.failTimes
      if (failed) {
        script.failures.set(text, (script.failures.get(text) ?? 0) + 1)
        const error: EngineError = { code: 'TRANSLATE_FAILED', retryable: true, detail: 'UNKNOWN' }
        throw error
      }
      return script.translate(source, target, text, signal)
    },
    detectLanguage: async (text) => {
      const lang = script.detected.get(text)
      return lang === undefined ? { language: 'en', confidence: 0.9 } : { language: lang, confidence: 0.9 }
    },
    dispose: () => undefined,
  }
  return script
}

const immediate = (): Promise<void> => Promise.resolve()

describe('CC-301.1: TranslationSession batching and ordering', () => {
  test('CC-301.1: batches of ≤ 20 with a macrotask yield between batches', async () => {
    const script = scriptedEngine()
    let yields = 0
    const session = createTranslationSession(script.engine, { scheduler: async () => void yields++ })
    const stats = await session.run(projectWith(45), 'fr', { ...( { onEntries: undefined } as object) })
    expect(stats.translated).toBe(45)
    expect(yields, 'yields between batches (i=20,40)').toBe(2)
  })

  test('CC-301.1: visible-first ordering — viewport blocks translate before the rest', async () => {
    const script = scriptedEngine()
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = projectWith(26)
    await session.run(project, 'fr', { visibleIds: new Set(['blk_25', 'blk_24']) })
    const first = script.calls.slice(0, 2)
    expect(first).toEqual(expect.arrayContaining([normalizeForTranslate(project.blocks[25]!.text), normalizeForTranslate(project.blocks[24]!.text)]))
  })

  test('CC-301.1: text cache (≤ 500) — identical texts hit the engine once', async () => {
    const texts = Array.from({ length: TEXT_CACHE_LIMIT + 30 }, (_, i) => `dup text ${i % 3 === 0 ? 0 : i}`)
    const script = scriptedEngine()
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = sampleProject({ language: 'en', blocks: blocks(texts.length, texts), speakers: SPEAKERS, translations: [{ language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: {} }] })
    const stats = await session.run(project, 'fr')
    const zeroHits = script.calls.filter((c) => c === 'dup text 0').length
    expect(zeroHits, 'repeated text translated once, cached thereafter').toBe(1)
    expect(stats.translated).toBe(texts.length)
  })

  test('CC-301.1: block text is normalized — no newline reaches the API', async () => {
    const script = scriptedEngine()
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = projectWith(1)
    project.blocks[0]!.text = 'line one\nline two'
    project.blocks[0]!.words[0]!.text = 'line one\nline two'
    await session.run(project, 'fr')
    expect(script.calls[0], 'FR-301.3: `\\n` replaced by spaces').toBe('line one line two')
  })
})

describe('CC-301.1: failure semantics', () => {
  test('CC-301.1: at most 3 attempts per block, then the entry is failed', async () => {
    const script = scriptedEngine()
    script.failTimes = 99 // always fail
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = projectWith(2)
    const entries: { blockId: string; entry: { text: string; status: string; sourceHash: string } }[] = []
    const stats = await session.run(project, 'fr', { onEntries: (batch) => entries.push(...batch) })
    expect(stats.failed).toBe(2)
    const perBlock = script.calls.filter((c) => c === project.blocks[0]!.text).length
    expect(perBlock, `≤ ${MAX_ATTEMPTS} engine calls per block`).toBe(MAX_ATTEMPTS)
    expect(entries.find((e) => e.blockId === 'blk_0')?.entry.status).toBe('failed')
    expect(entries.find((e) => e.blockId === 'blk_0')?.entry.text).toBe('')
    // plan excludes failed blocks once the attempt budget is spent (FR-301.3)
    const { planBlocks } = await import('@engine/translate/plan')
    const { applyEntries } = await import('@engine/translate/track')
    const settled = structuredClone(project)
    applyEntries(settled, 'fr', entries.map((e) => ({ blockId: e.blockId, entry: { text: e.entry.text, status: e.entry.status as 'failed', sourceHash: e.entry.sourceHash } })))
    const attempts = new Map<string, number>([['blk_0', MAX_ATTEMPTS], ['blk_1', MAX_ATTEMPTS]])
    expect(planBlocks(settled, 'fr', { attempts, maxAttempts: MAX_ATTEMPTS }).ordered, 'spent blocks leave the plan').toEqual([])
    expect(planBlocks(settled, 'fr', { attempts: new Map([['blk_0', 1], ['blk_1', 1]]), maxAttempts: MAX_ATTEMPTS }).ordered.sort(), 'under-budget failed blocks are re-planned').toEqual(['blk_0', 'blk_1'])
  })

  test('CC-301.1: aggregated warning — ONE per run, codes only, never text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const script = scriptedEngine()
    script.failTimes = 99
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = projectWith(3, ['CANARY-secret-phrase-alpha', 'CANARY-secret-phrase-beta', 'CANARY-secret-phrase-gamma'])
    await session.run(project, 'fr')
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(warn.mock.calls[0])
    expect(logged).not.toContain('CANARY')
    expect(logged).toContain('TRANSLATE_FAILED')
    warn.mockRestore()
  })

  test('CC-301.1: retryable failure recovers on a later attempt', async () => {
    const script = scriptedEngine()
    script.failTimes = 2 // two failures, third succeeds
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = projectWith(1)
    const entries: { blockId: string; entry: { status: string } }[] = []
    const stats = await session.run(project, 'fr', { onEntries: (b) => entries.push(...b) })
    expect(stats.translated).toBe(1)
    expect(entries[0]?.entry.status).toBe('translated')
  })
})

describe('CC-301.1: generation counter and cancellation', () => {
  test('CC-301.1: a newer run discards the older run in flight — the store never sees old results', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const script = scriptedEngine({
      translate: async () => {
        await gate
        return 'fr:late'
      },
    })
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = projectWith(5)
    const oldEntries: unknown[] = []
    const newEntries: unknown[] = []
    const oldRun = session.run(project, 'fr', { onEntries: (b) => oldEntries.push(...b) })
    await Promise.resolve()
    // target-language switch while the first translate is in flight
    const newRun = session.run(project, 'es', { onEntries: (b) => newEntries.push(...b) })
    await Promise.resolve()
    release()
    const oldStats = await oldRun
    const newStats = await newRun
    expect(oldStats.cancelled, 'older run reports cancellation on supersede').toBe(true)
    expect(oldStats.discarded, 'older in-flight results discarded').toBeGreaterThan(0)
    expect(oldEntries, 'older run delivered nothing').toEqual([])
    expect(newStats.translated, 'newer run completes').toBe(5)
    expect(newEntries.length, 'newer run delivers its batches').toBeGreaterThan(0)
  })

  test('CC-301.1: cancel via AbortSignal stops observing ≤ 500 ms; in-flight resolves discard', async () => {
    let resolvePending: (value: string) => void = () => undefined
    const script = scriptedEngine({
      translate: () => new Promise<string>((resolve) => (resolvePending = resolve)),
    })
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = projectWith(40)
    const controller = new AbortController()
    const delivered: unknown[] = []
    const run = session.run(project, 'fr', { signal: controller.signal, onEntries: (b) => delivered.push(...b) })
    // let the run reach its first in-flight engine call (real cancel happens
    // mid-translation, not at t=0), THEN abort and time from THERE.
    for (let i = 0; i < 50 && script.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
    expect(script.calls.length, 'run reached the engine before the cancel').toBe(1)
    const abortAt = performance.now()
    controller.abort()
    // FR-301.3 envelope: the API itself settles — bounded in-flight latency.
    resolvePending('fr:late')
    const stats = await run
    const settleMs = performance.now() - abortAt
    expect(stats.cancelled, 'cancelled').toBe(true)
    expect(settleMs, 'session stops observing within 500 ms of the abort').toBeLessThan(500)
    expect(script.calls.length, 'NO further engine call after the abort').toBe(1)
    expect(stats.discarded, 'late batch discarded (never reached onEntries)').toBeGreaterThan(0)
    expect(delivered.length, 'nothing delivered after abort').toBe(0)
  })

  test('CC-301.1: pass-through respects the script subtag (zh-Hant ≠ zh-Hans, FR-301.6)', async () => {
    const cases: { detected: string; target: string; passThrough: boolean }[] = [
      { detected: 'zh-hant', target: 'zh-Hant', passThrough: true },
      { detected: 'zh-hans', target: 'zh-Hant', passThrough: false },
      { detected: 'zh', target: 'zh-Hant', passThrough: false },
      { detected: 'zh-hans', target: 'zh', passThrough: true },
      { detected: 'en', target: 'zh-Hant', passThrough: false },
    ]
    for (const c of cases) {
      const script = scriptedEngine({ detected: new Map<string, string>([['sentence number 0', c.detected]]) })
      const session = createTranslationSession(script.engine, { scheduler: immediate })
      const stats = await session.run(projectWith(1), c.target)
      if (c.passThrough) {
        expect(stats.passThrough, `${c.detected} → ${c.target} passes through`).toBe(1)
        expect(script.calls.length, 'no engine call').toBe(0)
      } else {
        expect(stats.translated, `${c.detected} → ${c.target} gets translated`).toBe(1)
        expect(stats.passThrough, 'never passed through').toBe(0)
      }
    }
  })

  test('CC-301.1: background run against a downloadable pair starts no download and translates nothing', async () => {
    const script = scriptedEngine({ ensurePairResult: 'downloadable' })
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const stats = await session.run(projectWith(10), 'fr', { userInitiated: false })
    expect(stats.pairDownloadable).toBe(true)
    expect(script.calls, 'no translate calls').toEqual([])
    expect(script.ensurePairCalls[0]?.[2], 'userInitiated=false propagated').toBe(false)
  })
})

describe('FR-301.6 / US-301.3: pass-through and entry consistency', () => {
  test('FR-301.6: a block already in the target language becomes a translated entry without translate', async () => {
    const detected = new Map<string, string>([['sentence number 0', 'fr-FR']])
    const script = scriptedEngine({ detected })
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = projectWith(2)
    const entries: { blockId: string; entry: { text: string; status: string; sourceHash: string } }[] = []
    const stats = await session.run(project, 'fr', { onEntries: (b) => entries.push(...b) })
    expect(stats.passThrough).toBe(1)
    const pass = entries.find((e) => e.blockId === 'blk_0')
    expect(pass?.entry.text, 'entry is the SOURCE text').toBe(project.blocks[0]!.text)
    expect(pass?.entry.status).toBe('translated')
    expect(pass?.entry.sourceHash, 'not stale after pass-through').toBe(sourceHash(project.blocks[0]!.text))
    expect(script.calls).toEqual([project.blocks[1]!.text])
  })

  test('CC-301.1: translated entries carry sourceHash of the source block text', async () => {
    const script = scriptedEngine()
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const project = projectWith(1)
    const entries: { entry: { sourceHash: string } }[] = []
    await session.run(project, 'fr', { onEntries: (b) => entries.push(...b) })
    expect(entries[0]?.entry.sourceHash).toBe(sourceHash(project.blocks[0]!.text))
  })

  test('CC-301.1: progress reports done/total monotonically', async () => {
    const script = scriptedEngine()
    const session = createTranslationSession(script.engine, { scheduler: immediate })
    const seen: [number, number][] = []
    await session.run(projectWith(3), 'fr', { onProgress: (d, t) => seen.push([d, t]) })
    expect(seen.map(([d]) => d)).toEqual([1, 2, 3])
    expect(seen.every(([, t]) => t === 3)).toBe(true)
  })
})
