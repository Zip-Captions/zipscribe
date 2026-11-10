// Adverse round (unit-103 adversary, L1): STATEFUL INTERLEAVINGS of the
// controller drag machine with commands/undo/zoom/scrub under the drag, plus
// NaN/Infinity at the public seams. Regenerated from the CONTRACTS:
// unit103-api-contract.d.ts § '@ui/timeline/controller' ("EXACTLY ONE
// block-retime on endDrag", "adjacency floor — dispatched edges NEVER closer
// than ADJACENCY_MIN_GAP_SEC to a neighbour edge", "ghost data only until
// endDrag", scrub "ONE clock.seek per scrubTo, none on release"), unit file
// US-2.2.1 line 19, domain.md invariants 1/3/6/9. `adverse TL.<n>: …` titles.
//
// The two tests marked KNOWN VIOLATION are deliberate failing proofs against
// d.ts § controller "adjacency floor — dispatched edges never closer than
// ADJACENCY_MIN_GAP_SEC to a neighbour edge": endDrag dispatches the ghost
// computed from STALE neighbour geometry, so an out-of-band neighbour retime
// mid-drag lands an accepted block-retime closer than 0.05 s to a neighbour.
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../../editor/helpers/editor-app'
import { sampleProject } from '../../editor/helpers/fixture-project'
import { constraintBlocks, mergePairBlocks } from '../helpers/timeline-fixture'
import type { CaptionBlock, Project } from '@engine/model@103'
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

