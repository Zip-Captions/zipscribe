// FR-301.4 / US-301.3 (L1): pure track functions — sourceHash stability,
// staleIds, markReviewed, applyEntries, and the REAL invariant-10 hooks in
// isolation. The randomized sequences live in invariant10.property.test.ts.
import { describe, expect, test } from 'vitest'
import { REAL_TRANSLATION_RULES, STALE_HASH, applyEntries, isStale, markReviewed, sourceHash, staleIds } from '@engine/translate/track'
import type { Project } from '@engine/model'
import { sampleProject } from '../editor/helpers/fixture-project'

function project(fr: Record<string, { text: string; status: 'translated' | 'edited' | 'failed'; sourceHash: string }>): Project {
  return sampleProject({ translations: [{ language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: structuredClone(fr) }] })
}

describe('CC-301.2: sourceHash + stale derivation', () => {
  test('CC-301.2: sourceHash is deterministic and never equals the stale sentinel', () => {
    expect(sourceHash('hello world')).toBe(sourceHash('hello world'))
    expect(sourceHash('hello world')).not.toBe(sourceHash('hello worlds'))
    expect(sourceHash('')).not.toBe(STALE_HASH)
    expect(sourceHash('stale')).not.toBe(STALE_HASH)
  })

  test('US-301.3: an entry whose source text changed is stale; retime never is', () => {
    const text = 'welcome back'
    const entry = { text: 'bienvenue', status: 'translated' as const, sourceHash: sourceHash(text) }
    expect(isStale(entry, text), 'matching hash ⇒ fresh').toBe(false)
    expect(isStale(entry, text + '!'), 'changed text ⇒ stale').toBe(true)
    expect(isStale({ text: '', status: 'translated', sourceHash: STALE_HASH }, text), 'sentinel ⇒ stale').toBe(true)
  })

  test('US-301.3: markReviewed accepts the current source — text unchanged, entry leaves the stale set, one undo step is the command layer', () => {
    const p = project({ blk_a: { text: 'stale text', status: 'translated', sourceHash: 'nonsense' } })
    // current block text is the fixture's blk_a text, NOT 'stale text'
    const block = p.blocks.find((b) => b.id === 'blk_a')!
    p.blocks = [block]
    expect(staleIds(p, 'fr')).toEqual(['blk_a'])
    expect(markReviewed(p, 'fr', 'blk_a')).toBe(true)
    expect(p.translations[0]!.entries['blk_a']!.text, 'text untouched').toBe('stale text')
    expect(p.translations[0]!.entries['blk_a']!.sourceHash).toBe(sourceHash(block.text))
    expect(staleIds(p, 'fr'), 'fresh after review').toEqual([])
  })

  test('FR-301.4: applyEntries skips unknown blocks (invariant 10) and creates the machine track when absent', () => {
    const p = sampleProject({ translations: [] })
    const applied = applyEntries(p, 'de', [
      { blockId: p.blocks[0]!.id, entry: { text: 'x', status: 'translated', sourceHash: sourceHash(p.blocks[0]!.text) } },
      { blockId: 'blk_missing', entry: { text: 'y', status: 'translated', sourceHash: 'zzz' } },
    ])
    expect(applied).toBe(1)
    expect(p.translations[0]?.language).toBe('de')
    expect(p.translations[0]?.engine).toBe('chrome-translator')
    expect(Object.keys(p.translations[0]!.entries)).toEqual([p.blocks[0]!.id])
  })
})

