// CC-301.1 (L1) supplements: plan filtering matrix + session edge paths —
// retranslateStale, non-retryable single-attempt, disposed session, text
// cache eviction (> 500), abort during detection, dangling plan ids.
import { describe, expect, test } from 'vitest'
import { planBlocks, normalizeForTranslate } from '@engine/translate/plan'
import { createTranslationSession } from '@engine/translate/session'
import { translateError } from '@engine/translate/engine'
import { STALE_HASH, sourceHash } from '@engine/translate/track'
import type { TranslationEngine } from '@engine/translate/engine'
import type { Project } from '@engine/model'
import { sampleProject, block, speaker, word } from '../editor/helpers/fixture-project'

const SPEAKERS = [speaker('SPK_1', 'Speaker 1', '#4c8dff')]

function proj(count: number, frEntries: Project['translations'][number]['entries'] = {}): Project {
  return sampleProject({
    language: 'en',
    blocks: Array.from({ length: count }, (_, i) => block(`blk_${i}`, i * 2, i * 2 + 1.9, 'SPK_1', [word(`plan text ${i}`, i * 2, i * 2 + 1.9)])),
    speakers: SPEAKERS,
    translations: [{ language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: structuredClone(frEntries) }],
  })
}

describe('CC-301.1: planBlocks filtering matrix (FR-301.3)', () => {
  test('CC-301.1: missing planned; failed only under budget; stale only on request', () => {
    const p = proj(4)
    // blk_1 has a fresh entry, blk_2 failed (attempts=2), blk_3 stale
    p.translations[0]!.entries['blk_1'] = { text: 't1', status: 'translated', sourceHash: sourceHash(p.blocks[1]!.text) }
    p.translations[0]!.entries['blk_2'] = { text: '', status: 'failed', sourceHash: STALE_HASH }
    p.translations[0]!.entries['blk_3'] = { text: 'old', status: 'translated', sourceHash: 'stale-sentinel-ish' }

    let plan = planBlocks(p, 'fr')
    expect(plan.ordered, 'fresh+stale stay out by default; missing + under-budget failed in').toEqual(['blk_0', 'blk_2'])
    expect(plan.stale, 'stale reported informationally').toEqual(['blk_3'])

    plan = planBlocks(p, 'fr', { retranslateStale: true })
    expect(plan.ordered.sort()).toEqual(['blk_0', 'blk_2', 'blk_3'])

    plan = planBlocks(p, 'fr', { attempts: new Map([['blk_2', 3]]) })
    expect(plan.ordered, 'failed at budget leaves the plan').toEqual(['blk_0'])

    plan = planBlocks(p, 'fr', { visibleIds: new Set(['blk_0']) })
    expect(plan.ordered[0], 'visible first').toBe('blk_0')

    expect(planBlocks(p, 'de').ordered.length, 'absent track ⇒ all blocks missing ⇒ planned').toBe(4)
  })

  test('CC-301.1: normalizeForTranslate collapses newlines only', () => {
    expect(normalizeForTranslate('a\nb\nc')).toBe('a b c')
    expect(normalizeForTranslate('keep\ttabs  double')).toBe('keep\ttabs  double')
  })

  test('FR-301.7: translateError without detail omits the key (codes-only contract)', () => {
    const bare = translateError('TRANSLATE_FAILED', true)
    expect({ code: bare.code, retryable: bare.retryable, detail: bare.detail }).toEqual({ code: 'TRANSLATE_FAILED', retryable: true, detail: undefined })
    expect(bare.message, 'message is code-derived only (SECURITY-03)').toBe('engine:TRANSLATE_FAILED')
    const withDetail = translateError('DOWNLOAD_FAILED', false, 'CREATE:UNKNOWN')
    expect({ code: withDetail.code, retryable: withDetail.retryable, detail: withDetail.detail }).toEqual({ code: 'DOWNLOAD_FAILED', retryable: false, detail: 'CREATE:UNKNOWN' })
  })
})

function engineStub(overrides: Partial<TranslationEngine> = {}): TranslationEngine {
  return {
    isAvailable: () => ({ available: true }),
    availability: async () => 'available',
    ensurePair: async () => 'ready',
    translate: async (_s, _t, text) => `fr:${text}`,
    detectLanguage: async () => ({ language: 'en', confidence: 0.9 }),
    dispose: () => undefined,
    ...overrides,
  }
}

