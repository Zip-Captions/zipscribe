// CC-102.1 (L1, property): random command sequences (≥ 500 runs, N ≤ 200)
// survive the undo/redo round-trip — undo×N returns the PROJECT to start,
// redo×N reaches final. Every accepted step keeps domain invariants 1–4, 6,
// 9, 10 (checked with the suite's OWN guards, independent of the reducer).
// FR-102.2 pins ride along: zundo `limit:150`, no jump surface
// (`jumpable:false`), UI-only `editor` fields `undoable:false`, and the
// merge-window: consecutive `block-edit-text` on one block < 1 s apart
// (injected clock) coalesce into ONE undo step (US-2.1.4).
import { describe, expect, test } from 'vitest'
import * as fc from 'fast-check'
import { createTestApp } from './helpers/editor-app'
import { joinWords } from './helpers/fixture-project'
import type { CaptionBlock, Project } from '@engine/model@102'
import type { CommandId, CommandPayloads } from '@state/commands'

const round3 = (v: number): number => Math.round(v * 1000) / 1000
const TEXTS = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff']

interface Intent {
  kind: CommandId | 'clock-advance'
  pick: number
  param: number
}

const intentArb = fc.record({
  kind: fc.constantFrom<Intent['kind']>(
    'block-split',
    'block-merge',
    'block-retime',
    'block-edit-text',
    'block-delete',
    'block-delete-close-gap',
    'captions-retime-all',
    'captions-reflow',
    'captions-import',
    'speaker-add',
    'speaker-assign',
    'speaker-rename',
    'speaker-recolor',
    'project-rename',
    'transport-play',
    'transport-pause',
    'transport-seek',
    'transport-skip',
    'transport-step-frame',
    'transport-step-second',
    'transport-loop-set',
    'transport-loop-in',
    'transport-loop-out',
    'transport-loop-clear',
    'transport-loop-toggle',
    'transport-rate',
    'clock-advance',
  ),
  pick: fc.integer({ min: 0, max: 97 }),
  param: fc.integer({ min: 0, max: 1999 }),
})

/** Independent invariant guard (domain.md § Invariants 1–4, 6, 9, 10). */
function checkInvariants(project: Project, context: string): void {
  let previousEnd = Number.NEGATIVE_INFINITY
  for (const b of project.blocks) {
    expect(Number.isFinite(b.start) && Number.isFinite(b.end), `${context}: finite times`).toBe(true)
    expect(b.start, `${context}: non-negative start`).toBeGreaterThanOrEqual(0)
    expect(b.end > b.start, `${context}: positive duration ${b.id}`).toBe(true)
    expect(b.start >= previousEnd - 1e-9, `${context}: sorted & non-overlapping at ${b.id}`).toBe(true)
    previousEnd = b.end
    expect(b.words.length, `${context}: no empty blocks (invariant 3)`).toBeGreaterThan(0)
    let previousWordEnd = Number.NEGATIVE_INFINITY
    for (const w of b.words) {
      expect(w.start <= w.end, `${context}: word span ${b.id}`).toBe(true)
      expect(w.start >= previousWordEnd - 1e-9, `${context}: words sorted ${b.id}`).toBe(true)
      expect(w.start >= b.start - 1e-9 && w.end <= b.end + 1e-9, `${context}: words within bounds ${b.id}`).toBe(true)
      previousWordEnd = w.end
      // invariant 6: 3-decimal precision ceiling on everything the reducers write.
      expect(round3(w.start), `${context}: word start is 3-decimal`).toBe(w.start)
      expect(round3(w.end), `${context}: word end is 3-decimal`).toBe(w.end)
    }
    expect(round3(b.start), `${context}: block start is 3-decimal`).toBe(b.start)
    expect(round3(b.end), `${context}: block end is 3-decimal`).toBe(b.end)
    expect(b.text, `${context}: text is the words join (invariant 2)`).toBe(joinWords(b.words))
    expect(project.speakers.some((s) => s.id === b.speakerId), `${context}: speaker exists ${b.speakerId}`).toBe(true)
  }
  for (const track of project.translations) {
    for (const key of Object.keys(track.entries)) {
      expect(project.blocks.some((b) => b.id === key), `${context}: translation key ${'blk'} resolves (invariant 10)`).toBe(true)
    }
  }
}

