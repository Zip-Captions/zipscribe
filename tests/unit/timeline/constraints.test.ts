// CC-103.3 (L1): snap + constraint tests — snap within 8 px with indicator,
// Shift bypasses snap, the 0.05 s adjacency clamp (US-2.2.1), no word-cut
// dispatch value without Alt, and Alt free retime with proportional word
// re-derivation (frozen `block-retime` behavior). Data: constraintBlocks
// (prev 1–2 | target blk_mid 3–5 with words 3.0–3.6 / 3.7–4.3 / 4.4–5.0 |
// next 6–7) at pxPerSec 100 (1 s = 100 px → 8 px = 0.08 s).
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { sampleProject } from '../editor/helpers/fixture-project'
import { constraintBlocks } from './helpers/timeline-fixture'
import type { CaptionBlock } from '@engine/model@103'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

async function rig(snapEnabled: boolean = true): Promise<{
  app: ReturnType<typeof createTestApp>['app']
  viewport: import('@ui/timeline/viewport').ViewportState
  controller: import('@ui/timeline/controller').TimelineController
}> {
  const t = createTestApp({ project: sampleProject({ blocks: constraintBlocks() }) })
  const { createViewportState } = await import(/* @vite-ignore */ '@ui/timeline/viewport')
  const { createTimelineController } = await import(/* @vite-ignore */ '@ui/timeline/controller')
  const viewport = createViewportState({ t0: 0, pxPerSec: 100 })
  const controller = createTimelineController({ app: t.app, rafs: t.rafs, viewport, widthPx: 800, snapEnabled: () => snapEnabled })
  return { app: t.app, viewport, controller }
}

function mid(app: ReturnType<typeof createTestApp>['app']): CaptionBlock {
  const project = app.project.getState().project
  const found = project?.blocks.find((b) => b.id === 'blk_mid')
  if (found === undefined) throw new Error('blk_mid missing')
  return found
}

describe('CC-103.3: adjacency clamp (US-2.2.1 — never closer than 0.05 s)', () => {
  test('CC-103.3: end trim clamps to next.start − 0.05 s, never overlapping (invariants 1/9)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'end', 500, { altKey: true })
    r.controller.moveDrag(650)
    expect(r.controller.endDrag(), 'the clamped value is accepted by the reducer (no BLOCKS_OVERLAP)').toBeNull()
    expect(mid(r.app).end, 'dispatched end = 6 − 0.05').toBe(5.95)
    const project = r.app.project.getState().project
    expect(project?.blocks.find((b) => b.id === 'blk_next')?.start, 'the neighbour is untouched').toBe(6.0)
  })

  test('CC-103.3: start trim clamps to prev.end + 0.05 s', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'start', 300, { altKey: true })
    r.controller.moveDrag(120)
    expect(r.controller.endDrag()).toBeNull()
    expect(mid(r.app).start, 'dispatched start = 2 + 0.05').toBe(2.05)
    const project = r.app.project.getState().project
    expect(project?.blocks.find((b) => b.id === 'blk_prev')?.end, 'the neighbour is untouched').toBe(2.0)
  })
})

