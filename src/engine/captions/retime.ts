// CC-07.4 / US-07.4 (FR-07.4): whole-track retiming — `retimeAll` maps every
// block AND word time t → anchor + (t − anchor) × scale + offset, clamped
// into [0, asset.duration]; `solveRetime` derives (scale, offset) from two
// editor-picked (sourceTime, correctTime) points. Pure: the input project is
// never mutated (a new project is returned; the one-undo-step command wiring
// is unit-101's). No DOM/React/SDK surface (engine-purity).

import type { Project } from '../model'

export interface RetimeOptions {
  offsetSec?: number
  scale?: number
  anchorSec?: number
}

export interface RetimeSolution {
  anchorSec: number
  scale: number
  offsetSec: number
}

/** Domain invariant 6 quantization, then the media clamp [0, duration]. */
function mapTime(t: number, anchor: number, scale: number, offset: number, duration: number): number {
  const mapped = anchor + (t - anchor) * scale + offset
  const rounded = Math.round(mapped * 1000) / 1000
  const clamped = rounded < 0 ? 0 : rounded > duration ? duration : rounded
  return clamped === 0 ? 0 : clamped
}

/**
 * US-07.4: offset fixes constant sync drift, scale fixes frame-rate drift
 * (e.g. 23.976 → 25 fps) about `anchorSec`. Defaults are the identity
 * (offset 0, scale 1, anchor 0). A scale < 0 map is strictly decreasing, and
 * clamping cannot restore `start ≤ end` — it is repaired to the nearest
 * monotone map (0: the documented degenerate collapse onto anchor + offset),
 * so the result always satisfies domain invariant 1. `solveRetime` still
 * reports the raw solved scale (a reversed two-point pick is visible there;
 * the contract reserves TypeError for the degenerate solve only).
 */
export function retimeAll(project: Project, opts: RetimeOptions = {}): Project {
  const offset = opts.offsetSec ?? 0
  const scale = Math.max(0, opts.scale ?? 1)
  const anchor = opts.anchorSec ?? 0
  const duration = project.asset.duration
  const map = (t: number): number => mapTime(t, anchor, scale, offset, duration)
  return {
    ...project,
    blocks: project.blocks.map((block) => ({
      ...block,
      start: map(block.start),
      end: map(block.end),
      words: block.words.map((word) => ({ ...word, start: map(word.start), end: map(word.end) })),
    })),
  }
}

/**
 * Two-point sync: the editor types (fromA → toA) and (fromB → toB); the
 * solved map retimeAll(..., solution) hits both exactly (anchor 0).
 * Degenerate (identical source times) → TypeError — codes/numbers only in
 * the message (SECURITY-03).
 */
export function solveRetime(fromA: number, toA: number, fromB: number, toB: number): RetimeSolution {
  if (fromA === fromB) throw new TypeError(`solveRetime: degenerate two-point solve (both source times are ${fromA})`)
  const scale = (toB - toA) / (fromB - fromA)
  const offsetSec = toA - fromA * scale
  return { anchorSec: 0, scale, offsetSec }
}