function generatedBlocks(count: number, seed: number): CaptionBlock[] {
  const out: CaptionBlock[] = []
  let cursor = 30 + (seed % 7)
  for (let i = 0; i < count; i++) {
    const words = Array.from({ length: 1 + (seed + i) % 3 }, (_, w) => {
      const start = round3(cursor + (w * 0.5) % 1)
      const end = round3(start + 0.3)
      return { text: TEXTS[(seed + i + w) % TEXTS.length] ?? 'aa', start, end }
    })
    const last = words[words.length - 1]
    const end = round3(cursor + 1 + i * 0.05)
    out.push({ id: `imp_${seed}_${i}`, start: round3(cursor), end, text: joinWords(words), words, speakerId: 'SPK_1' })
    cursor = round3(end + 1)
  }
  return out
}

function applyIntent(t: ReturnType<typeof createTestApp>, intent: Intent, counter: number): boolean {
  const project = t.app.project.getState().project
  if (project === null) return false
  const { kind, pick, param } = intent
  const blocks = project.blocks

  const go = <Id extends CommandId>(id: Id, payload: CommandPayloads[Id]): boolean => t.app.dispatch(id, payload) === null

  switch (kind) {
    case 'clock-advance':
      t.clock.advance(param)
      return false
    case 'block-split': {
      if (blocks.length === 0) return false
      const b = blocks[pick % blocks.length]
      if (b === undefined) return false
      if (b.words.length < 2) return false
      return go('block-split', { blockId: b.id, at: round3(b.words[1]?.start ?? b.start) })
    }
    case 'block-merge': {
      if (blocks.length < 2) return false
      const i = pick % (blocks.length - 1)
      const left = blocks[i]
      const right = blocks[i + 1]
      if (left === undefined || right === undefined) return false
      return go('block-merge', { blockIds: [left.id, right.id] })
    }
    case 'block-retime': {
      if (blocks.length === 0) return false
      const b = blocks[pick % blocks.length]
      if (b === undefined) return false
      const end = round3(b.end - 0.1)
      if (end <= b.start) return false
      return go('block-retime', { blockId: b.id, end })
    }
    case 'block-edit-text': {
      if (blocks.length === 0) return false
      const b = blocks[pick % blocks.length]
      if (b === undefined) return false
      const wordCount = 1 + (param % 3)
      const text = param % 17 === 0 ? '' : Array.from({ length: wordCount }, (_, i) => TEXTS[(param + i) % TEXTS.length]).join(' ')
      return go('block-edit-text', { blockId: b.id, text })
    }
    case 'block-delete': {
      if (blocks.length === 0) return false
      return go('block-delete', { blockId: blocks[pick % blocks.length]?.id ?? '' })
    }
    case 'block-delete-close-gap': {
      if (blocks.length === 0) return false
      return go('block-delete-close-gap', { blockId: blocks[pick % blocks.length]?.id ?? '' })
    }
    case 'captions-retime-all':
      return go('captions-retime-all', { offsetSec: round3(((param % 400) - 200) / 100) })
    case 'captions-reflow':
      return go('captions-reflow', {})
    case 'captions-import':
      return go('captions-import', { blocks: generatedBlocks(1 + (pick % 4), param), replace: pick % 2 === 0 })
    case 'speaker-add':
      return go('speaker-add', { label: `L${counter}`, color: '#123456' })
    case 'speaker-assign': {
      if (blocks.length === 0 || project.speakers.length === 0) return false
      const target = project.speakers[pick % project.speakers.length]
      if (target === undefined) return false
      const chosen = blocks.filter((_, i) => i % (1 + (param % 3)) === 0).map((b) => b.id)
      if (chosen.length === 0) return false
      return go('speaker-assign', { blockIds: chosen, speakerId: target.id })
    }
    case 'speaker-rename': {
      if (project.speakers.length === 0) return false
      const s = project.speakers[pick % project.speakers.length]
      if (s === undefined) return false
      return go('speaker-rename', { speakerId: s.id, label: `R${param}` })
    }
    case 'speaker-recolor': {
      if (project.speakers.length === 0) return false
      const s = project.speakers[pick % project.speakers.length]
      if (s === undefined) return false
      return go('speaker-recolor', { speakerId: s.id, color: '#abcdef' })
    }
    case 'project-rename':
      return go('project-rename', { name: `renamed${counter}` })
    case 'transport-play':
      return go('transport-play', undefined)
    case 'transport-pause':
      return go('transport-pause', undefined)
    case 'transport-seek':
      return go('transport-seek', { time: round3((param % 12100) / 100) })
    case 'transport-skip':
      return go('transport-skip', { seconds: (param % 2 === 0 ? 1 : -1) * (param % 5 === 0 ? 10 : 5) })
    case 'transport-step-frame':
      return go('transport-step-frame', { frames: (param % 2 === 0 ? 1 : -1) * (1 + (param % 3)) })
    case 'transport-step-second':
      return go('transport-step-second', { seconds: (param % 2 === 0 ? 1 : -1) * (1 + (param % 2)) })
    case 'transport-loop-set': {
      const start = round3((param % 5000) / 100)
      return go('transport-loop-set', { start, end: round3(start + 2.5) })
    }
    case 'transport-loop-in':
      return go('transport-loop-in', undefined)
    case 'transport-loop-out':
      return go('transport-loop-out', undefined)
    case 'transport-loop-clear':
      return go('transport-loop-clear', undefined)
    case 'transport-loop-toggle':
      return go('transport-loop-toggle', undefined)
    case 'transport-rate':
      return go('transport-rate', { rate: [0.5, 1, 1.5, 2][param % 4] ?? 1 })
    default:
      return false
  }
}