describe('FR-301.4: REAL invariant-10 hooks (deterministic cases)', () => {
  const seeded = (): Project =>
    project({
      blk_a: { text: 'alpha', status: 'translated', sourceHash: 'wrong-a' },
      blk_c: { text: 'charlie', status: 'edited', sourceHash: 'wrong-c' },
    })

  test('CC-301.2: delete removes the entry from EVERY track', () => {
    const p = seeded()
    p.translations.push({ language: 'es', origin: 'machine', engine: 'chrome-translator', entries: { blk_a: { text: 'alpha-es', status: 'translated', sourceHash: 'h' } } })
    REAL_TRANSLATION_RULES.onBlockDelete(p, 'blk_a')
    for (const track of p.translations) expect(track.entries['blk_a']).toBeUndefined()
    expect(p.translations[0]!.entries['blk_c'], 'other entries untouched').toBeDefined()
  })

  test('CC-301.2: split keeps the entry on the first part (stale) and seeds an empty stale second; never-translated splits create nothing', () => {
    const p = seeded()
    REAL_TRANSLATION_RULES.onBlockSplit(p, 'blk_a', 'blk_a1', 'blk_a2')
    const track = p.translations[0]!
    expect(track.entries['blk_a'], 'source key never dangles').toBeUndefined()
    expect(track.entries['blk_a1']?.text).toBe('alpha')
    expect(isStale(track.entries['blk_a1']!, 'anything-but-original'), 'first part stale via hash mismatch').toBe(true)
    expect(track.entries['blk_a2']).toEqual({ text: '', status: 'translated', sourceHash: STALE_HASH })
    // blk_d never translated ⇒ no fabricated entries
    REAL_TRANSLATION_RULES.onBlockSplit(p, 'blk_d', 'blk_d1', 'blk_d2')
    expect(track.entries['blk_d1']).toBeUndefined()
    expect(track.entries['blk_d2'], 'no entry fabrication').toBeUndefined()
  })

  // block-split.ts calls onBlockSplit(project, block.id, first.id, secondId)
  // with first.id === block.id (the first part KEEPS the source id — the
  // command's only shape). The handler must survive that key aliasing: the
  // preserved first-part entry must not be destroyed by the source-key delete.
  test('CC-301.2: identical-id split (block-split.ts real shape, sourceId === firstId) keeps the first part entry and seeds the empty stale second', () => {
    const p = seeded()
    REAL_TRANSLATION_RULES.onBlockSplit(p, 'blk_a', 'blk_a', 'blk_a2')
    const track = p.translations[0]!
    expect(track.entries['blk_a'], 'aliased source key must NOT be deleted out from under the first part').toEqual({ text: 'alpha', status: 'translated', sourceHash: 'wrong-a' })
    expect(track.entries['blk_a2'], 'second part gets the empty stale entry').toEqual({ text: '', status: 'translated', sourceHash: STALE_HASH })
    expect(isStale(track.entries['blk_a']!, 'alpha beta'), 'part text changed ⇒ derived stale (hash mismatch, entry un-re-stamped)').toBe(true)
  })

  test('CC-301.2: identical-id split preserves `edited` status and the reviewed hash verbatim (T3 b3 shape)', () => {
    const p = seeded()
    REAL_TRANSLATION_RULES.onBlockSplit(p, 'blk_c', 'blk_c', 'blk_c2')
    const track = p.translations[0]!
    expect(track.entries['blk_c'], 'edited entry survives the aliased split untouched').toEqual({ text: 'charlie', status: 'edited', sourceHash: 'wrong-c' })
    expect(track.entries['blk_c2']).toEqual({ text: '', status: 'translated', sourceHash: STALE_HASH })
  })

  test('CC-301.2: identical-id split of a never-translated block fabricates nothing', () => {
    const p = seeded()
    REAL_TRANSLATION_RULES.onBlockSplit(p, 'blk_d', 'blk_d', 'blk_d2')
    const track = p.translations[0]!
    expect(track.entries['blk_d']).toBeUndefined()
    expect(track.entries['blk_d2'], 'no entry fabrication').toBeUndefined()
  })

  // block-merge.ts calls onBlockMerge(project, left.id, [leftId, rightId]) —
  // mergedId === sourceIds[0]. The concatenated entry must land on the merged
  // id even though that id is also a deleted source key.
  test('CC-301.2: merge with mergedId equal to a source id (block-merge.ts real shape) lands the concatenated stale entry on the merged id', () => {
    const p = seeded()
    REAL_TRANSLATION_RULES.onBlockMerge(p, 'blk_a', ['blk_a', 'blk_c'])
    const track = p.translations[0]!
    expect(track.entries['blk_a'], 'merged id is its own source key — result must not be deleted').toEqual({ text: 'alpha charlie', status: 'edited', sourceHash: STALE_HASH })
    expect(track.entries['blk_c'], 'other source key consumed').toBeUndefined()
  })

  test('CC-301.2: merge with mergedId equal to a source id keeps its text alone when the other source is entry-less', () => {
    const p = seeded()
    REAL_TRANSLATION_RULES.onBlockMerge(p, 'blk_c', ['blk_c', 'blk_x'])
    const track = p.translations[0]!
    expect(track.entries['blk_c']).toEqual({ text: 'charlie', status: 'edited', sourceHash: STALE_HASH })
  })

  test('CC-301.2: merge space-joins entries, preserves `edited` and marks stale; entry-less sources create nothing', () => {
    const p = seeded()
    p.blocks.push({ id: 'blk_m', start: 10, end: 12, text: 'merged', speakerId: 'SPK_1', words: [] })
    REAL_TRANSLATION_RULES.onBlockMerge(p, 'blk_m', ['blk_a', 'blk_c'])
    const track = p.translations[0]!
    expect(track.entries['blk_a']).toBeUndefined()
    expect(track.entries['blk_c']).toBeUndefined()
    expect(track.entries['blk_m']).toEqual({ text: 'alpha charlie', status: 'edited', sourceHash: STALE_HASH })
    REAL_TRANSLATION_RULES.onBlockMerge(p, 'blk_m2', ['blk_x', 'blk_y'])
    expect(track.entries['blk_m2'], 'no entry fabrication on merge').toBeUndefined()
  })

  test('CC-301.2: retime hook is a pure no-op', () => {
    const p = seeded()
    const before = structuredClone(p.translations)
    REAL_TRANSLATION_RULES.onBlockRetime(p, 'blk_a')
    expect(p.translations).toEqual(before)
  })
})
