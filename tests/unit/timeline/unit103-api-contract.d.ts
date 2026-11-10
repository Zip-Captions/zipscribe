// Unit-103 FROZEN API CONTRACT — test-author-owned ambient module declarations.
//
// The RED-phase suite of unit-103 (Timeline — canvas) imports the production
// modules `src/ui/timeline/{viewport,hittest,waveform,renderer,controller,Timeline}.ts`
// and `src/ui/editable/TimecodeInput.tsx` through the `@ui/…` specifiers
// (vite/vitest alias + tsconfig paths → `src/…`). None of them exist yet —
// that is the point: the tests import them and fail at *runtime* (missing
// module), while `pnpm typecheck` types the tests against the declarations
// below. The builder must export exactly these names/shapes; the runtime
// assertions (not these types) are the acceptance gate
// (unit-03/04/05/101/102 `@NN` precedent, tests/unit/editor/unit102-api-contract.d.ts
// header doctrine).
//
// Ownership boundary: the unit-101 (`@state/jobs`, `@state/settings`,
// `@state/project`, `@ui/shell/Workbench`, `@ui/commands/registry`) and
// unit-102 (`@state/commands`, `@state/editor`, `@state/history`,
// `@state/selectors`, `@state/services/*`, `@ui/format`, `@ui/canvas/overlay`,
// `@state/generated/contract-types`) ambient contracts stay authoritative —
// this file NEVER re-declares them. Commands the timeline dispatches
// (`block-split`, `block-merge`, `block-retime`, `transport-seek`) are the
// FROZEN unit-102 registry commands, imported through their existing ambient
// modules. Domain types are re-exported type-only under `@engine/model@103` /
// `@engine/protocol@103` (the `@103` suffix makes an accidental RUNTIME import
// impossible: nothing resolves it).
//
// INTENT BOUNDARIES (.ai-dlc/caption-studio-ui/intent.md): the full
// keyboard→command BINDING TABLE snapshot is unit-105 and persistence is
// unit-106 — unit-103 EXTENDS the registry (unit-102 MAJOR-5 pattern) with
// exactly the timeline bindings frozen below, and touches nothing else.
//
// Registry EXTENDS (unit-103 adds these CommandBinding entries to
// `src/ui/commands/registry.ts` — frozen ids/chords; design.md § Keyboard
// shortcuts; `when: 'timeline-focused'` is the unit-103 extension of the
// frozen `when?: 'not-editing'` field, checked BEFORE the global transport
// arrows so FR-103.7's focus model wins while the timeline region has focus):
//   timeline.split        'S'                  (when: not-editing)
//   timeline.merge        'Meta+Shift+M'       (when: not-editing)
//   timeline.merge-ctrl   'Ctrl+Shift+M'       (when: not-editing)
//   timeline.trim-start   'Z+ArrowLeft' / 'Z+ArrowRight'      (two bindings, one id)
//   timeline.trim-end     'C+ArrowLeft' / 'C+ArrowRight'      (two bindings, one id)
//   timeline.zoom-in      'Meta+='             (when: not-editing)
//   timeline.zoom-out     'Meta+-'             (when: not-editing)
//   timeline.zoom-fit     'Meta+0'             (when: not-editing)
//   timeline.focus-next   'ArrowRight'         (when: timeline-focused)
//   timeline.focus-prev   'ArrowLeft'          (when: timeline-focused)
//   timeline.select       'Enter'              (when: timeline-focused)
// Held-letter chords ('Z+ArrowLeft' …): useCommands must track held letter
// keys and prefix them into the chord (design.md: "held-letter chord;
// registry must support it") — verified end-to-end by
// e2e/timeline/keyboard-only.spec.ts.
//
// `data-testid` contract (builder must use exactly these ids):
//   timeline-root     — the timeline panel root: `data-region="timeline"`
//                       nesting (unit-101 region), `tabindex="0"`,
//                       `aria-label="timeline"` (FR-103.7 slider-style
//                       keyboard model lives on this element).
//   timeline-canvas   — the single <canvas> (dpr-scaled backing store).
//   timeline-live     — `aria-live="polite"` status region; announces the
//                       focused-block summary `${speakerLabel}, ${timecode},
//                       ${text}` (conventions § ARIA row pattern reused).
//   timeline-snap-toggle  — toolbar snap toggle (role=button, aria-pressed =
//                       snap enabled; design.md: snap "toggleable").
//   timeline-input-start / timeline-input-end — inspector-strip TimecodeInputs
//                       (US-2.2.5) under the timeline; the <input> carries the
//                       testid; invalid text sets `aria-invalid="true"` and
//                       commits NOTHING (recovery UX, never a silent clamp).
//
// SPLIT WORD RULE (US-2.2.2, binding on the `block-split` reducer path the
// controller uses): a word straddling `at` goes WHOLE into the part whose
// MIDPOINT is nearer the word's own midpoint (ties → first part); a word is
// never split; both parts keep ≥ 1 word (unit-102 frozen reject otherwise).
// NOT every unit-102 committed case lands on the same side: blk_a `at:0.6`
// (straddler alpha mid 0.85 vs part mids 0.55/1.55) is the DIVERGING case —
// nearer-midpoint sends alpha LEFT (right keeps beta+gamma) — so the unit-102
// commands-reducer/CH.6 empty-part cases were re-anchored to blk_b `at:3.05`
// per ledger adjudication (8c); blk_a `at:1.5` lands on the same side (beta
// mid 1.6 nearer the right part). CC-103.2 pins the diverging case.
//
// MERGE RULE (US-2.2.3): text joined with a SINGLE space, words concatenated
// (unit-102 `block-merge` reducer frozen behavior — asserted here through the
// controller seam).
//
// TIMING GATE DOCTRINE (conventions § Performance): the L5 latency spec
// measures INPUT→STATE latency p95 < 16 ms because the unit file (US-2.2.6 /
// CC-103.4) states it (unit file wins for its own scope per AGENTS precedence;
// `settings.yml performance_baselines` keeps the absolute floors as [RQ]).
// The PR-side sampler is an INP-style event→store-visible latency, chromium
// only, generous sample counts, non-vacuity-guarded.
//
// E2E-only injection bridge (FR-2.0.6 doctrine; sibling of
// `__zipEditorBridge`/`__zipWorkbenchBridge`, lazily installed under
// `?ziptest=1`). SECURITY-03: everything crossing here is numbers, generated
// synthetic block IDS and viewport scalars — never user text; nothing logs
// content. Canvas-relative CSS pixels for timeAtX/xAtTime.