describe('CC-102.1 / US-2.1.4: command undo/redo round-trip (property)', () => {
  test('CC-102.1: ≥ 500 random command sequences (N ≤ 200) undo×N → start, redo×N → final', () => {
    let counter = 0
    fc.assert(
      fc.property(fc.array(intentArb, { minLength: 1, maxLength: 200 }), (intents: unknown) => {
        const t = createTestApp()
        const start = structuredClone(t.app.project.getState().project)
        expect(t.app.history.undoCount(), 'fresh app has no history steps').toBe(0)

        let accepted = 0
        for (const intent of intents as Intent[]) {
          counter += 1
          const wasAccepted = applyIntent(t, intent, counter)
          if (wasAccepted) accepted += 1
          const current = t.app.project.getState().project
          if (current !== null) checkInvariants(current, `after ${intent.kind}`)
          expect(t.app.history.undoCount(), 'history never exceeds the frozen zundo limit').toBeLessThanOrEqual(150)
        }
        const final = structuredClone(t.app.project.getState().project)

        t.app.history.undo(accepted)
        expect(t.app.project.getState().project, 'undo×N returns to the start project').toEqual(start)
        t.app.history.redo(accepted)
        expect(t.app.project.getState().project, 'redo×N reaches the final project').toEqual(final)
        return true
      }),
      { numRuns: 500, seed: 20261104 },
    )
  })
})

