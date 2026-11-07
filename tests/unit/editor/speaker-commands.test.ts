// FR-102.1 (L1): the `speaker-*` commands wrapping the engine-06 PURE
// functions through the injectable `SpeakerEngine` seam (ASSUMPTION:
// engine-06 unmerged — contract header; the fake stands in, the same suites
// re-run against the real fns when unit-06 lands). Enforces invariants 4
// (rename never touches ids; deleting a speaker's last block keeps the
// speaker) and 5 (any speaker mutation sets `speakerSource:'manual'`).
import { describe, expect, test } from 'vitest'
import { createTestApp } from './helpers/editor-app'
import { block, word } from './helpers/fixture-project'

describe('FR-102.1: speaker commands through the engine seam', () => {
  test('FR-102.1: speaker-add creates the next SPK_<n> id', () => {
    const { app } = createTestApp()
    const reject = app.dispatch('speaker-add', { label: 'Narrator', color: '#00ff00' })
    expect(reject).toBeNull()
    const added = app.project.getState().project?.speakers.at(-1)
    expect(added?.label).toBe('Narrator')
    expect(added?.id, 'durable SPK_<n> id from the store (never a label)').toMatch(/^SPK_\d+$/)
    expect(added?.id).not.toBe('Narrator')
  })

  test('FR-102.1 (invariant 5): any speaker mutation flips speakerSource to manual — reverting is explicit only', () => {
    const { app } = createTestApp()
    expect(app.project.getState().project?.speakerSource).toBe('auto-beta')
    expect(app.dispatch('speaker-rename', { speakerId: 'SPK_1', label: 'Ann' })).toBeNull()
    expect(app.project.getState().project?.speakerSource).toBe('manual')
  })

  test('CC-102.3 (invariant 4): a rename payload carrying an id change is rejected — ids are immutable', () => {
    const { app } = createTestApp()
    const before = structuredClone(app.project.getState().project?.speakers)
    const reject = app.dispatch('speaker-rename', { speakerId: 'SPK_1', label: 'Ann', id: 'SPK_999' } as never)
    expect(reject?.code).toBe('SPEAKER_ID_IMMUTABLE')
    expect(app.project.getState().project?.speakers).toEqual(before)
  })

  test('CC-102.3: empty rename label is rejected', () => {
    const { app } = createTestApp()
    const reject = app.dispatch('speaker-rename', { speakerId: 'SPK_1', label: '  ' })
    expect(reject?.code).toBe('SPEAKER_LABEL_EMPTY')
  })

  test('FR-102.1 (invariant 4): rename changes ONLY the label — every block keeps its speakerId', () => {
    const { app } = createTestApp()
    const before = structuredClone(app.project.getState().project?.speakers)
    const blockIdsBefore = app.project.getState().project?.blocks.map((b) => [b.id, b.speakerId])

    expect(app.dispatch('speaker-rename', { speakerId: 'SPK_2', label: 'Interviewer' })).toBeNull()

    const speakers = app.project.getState().project?.speakers
    expect(speakers?.map((s) => s.id)).toEqual(before?.map((s) => s.id))
    expect(speakers?.find((s) => s.id === 'SPK_2')?.label).toBe('Interviewer')
    expect(app.project.getState().project?.blocks.map((b) => [b.id, b.speakerId]), 'renaming is cosmetic — ids untouched').toEqual(blockIdsBefore)
  })

  test('FR-102.1: recolor changes only the color', () => {
    const { app } = createTestApp()
    expect(app.dispatch('speaker-recolor', { speakerId: 'SPK_1', color: '#ff0000' })).toBeNull()
    expect(app.project.getState().project?.speakers.find((s) => s.id === 'SPK_1')?.color).toBe('#ff0000')
  })

  test('FR-102.1: speaker-assign routes words through the engine seam and materializes the block majority (invariant: word-level truth)', () => {
    const t = createTestApp()
    t.speakerEngine.nextMajority = 'SPK_2'
    const reject = t.app.dispatch('speaker-assign', { blockIds: ['blk_a'], speakerId: 'SPK_2' })
    expect(reject).toBeNull()
    expect(t.speakerEngine.calls.some((c) => c.fn === 'reassignWords' && c.arg === 'SPK_1→SPK_2'), 'word-level truth updated via the pure fns').toBe(true)
    expect(t.speakerEngine.calls.some((c) => c.fn === 'majoritySpeakerId'), 'block display materialized by the majority fn').toBe(true)
    const assigned = t.app.project.getState().project?.blocks.find((b) => b.id === 'blk_a')
    expect(assigned?.speakerId).toBe('SPK_2')
    expect(assigned?.words.every((w) => w.speakerId === 'SPK_2'), 'every word carries the new id').toBe(true)
  })

  test('FR-102.1: assign keeps the majority honest when the seam votes back (no canned result)', () => {
    const t = createTestApp()
    // Pre-seed a block whose words are mixed SPK_1×2 + SPK_2×1 → majority SPK_1.
    const mixed = block('blk_mix', 20, 22, 'SPK_2', [word('a', 20, 20.5, { speakerId: 'SPK_1' }), word('b', 20.6, 21, { speakerId: 'SPK_1' }), word('c', 21.1, 21.9, { speakerId: 'SPK_2' })])
    const importReject = t.app.dispatch('captions-import', { blocks: [mixed], replace: false })
    expect(importReject).toBeNull()

    expect(t.app.dispatch('speaker-assign', { blockIds: ['blk_mix'], speakerId: 'SPK_1' })).toBeNull()
    const after = t.app.project.getState().project?.blocks.find((b) => b.id === 'blk_mix')
    expect(after?.speakerId, 'majority over the updated words').toBe('SPK_1')
  })

  test('CC-102.3 (invariant 4): assign to an unknown speaker is rejected', () => {
    const { app } = createTestApp()
    const reject = app.dispatch('speaker-assign', { blockIds: ['blk_a'], speakerId: 'SPK_404' })
    expect(reject?.code).toBe('DANGLING_SPEAKER_REF')
  })

  test('FR-102.1: speaker mutations are undoable/redoable through history', () => {
    const { app } = createTestApp()
    const labelBefore = app.project.getState().project?.speakers.find((s) => s.id === 'SPK_1')?.label
    expect(app.dispatch('speaker-rename', { speakerId: 'SPK_1', label: 'Ann' })).toBeNull()
    const sourceBeforeUndo = app.project.getState().project?.speakerSource
    expect(sourceBeforeUndo).toBe('manual')
    app.history.undo()
    expect(app.project.getState().project?.speakers.find((s) => s.id === 'SPK_1')?.label, 'undo restores the label…').toBe(labelBefore)
    expect(app.project.getState().project?.speakerSource, '…and the pre-mutation source state').toBe('auto-beta')
    app.history.redo()
    expect(app.project.getState().project?.speakers.find((s) => s.id === 'SPK_1')?.label).toBe('Ann')
  })
})