declare module '@engine/model@103' {
  export type { CaptionBlock, MediaAsset, Project, Seconds, Speaker, WordToken } from '@engine/model'
}

declare module '@engine/protocol@103' {
  export type { PeaksData } from '@engine/protocol'
}

// ── FR-103.2 / US-2.2.6: viewport model + pure mapping math (CC-103.1) ─────
declare module '@ui/timeline/viewport' {
  import type { Seconds } from '@engine/model@103'

  /** THE viewport model (FR-103.2): scroll offset + zoom, nothing else. */
  export interface TimelineViewport {
    t0: Seconds
    pxPerSec: number
  }

  /** Trim-handle grab zone width in CSS px (design.md § Trim handles: 8 px). */
  export const HANDLE_PX: 8
  /** Snap radius in CSS px (design.md: snap within 8 px; Shift bypasses). */
  export const SNAP_PX: 8
  /** Adjacency floor in seconds (US-2.2.1: never closer than 0.05 s to a neighbour edge). */
  export const ADJACENCY_MIN_GAP_SEC: 0.05
  export const ZOOM_MIN_PX_PER_SEC: number
  export const ZOOM_MAX_PX_PER_SEC: number
  /** Multiplicative step for the keyboard zoom keys (⌘= multiply, ⌘− divide). */
  export const ZOOM_KEY_FACTOR: number

