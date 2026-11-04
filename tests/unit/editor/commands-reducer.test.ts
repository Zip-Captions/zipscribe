// CC-102.3 (L1): reducer invalid-payload tests enforcing domain invariants 1–4
// and 9, plus the valid-path block semantics of FR-102.1. Every reducer must
// REJECT out-of-contract payloads with a `CommandReject` CODE (SECURITY-03:
// code + token only) and leave the project byte-identical; accepting paths
// keep invariants 1–3 (sorted non-overlapping blocks, words within bounds,
// text == words join) and never move media (invariant 9).
//
// RED until `@state/history` exists (createEditorApp is the public seam — the
// command table is reached through `app.dispatch`/`app.getCommand`).
import { describe, expect, test } from 'vitest'
import { createTestApp } from './helpers/editor-app'
import { block, sampleProject, word } from './helpers/fixture-project'
import { deriveBlockText } from '@state/commands'
import type { EditorApp } from '@state/history'
import type { CaptionBlock } from '@engine/model@102'

function projectOf(app: EditorApp) {
  const state = app.project.getState().project
  if (state === null) throw new Error('no project')
  return state
}

function snapshot(app: EditorApp) {
  return structuredClone(projectOf(app))
}

describe('CC-102.3: captions-import payload validation (invariants 1–2, 4)', () => {
  test('CC-102.3: unsorted blocks are rejected (invariant 1) with state unchanged', () => {
    const { app } = createTestApp()
    const before = snapshot(app)
    const late = block('blk_late', 20, 21, 'SPK_1', [word('late', 20, 21)])
    const early = block('blk_early', 10, 11, 'SPK_1', [word('early', 10, 11)])
    const reject = app.dispatch('captions-import', { blocks: [late, early], replace: false })
    expect(reject).not.toBeNull()
    expect(reject?.code).toBe('BLOCKS_UNSORTED')
    expect(projectOf(app)).toEqual(before)
    expect(app.history.undoCount(), 'a rejected command creates no history step').toBe(0)
  })

  test('CC-102.3: overlapping blocks are rejected (invariant 1)', () => {
    const { app } = createTestApp()
    const a = block('blk_o1', 30, 34, 'SPK_1', [word('one', 30, 32)])
    const b = block('blk_o2', 33, 36, 'SPK_1', [word('two', 33, 36)])
    const reject = app.dispatch('captions-import', { blocks: [a, b], replace: false })
    expect(reject?.code, 'overlap must be reported as overlap, not silence').toBe('BLOCKS_OVERLAP')
  })

  test('CC-102.3: overlapping against EXISTING blocks is rejected (replace:false append)', () => {
    const { app } = createTestApp()
    const collide = block('blk_hit', 3, 4, 'SPK_1', [word('hit', 3, 4)])
    const reject = app.dispatch('captions-import', { blocks: [collide], replace: false })
    expect(reject?.code).toBe('BLOCKS_OVERLAP')
  })

  test('CC-102.3: unsorted words inside a block are rejected (invariant 1)', () => {
    const { app } = createTestApp()
    const bad = block('blk_w', 40, 42, 'SPK_1', [word('b', 41, 42), word('a', 40, 41)])
    const reject = app.dispatch('captions-import', { blocks: [bad], replace: false })
    expect(reject?.code).toBe('WORDS_UNSORTED')
  })

  test('CC-102.3: a word outside [start,end] is rejected (invariant 1)', () => {
    const { app } = createTestApp()
    const bad = block('blk_x', 40, 42, 'SPK_1', [word('out', 41, 43)])
    const reject = app.dispatch('captions-import', { blocks: [bad], replace: false })
    expect(reject?.code).toBe('WORD_OUT_OF_RANGE')
  })

  test('CC-102.3: text != words join is rejected (invariant 2)', () => {
    const { app } = createTestApp()
    const words = [word('alpha', 50, 51), word('beta', 51, 52)]
    const bad: CaptionBlock = { id: 'bad2', start: 50, end: 52, text: 'alpha betA', words, speakerId: 'SPK_1' }
    const reject = app.dispatch('captions-import', { blocks: [bad], replace: false })
    expect(reject?.code).toBe('TEXT_WORD_MISMATCH')
  })

  test('CC-102.3: a block referencing an unknown speaker is rejected (invariant 4)', () => {
    const { app } = createTestApp()
    const bad = block('blk_d', 50, 51, 'SPK_404', [word('dangling', 50, 51)])
    const reject = app.dispatch('captions-import', { blocks: [bad], replace: false })
    expect(reject?.code).toBe('DANGLING_SPEAKER_REF')
    expect(reject?.token, 'token identifies the speaker id, not content').toBe('SPK_404')
  })

  test('FR-102.1: a valid replace-import lands sorted and re-renders (sanity)', () => {
    const { app } = createTestApp()
    const a = block('imp_1', 60, 61, 'SPK_1', [word('one', 60, 61)])
    const b = block('imp_2', 62, 63, 'SPK_2', [word('two', 62, 63)])
    const reject = app.dispatch('captions-import', { blocks: [b, a].sort((x, y) => x.start - y.start), replace: true })
    expect(reject).toBeNull()
    expect(projectOf(app).blocks.map((x) => x.id)).toEqual(['imp_1', 'imp_2'])
    expect(projectOf(app).captionOrigin, 'import sets the origin (model.ts)').toBe('imported')
  })
})