describe('CC-103.3: word protection (US-2.2.1)', () => {
  test('CC-103.3: without Alt, a trim never lands inside a word — it lands on a word boundary', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'end', 500)
    r.controller.moveDrag(455)
    // t = 4.55 cuts through the word [4.4, 5.0] — forbidden without Alt.
    const proposed = r.controller.dragState()
    expect(proposed?.end, 'the live ghost already respects the word rule').not.toBe(4.55)
    expect(r.controller.endDrag()).toBeNull()
    const block = mid(r.app)
    const wordEdges = constraintBlocks()[1]?.words.flatMap((w) => [w.start, w.end]) ?? []
    expect(block.end, 'the drag took effect (shrank the block)').toBeLessThan(5.0)
    expect(block.end, 'never the exact mid-word value').not.toBe(4.55)
    expect(wordEdges, 'dispatched end is one of the block word boundaries (never mid-word)').toContain(block.end)
    expect(block.words.length, 'no word was dropped or split').toBe(3)
  })

  test('CC-103.3: Alt allows free retime — words re-derive proportionally', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'end', 500, { altKey: true })
    r.controller.moveDrag(455)
    expect(r.controller.endDrag()).toBeNull()
    const block = mid(r.app)
    expect(block.end, 'the mid-word value passes through unmodified').toBe(4.55)
    expect(block.words.length, 'all words survive, re-scaled').toBe(3)
    // Original span 3.0–5.0 (2 s) → 3.0–4.55 (1.55 s): ratio 0.775.
    expect(block.words[0]?.end ?? 0, 'word ends scale by 0.775 (frozen block-retime)').toBeCloseTo(3 + 0.6 * 0.775, 3)
    expect(block.words[1]?.start ?? 0, 'word starts scale too').toBeCloseTo(3 + 0.7 * 0.775, 3)
    expect(block.words[2]?.end ?? 0, 'the last word lands on the new block end').toBeCloseTo(4.55, 3)
  })
})

describe('CC-103.3: snapping (design.md § Trim handles — 8 px, Shift bypass, toggleable)', () => {
  test('CC-103.3: within 8 px of the playhead the value snaps and the indicator reports it', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    expect(r.app.dispatch('transport-seek', { time: 5.08 })).toBeNull()
    r.controller.beginDrag('blk_mid', 'end', 500, { altKey: true })
    r.controller.moveDrag(506)
    expect(r.controller.dragState()?.snappedTo, 'indicator: snapped to the playhead candidate').toBe(5.08)
    expect(r.controller.endDrag()).toBeNull()
    expect(mid(r.app).end, 'the dispatched value is the snapped playhead time').toBe(5.08)
  })

  test('CC-103.3: Shift bypasses snapping while dragging', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    expect(r.app.dispatch('transport-seek', { time: 5.08 })).toBeNull()
    r.controller.beginDrag('blk_mid', 'end', 500, { altKey: true, shiftKey: true })
    r.controller.moveDrag(506)
    expect(r.controller.dragState()?.snappedTo, 'no snap indicator while Shift is held').toBeNull()
    expect(r.controller.endDrag()).toBeNull()
    expect(mid(r.app).end, 'the exact dragged value dispatches unsnapped').toBe(5.06)
  })

  test('CC-103.3: snap to an adjacent block edge — indicator at the edge, dispatched value keeps the 0.05 s clamp (clamp dominates)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    r.controller.beginDrag('blk_mid', 'end', 500, { altKey: true })
    r.controller.moveDrag(594)
    expect(r.controller.dragState()?.snappedTo, 'the 6 px-away neighbour edge is the snap candidate').toBe(6.0)
    expect(r.controller.endDrag()).toBeNull()
    expect(mid(r.app).end, 'the adjacency clamp dominates the snap: 6 − 0.05').toBe(5.95)
  })

  test('CC-103.3: the snap toggle disables snapping', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig(false)
    expect(r.app.dispatch('transport-seek', { time: 5.08 })).toBeNull()
    r.controller.beginDrag('blk_mid', 'end', 500, { altKey: true })
    r.controller.moveDrag(506)
    expect(r.controller.dragState()?.snappedTo, 'snap disabled → no candidate wins').toBeNull()
    expect(r.controller.endDrag()).toBeNull()
    expect(mid(r.app).end, 'the raw value dispatches').toBe(5.06)
  })

  test('CC-103.3: beyond 8 px nothing snaps', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await rig()
    expect(r.app.dispatch('transport-seek', { time: 5.08 })).toBeNull()
    r.controller.beginDrag('blk_mid', 'end', 500, { altKey: true })
    r.controller.moveDrag(517)
    expect(r.controller.dragState()?.snappedTo, '9 px from the candidate → no snap').toBeNull()
    expect(r.controller.endDrag()).toBeNull()
    expect(mid(r.app).end).toBe(5.17)
  })
})