  /** x = (t − t0) · pxPerSec (golden table: fixtures/golden/timeline/viewport-mapping.json). */
  export function timeToX(t: Seconds, v: TimelineViewport): number
  /** Inverse of `timeToX`. */
  export function xToTime(x: number, v: TimelineViewport): Seconds

  /**
   * Wheel/⌘-wheel zoom that keeps `anchorTime` under the SAME pixel:
   * pxPerSec' = pxPerSec·factor, t0' = anchorTime − (anchorTime − t0)/factor.
   * No clamping here (pure math; clamped wrappers clamp the RESULT).
   */
  export function anchorZoom(v: TimelineViewport, anchorTime: Seconds, factor: number): TimelineViewport

  /** Keyboard ⌘=/⌘−: scale by ZOOM_KEY_FACTOR toward `direction`, clamp pxPerSec into [MIN, MAX], anchor = visible center (widthPx/2). */
  export function zoomKey(v: TimelineViewport, direction: 1 | -1, widthPx: number): TimelineViewport

  /** ⌘0 fit-to-project: t0 = 0, pxPerSec = widthPx/duration clamped into [MIN, MAX]. */
  export function fitViewport(duration: Seconds, widthPx: number): TimelineViewport

  /** Wheel pan: t0 += dxPx/pxPerSec, clamped so the visible window stays within [0, duration] whenever content is wider than the viewport. */
  export function panBy(v: TimelineViewport, dxPx: number, widthPx: number, duration: Seconds): TimelineViewport

  /** Nearest candidate within SNAP_PX px of `t`; null when nothing is in range. */
  export function snapTime(t: Seconds, candidates: readonly Seconds[], v: TimelineViewport): Seconds | null

  /** Loop-region shade rectangle (FR-103.6); null when no loop region. */
  export function loopShade(loop: readonly [Seconds, Seconds] | null, v: TimelineViewport): { x: number; width: number } | null

  /** Tiny observable holder injected into the renderer and the controller. */
  export interface ViewportState {
    get(): TimelineViewport
    set(next: TimelineViewport): void
    subscribe(listener: (v: TimelineViewport) => void): () => void
  }
  export function createViewportState(initial: TimelineViewport): ViewportState
}

// ── FR-103.2: data-model hit-testing via spatial index (CC-103.1 parity) ───
declare module '@ui/timeline/hittest' {
  import type { CaptionBlock, Seconds } from '@engine/model@103'
  import type { TimelineViewport } from '@ui/timeline/viewport'

  /**
   * Interval index over blocks — queries are O(log n + k) (FR-103.2).
   * Hit-testing goes through the DATA MODEL; there are no DOM block nodes
   * (architecture § Timeline rendering).
   */
  export interface BlockIndex {
    /** Blocks overlapping the time window [tA, tB] (tA ≤ tB), timeline order. */
    query(tA: Seconds, tB: Seconds): CaptionBlock[]
    /** Block containing `t` (`start <= t < end`), else null. */
    hit(t: Seconds): CaptionBlock | null
    all(): readonly CaptionBlock[]
  }
  export function createBlockIndex(blocks: readonly CaptionBlock[]): BlockIndex

  /** The 8 px grab zones on the block edges in PIXEL space (design.md § Trim handles); the nearer zone wins when the block is narrower than 2·HANDLE_PX. */
  export function hitEdge(block: CaptionBlock, x: number, v: TimelineViewport): 'start' | 'end' | null

  /** Blocks whose pixel rect intersects the marquee pixel span [xA, xB] (normalized, inclusive), timeline order. */
  export function blocksInPixelRange(index: BlockIndex, xA: number, xB: number, v: TimelineViewport): CaptionBlock[]
}

// ── FR-103.4: PeaksData → pixel-aligned buckets + silence markers ──────────
declare module '@ui/timeline/waveform' {
  import type { PeaksData } from '@engine/protocol@103'
  import type { Seconds } from '@engine/model@103'
  import type { TimelineViewport } from '@ui/timeline/viewport'

  export interface WaveformBucket {
    t0: Seconds
    t1: Seconds
    min: number
    max: number
  }