describe('CC-102.3: block command validation', () => {
  test('CC-102.3: unknown blockId is a dangling reference', () => {
    const { app } = createTestApp()
    const before = snapshot(app)
    const reject = app.dispatch('block-split', { blockId: 'nope', at: 1 })
    expect(reject?.code).toBe('DANGLING_BLOCK_REF')
    expect(projectOf(app)).toEqual(before)
  })

  test('CC-102.3: split at a point that empties one part is rejected', () => {
    const { app } = createTestApp()
    // blk_a spans 0.5–2.5, first word starts at 0.5 → any `at` before the
    // first word's end leaves the LEFT part wordless (invariant 3 forbids it).
    const reject = app.dispatch('block-split', { blockId: 'blk_a', at: 0.6 })
    expect(reject?.code).toBe('SPLIT_EMPTY_PART')
  })

  test('FR-102.1: split produces two invariant-valid halves and notifies the rules seam', () => {
    const { app, translationRules } = createTestApp()
    const reject = app.dispatch('block-split', { blockId: 'blk_a', at: 1.5 })
    expect(reject).toBeNull()
    const blocks = projectOf(app).blocks
    expect(blocks.length).toBe(4)
    const first = blocks[0]
    const second = blocks[1]
    expect(first?.end).toBe(1.5)
    expect(second?.start).toBe(1.5)
    for (const b of [first, second]) {
      if (b === undefined || b.words.length === 0) throw new Error('split part empty')
      expect(b.text, 'invariant 2 via the frozen deriveBlockText').toBe(deriveBlockText(b.words))
    }
    expect(translationRules.calls.some((c) => c.hook === 'onBlockSplit'), 'invariant-10 hook routed through the seam').toBe(true)
  })

  test('CC-102.3: merge of non-adjacent blocks is rejected', () => {
    const { app } = createTestApp()
    const reject = app.dispatch('block-merge', { blockIds: ['blk_a', 'blk_c'] })
    expect(reject?.code).toBe('MERGE_NOT_ADJACENT')
  })

  test('FR-102.1: merging neighbours unions the span, space-joins text, fires onBlockMerge', () => {
    const { app, translationRules } = createTestApp()
    const reject = app.dispatch('block-merge', { blockIds: ['blk_a', 'blk_b'] })
    expect(reject).toBeNull()
    const merged = projectOf(app).blocks[0]
    expect(merged?.start).toBe(0.5)
    expect(merged?.end).toBe(5)
    expect(merged?.text, 'invariant 2 across the join').toBe(deriveBlockText(merged?.words ?? []))
    expect(translationRules.calls.some((c) => c.hook === 'onBlockMerge')).toBe(true)
  })

  test('CC-102.3: retime with end <= start is rejected', () => {
    const { app } = createTestApp()
    const reject = app.dispatch('block-retime', { blockId: 'blk_a', start: 2, end: 1 })
    expect(reject?.code).toBe('DURATION_NON_POSITIVE')
  })

  test('CC-102.3: retime that would overlap the next block is rejected (invariant 1)', () => {
    const { app } = createTestApp()
    const before = snapshot(app)
    const reject = app.dispatch('block-retime', { blockId: 'blk_a', end: 4 })
    expect(reject?.code).toBe('BLOCKS_OVERLAP')
    expect(projectOf(app)).toEqual(before)
  })

  test('CC-102.3: retime beyond the asset duration is rejected', () => {
    const { app } = createTestApp()
    const reject = app.dispatch('block-retime', { blockId: 'blk_c', end: 999 })
    expect(reject?.code).toBe('OUT_OF_MEDIA')
  })

  test('CC-102.3: loop payload with end <= start is rejected; invalid rate rejected', () => {
    const { app } = createTestApp()
    expect(app.dispatch('transport-loop-set', { start: 5, end: 5 })?.code).toBe('LOOP_RANGE_INVALID')
    expect(app.dispatch('transport-rate', { rate: 0 })?.code).toBe('RATE_INVALID')
    expect(app.dispatch('transport-rate', { rate: Number.NaN })?.code).toBe('RATE_INVALID')
  })
})

