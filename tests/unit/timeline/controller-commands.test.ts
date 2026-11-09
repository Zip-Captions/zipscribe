// CC-103.2 (L1): drag/trim/split/merge dispatch the FROZEN unit-102 commands
// through the controller seam, with real store assertions and EXACTLY ONE
// undo step per user gesture (zundo partializes { project }; the editor slice
// is not undoable — asserted here too). Retime semantics are the frozen
// `block-retime` contract (words scale proportionally); the US-2.2.2
// nearer-midpoint straddler rule is pinned on the split path (frozen in
// unit103-api-contract.d.ts). RED until `src/ui/timeline/controller.ts` ships.
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { sampleProject, block, word } from '../editor/helpers/fixture-project'
import { constraintBlocks, mergePairBlocks, timelineBlocks } from './helpers/timeline-fixture'
import type { Project, Seconds } from '@engine/model@103'
import type { TimelineController } from '@ui/timeline/controller'
import type { TimelineViewport } from '@ui/timeline/viewport'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

interface Rig {
  app: ReturnType<typeof createTestApp>['app']
  rafs: ReturnType<typeof createTestApp>['rafs']
  mediaClock: ReturnType<typeof createTestApp>['mediaClock']
  viewport: import('@ui/timeline/viewport').ViewportState
  controller: TimelineController
}

async function rig(options: { project?: Project; withMediaClock?: boolean; viewport?: TimelineViewport; snapEnabled?: () => boolean } = {}): Promise<Rig> {
  const t = createTestApp({ project: options.project ?? sampleProject({ blocks: constraintBlocks() }), withMediaClock: options.withMediaClock })
  const { createViewportState } = await import(/* @vite-ignore */ '@ui/timeline/viewport')
  const { createTimelineController } = await import(/* @vite-ignore */ '@ui/timeline/controller')
  const viewport = createViewportState(options.viewport ?? { t0: 0, pxPerSec: 100 })
  const controller = createTimelineController({ app: t.app, rafs: t.rafs, viewport, widthPx: 800, snapEnabled: options.snapEnabled })
  return { app: t.app, rafs: t.rafs, mediaClock: t.mediaClock, viewport, controller }
}

function blocksOf(app: Rig['app']): Project['blocks'] {
  const project = app.project.getState().project
  if (project === null) throw new Error('no project')
  return project.blocks
}

function blockById(app: Rig['app'], id: string): Project['blocks'][number] {
  const found = blocksOf(app).find((b) => b.id === id)
  if (found === undefined) throw new Error(`missing block ${id}`)
  return found
}

