// Unit-103 FR-103.1/FR-103.5 — the canvas timeline renderer: layers, dirty
// flags, rAF-coalesced scheduling, dpr-scaled backing store. Shapes frozen by
// tests/unit/timeline/unit103-api-contract.d.ts § '@ui/timeline/renderer'.
//
// Design (architecture § Timeline rendering): ONE canvas, six logical layers.
// Every layer's draw batch is bracketed by `beginLayer`/`endLayer` on the
// injected DrawTarget so CC-103.4's dirty-region redraw is observable per
// layer: a clean frame emits ZERO ops for clean layers, and `stats()` reports
// cumulative per-layer op counts plus the pass count (ONE per scheduled rAF
// frame — repeated `schedule()` calls coalesce through a single pending rAF).
//
// `blockVisuals` is the PURE visual-derivation half (CC-103.1: state is
// data, asserted without a canvas); the draw pass consumes it. Text
// measurement goes through a bounded LRU keyed (text, font, width) — the
// unit's named Risk (canvas-text measure cost per frame).
//
// No React, no DOM globals: the renderer talks to `DrawTarget` (a real 2D
// context in the browser, the recording double in L1/L2) and the injected
// `RafDriver` only.

import type { CaptionBlock, Seconds } from '../../engine/model'
import type { Selection } from '../../state/editor'
import type { RafDriver } from '../../state/services/playback/arbitrator'
import { HANDLE_PX, loopShade, timeToX } from './viewport'
import type { TimelineViewport } from './viewport'
import type { WaveformBucket } from './waveform'

export type TimelineLayer = 'ruler' | 'waveform' | 'blocks' | 'handles' | 'playhead' | 'snap'

const LAYER_ORDER: readonly TimelineLayer[] = ['ruler', 'waveform', 'blocks', 'handles', 'playhead', 'snap']

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

// Exact values of the dark-theme custom properties in knowledge/design.md
// § Design tokens — the renderer owns no color of its own.
export const DEFAULT_TIMELINE_PALETTE: TimelinePalette = {
  waveform: '#3d4450',
  waveformActive: '#4c8dff',
  playhead: '#ff5c5c',
  selection: 'rgba(76,141,255,.22)',
  accent: '#4c8dff',
  warning: '#d9a03f',
  textPrimary: '#e8eaed',
  bgPanel: '#15181d',
  borderSubtle: '#2a2f38',
}

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

// ── FR-103.5 block visuals — PURE derivation, no canvas access ──────────────

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

/** Deterministic default advance (px/char) — the canvas-free stand-in for measureText. */
const CHAR_ADVANCE_PX = 6
/** Horizontal text inset per block side. */
const TEXT_PADDING_PX = 6
/** Speaker border strip width. */
const SPEAKER_BORDER_PX = 3
const ELLIPSIS = '\u2026'
const RULER_FONT = '11px Inter'
const BLOCK_FONT = '12px Inter'
/**
 * Implementation-owned low-confidence threshold (FR-103.5 --warning dot).
 * Tests pin the behavior bands: 0.2 is low, 0.95+/absent is not
 * (absent ⇒ not — engine without probabilities never shows the dot,
 * architecture invariant 7).
 */
const LOW_CONFIDENCE_MAX = 0.5

function defaultMeasure(text: string): number {
  return text.length * CHAR_ADVANCE_PX
}

/**
 * Word-granular ellipsize: whole trailing words are dropped until the text
 * (plus the U+2026) fits `availPx`. A single word is never cut — if even it
 * does not fit, the text passes through untruncated (overflow is painted,
 * words are data and never sliced mid-word on the ruler level).
 */
function ellipsize(text: string, measure: (text: string) => number, availPx: number): { text: string; truncated: boolean } {
  if (text.length === 0 || measure(text) <= availPx) return { text, truncated: false }
  const words = text.split(' ')
  let kept = words.length
  while (kept > 1 && measure(`${words.slice(0, kept).join(' ')}${ELLIPSIS}`) > availPx) kept--
  if (kept === words.length) return { text, truncated: false }
  return { text: `${words.slice(0, kept).join(' ')}${ELLIPSIS}`, truncated: true }
}

