// Unit-103 FR-103.3/FR-103.6 + US-2.2.1/2/3 — the timeline interaction
// controller. Shape frozen by tests/unit/timeline/unit103-api-contract.d.ts
// § '@ui/timeline/controller'. All state mutation flows through the FROZEN
// unit-102 commands via `app.dispatch` (never a store write); the controller
// can NEVER produce overlapping/empty blocks or move media — the reducers own
// those guards (domain invariants 1/3/9) and the controller pre-clamps to the
// US-2.2.1 adjacency floor so accepted gestures stay honest.
//
// Drag machine: beginDrag/moveDrag carry GHOST DATA ONLY (snap + clamp +
// word-protection applied to the proposed span, `snappedTo` reports the snap
// candidate — the adjacency clamp DOMINATES the snap, orch adjudication 3:
// indicator renders the candidate edge, the dispatched value keeps the
// 0.05 s floor); endDrag dispatches EXACTLY ONE `block-retime` (or nothing on
// unchanged/rejected). One user gesture = one undo step (the editor slice is
// not undoable — zundo partializes { project }, history.ts).
//
// Constraints (CC-103.3): snap to adjacent edges/playhead within SNAP_PX,
// Shift bypasses per-drag, `snapEnabled()` gates the toolbar toggle; a body
// drag moves ONLY that block (words ride along, the frozen reducer scales
// them) clamped between neighbours — neighbours are never pushed; WITHOUT
// Alt a trim never cuts through a word (lands on a word boundary, block
// keeps ≥ 1 word); WITH Alt free retime (frozen reducer re-derives word times
// proportionally).
//
// No React, no DOM globals: pixels come from the viewport math, the store
// goes through the injected EditorApp seams.

import type { CaptionBlock, Seconds } from '../../engine/model'
import type { BlockRetimePayload, CommandReject } from '../../state/commands'
import type { EditorApp } from '../../state/history'
import type { RafDriver } from '../../state/services/playback/arbitrator'
import { formatTimecode } from '../format'
import { blocksInPixelRange, createBlockIndex } from './hittest'
import type { BlockIndex } from './hittest'
import { ADJACENCY_MIN_GAP_SEC, ZOOM_MAX_PX_PER_SEC, ZOOM_MIN_PX_PER_SEC, anchorZoom, fitViewport, panBy, snapTime, xToTime, zoomKey } from './viewport'
import type { ViewportState } from './viewport'

/** Focused-block announcement payload (FR-103.7 live region). */
export interface FocusedBlockSummary {
  blockId: string
  speakerLabel: string
  timecode: string
  text: string
}

export interface DragState {
  blockId: string
  edge: 'body' | 'start' | 'end'
  /** Proposed (snap + clamp applied) span during the drag — the live ghost, NO command dispatched until endDrag. */
  start: Seconds
  end: Seconds
  snappedTo: Seconds | null
}

export interface TimelineController {
  viewport: ViewportState

  /** Click selects the block at x (single); no block → no selection change. */
  clickBlock(x: number): void
  /** Shift+click extends the selection range to the block at x (anchor stays). */
  shiftClickBlock(x: number): void
  /** Drag on empty lane → marquee; selection = range over the blocks intersecting the span (anchor first, focus last). */
  marqueeSelect(xA: number, xB: number): void

  /** Ruler click seeks (FR-103.6): dispatches `transport-seek` with xToTime(x). */
  rulerClick(x: number): CommandReject | null

  /** Playhead drag = scrub through the SyncArbitrator (FR-103.6/US-2.1.5): ONE clock.seek per scrubTo, none on release. */
  beginPlayheadDrag(x: number): void
  dragPlayheadTo(x: number): void
  endPlayheadDrag(): void

  beginDrag(blockId: string, edge: 'body' | 'start' | 'end', x: number, mods?: { altKey?: boolean; shiftKey?: boolean }): void
  moveDrag(x: number): void
  endDrag(): CommandReject | null
  dragState(): DragState | null