  /**
   * Zoom-aware re-bucketing into `bucketWidthPx`-wide PIXEL buckets covering
   * the visible window [t0, t0 + widthPx/pxPerSec]: native buckets are merged
   * when a bucket spans several and split (exact copy, native resolution is
   * the truth) when zoomed past it. Empty visible tail → empty array.
   */
  export function rebucketPeaks(peaks: PeaksData, v: TimelineViewport, widthPx: number, bucketWidthPx?: number): WaveformBucket[]

  /** Maximal consecutive runs where both channels stay within ±maxAbs (FR-103.4 silence markers). */
  export function silenceMarkers(peaks: PeaksData, maxAbs: number): Array<[Seconds, Seconds]>
}

// ── FR-103.1/FR-103.5: canvas renderer — layers, dirty flags, dpr ──────────
declare module '@ui/timeline/renderer' {
  import type { CaptionBlock, Seconds } from '@engine/model@103'
  import type { RafDriver } from '@state/services/playback/arbitrator'
  import type { Selection } from '@state/editor'
  import type { TimelineViewport } from '@ui/timeline/viewport'
  import type { WaveformBucket } from '@ui/timeline/waveform'

  export type TimelineLayer = 'ruler' | 'waveform' | 'blocks' | 'handles' | 'playhead' | 'snap'

  /** Design tokens the renderer paints with (knowledge/design.md § Design tokens). Injectable so L1/L2 asserts stable colors. */
  export interface TimelinePalette {
    waveform: string
    waveformActive: string
    playhead: string
    selection: string
    accent: string
    warning: string
    textPrimary: string
    bgPanel: string
    borderSubtle: string
  }
  export const DEFAULT_TIMELINE_PALETTE: TimelinePalette

  /**
   * The Canvas-2D subset the renderer consumes — a real 2D context in the
   * browser, the recording double (tests/unit/timeline/helpers/canvas-recorder.ts)
   * in L1/L2. `beginLayer`/`endLayer` bracket every layer's draw batch so the
   * dirty-region redraw counts are observable per layer (CC-103.4).
   */
  export interface DrawTarget {
    width: number
    height: number
    fillStyle: string
    strokeStyle: string
    font: string
    beginLayer(layer: TimelineLayer): void
    endLayer(): void
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
    clearRect(x: number, y: number, w: number, h: number): void
    fillRect(x: number, y: number, w: number, h: number): void
    strokeRect(x: number, y: number, w: number, h: number): void
    fillText(text: string, x: number, y: number): void
    beginPath(): void
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    stroke(): void
    measureText(text: string): { width: number }
  }

  export interface TimelineGhost {
    blockId: string
    start: Seconds
    end: Seconds
  }

  export interface TimelineRenderState {
    viewport: TimelineViewport
    blocks: readonly CaptionBlock[]
    selection: Selection
    focusBlockId: string | null
    playhead: Seconds
    loop: readonly [Seconds, Seconds] | null
    waveform: readonly WaveformBucket[]
    silence: ReadonlyArray<readonly [Seconds, Seconds]>
    snapIndicator: Seconds | null
    ghost: TimelineGhost | null
  }

  /** FR-103.5 block-visuals state data (time→width mapping, fit/ellipsize, speaker border, low-confidence dot, selected/ghost states). */
  export interface BlockVisual {
    x: number
    width: number
    speakerColor: string
    selected: boolean
    focused: boolean
    ghosted: boolean
    lowConfidence: boolean
    ellipsizedText: string
    truncated: boolean
  }

  /**
   * PURE derivation — no canvas access. `measure` defaults to a deterministic
   * 6 px/char advance; the low-confidence threshold is implementation-owned
   * (tests pin 0.2 = low, 0.95/absent = not). `ellipsizedText` ends with the
   * U+2026 ellipsis iff `truncated`.
   */
  export function blockVisuals(
    block: CaptionBlock,
    opts: { viewport: TimelineViewport; selected: boolean; focused: boolean; ghosted: boolean; speakerColor: string; measure?: (text: string) => number },
  ): BlockVisual