/**
 * PURE derivation — no canvas access. `measure` defaults to a deterministic
 * 6 px/char advance; the low-confidence threshold is implementation-owned
 * (tests pin 0.2 = low, 0.95/absent = not). `ellipsizedText` ends with the
 * U+2026 ellipsis iff `truncated`.
 */
export function blockVisuals(block: CaptionBlock, opts: { viewport: TimelineViewport; selected: boolean; focused: boolean; ghosted: boolean; speakerColor: string; measure?: (text: string) => number }): BlockVisual {
  const measure = opts.measure ?? defaultMeasure
  const x = timeToX(block.start, opts.viewport)
  const width = (block.end - block.start) * opts.viewport.pxPerSec
  const fitted = ellipsize(block.text, measure, width - 2 * TEXT_PADDING_PX)
  return {
    x,
    width,
    speakerColor: opts.speakerColor,
    selected: opts.selected,
    focused: opts.focused,
    ghosted: opts.ghosted,
    lowConfidence: block.confidence !== undefined && block.confidence < LOW_CONFIDENCE_MAX,
    ellipsizedText: fitted.text,
    truncated: fitted.truncated,
  }
}

// ── LRU text-measure cache (unit Risk: canvas-text measure cost per frame) ──

const MEASURE_CACHE_LIMIT = 512

function createMeasureCache(measure: (text: string) => number, limit: number = MEASURE_CACHE_LIMIT): (text: string, font: string, width: number) => number {
  const cache = new Map<string, number>()
  return (text, font, width) => {
    const key = `${font}\u0000${width}\u0000${text}`
    const hit = cache.get(key)
    if (hit !== undefined) {
      cache.delete(key)
      cache.set(key, hit)
      return hit
    }
    const value = measure(text)
    cache.set(key, value)
    if (cache.size > limit) {
      const oldest = cache.keys().next()
      if (!oldest.done) cache.delete(oldest.value)
    }
    return value
  }
}

// ── Renderer ────────────────────────────────────────────────────────────────

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

interface LaneHeights {
  ruler: number
  waveform: number
  blocks: number
}

const DEFAULT_LANE_HEIGHTS: LaneHeights = { ruler: 24, waveform: 48, blocks: 72 }

/** Tick candidate spacings (seconds); the finest whose px pitch ≥ 60 px wins. */
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600] as const

function speakerColorFor(speakerId: string, palette: TimelinePalette): string {
  // Deterministic stripe over the palette's distinguishable accents —
  // component-level speaker color resolution (design.md § Speaker chips)
  // lives with the component and overrides via its own palette.
  let hash = 0
  for (let i = 0; i < speakerId.length; i++) hash = (hash * 31 + speakerId.charCodeAt(i)) | 0
  const ring = [palette.accent, palette.warning, palette.waveformActive, palette.playhead]
  return ring[Math.abs(hash) % ring.length] as string
}

function formatTick(t: Seconds): string {
  const rounded = Math.round(t * 1000) / 1000
  return `${rounded}s`
}