  /** S (US-2.2.2): split the focused (or selected, focused-last) block containing the playhead → ONE `block-split`. */
  splitAtPlayhead(): CommandReject | null
  /** ⌘⇧M (US-2.2.3): merge the selection when it covers EXACTLY two adjacent blocks → ONE `block-merge`. */
  mergeSelected(): CommandReject | null

  /** Z+←/→ / C+←/→ (design.md, Clipchamp): trim the focused block start/end to the playhead → `block-retime`. */
  trimStartToPlayhead(): CommandReject | null
  trimEndToPlayhead(): CommandReject | null

  /** FR-103.7 keyboard focus model: arrows move block focus (no wraparound past the ends), Enter selects the focused block. */
  focusNext(): void
  focusPrev(): void
  selectFocused(): void
  focusedBlockId(): string | null

  /** ⌘= / ⌘− / ⌘0 (viewport.zoomKey/fitViewport) and ⌘+wheel zoom (anchorZoom at xToTime). */
  zoomIn(): void
  zoomOut(): void
  zoomFit(): void
  zoomAtPixel(x: number, factor: number): void
  /** Wheel pan (viewport.panBy; clamped to the project range). */
  panByPixels(dxPx: number): void

  dispose(): void
}

interface DragSession {
  blockId: string
  edge: 'body' | 'start' | 'end'
  alt: boolean
  shiftBypass: boolean
  grabT: Seconds
  start: Seconds
  end: Seconds
  snappedTo: Seconds | null
  moved: boolean
}

const NO_BLOCKS: readonly CaptionBlock[] = Object.freeze([])