async function rig(options: { blocks?: CaptionBlock[]; withMediaClock?: boolean; viewport?: TimelineViewport; snapEnabled?: () => boolean } = {}): Promise<Rig> {
  const t = createTestApp({
    project: sampleProject({ blocks: options.blocks ?? constraintBlocks() }),
    withMediaClock: options.withMediaClock,
  })
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

function checkInvariants(app: Rig['app']): void {
  const project = app.project.getState().project
  if (project === null) throw new Error('no project')
  const duration = project.asset.duration
  let prevEnd = Number.NEGATIVE_INFINITY
  for (const b of project.blocks) {
    expect(b.start >= 0 && b.end <= duration, `${b.id} inside media (invariant 9)`).toBe(true)
    expect(b.end > b.start, `${b.id} positive duration`).toBe(true)
    expect(b.start >= prevEnd, `${b.id} not before previous end (invariant 1)`).toBe(true)
    prevEnd = b.end
    expect(b.words.length, `${b.id} keeps ≥ 1 word (invariant 3)`).toBeGreaterThan(0)
    let wEnd = Number.NEGATIVE_INFINITY
    for (const w of b.words) {
      expect(w.start >= wEnd, `${b.id} word order (invariant 1)`).toBe(true)
      expect(w.start >= b.start - 1e-9 && w.end <= b.end + 1e-9, `${b.id} words inside bounds`).toBe(true)
      wEnd = w.end
    }
  }
}

describe('adverse TL.stateful (CC-103.2/CC-103.3): gestures interleaved with commands, undo, zoom, scrub', () => {
  test('adverse TL.18: CC-103.2 beginDrag never dispatches — split dispatched mid-drag, ghost cleared on rejection', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.app.editor.setSelection({ anchorBlockId: 'blk_mid', focusBlockId: 'blk_mid' })
    expect(r.app.dispatch('transport-seek', { time: 4.2 })).toBeNull()
    r.controller.beginDrag('blk_mid', 'end', 500, { shiftKey: true })
    r.controller.moveDrag(599) // ghost end 5.95 (ceiling next.start − 0.05)
    expect(r.controller.splitAtPlayhead(), 'split dispatched mid-drag').toBeNull()
    expect(r.controller.endDrag(), 'stale end-ghost overlaps the split-off right part → reducer doctrine rejects').toEqual({ code: 'BLOCKS_OVERLAP', token: 'blk_mid' })
    expect(r.controller.dragState(), 'ghost must not leak past endDrag').toBeNull()
    expect(blockById(r.app, 'blk_mid').end, 'store untouched by the rejected release').toBe(4.2)
    checkInvariants(r.app)
  })

  test('adverse TL.15: CC-103.3 KNOWN VIOLATION — handle-drag release after mid-drag neighbour retime dispatches a sub-0.05 s gap', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'end', 500, { shiftKey: true })
    r.controller.moveDrag(599)
    expect(r.controller.dragState()?.end, 'ghost honest at the time it was computed').toBeCloseTo(5.95, 10)
    // Out-of-band neighbour move mid-drag (e.g. Z/C trim / inspector edit on blk_next):
    expect(r.app.dispatch('block-retime', { blockId: 'blk_next', start: 5.98 })).toBeNull()
    // d.ts § controller (frozen): "adjacency floor — dispatched edges NEVER
    // closer than ADJACENCY_MIN_GAP_SEC to a neighbour edge". endDrag does NOT
    // re-derive the clamp against FINAL geometry → accepted 0.03 s gap.
    expect(r.controller.endDrag(), 'the retime is ACCEPTED (no overlap) → floor breach reaches the store').toBeNull()
    const gap = blockById(r.app, 'blk_next').start - blockById(r.app, 'blk_mid').end
    expect(gap, 'dispatched edge must never sit closer than 0.05 s to a neighbour edge').toBeGreaterThanOrEqual(0.05)
    checkInvariants(r.app)
  })

  test('adverse TL.16: CC-103.3 KNOWN VIOLATION — body-drag release after mid-drag neighbour retime dispatches a sub-0.05 s gap', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'body', 350)
    r.controller.moveDrag(205) // ghost start clamped to prev.end + 0.05 = 2.05
    expect(r.app.dispatch('block-retime', { blockId: 'blk_prev', end: 2.03 })).toBeNull()
    expect(r.controller.endDrag(), 'stale floor → accepted 0.02 s gap (d.ts adjacency clause breached)').toBeNull()
    const gap = blockById(r.app, 'blk_mid').start - blockById(r.app, 'blk_prev').end
    expect(gap, 'dispatched edge must never sit closer than 0.05 s to a neighbour edge').toBeGreaterThanOrEqual(0.05)
    checkInvariants(r.app)
  })

  test('adverse TL.17: CC-103.2 delete underneath an active drag → endDrag rejects DANGLING, no dispatch', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'body', 350)
    r.controller.moveDrag(330)
    expect(r.app.dispatch('block-delete', { blockId: 'blk_mid' })).toBeNull()
    expect(r.controller.endDrag()).toEqual({ code: 'DANGLING_BLOCK_REF', token: 'blk_mid' })
    expect(blocksOf(r.app).map((b) => b.id)).toEqual(['blk_prev', 'blk_next'])
    checkInvariants(r.app)
  })

  test('adverse TL.19: CC-103.2 two interleaved beginDrag calls — only the last session dispatches, ONE command', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    const before = r.app.history.undoCount()
    r.controller.beginDrag('blk_mid', 'start', 300, { shiftKey: true })
    r.controller.moveDrag(290) // 2.9 — superseded
    r.controller.beginDrag('blk_mid', 'end', 500, { shiftKey: true })
    r.controller.moveDrag(520) // 5.2
    expect(r.controller.endDrag()).toBeNull()
    const b = blockById(r.app, 'blk_mid')
    expect(b.start, 'first (abandoned) session must not leak into the dispatch').toBe(3.0)
    expect(b.end).toBe(5.2)
    expect(r.app.history.undoCount(), 'one user gesture = one undo step').toBe(before + 1)
    checkInvariants(r.app)
  })

  test('adverse TL.20: CC-103.2 rapid endDrag ×2 → second release dispatches nothing', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    const before = r.app.history.undoCount()
    r.controller.beginDrag('blk_mid', 'end', 500, { shiftKey: true })
    r.controller.moveDrag(520)
    expect(r.controller.endDrag()).toBeNull()
    expect(r.controller.endDrag(), 'no session left → null, never a second dispatch').toBeNull()
    expect(blockById(r.app, 'blk_mid').end).toBe(5.2)
    expect(r.app.history.undoCount()).toBe(before + 1)
  })

  test('adverse TL.21: CC-103.3 snap toggle mid-drag — later moves honour the flipped toggle', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const snap = { current: true }
    const r = await rig({ snapEnabled: () => snap.current })
    expect(r.app.dispatch('transport-seek', { time: 5.05 })).toBeNull()
    r.controller.beginDrag('blk_mid', 'end', 500)
    r.controller.moveDrag(505) // 5.05 → 0 px from the playhead candidate
    expect(r.controller.dragState()?.snappedTo, 'snapped to the playhead').toBe(5.05)
    snap.current = false // toolbar toggle mid-drag
    r.controller.moveDrag(507) // 5.07 would snap to 5.05 (2 px) if snap were still on
    const d = r.controller.dragState()
    expect(d?.snappedTo, 'toggle flipped mid-drag → no snap').toBeNull()
    expect(d?.end).toBe(5.07)
    expect(r.controller.endDrag()).toBeNull()
    expect(blockById(r.app, 'blk_mid').end).toBe(5.07)
  })

  test('adverse TL.22: CC-103.2 wheel-zoom during a playhead scrub — EXACTLY one clock.seek per scrubTo, none on release', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig({ withMediaClock: true })
    const clock = r.mediaClock
    if (clock === null) throw new Error('media clock required')
    const base = clock.seekCalls
    r.controller.beginPlayheadDrag(0)
    r.controller.dragPlayheadTo(300)
    r.controller.dragPlayheadTo(310)
    r.controller.zoomAtPixel(400, 1.1) // zoom must not issue any seek
    r.controller.dragPlayheadTo(320)
    r.controller.endPlayheadDrag()
    r.controller.endPlayheadDrag() // idempotent
    expect(clock.seekCalls, '3 scrubTo → 3 seeks; zoom + releases add none (d.ts § controller)').toBe(base + 3)
  })

  test('adverse TL.23: CC-103.2 marquee while scrubbing — selection and scrub sessions are independent', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig({ withMediaClock: true })
    const clock = r.mediaClock
    if (clock === null) throw new Error('media clock required')
    const base = clock.seekCalls
    r.controller.beginPlayheadDrag(0)
    r.controller.dragPlayheadTo(300)
    r.controller.marqueeSelect(0, 700) // [0,7] covers all three blocks
    r.controller.dragPlayheadTo(350)
    r.controller.endPlayheadDrag()
    expect(clock.seekCalls).toBe(base + 2)
    expect(r.app.editor.getState().selection).toEqual({ anchorBlockId: 'blk_prev', focusBlockId: 'blk_next' })
  })

  test('adverse TL.24: CC-103.2 merge dispatched mid-drag then undo — release retime stays valid, one step per gesture', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig({ blocks: mergePairBlocks() })
    r.app.editor.setSelection({ anchorBlockId: 'blk_m1', focusBlockId: 'blk_m2' })
    r.controller.beginDrag('blk_m1', 'end', 200, { shiftKey: true })
    r.controller.moveDrag(205) // ghost 2.05 (ceiling 2.1 − 0.05)
    expect(r.controller.mergeSelected()).toBeNull()
    expect(blockById(r.app, 'blk_m1').end, 'merged union').toBe(3.0)
    expect(r.controller.endDrag()).toBeNull() // stale ghost → shrink merged block
    const merged = blockById(r.app, 'blk_m1')
    expect(merged.end).toBe(2.05)
    expect(merged.words.length, 'merged words ride the proportional retime').toBe(4)
    checkInvariants(r.app)
    r.app.history.undo() // the release retime
    r.app.history.undo() // the merge
    expect(blocksOf(r.app).map((b) => b.id)).toEqual(['blk_m1', 'blk_m2'])
  })

  test('adverse TL.25: CC-103.2 undo mid-drag — the release still dispatches exactly one valid retime', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    expect(r.app.dispatch('block-retime', { blockId: 'blk_mid', end: 5.5 })).toBeNull()
    r.controller.beginDrag('blk_mid', 'end', 550, { shiftKey: true })
    r.controller.moveDrag(560) // ghost 5.6
    r.app.history.undo() // block back to [3,5] underneath the drag
    expect(blockById(r.app, 'blk_mid').end).toBe(5.0)
    const before = r.app.history.undoCount()
    expect(r.controller.endDrag()).toBeNull()
    expect(blockById(r.app, 'blk_mid').end).toBe(5.6)
    expect(r.app.history.undoCount(), 'the release is one new step').toBe(before + 1)
    checkInvariants(r.app)
  })

  test('adverse TL.26: CC-103.3 Alt free retime at the duration boundary — end == duration is inside media, never OUT_OF_MEDIA', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_next', 'end', 700, { altKey: true })
    r.controller.moveDrag(13_000) // 130 s ≫ 121.44 s asset
    expect(r.controller.dragState()?.end, 'ghost clamped exactly to the duration').toBe(121.44)
    expect(r.controller.endDrag(), 'reducer allows newEnd === duration').toBeNull()
    expect(blockById(r.app, 'blk_next').end).toBe(121.44)
    checkInvariants(r.app)
  })

  test('adverse TL.27: CC-103.2 NaN/Infinity at the public seams never persist into the store or crash a dispatch', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    const midBefore = JSON.stringify(blockById(r.app, 'blk_mid'))
    // Corrupted viewport (adversarial set) — dispatches stay command-rejected, never NaN in the store.
    r.viewport.set({ t0: Number.NaN, pxPerSec: Number.NaN })
    r.controller.clickBlock(400) // must not throw, must not select
    r.controller.marqueeSelect(Number.NaN, Number.NaN)
    expect(r.app.editor.getState().selection.anchorBlockId, 'selection stays null (marquee-empty doctrine)').toBeNull()
    expect(r.controller.rulerClick(Number.NaN), 'transport-seek rejects the NaN payload').toEqual({ code: 'INVALID_PAYLOAD', token: 'time' })
    expect(r.app.editor.getState().playhead, 'playhead never becomes NaN').toBe(0)
    r.viewport.set({ t0: 0, pxPerSec: 100 })
    // NaN pixel under the drag → ghost NaN → block-retime isFiniteNumber rejects.
    r.controller.beginDrag('blk_mid', 'body', Number.NaN)
    r.controller.moveDrag(Number.NaN)
    expect(r.controller.endDrag(), 'block-retime rejects NaN edges (command-rejection doctrine)').toEqual({ code: 'INVALID_PAYLOAD', token: 'blk_mid' })
    expect(JSON.stringify(blockById(r.app, 'blk_mid')), 'block byte-identical through the NaN barrage').toBe(midBefore)
    // NaN zoom factor poisons the (non-store) viewport — zoomFit recovers it.
    r.controller.zoomAtPixel(Number.NaN, Number.NaN)
    r.controller.zoomIn()
    r.controller.panByPixels(Number.POSITIVE_INFINITY)
    r.controller.zoomFit()
    const v = r.viewport.get()
    expect(Number.isFinite(v.t0) && Number.isFinite(v.pxPerSec), 'zoomFit re-establishes a finite viewport').toBe(true)
    checkInvariants(r.app)
  })

  test('adverse TL.28: CC-103.2 scrub lifecycle guards — move before begin is a no-op, double end is idempotent', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig({ withMediaClock: true })
    const clock = r.mediaClock
    if (clock === null) throw new Error('media clock required')
    const base = clock.seekCalls
    r.controller.dragPlayheadTo(100)
    expect(clock.seekCalls, 'no session → no seek').toBe(base)
    r.controller.beginPlayheadDrag(0)
    r.controller.dragPlayheadTo(100)
    r.controller.endPlayheadDrag()
    r.controller.endPlayheadDrag()
    r.controller.dragPlayheadTo(200)
    expect(clock.seekCalls).toBe(base + 1)
  })

  test('adverse TL.29: CC-103.5 empty-blocks project — focus/marquee/split/merge/trim all reject or no-op, never crash', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig({ blocks: [] })
    r.controller.focusNext()
    r.controller.focusPrev()
    expect(r.controller.focusedBlockId()).toBeNull()
    r.controller.selectFocused()
    expect(r.app.editor.getState().selection.anchorBlockId).toBeNull()
    expect(r.controller.splitAtPlayhead()).toEqual({ code: 'INVALID_PAYLOAD', token: 'selection' })
    expect(r.controller.mergeSelected()).toEqual({ code: 'INVALID_PAYLOAD', token: 'selection' })
    expect(r.controller.trimStartToPlayhead()).toEqual({ code: 'INVALID_PAYLOAD', token: 'selection' })
    expect(r.controller.trimEndToPlayhead()).toEqual({ code: 'INVALID_PAYLOAD', token: 'selection' })
    r.controller.marqueeSelect(0, 800)
    r.controller.clickBlock(100)
    expect(r.app.editor.getState().selection.anchorBlockId).toBeNull()
  })

  test('adverse TL.30: CC-103.2 selection referencing deleted blocks — every seam rejects DANGLING, no crash', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.app.editor.setSelection({ anchorBlockId: 'blk_ghost', focusBlockId: 'blk_ghost' })
    expect(r.controller.mergeSelected()).toEqual({ code: 'DANGLING_BLOCK_REF', token: 'blk_ghost' })
    expect(r.controller.splitAtPlayhead()).toEqual({ code: 'DANGLING_BLOCK_REF', token: 'blk_ghost' })
    expect(r.controller.trimStartToPlayhead()).toEqual({ code: 'DANGLING_BLOCK_REF', token: 'blk_ghost' })
    checkInvariants(r.app)
  })

  test('adverse TL.31: CC-103.3 body drag clamps to EXACTLY prev.end + 0.05 and next.start − 0.05', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'body', 350)
    r.controller.moveDrag(100) // hard left
    expect(r.controller.dragState()?.start).toBeCloseTo(2.05, 10)
    expect(r.controller.endDrag()).toBeNull()
    expect(blockById(r.app, 'blk_mid').start - blockById(r.app, 'blk_prev').end).toBeCloseTo(0.05, 10)
    r.controller.beginDrag('blk_mid', 'body', 305)
    r.controller.moveDrag(100_000) // hard right
    expect(r.controller.dragState()?.end).toBeCloseTo(5.95, 10)
    expect(r.controller.endDrag()).toBeNull()
    expect(blockById(r.app, 'blk_next').start - blockById(r.app, 'blk_mid').end).toBeCloseTo(0.05, 10)
    checkInvariants(r.app)
  })
})