describe('CC-103.2: drag gestures dispatch the frozen commands with one undo step', () => {
  test('CC-103.2: handle drag dispatches block-retime on release, one-undo-step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    const before = r.app.history.undoCount()
    r.controller.beginDrag('blk_mid', 'start', 300, { altKey: true })
    r.controller.moveDrag(320)
    expect(blockById(r.app, 'blk_mid').start, 'no command during the drag — live ghost only').toBe(3.0)
    expect(r.controller.dragState(), 'the ghost reports the proposed span').not.toBeNull()
    expect(r.app.history.undoCount(), 'no history step before release').toBe(before)
    expect(r.controller.endDrag(), 'the release dispatches and is accepted').toBeNull()
    expect(blockById(r.app, 'blk_mid').start, 'start landed at the proposed time').toBe(3.2)
    expect(r.app.history.undoCount(), 'exactly ONE undo step for the gesture').toBe(before + 1)
    r.app.history.undo()
    expect(blockById(r.app, 'blk_mid').start, 'the single undo restores the original bounds').toBe(3.0)
  })

  test('CC-103.2: body drag moves ONLY that block (with its words), clamped between neighbours', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    const before = r.app.history.undoCount()
    const nextBefore = { ...blockById(r.app, 'blk_next') }
    r.controller.beginDrag('blk_mid', 'body', 400)
    r.controller.moveDrag(600)
    expect(r.controller.endDrag(), 'the clamped retime is accepted by the reducer').toBeNull()
    const moved = blockById(r.app, 'blk_mid')
    expect(moved.start, 'moved right by the clamped delta').toBeGreaterThan(3.0)
    expect(moved.end, 'never pushed INTO the next block (invariants 1/9 — neighbours are never shifted)').toBeLessThanOrEqual(6.0)
    expect(moved.end - moved.start, 'duration preserved').toBeCloseTo(2.0, 9)
    expect({ ...blockById(r.app, 'blk_next') }, 'the next block is untouched').toEqual(nextBefore)
    expect(moved.words[0]?.start ?? 0, 'words moved with the block (relative offsets preserved)').toBeCloseTo(moved.start + 0.0, 3)
    expect(r.app.history.undoCount(), 'one undo step for the body drag').toBe(before + 1)
  })

  test('CC-103.2: split at the playhead is one undo step with contiguous parts (US-2.2.2)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const target = block('blk_s', 0, 10, 'SPK_1', [word('aa', 0, 1), word('bb', 1, 9), word('cc', 9, 10)])
    const r = await rig({ project: sampleProject({ blocks: [target] }) })
    r.app.editor.setSelection({ anchorBlockId: 'blk_s', focusBlockId: 'blk_s' })
    expect(r.app.dispatch('transport-seek', { time: 8 }), 'seek to the split point').toBeNull()
    const before = r.app.history.undoCount()
    expect(r.controller.splitAtPlayhead(), 'split accepted').toBeNull()
    const parts = blocksOf(r.app)
    expect(parts.length, 'two blocks after the split').toBe(2)
    const first = parts[0]
    const second = parts[1]
    if (first === undefined || second === undefined) throw new Error('split shape')
    expect(first.start, 'first keeps the span head').toBe(0)
    expect(first.end, 'first ends AT the playhead').toBe(8)
    expect(second.start, 'parts are contiguous (US-2.2.2)').toBe(8)
    expect(second.end, 'second keeps the span tail').toBe(10)
    expect(r.app.history.undoCount(), 'the split is ONE undo step').toBe(before + 1)
    r.app.history.undo()
    expect(blocksOf(r.app).length, 'the single undo restores the original block').toBe(1)
  })

  test('CC-103.2: US-2.2.2 — a straddling word goes whole to the NEARER-MIDPOINT part', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    // Words aa[0,1] bb[1,9] cc[9,10], split at 8: part mids 4 and 9; the
    // straddler bb (mid 5) is nearer 4 → WHOLE into the FIRST part, clamped
    // end ≤ 8. The unit-102 frozen straddler cases land on the same side, so
    // this is the rule's diverging corner (frozen in the d.ts).
    const target = block('blk_s', 0, 10, 'SPK_1', [word('aa', 0, 1), word('bb', 1, 9), word('cc', 9, 10)])
    const r = await rig({ project: sampleProject({ blocks: [target] }) })
    r.app.editor.setSelection({ anchorBlockId: 'blk_s', focusBlockId: 'blk_s' })
    expect(r.app.dispatch('transport-seek', { time: 8 })).toBeNull()
    expect(r.controller.splitAtPlayhead()).toBeNull()
    const parts = blocksOf(r.app)
    const first = parts[0]
    const second = parts[1]
    if (first === undefined || second === undefined) throw new Error('split shape')
    expect(first.words.map((w) => w.text), 'bb joined the nearer-midpoint first part').toEqual(['aa', 'bb'])
    expect(second.words.map((w) => w.text), 'cc alone in the second part').toEqual(['cc'])
    expect(first.words[1]?.end, 'the whole word fits its part (never split, invariant 1)').toBeLessThanOrEqual(first.end)
    expect(second.words[0]?.start, 'second part word starts at or after the part start').toBeGreaterThanOrEqual(second.start)
  })

  test('CC-103.2: split outside the focused/selected block rejects with no history step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.app.editor.setSelection({ anchorBlockId: 'blk_mid', focusBlockId: 'blk_mid' })
    expect(r.app.dispatch('transport-seek', { time: 50 }), 'playhead in empty media').toBeNull()
    const before = r.app.history.undoCount()
    const blocksBefore = structuredClone(blocksOf(r.app))
    expect(r.controller.splitAtPlayhead(), 'no block contains the playhead → reject').not.toBeNull()
    expect(blocksOf(r.app), 'reject leaves state byte-identical').toEqual(blocksBefore)
    expect(r.app.history.undoCount(), 'reject creates no history step').toBe(before)
  })

  test('CC-103.2: merge of exactly two selected adjacent blocks — text space-joined, words concatenated (US-2.2.3)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig({ project: sampleProject({ blocks: mergePairBlocks() }) })
    r.app.editor.setSelection({ anchorBlockId: 'blk_m1', focusBlockId: 'blk_m2' })
    const before = r.app.history.undoCount()
    expect(r.controller.mergeSelected(), 'merge accepted').toBeNull()
    const merged = blocksOf(r.app)
    expect(merged.length, 'one block after merge').toBe(1)
    const m = merged[0]
    if (m === undefined) throw new Error('merge shape')
    expect(m.text, 'text joined with a SINGLE space (CapCut-style)').toBe('alpha beta gamma delta')
    expect(m.words.map((w) => w.text), 'words concatenated in order').toEqual(['alpha', 'beta', 'gamma', 'delta'])
    expect(m.start, 'span is the union').toBe(1.0)
    expect(m.end, 'span is the union').toBe(3.0)
    expect(r.app.history.undoCount(), 'single undo step for the merge').toBe(before + 1)
    r.app.history.undo()
    expect(blocksOf(r.app).length, 'the single undo restores both blocks').toBe(2)
  })

  test('CC-103.2: merge with a single-block selection rejects without a history step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig({ project: sampleProject({ blocks: mergePairBlocks() }) })
    r.app.editor.setSelection({ anchorBlockId: 'blk_m1', focusBlockId: 'blk_m1' })
    const before = r.app.history.undoCount()
    expect(r.controller.mergeSelected(), 'one block selected → reject').not.toBeNull()
    expect(r.app.history.undoCount(), 'no history step').toBe(before)
  })

  test('CC-103.2: selection and playhead (editor slice) are NOT undoable — ZUNDO partializes { project }', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'start', 300, { altKey: true })
    r.controller.moveDrag(325)
    expect(r.controller.endDrag()).toBeNull()
    const steps = r.app.history.undoCount()
    r.app.editor.setSelection({ anchorBlockId: 'blk_mid', focusBlockId: 'blk_prev' })
    r.app.editor.setPlayhead(42.5)
    expect(r.app.history.undoCount(), 'editor-slice mutations never create history steps').toBe(steps)
    r.app.history.undo()
    expect(r.app.editor.getState().playhead, 'undo never moves the playhead').toBe(42.5)
    expect(r.app.editor.getState().selection.focusBlockId, 'undo never moves the selection').toBe('blk_prev')
    expect(blockById(r.app, 'blk_mid').start, 'undo restored only the project slice').toBe(3.0)
  })

  test('CC-103.2: click selects, shift-click extends, marquee ranges the selection', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig({ project: sampleProject({ blocks: timelineBlocks() }) })
    r.controller.clickBlock(150)
    expect(r.app.editor.getState().selection, 'click selects the single block under x').toEqual({ anchorBlockId: 'blk_v1', focusBlockId: 'blk_v1' })
    r.controller.shiftClickBlock(650)
    const extended = r.app.editor.getState().selection
    expect(extended.anchorBlockId, 'the anchor stays').toBe('blk_v1')
    expect(extended.focusBlockId, 'shift-click moves the focus block (range extend)').toBe('blk_v3')
    r.controller.marqueeSelect(100, 550)
    expect(r.app.editor.getState().selection, 'marquee = range over intersecting blocks (anchor first, focus last)').toEqual({ anchorBlockId: 'blk_v1', focusBlockId: 'blk_v2' })
  })

  test('CC-103.2: ruler click seeks through transport-seek (FR-103.6)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    expect(r.controller.rulerClick(250), 'ruler click dispatches the seek').toBeNull()
    expect(r.app.editor.getState().playhead, 'playhead = xToTime(250) @ t0=0 p=100').toBe(2.5)
    r.viewport.set({ t0: 1, pxPerSec: 100 })
    expect(r.controller.rulerClick(250)).toBeNull()
    expect(r.app.editor.getState().playhead, 'the seek respects the scrolled viewport').toBe(3.5)
  })

  test('CC-103.2: playhead drag scrubs through the SyncArbitrator — one seek per scrubTo, none on release', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig({ withMediaClock: true })
    const clock = r.mediaClock
    if (clock === null) throw new Error('media clock missing')
    expect(r.app.dispatch('transport-seek', { time: 3 })).toBeNull()
    const seeksBefore = clock.seekCalls
    r.controller.beginPlayheadDrag(300)
    r.controller.dragPlayheadTo(330)
    r.controller.dragPlayheadTo(350)
    expect(clock.seekCalls - seeksBefore, 'two scrub positions → exactly two clock seeks').toBe(2)
    r.controller.endPlayheadDrag()
    expect(clock.seekCalls - seeksBefore, 'the release adds NO further seek (US-2.1.5 doctrine)').toBe(2)
    expect(r.app.editor.getState().playhead, 'the playhead followed the scrub').toBeCloseTo(3.5, 3)
  })
})

describe('CC-103.2 + SECURITY-03: gestures over the canary project never leak content', () => {
  test('CC-103.2: trim on the canary project stays content-free in console/errors', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spy = createRedactionSpy()
    try {
      const r = await rig({ project: sampleProject() })
      r.controller.beginDrag('blk_a', 'start', 50, { altKey: true })
      r.controller.moveDrag(60)
      expect(r.controller.endDrag()).toBeNull()
      const start: Seconds | undefined = blockById(r.app, 'blk_a').start
      expect(start).toBe(0.6)
    } finally {
      spy.restore()
    }
    expect(spy.settle().clean, 'SECURITY-03: no canary content reached console during the gesture').toBe(true)
  })
})