export function createTimelineController(deps: {
  app: EditorApp
  rafs: RafDriver
  viewport: ViewportState
  widthPx: number
  /** Snap toggle state source (toolbar toggle, design.md "toggleable"); default = always on. Shift-bypass is per-drag, not here. */
  snapEnabled?: () => boolean
  /** Live-region sink (FR-103.7) — called when block focus changes. */
  onAnnounce?: (summary: FocusedBlockSummary) => void
}): TimelineController {
  const { app, viewport, widthPx } = deps
  const snapEnabled = deps.snapEnabled ?? (() => true)
  const onAnnounce = deps.onAnnounce

  // Index cache keyed on the blocks REFERENCE (immer keeps it for untouched
  // subtrees, so a rebuild costs O(n log n) only when the project changed).
  let blocksRef: readonly CaptionBlock[] | null = null
  let cachedIndex: BlockIndex | null = null
  let focusId: string | null = null
  let drag: DragSession | null = null
  let scrubbing = false

  function currentBlocks(): readonly CaptionBlock[] {
    return app.project.getState().project?.blocks ?? NO_BLOCKS
  }
  function index(): BlockIndex {
    const blocks = currentBlocks()
    if (cachedIndex === null || blocksRef !== blocks) {
      blocksRef = blocks
      cachedIndex = createBlockIndex(blocks)
    }
    return cachedIndex
  }
  function duration(): Seconds {
    return app.project.getState().project?.asset.duration ?? 0
  }
  function findBlock(id: string): CaptionBlock | null {
    return (
      index()
        .all()
        .find((block) => block.id === id) ?? null
    )
  }
  function neighbours(id: string): { prev: CaptionBlock | null; next: CaptionBlock | null } {
    const all = index().all()
    const i = all.findIndex((block) => block.id === id)
    return { prev: i > 0 ? (all[i - 1] ?? null) : null, next: i >= 0 && i < all.length - 1 ? (all[i + 1] ?? null) : null }
  }
  function selectionTargetId(): string | null {
    const selection = app.editor.getState().selection
    return focusId ?? selection.focusBlockId ?? selection.anchorBlockId
  }

  // ── selection (FR-103.3 / design.md § Block selection model) ─────────────

  function clickBlock(x: number): void {
    const block = index().hit(xToTime(x, viewport.get()))
    if (block === null) return // no block → no selection change
    app.editor.setSelection({ anchorBlockId: block.id, focusBlockId: block.id })
  }

  function shiftClickBlock(x: number): void {
    const block = index().hit(xToTime(x, viewport.get()))
    if (block === null) return
    const selection = app.editor.getState().selection
    app.editor.setSelection({ anchorBlockId: selection.anchorBlockId ?? block.id, focusBlockId: block.id })
  }

  function marqueeSelect(xA: number, xB: number): void {
    const hits = blocksInPixelRange(index(), xA, xB, viewport.get())
    const first = hits[0]
    const last = hits[hits.length - 1]
    if (first === undefined || last === undefined) {
      app.editor.setSelection({ anchorBlockId: null, focusBlockId: null })
      return
    }
    app.editor.setSelection({ anchorBlockId: first.id, focusBlockId: last.id }) // anchor first, focus last
  }

  // ── ruler + playhead (FR-103.6) ───────────────────────────────────────────

  function rulerClick(x: number): CommandReject | null {
    return app.dispatch('transport-seek', { time: xToTime(x, viewport.get()) })
  }

  function beginPlayheadDrag(_x: number): void {
    scrubbing = true
    app.arbitrator?.beginScrub()
  }
  function dragPlayheadTo(x: number): void {
    if (!scrubbing) return
    app.arbitrator?.scrubTo(xToTime(x, viewport.get())) // ONE clock.seek per scrubTo (US-2.1.5 doctrine)
  }
  function endPlayheadDrag(): void {
    if (!scrubbing) return
    scrubbing = false
    app.arbitrator?.endScrub() // the release adds NO further seek
  }

  // ── drag machine (US-2.2.1, FR-103.3) — ghost data only until endDrag ─────

  function snapCandidates(block: CaptionBlock): Seconds[] {
    const candidates: Seconds[] = [app.editor.getState().playhead]
    const { prev, next } = neighbours(block.id)
    if (prev !== null) candidates.push(prev.start, prev.end)
    if (next !== null) candidates.push(next.start, next.end)
    return candidates
  }

  /** Without Alt a start trim never lands inside a word — it lands on the nearer word boundary, keeping ≥ 1 word. */
  function protectStart(block: CaptionBlock, s: Seconds): Seconds {
    const words = block.words
    const straddled = words.find((w) => w.start < s && s < w.end)
    if (straddled === undefined) return s
    const lastStart = words[words.length - 1]?.start ?? block.start
    let landed = s - straddled.start <= straddled.end - s ? straddled.start : straddled.end
    if (landed > lastStart) landed = lastStart
    if (landed < block.start) landed = block.start
    return landed
  }

  function protectEnd(block: CaptionBlock, e: Seconds): Seconds {
    const words = block.words
    const straddled = words.find((w) => w.start < e && e < w.end)
    if (straddled === undefined) return e
    const firstEnd = words[0]?.end ?? block.end
    let landed = e - straddled.start <= straddled.end - e ? straddled.start : straddled.end
    if (landed < firstEnd) landed = firstEnd
    if (landed > block.end) landed = block.end
    return landed
  }

  function beginDrag(blockId: string, edge: 'body' | 'start' | 'end', x: number, mods?: { altKey?: boolean; shiftKey?: boolean }): void {
    const block = findBlock(blockId)
    if (block === null) return
    // The proposal starts UNCHANGED (a press without movement must never
    // dispatch, even when a snap candidate sits within SNAP_PX of the press).
    drag = { blockId, edge, alt: mods?.altKey === true, shiftBypass: mods?.shiftKey === true, grabT: xToTime(x, viewport.get()), start: block.start, end: block.end, snappedTo: null, moved: false }
  }

  function moveDrag(x: number): void {
    if (drag === null) return
    const block = findBlock(drag.blockId)
    if (block === null) return
    const v = viewport.get()
    const t = xToTime(x, v)
    const session = drag
    session.moved = true
    session.snappedTo = null

    if (session.edge === 'body') {
      // Moves ONLY this block (words ride along), clamped between neighbours
      // with the 0.05 s floor — neighbours are never pushed (invariants 1/9).
      const span = block.end - block.start
      const { prev, next } = neighbours(block.id)
      const floor = prev !== null ? prev.end + ADJACENCY_MIN_GAP_SEC : 0
      const ceiling = (next !== null ? next.start - ADJACENCY_MIN_GAP_SEC : duration()) - span
      const s = Math.min(Math.max(block.start + (t - session.grabT), floor), Math.max(ceiling, floor))
      session.start = s
      session.end = s + span
      return
    }

    let value = t
    if (snapEnabled() && !session.shiftBypass) {
      const snapped = snapTime(value, snapCandidates(block), v)
      if (snapped !== null) {
        session.snappedTo = snapped
        value = snapped
      }
    }
    if (session.edge === 'start') {
      if (!session.alt && value > block.start) value = protectStart(block, value)
      const { prev } = neighbours(block.id)
      const floor = prev !== null ? prev.end + ADJACENCY_MIN_GAP_SEC : 0
      session.start = Math.min(Math.max(value, floor), block.end)
    } else {
      if (!session.alt && value < block.end) value = protectEnd(block, value)
      const { next } = neighbours(block.id)
      const ceiling = next !== null ? next.start - ADJACENCY_MIN_GAP_SEC : duration()
      session.end = Math.max(Math.min(value, ceiling), block.start)
    }
  }

  function endDrag(): CommandReject | null {
    const session = drag
    drag = null
    if (session === null || !session.moved) return null
    const block = findBlock(session.blockId)
    if (block === null) return { code: 'DANGLING_BLOCK_REF', token: session.blockId }
    if (session.start === block.start && session.end === block.end) return null // unchanged → nothing dispatched
    const payload: BlockRetimePayload = { blockId: session.blockId }
    if (session.start !== block.start) payload.start = session.start
    if (session.end !== block.end) payload.end = session.end
    return app.dispatch('block-retime', payload) // EXACTLY ONE command per gesture
  }

  function dragState(): DragState | null {
    if (drag === null) return null
    return { blockId: drag.blockId, edge: drag.edge, start: drag.start, end: drag.end, snappedTo: drag.snappedTo }
  }

  // ── block commands (US-2.2.2/US-2.2.3, CC-103.2) ──────────────────────────

  function splitAtPlayhead(): CommandReject | null {
    const targetId = selectionTargetId()
    if (targetId === null) return { code: 'INVALID_PAYLOAD', token: 'selection' }
    const block = findBlock(targetId)
    if (block === null) return { code: 'DANGLING_BLOCK_REF', token: targetId }
    const at = app.editor.getState().playhead
    if (!(at > block.start && at < block.end)) return { code: 'INVALID_PAYLOAD', token: block.id }
    // ONE `block-split`; the frozen unit-102 reducer owns the straddler-word
    // assignment (d.ts SPLIT WORD RULE — see the unit report BLOCKERS note).
    return app.dispatch('block-split', { blockId: block.id, at })
  }

  function mergeSelected(): CommandReject | null {
    const selection = app.editor.getState().selection
    if (selection.anchorBlockId === null || selection.focusBlockId === null) return { code: 'INVALID_PAYLOAD', token: 'selection' }
    const all = index().all()
    const ia = all.findIndex((block) => block.id === selection.anchorBlockId)
    const ib = all.findIndex((block) => block.id === selection.focusBlockId)
    if (ia < 0 || ib < 0) return { code: 'DANGLING_BLOCK_REF', token: selection.anchorBlockId }
    const lo = Math.min(ia, ib)
    const hi = Math.max(ia, ib)
    const first = all[lo]
    const second = all[hi]
    if (hi - lo !== 1 || first === undefined || second === undefined) return { code: 'INVALID_PAYLOAD', token: 'selection' } // EXACTLY two adjacent blocks
    const blockIds: readonly [string, string] = [first.id, second.id]
    return app.dispatch('block-merge', { blockIds })
  }

  function trimStartToPlayhead(): CommandReject | null {
    const targetId = selectionTargetId()
    if (targetId === null) return { code: 'INVALID_PAYLOAD', token: 'selection' }
    const block = findBlock(targetId)
    if (block === null) return { code: 'DANGLING_BLOCK_REF', token: targetId }
    const { prev } = neighbours(block.id)
    const floor = prev !== null ? prev.end + ADJACENCY_MIN_GAP_SEC : 0
    // design.md (Clipchamp): the trim target IS the playhead — the explicit
    // numeric target dispatches as-is (word boundaries are a POINTER-trim
    // rule; the frozen reducer re-derives word times proportionally).
    const start = Math.max(app.editor.getState().playhead, floor)
    return app.dispatch('block-retime', { blockId: block.id, start })
  }

  function trimEndToPlayhead(): CommandReject | null {
    const targetId = selectionTargetId()
    if (targetId === null) return { code: 'INVALID_PAYLOAD', token: 'selection' }
    const block = findBlock(targetId)
    if (block === null) return { code: 'DANGLING_BLOCK_REF', token: targetId }
    const { next } = neighbours(block.id)
    const ceiling = next !== null ? next.start - ADJACENCY_MIN_GAP_SEC : duration()
    const end = Math.min(app.editor.getState().playhead, ceiling)
    return app.dispatch('block-retime', { blockId: block.id, end })
  }

  // ── keyboard focus model (FR-103.7) ───────────────────────────────────────

  function announce(block: CaptionBlock): void {
    onAnnounce?.({
      blockId: block.id,
      speakerLabel: app.project.getState().project?.speakers.find((speaker) => speaker.id === block.speakerId)?.label ?? block.speakerId,
      timecode: formatTimecode(block.start),
      text: block.text,
    })
  }

  function moveFocus(delta: 1 | -1): void {
    const all = index().all()
    if (all.length === 0) return
    if (focusId === null) {
      if (delta !== 1) return // arrows never wrap before the first block
      const first = all[0]
      if (first === undefined) return
      focusId = first.id
      announce(first)
      return
    }
    const i = all.findIndex((block) => block.id === focusId)
    const target = i < 0 ? all[0] : all[Math.min(Math.max(i + delta, 0), all.length - 1)]
    if (target === undefined || target.id === focusId) return // no wraparound past the ends
    focusId = target.id
    announce(target)
  }

  function focusNext(): void {
    moveFocus(1)
  }
  function focusPrev(): void {
    moveFocus(-1)
  }
  function selectFocused(): void {
    if (focusId === null) return
    app.editor.setSelection({ anchorBlockId: focusId, focusBlockId: focusId })
  }
  function focusedBlockId(): string | null {
    return focusId
  }

  // ── zoom + pan (US-2.2.6 / FR-103.2) ──────────────────────────────────────

  function zoomIn(): void {
    viewport.set(zoomKey(viewport.get(), 1, widthPx))
  }
  function zoomOut(): void {
    viewport.set(zoomKey(viewport.get(), -1, widthPx))
  }
  function zoomFit(): void {
    viewport.set(fitViewport(duration(), widthPx))
  }
  function zoomAtPixel(x: number, factor: number): void {
    const v = viewport.get()
    const anchor = xToTime(x, v)
    const raw = anchorZoom(v, anchor, factor)
    // Clamp the RESULT and re-derive the applied factor so the anchor pixel
    // stays fixed at the bound (same discipline as viewport.zoomKey).
    const clamped = Math.min(ZOOM_MAX_PX_PER_SEC, Math.max(ZOOM_MIN_PX_PER_SEC, raw.pxPerSec))
    const applied = v.pxPerSec > 0 ? clamped / v.pxPerSec : 1
    viewport.set(anchorZoom(v, anchor, applied))
  }
  function panByPixels(dxPx: number): void {
    viewport.set(panBy(viewport.get(), dxPx, widthPx, duration()))
  }

  function dispose(): void {
    drag = null
    scrubbing = false
  }

  return {
    viewport,
    clickBlock,
    shiftClickBlock,
    marqueeSelect,
    rulerClick,
    beginPlayheadDrag,
    dragPlayheadTo,
    endPlayheadDrag,
    beginDrag,
    moveDrag,
    endDrag,
    dragState,
    splitAtPlayhead,
    mergeSelected,
    trimStartToPlayhead,
    trimEndToPlayhead,
    focusNext,
    focusPrev,
    selectFocused,
    focusedBlockId,
    zoomIn,
    zoomOut,
    zoomFit,
    zoomAtPixel,
    panByPixels,
    dispose,
  }
}