  export interface TimelineRendererStats {
    /** Dirty flushes performed — ONE per scheduled rAF frame (coalescing, FR-103.1). */
    passes: number
    /** Cumulative ops emitted per layer (via beginLayer/endLayer bracketing). */
    drawsByLayer: Record<TimelineLayer, number>
  }

  export interface TimelineRenderer {
    /** Backing store = round(css × dpr) + the dpr transform, recorded through the target (FR-103.1). */
    resize(widthPx: number, heightPx: number, dpr: number): void
    /** `undefined` or 'all' dirties every layer; a named layer dirties only that layer (CC-103.4). */
    invalidate(layer?: TimelineLayer | 'all'): void
    /** Coalesced frame request — repeated schedules within one frame flush ONCE. */
    schedule(): void
    /** Immediate full flush of the DIRTY layers against `state` (clears the dirty set). */
    renderNow(state: TimelineRenderState): void
    dirtyLayers(): TimelineLayer[]
    stats(): TimelineRendererStats
    dispose(): void
  }

  export function createTimelineRenderer(deps: { target: DrawTarget; rafs: RafDriver; palette: TimelinePalette; measure?: (text: string) => number; laneHeights?: { ruler: number; waveform: number; blocks: number } }): TimelineRenderer
}

// ── FR-103.3/FR-103.6 + US-2.2.1/2/3: interaction controller ───────────────
declare module '@ui/timeline/controller' {
  import type { Seconds } from '@engine/model@103'
  import type { CommandReject } from '@state/commands'
  import type { EditorApp } from '@state/history'
  import type { RafDriver } from '@state/services/playback/arbitrator'
  import type { ViewportState } from '@ui/timeline/viewport'

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

    /**
     * Trim/body drag (US-2.2.1, FR-103.3): NO command during the drag (ghost
     * data only); EXACTLY ONE `block-retime` on endDrag. Constraints (CC-103.3):
     * snap to adjacent edges/playhead within SNAP_PX (Shift bypasses);
     * adjacency floor — dispatched edges never closer than ADJACENCY_MIN_GAP_SEC
     * to a neighbour edge; body drag moves ONLY that block (with its words),
     * clamped between neighbours, never pushing them; without Alt a trim never
     * cuts through a word (lands on a word boundary, block keeps ≥ 1 word);
     * Alt allows free retime (the frozen reducer re-derives word times
     * proportionally).
     */
    beginDrag(blockId: string, edge: 'body' | 'start' | 'end', x: number, mods?: { altKey?: boolean; shiftKey?: boolean }): void
    moveDrag(x: number): void
    endDrag(): CommandReject | null
    dragState(): DragState | null

    /** S (US-2.2.2): split the focused (or selected, focused-last) block containing the playhead → ONE `block-split`; straddling words go WHOLE to the nearer-midpoint part. */
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

    /** ⌘= / ⌘− / ⌘0 (viewport.zoomKey/fitViewport) and ⌘+wheel zoom (anchorZoom at xToPixel). */
    zoomIn(): void
    zoomOut(): void
    zoomFit(): void
    zoomAtPixel(x: number, factor: number): void
    /** Wheel pan (viewport.panBy; clamped to the project range). */
    panByPixels(dxPx: number): void

    dispose(): void
  }

  export function createTimelineController(deps: {
    app: EditorApp
    rafs: RafDriver
    viewport: ViewportState
    widthPx: number
    /** Snap toggle state source (toolbar toggle, design.md "toggleable"); default = always on. Shift-bypass is per-drag, not here. */
    snapEnabled?: () => boolean
    /** Live-region sink (FR-103.7) — called when block focus changes. */
    onAnnounce?: (summary: FocusedBlockSummary) => void
  }): TimelineController
}

// ── US-2.2.5 / conventions § UI conventions: the shared timecode input ─────
declare module '@ui/editable/TimecodeInput' {
  import type { Seconds } from '@engine/model@103'
  import type { ReactElement } from 'react'

