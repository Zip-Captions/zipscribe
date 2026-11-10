// Unit-103 FR-103.2 / US-2.2.6 — the pure viewport model `{ t0, pxPerSec }`
// and its mapping math (CC-103.1). Shapes frozen by
// tests/unit/timeline/unit103-api-contract.d.ts § '@ui/timeline/viewport';
// golden table fixtures/golden/timeline/viewport-mapping.json pins
// timeToX/xToTime/anchorZoom (the rules its `note` states are binding).
//
// Pure math: no React, no DOM globals, no store reads. `anchorZoom` is
// deliberately UNCLAMPED (wheel/⌘-wheel callers clamp the RESULT); the
// clamped wrappers are `zoomKey` and `fitViewport`. Times are seconds float
// end to end (domain invariant 6 rounds only on WRITE — pre-rounding here
// would break the golden `.toBe` parity).

import type { Seconds } from '../../engine/model'

/** THE viewport model (FR-103.2): scroll offset + zoom, nothing else. */
export interface TimelineViewport {
  t0: Seconds
  pxPerSec: number
}

/** Trim-handle grab zone width in CSS px (design.md § Trim handles: 8 px). */
export const HANDLE_PX = 8 as const
/** Snap radius in CSS px (design.md: snap within 8 px; Shift bypasses). */
export const SNAP_PX = 8 as const
/** Adjacency floor in seconds (US-2.2.1: never closer than 0.05 s to a neighbour edge). */
export const ADJACENCY_MIN_GAP_SEC = 0.05 as const
/** Zoom-out floor: 2 px/s still renders a 10 000-block overview legibly. */
export const ZOOM_MIN_PX_PER_SEC: number = 2
/** Zoom-in ceiling: 1000 px/s = frame-accurate scrubbing at ≥ 25 fps. */
export const ZOOM_MAX_PX_PER_SEC: number = 1000
/** Multiplicative step for the keyboard zoom keys (⌘= multiply, ⌘− divide). */
export const ZOOM_KEY_FACTOR: number = 1.5

// Mapping outputs are quantized at 1e-10: it erases IEEE-754 accumulation
// noise (~1e-13 — e.g. (10.123 − 10) · 400 = 49.19999999999973) so the golden
// table's exact decimal comparisons hold, while staying ~9 orders of
// magnitude under the golden tolerance (0.01 px). anchorZoom stays raw.
const COORD_DECIMALS = 10

function quantize(value: number): number {
  if (!Number.isFinite(value)) return value
  return Number(value.toFixed(COORD_DECIMALS))
}

/** x = (t − t0) · pxPerSec (golden table: fixtures/golden/timeline/viewport-mapping.json). */
export function timeToX(t: Seconds, v: TimelineViewport): number {
  return quantize((t - v.t0) * v.pxPerSec)
}

/** Inverse of `timeToX`: t = x / pxPerSec + t0. */
export function xToTime(x: number, v: TimelineViewport): Seconds {
  return quantize(x / v.pxPerSec + v.t0)
}

/**
 * Wheel/⌘-wheel zoom that keeps `anchorTime` under the SAME pixel:
 * pxPerSec' = pxPerSec·factor, t0' = anchorTime − (anchorTime − t0)/factor.
 * No clamping here (pure math; clamped wrappers clamp the RESULT).
 */
export function anchorZoom(v: TimelineViewport, anchorTime: Seconds, factor: number): TimelineViewport {
  return {
    pxPerSec: v.pxPerSec * factor,
    t0: anchorTime - (anchorTime - v.t0) / factor,
  }
}

/** Keyboard ⌘=/⌘−: scale by ZOOM_KEY_FACTOR toward `direction`, clamp pxPerSec into [MIN, MAX], anchor = visible center (widthPx/2). */
export function zoomKey(v: TimelineViewport, direction: 1 | -1, widthPx: number): TimelineViewport {
  const step = direction === 1 ? ZOOM_KEY_FACTOR : 1 / ZOOM_KEY_FACTOR
  const pxPerSec = clampZoom(v.pxPerSec * step)
  // The factor actually APPLIED after clamping — at a bound it is 1, so the
  // anchor (and t0) stay put and pxPerSec keeps its exact clamped value.
  return anchorZoom(v, xToTime(widthPx / 2, v), pxPerSec / v.pxPerSec)
}

/** ⌘0 fit-to-project: t0 = 0, pxPerSec = widthPx/duration clamped into [MIN, MAX]. */
export function fitViewport(duration: Seconds, widthPx: number): TimelineViewport {
  if (!(duration > 0) || !(widthPx > 0)) return { t0: 0, pxPerSec: ZOOM_MIN_PX_PER_SEC }
  return { t0: 0, pxPerSec: clampZoom(widthPx / duration) }
}

/** Wheel pan: t0 += dxPx/pxPerSec, clamped so the visible window stays within [0, duration] whenever content is wider than the viewport. */
export function panBy(v: TimelineViewport, dxPx: number, widthPx: number, duration: Seconds): TimelineViewport {
  const t = v.t0 + dxPx / v.pxPerSec
  const visibleSec = widthPx / v.pxPerSec
  const maxT0 = Math.max(0, duration - visibleSec)
  return { t0: Math.min(Math.max(t, 0), maxT0), pxPerSec: v.pxPerSec }
}

/** Nearest candidate within SNAP_PX px of `t`; null when nothing is in range. */
export function snapTime(t: Seconds, candidates: readonly Seconds[], v: TimelineViewport): Seconds | null {
  let best: Seconds | null = null
  let bestPx = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const px = Math.abs(candidate - t) * v.pxPerSec
    if (px <= SNAP_PX && px < bestPx) {
      bestPx = px
      best = candidate
    }
  }
  return best
}

/** Loop-region shade rectangle (FR-103.6); null when no loop region. */
export function loopShade(loop: readonly [Seconds, Seconds] | null, v: TimelineViewport): { x: number; width: number } | null {
  if (loop === null) return null
  const [from, to] = loop
  return { x: timeToX(from, v), width: (to - from) * v.pxPerSec }
}

/** Tiny observable holder injected into the renderer and the controller. */
export interface ViewportState {
  get(): TimelineViewport
  set(next: TimelineViewport): void
  subscribe(listener: (v: TimelineViewport) => void): () => void
}

export function createViewportState(initial: TimelineViewport): ViewportState {
  let current: TimelineViewport = Object.freeze({ t0: initial.t0, pxPerSec: initial.pxPerSec })
  const listeners = new Set<(v: TimelineViewport) => void>()
  return {
    get: () => current,
    set: (next) => {
      current = Object.freeze({ t0: next.t0, pxPerSec: next.pxPerSec })
      // Snapshot so a listener that (un)subscribes during dispatch cannot
      // mutate the collection under iteration (subscriber-safe).
      for (const listener of [...listeners]) listener(current)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function clampZoom(pxPerSec: number): number {
  return Math.min(ZOOM_MAX_PX_PER_SEC, Math.max(ZOOM_MIN_PX_PER_SEC, pxPerSec))
}