describe('FR-102.2: zundo configuration through the history seam', () => {
  function renameRun(count: number) {
    const t = createTestApp()
    const start = structuredClone(t.app.project.getState().project)
    for (let i = 0; i < count; i++) {
      const reject = t.app.dispatch('project-rename', { name: `renamed${i}` })
      expect(reject).toBeNull()
    }
    return { t, start }
  }

  test('FR-102.2: history depth ≥ 100 — 100 undos from 120 commands do NOT reach the start; 120 do', () => {
    const { t, start } = renameRun(120)
    expect(t.app.history.undoCount()).toBe(120)
    t.app.history.undo(100)
    expect(t.app.project.getState().project, 'the 100th undo still has earlier steps beneath it').not.toEqual(start)
    t.app.history.undo(20)
    expect(t.app.project.getState().project).toEqual(start)
  })

  test('FR-102.2: zundo limit 150 — after 170 commands only 150 steps remain and the start is unreachable', () => {
    const { t, start } = renameRun(170)
    expect(t.app.history.undoCount()).toBe(150)
    t.app.history.undo(500)
    expect(t.app.history.undoCount(), 'undo clamps at the oldest retained step').toBe(0)
    expect(t.app.project.getState().project, 'the pruned past is gone (limit 150, not ∞)').not.toEqual(start)
  })

  test('FR-102.2: jumpable:false — the history surface is undo/redo/clear only (zundo 2.3.0 has no jump)', () => {
    const { t } = renameRun(3)
    const history = t.app.history as unknown as Record<string, unknown>
    expect('jump' in history, 'no jump affordance may appear').toBe(false)
    expect('jumpable' in history).toBe(false)
    expect(typeof history.undo).toBe('function')
    expect(typeof history.redo).toBe('function')
    expect(typeof history.clear).toBe('function')
  })

  test('FR-102.2: editor UI-only fields are undoable:false — playhead/selection/loop/rate create no steps and survive undo', () => {
    const t = createTestApp()
    t.app.editor.setPlayhead(5)
    t.app.editor.setSelection({ anchorBlockId: 'blk_a', focusBlockId: 'blk_b' })
    t.app.editor.setLoop([1, 2])
    t.app.editor.setRate(1.5)
    t.app.editor.setSearchOpen(true)
    expect(t.app.history.undoCount(), 'UI-only mutations create no history step').toBe(0)

    const reject = t.app.dispatch('project-rename', { name: 'renamed-ui' })
    expect(reject).toBeNull()
    expect(t.app.history.undoCount()).toBe(1)

    t.app.history.undo()
    expect(t.app.project.getState().project?.name, 'undo reverts the project').toBe('Sample project')
    expect(t.app.editor.getState().playhead, 'undo does NOT move the playhead').toBe(5)
    expect(t.app.editor.getState().selection.anchorBlockId).toBe('blk_a')
    expect(t.app.editor.getState().loop).toEqual([1, 2])
  })

  test('US-2.1.4: consecutive block-edit-text on ONE block < 1 s apart (injected clock) coalesce to one undo step', () => {
    const t = createTestApp()
    const original = t.app.project.getState().project?.blocks.find((b) => b.id === 'blk_a')?.text
    expect(original).toBeDefined()

    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'one two' })).toBeNull()
    t.clock.advance(500)
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'three four' })).toBeNull()
    t.clock.advance(400)
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'five six' })).toBeNull()

    expect(t.app.history.undoCount(), '500 ms + 400 ms gaps stay inside the 1 s merge window').toBe(1)
    t.app.history.undo()
    expect(t.app.project.getState().project?.blocks.find((b) => b.id === 'blk_a')?.text, 'one step reverts all three edits').toBe(original)
  })

  test('US-2.1.4: ≥ 1 s gap, a different block, or an interleaved command each end the merge chain', () => {
    const t = createTestApp()
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'a1' })).toBeNull()
    t.clock.advance(1000)
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'a2' })).toBeNull()
    expect(t.app.history.undoCount(), 'exactly 1000 ms is NOT < 1 s → separate step').toBe(2)

    t.clock.advance(100)
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_b', text: 'b1' })).toBeNull()
    expect(t.app.history.undoCount(), 'a different block breaks the chain').toBe(3)

    t.clock.advance(100)
    expect(t.app.dispatch('block-split', { blockId: 'blk_c', at: 7 })).toBeNull()
    t.clock.advance(100)
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_c', text: 'c1' })).toBeNull()
    expect(t.app.history.undoCount(), 'a non-edit command breaks the chain').toBe(5)
  })
})
