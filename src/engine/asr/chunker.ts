// Pure VAD → ASR window packing (FR-05.1 / CC-05.4). Deterministic TypeScript:
// no SDK imports, no DOM globals, no I/O, no randomness. The exported surface
// is the frozen unit-05 contract (`tests/unit/asr/unit05-api-contract.d.ts`).
//
// Pipeline (FR-05.1): merge segments whose gap is strictly below
// `mergeGapSec` into one, then pack consecutive merged segments into windows
// of at most `maxWindowSec` — cutting only inside silence (a gap ≥
// `minSilenceSec`), so gaps in `[mergeGapSec, minSilenceSec)` stay inside the
// same window and only continuous chains (every internal gap < `minSilenceSec`)
// may exceed the ceiling. Each window is padded ± `padSec`, each side clamped
// to the midpoint of the neighbouring silence (both sides of one silence are
// clamped to the same midpoint, so windows never overlap); padding at the
// media floor is clamped so a window never starts below 0. The packing budget
// counts the padding (span + both clamped pads ≤ `maxWindowSec` whenever a
// legal cut existed).

import type { Seconds } from '../model'
import type { VadSegment } from '../protocol'

/** One ASR window: the audio range for ONE engine pipeline call. */
export interface AsrWindow {
  start: Seconds
  end: Seconds
}

export interface PackOptions {
  /** Hard window ceiling; default 28 (FR-05.1). Only continuous speech may exceed it. */
  maxWindowSec?: number
  /** Silence padding applied both sides, clamped to the midpoint of the neighbouring silence; default 0.2. */
  padSec?: number
  /** Segments closer than this merge into one (FR-05.1); default 0.3. */
  mergeGapSec?: number
  /** Below this a gap is not silence (Silero min-silence); default 0.35. Gaps ≥ it are the only legal cut points. */
  minSilenceSec?: number
}

const DEFAULT_MAX_WINDOW_SEC = 28
const DEFAULT_PAD_SEC = 0.2
const DEFAULT_MERGE_GAP_SEC = 0.3
const DEFAULT_MIN_SILENCE_SEC = 0.35

/** Float slack on the ≤ `maxWindowSec` budget (exact reals hold; see tests at 1e-9). */
const PACK_EPSILON = 1e-9

/** Merge segments closer than `mergeGapSec`; input is sorted first (defensive, deterministic). */
function mergeClusters(segments: readonly VadSegment[], mergeGapSec: number): VadSegment[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const merged: VadSegment[] = []
  for (const segment of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && segment.start - last.end < mergeGapSec) {
      last.end = Math.max(last.end, segment.end)
    } else {
      merged.push({ start: segment.start, end: segment.end })
    }
  }
  return merged
}

/** Group merged clusters into blocks joined by sub-silence gaps (the atomic, uncuttable packing units). */
function toBlocks(clusters: readonly VadSegment[], minSilenceSec: number): VadSegment[] {
  const blocks: VadSegment[] = []
  for (const cluster of clusters) {
    const last = blocks[blocks.length - 1]
    if (last !== undefined && cluster.start - last.end < minSilenceSec) {
      last.end = Math.max(last.end, cluster.end)
    } else {
      blocks.push({ start: cluster.start, end: cluster.end })
    }
  }
  return blocks
}

/**
 * Pure: VadSegment[] → packed ASR windows (FR-05.1). Merge (gap <
 * `mergeGapSec`) then pack consecutive segments into ≤ `maxWindowSec`
 * windows, cutting only inside silence (≥ `minSilenceSec` gap), padding ±
 * `padSec` clamped to the silence midpoint. Deterministic; no I/O.
 */
export function packWindows(segments: readonly VadSegment[], opts: PackOptions = {}): AsrWindow[] {
  const maxWindowSec = opts.maxWindowSec ?? DEFAULT_MAX_WINDOW_SEC
  const padSec = opts.padSec ?? DEFAULT_PAD_SEC
  const mergeGapSec = opts.mergeGapSec ?? DEFAULT_MERGE_GAP_SEC
  const minSilenceSec = opts.minSilenceSec ?? DEFAULT_MIN_SILENCE_SEC

  const blocks = toBlocks(mergeClusters(segments, mergeGapSec), minSilenceSec)
  const windows: AsrWindow[] = []

  let first = 0
  while (first < blocks.length) {
    const firstBlock = blocks[first]!
    // Backward pad: half the preceding cut silence (or the media floor at 0).
    const backPad = first === 0 ? Math.min(padSec, firstBlock.start / 2) : Math.min(padSec, (firstBlock.start - blocks[first - 1]!.end) / 2)

    // Greedy: extend while the span plus the backward pad and the worst-case
    // forward pad (`padSec` — the midpoint clamp can only shrink it) fits.
    let last = first
    while (last + 1 < blocks.length && blocks[last + 1]!.end - firstBlock.start + backPad + padSec <= maxWindowSec + PACK_EPSILON) {
      last += 1
    }

    const lastBlock = blocks[last]!
    const fwdPad = last === blocks.length - 1 ? padSec : Math.min(padSec, (blocks[last + 1]!.start - lastBlock.end) / 2)
    windows.push({ start: firstBlock.start - backPad, end: lastBlock.end + fwdPad })
    first = last + 1
  }

  return windows
}