export function createTimelineRenderer(deps: {
  target: DrawTarget
  rafs: RafDriver
  palette: TimelinePalette
  measure?: (text: string) => number
  laneHeights?: { ruler: number; waveform: number; blocks: number }
}): TimelineRenderer {
  const { target, rafs, palette } = deps
  const lanes: LaneHeights = deps.laneHeights ?? DEFAULT_LANE_HEIGHTS
  const measureCached = createMeasureCache(deps.measure ?? defaultMeasure)

  const dirty = new Set<TimelineLayer>(LAYER_ORDER)
  const drawsByLayer: Record<TimelineLayer, number> = { ruler: 0, waveform: 0, blocks: 0, handles: 0, playhead: 0, snap: 0 }
  let passes = 0
  let pendingFrame: number | null = null
  let disposed = false
  let cssWidth = 0
  let cssHeight = 0
  let lastState: TimelineRenderState | null = null
  let activeLayer: TimelineLayer | null = null

  function count(): void {
    if (activeLayer !== null) drawsByLayer[activeLayer] += 1
  }

  function fillRect(x: number, y: number, w: number, h: number): void {
    target.fillRect(x, y, w, h)
    count()
  }

  function strokeRect(x: number, y: number, w: number, h: number): void {
    target.strokeRect(x, y, w, h)
    count()
  }

  function fillText(text: string, x: number, y: number): void {
    target.fillText(text, x, y)
    count()
  }

  function verticalLine(x: number, y0: number, y1: number): void {
    target.beginPath()
    count()
    target.moveTo(x, y0)
    count()
    target.lineTo(x, y1)
    count()
    target.stroke()
    count()
  }

  // ── layers ────────────────────────────────────────────────────────────────

  function drawRuler(st: TimelineRenderState): void {
    target.fillStyle = palette.bgPanel
    fillRect(0, 0, cssWidth, lanes.ruler)
    const shade = loopShade(st.loop, st.viewport)
    if (shade !== null) {
      target.fillStyle = palette.selection
      fillRect(shade.x, 0, shade.width, lanes.ruler)
    }
    if (!(st.viewport.pxPerSec > 0)) return
    let step = TICK_STEPS[TICK_STEPS.length - 1] as number
    for (const candidate of TICK_STEPS) {
      if (candidate * st.viewport.pxPerSec >= 60) {
        step = candidate
        break
      }
    }
    const firstTick = Math.ceil(st.viewport.t0 / step) * step
    for (let t = firstTick; ; t += step) {
      const x = timeToX(t, st.viewport)
      if (x > cssWidth) break
      target.fillStyle = palette.borderSubtle
      fillRect(x, lanes.ruler - 6, 1, 6)
      target.fillStyle = palette.textPrimary
      target.font = RULER_FONT
      fillText(formatTick(t), x + 2, lanes.ruler - 4)
    }
  }

  function waveformTop(bucket: WaveformBucket): number {
    const center = lanes.ruler + lanes.waveform / 2
    const amp = Math.max(Math.abs(bucket.min), Math.abs(bucket.max))
    return center - (Math.min(1, amp) * (lanes.waveform - 4)) / 2
  }

  function drawWaveform(st: TimelineRenderState): void {
    target.fillStyle = palette.bgPanel
    fillRect(0, lanes.ruler, cssWidth, lanes.waveform)
    target.fillStyle = palette.waveform
    for (const bucket of st.waveform) {
      const x = timeToX(bucket.t0, st.viewport)
      const w = (bucket.t1 - bucket.t0) * st.viewport.pxPerSec
      const top = waveformTop(bucket)
      const h = lanes.ruler + lanes.waveform - 2 - top
      fillRect(x, top, Math.max(w, 0.5), Math.max(h, 1))
    }
    target.fillStyle = palette.waveformActive
    for (const [from, to] of st.silence) {
      const x = timeToX(from, st.viewport)
      fillRect(x, lanes.ruler + lanes.waveform - 3, (to - from) * st.viewport.pxPerSec, 2)
    }
  }

  function blocksTop(): number {
    return lanes.ruler + lanes.waveform
  }

  function drawBlockShape(st: TimelineRenderState, block: CaptionBlock, x: number, width: number, opts: { selected: boolean; focused: boolean; ghosted: boolean }): void {
    const y = blocksTop()
    const visual = blockVisuals(block, {
      viewport: st.viewport,
      selected: opts.selected,
      focused: opts.focused,
      ghosted: opts.ghosted,
      speakerColor: speakerColorFor(block.speakerId, palette),
      measure: (text) => measureCached(text, BLOCK_FONT, Math.max(width - 2 * TEXT_PADDING_PX, 0)),
    })
    if (visual.selected || visual.ghosted) {
      target.fillStyle = palette.selection
      fillRect(x, y, width, lanes.blocks)
    }
    target.strokeStyle = palette.borderSubtle
    strokeRect(x, y, width, lanes.blocks)
    target.fillStyle = visual.speakerColor
    fillRect(x, y, Math.min(SPEAKER_BORDER_PX, width), lanes.blocks)
    target.fillStyle = palette.textPrimary
    target.font = BLOCK_FONT
    fillText(visual.ellipsizedText, x + TEXT_PADDING_PX, y + 16)
    if (visual.lowConfidence) {
      target.fillStyle = palette.warning
      fillRect(x + Math.max(width - 8, 0), y + 4, 4, 4)
    }
  }

  function drawBlocks(st: TimelineRenderState): void {
    target.fillStyle = palette.bgPanel
    fillRect(0, blocksTop(), cssWidth, lanes.blocks)
    for (const block of st.blocks) {
      const selected = st.selection.anchorBlockId === block.id || st.selection.focusBlockId === block.id
      const x = timeToX(block.start, st.viewport)
      const width = (block.end - block.start) * st.viewport.pxPerSec
      drawBlockShape(st, block, x, width, { selected, focused: st.focusBlockId === block.id, ghosted: false })
    }
    if (st.ghost !== null) {
      const ghosted = st.blocks.find((block) => block.id === st.ghost?.blockId)
      if (ghosted !== undefined) {
        const gx = timeToX(st.ghost.start, st.viewport)
        const gw = (st.ghost.end - st.ghost.start) * st.viewport.pxPerSec
        drawBlockShape(st, ghosted, gx, gw, { selected: false, focused: false, ghosted: true })
      }
    }
  }

  function drawHandles(st: TimelineRenderState): void {
    for (const block of st.blocks) {
      const selected = st.selection.anchorBlockId === block.id || st.selection.focusBlockId === block.id
      if (!selected && st.focusBlockId !== block.id) continue
      const y = blocksTop()
      const xs = timeToX(block.start, st.viewport)
      const xe = timeToX(block.end, st.viewport)
      target.fillStyle = palette.selection
      fillRect(xs - HANDLE_PX / 2, y, HANDLE_PX, lanes.blocks)
      fillRect(xe - HANDLE_PX / 2, y, HANDLE_PX, lanes.blocks)
    }
  }

  function drawPlayhead(st: TimelineRenderState): void {
    const x = timeToX(st.playhead, st.viewport)
    target.strokeStyle = palette.playhead
    verticalLine(x, 0, cssHeight)
    target.fillStyle = palette.playhead
    fillRect(x - 3, 0, 6, 6)
  }

  function drawSnap(st: TimelineRenderState): void {
    if (st.snapIndicator === null) return
    const x = timeToX(st.snapIndicator, st.viewport)
    target.strokeStyle = palette.accent
    verticalLine(x, lanes.ruler, cssHeight)
  }

  const LAYER_DRAW: Record<TimelineLayer, (st: TimelineRenderState) => void> = {
    ruler: drawRuler,
    waveform: drawWaveform,
    blocks: drawBlocks,
    handles: drawHandles,
    playhead: drawPlayhead,
    snap: drawSnap,
  }

  // ── flush / scheduling ────────────────────────────────────────────────────

  function flush(): void {
    passes += 1
    const due = LAYER_ORDER.filter((layer) => dirty.has(layer))
    dirty.clear()
    if (lastState === null) return
    for (const layer of due) {
      activeLayer = layer
      target.beginLayer(layer)
      LAYER_DRAW[layer](lastState)
      target.endLayer()
      activeLayer = null
    }
  }

  function onScheduledFrame(): void {
    pendingFrame = null
    if (!disposed) flush()
  }

  return {
    resize(widthPx, heightPx, dpr) {
      cssWidth = widthPx
      cssHeight = heightPx
      target.width = Math.round(widthPx * dpr)
      target.height = Math.round(heightPx * dpr)
      target.setTransform(dpr, 0, 0, dpr, 0, 0)
    },
    invalidate(layer) {
      if (disposed) return
      if (layer === undefined || layer === 'all') {
        for (const name of LAYER_ORDER) dirty.add(name)
      } else {
        dirty.add(layer)
      }
    },
    schedule() {
      if (disposed || pendingFrame !== null) return
      pendingFrame = rafs.request(onScheduledFrame)
    },
    renderNow(state) {
      if (disposed) return
      lastState = state
      flush()
    },
    dirtyLayers() {
      return LAYER_ORDER.filter((layer) => dirty.has(layer))
    },
    stats() {
      return { passes, drawsByLayer: { ...drawsByLayer } }
    },
    dispose() {
      disposed = true
      if (pendingFrame !== null) {
        rafs.cancel(pendingFrame)
        pendingFrame = null
      }
    },
  }
}