  export interface TimecodeInputProps {
    value: Seconds
    label: string
    /** The <input> carries this data-testid. */
    testId: string
    /** Enter (or blur) commits a PARSED value; invalid text shows the error state (`aria-invalid="true"`) and never calls onCommit — no silent clamp, recovery UX (US-2.2.5). */
    onCommit(t: Seconds): void
    /** Frame-precision mode (MM:SS:FF) for fps-backed assets. */
    fps?: number
  }
  /**
   * Shared timecode input (conventions § UI conventions: the only allowed
   * onKeyDown path — must live under `src/ui/**\/editable/**`). Formatting
   * through `@ui/format.formatTimecode`; parsing accepts millisecond
   * precision for the inspector strip ('00:12.350' → 12.35) — additive parse
   * options beyond the frozen tenths default are the builder's choice, the
   * BEHAVIOR above is the gate.
   */
  export function TimecodeInput(props: TimecodeInputProps): ReactElement
}

// ── L2 mount surface (jsdom): the Timeline panel component ──────────────────
declare module '@ui/timeline/Timeline' {
  import type { EditorApp } from '@state/history'
  import type { RafDriver } from '@state/services/playback/arbitrator'
  import type { DrawTarget, TimelinePalette } from '@ui/timeline/renderer'
  import type { TimelineViewport } from '@ui/timeline/viewport'
  import type { ReactElement } from 'react'

  export interface TimelineProps {
    app: EditorApp
    rafs: RafDriver
    /** devicePixelRatio (default 1) — drives the backing-store scale (FR-103.1). */
    dpr?: number
    /** Explicit CSS size (default falls back to the element's client size). */
    initialSize?: { widthPx: number; heightPx: number }
    initialViewport?: TimelineViewport
    palette?: TimelinePalette
    /** THE seam for the canvas recorder double: the component builds its draw
     *  target through this factory (default: the canvas 2D context). */
    createTarget?: (widthPx: number, heightPx: number, dpr: number) => DrawTarget
    /** Snap toggle initial state (default true); exposes the timeline-snap-toggle control. */
    snapEnabled?: boolean
  }
  /**
   * The timeline panel: ruler/waveform/blocks/handles/playhead/snap on ONE
   * canvas (FR-103.1), pointer interactions routed to the controller, the
   * inspector strip with the two TimecodeInputs (US-2.2.5), the
   * `timeline-live` announcement region (FR-103.7). Thin render layer —
   * all behavior through the controller/commands (conventions § ui/**).
   * WHILE MOUNTED the panel registers command handlers for every frozen
   * `timeline.*` binding id (→ controller methods; the `useTransportCommands`
   * precedent) — it is the single owner of the timeline command surface, and
   * the `when: 'timeline-focused'` gate reads `document.activeElement` inside
   * the `data-region="timeline"` element. The inspector inputs edit the
   * selected block (selection focus, else controller focus; disabled with
   * neither). `timeline-live` text is EXACTLY
   * `${speakerLabel}, ${timecode}, ${text}` (formatTimecode timecode).
   */
  export function Timeline(props: TimelineProps): ReactElement
}

/**
 * E2E-only injection bridge (FR-2.0.6; sibling of __zipEditorBridge /
 * __zipWorkbenchBridge under ?ziptest=1). Diagnostics ONLY — numbers,
 * synthetic block ids and viewport scalars (SECURITY-03); keyboard/mouse go
 * through REAL trusted input, never through this bridge. x is canvas-relative
 * CSS pixels for timeAtX/xAtTime.
 */
interface Window {
  __zipTimelineBridge?: {
    getTimelineState(): {
      t0: number
      pxPerSec: number
      focusedBlockId: string | null
      selectionAnchorBlockId: string | null
      selectionFocusBlockId: string | null
      blockCount: number
      dragging: boolean
      snapEnabled: boolean
    }
    /** Numbers only (SECURITY-03): bounds + word count — never block text. */
    getBlock(blockId: string): { start: number; end: number; wordCount: number } | null
    timeAtX(x: number): number
    xAtTime(t: number): number
  }
}