describe('CC-102.3: deletions never move media (invariant 9) and never orphan speakers (invariant 4)', () => {
  test('CC-102.3: block-delete leaves the gap — later blocks keep their times', () => {
    const { app } = createTestApp()
    const before = projectOf(app).blocks.map((b) => [b.id, b.start, b.end])
    const reject = app.dispatch('block-delete', { blockId: 'blk_a' })
    expect(reject).toBeNull()
    const after = projectOf(app).blocks.map((b) => [b.id, b.start, b.end])
    expect(after).toEqual(before.slice(1))
  })

  test('CC-102.3: delete + close gap extends ONLY the neighbours; media never cut', () => {
    const { app } = createTestApp()
    const assetBefore = structuredClone(projectOf(app).asset)
    const reject = app.dispatch('block-delete-close-gap', { blockId: 'blk_b' })
    expect(reject).toBeNull()
    const blocks = projectOf(app).blocks
    expect(blocks.map((b) => b.id)).toEqual(['blk_a', 'blk_c'])
    expect(blocks[0]?.end, 'previous neighbour extends to the next start').toBe(blocks[1]?.start)
    expect(blocks[1]?.start, 'the later block is NOT shifted (invariant 9)').toBe(6.25)
    expect(projectOf(app).asset, 'media metadata untouched').toEqual(assetBefore)
  })

  test('CC-102.3: deleting a speaker’s last block keeps the speaker (invariant 4)', () => {
    const { app } = createTestApp()
    const reject = app.dispatch('block-delete', { blockId: 'blk_b' })
    expect(reject).toBeNull()
    expect(projectOf(app).speakers.map((s) => s.id), 'SPK_2 keeps its label for reuse').toContain('SPK_2')
  })

  test('CC-102.3: empty edit-text deletes the block (invariant 3)', () => {
    const { app } = createTestApp()
    const reject = app.dispatch('block-edit-text', { blockId: 'blk_c', text: '' })
    expect(reject).toBeNull()
    expect(projectOf(app).blocks.map((b) => b.id), 'no empty block persists').toEqual(['blk_a', 'blk_b'])
  })

  test('CC-102.3: a dangling translation entry fails the reducer pre-validation (invariant 10)', () => {
    const app10 = sampleProject({
      translations: [{ language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: { blk_ghost: { text: 'x', status: 'translated', sourceHash: 'h' } } }],
    })
    const { app } = createTestApp({ project: app10 })
    const before = structuredClone(app.project.getState().project)
    const reject = app.dispatch('block-split', { blockId: 'blk_a', at: 1.5 })
    expect(reject?.code).toBe('DANGLING_TRANSLATION_REF')
    expect(app.project.getState().project).toEqual(before)
  })
})