describe('CC-301.1: session edge paths', () => {
  test('CC-301.1: engine absent → run rejects PAIR_UNAVAILABLE with the reason', async () => {
    const session = createTranslationSession(engineStub({ isAvailable: () => ({ available: false, reason: 'browser' }) }))
    await expect(session.run(proj(1), 'fr')).rejects.toMatchObject({ code: 'PAIR_UNAVAILABLE', detail: 'ENGINE_UNAVAILABLE:browser' })
  })

  test('CC-301.1: null source language → PAIR_UNAVAILABLE NO_SOURCE_LANGUAGE', async () => {
    const p = proj(1)
    p.language = null
    const session = createTranslationSession(engineStub())
    await expect(session.run(p, 'fr')).rejects.toMatchObject({ detail: 'NO_SOURCE_LANGUAGE' })
  })

  test('CC-301.1: disposed session refuses runs', async () => {
    const session = createTranslationSession(engineStub())
    session.dispose()
    await expect(session.run(proj(1), 'fr')).rejects.toMatchObject({ code: 'PAIR_UNAVAILABLE', detail: 'DISPOSED' })
  })

  test('CC-301.1: non-retryable failure → single attempt, entry failed', async () => {
    const calls: string[] = []
    const engine = engineStub({
      translate: async (_s, _t, text) => {
        calls.push(text)
        throw translateError('PAIR_UNAVAILABLE', false, 'PAIR_UNSUPPORTED')
      },
    })
    const session = createTranslationSession(engine, { scheduler: async () => undefined })
    const entries: { blockId: string; entry: { status: string } }[] = []
    const stats = await session.run(proj(1), 'fr', { onEntries: (b) => entries.push(...b) })
    expect(calls.length, 'retryable=false ⇒ no retries').toBe(1)
    expect(stats.failed).toBe(1)
    expect(entries[0]?.entry.status).toBe('failed')
    expect(session.attemptsFor('fr').get('blk_0')).toBe(1)
  })

  test('CC-301.1: text cache caps at 500 with FIFO eviction (FR-301.6)', async () => {
    const distinct = 560
    const allBlocks = Array.from({ length: distinct }, (_, i) => block(`blk_${i}`, i * 0.5, i * 0.5 + 0.4, 'SPK_1', [word(`cache text ${i}`, i * 0.5, i * 0.5 + 0.4)]))
    const projOf = (blocks: typeof allBlocks): ReturnType<typeof sampleProject> =>
      sampleProject({
        language: 'en',
        blocks: structuredClone(blocks),
        speakers: SPEAKERS,
        translations: [{ language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: {} }],
      })
    const calls: string[] = []
    const engine = engineStub({
      translate: async (_s, _t, text) => {
        calls.push(text)
        return `fr:${text}`
      },
    })
    const session = createTranslationSession(engine, { scheduler: async () => undefined })
    const runRange = async (from: number, to: number) => {
      const before = calls.length
      const stats = await session.run(projOf(allBlocks.slice(from, to)), 'fr')
      return { fetched: calls.length - before, stats }
    }

    // Run 1: every distinct text crosses the engine once; the FIFO evicts
    // the first 60 at the 500-entry cap.
    const r1 = await runRange(0, distinct)
    expect(r1.fetched).toBe(distinct)
    expect(r1.stats.translated).toBe(distinct)
    // Run 2 — TAIL (most recently inserted): full hits, zero engine calls
    // (proves retention, and that the cap did not drop the recent set).
    expect((await runRange(distinct - 10, distinct)).fetched, 'recent tail stays cached').toBe(0)
    // Run 3 — HEAD (the FIFO victims): all 10 refetch (proves the 500 cap
    // evicted exactly the oldest). Their re-insertion evicts blocks 60–69.
    expect((await runRange(0, 10)).fetched, 'FIFO-evicted head refetches').toBe(10)
    // Run 4 — blocks 60–69: just evicted to make room → refetch (proves
    // FIFO victim ORDER, not just that eviction happens).
    expect((await runRange(60, 70)).fetched, 'FIFO pops oldest first').toBe(10)
    // Run 5 — tail again: still resident (the eviction storm never touched it).
    expect((await runRange(distinct - 10, distinct)).fetched, 'tail never evicted').toBe(0)
  })

  test('CC-301.1: abort while awaiting detection → cancelled, nothing delivered', async () => {
    const controller = new AbortController()
    const engine = engineStub({
      detectLanguage: async () => {
        controller.abort()
        await Promise.resolve()
        return { language: 'en', confidence: 0.9 }
      },
    })
    const session = createTranslationSession(engine, { scheduler: async () => undefined })
    const delivered: unknown[] = []
    const stats = await session.run(proj(3), 'fr', { signal: controller.signal, onEntries: (b) => delivered.push(...b) })
    expect(stats.cancelled).toBe(true)
    expect(delivered).toEqual([])
    expect(stats.discarded).toBeGreaterThan(0)
  })

  test('CC-301.1: plan ids that no longer exist are skipped (invariant 10 race)', async () => {
    const p = proj(3)
    const engine = engineStub()
    const session = createTranslationSession(engine, { scheduler: async () => undefined })
    // mutate the project mid-run: the run snapshots the plan up front; deleting
    // a block afterwards must not crash nor emit entries for the dead id.
    const delivered: { blockId: string }[] = []
    let deleted = false
    const run = session.run(p, 'fr', {
      onEntries: (b) => delivered.push(...b),
      onProgress: (done) => {
        if (done === 1 && !deleted) {
          deleted = true
          p.blocks.splice(2, 1)
        }
      },
    })
    const stats = await run
    expect(delivered.every((e) => e.blockId !== 'blk_2'), 'no entries for a block deleted mid-run').toBe(true)
    expect(stats.planned).toBe(3)
  })
})
