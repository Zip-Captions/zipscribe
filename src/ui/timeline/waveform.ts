// Unit-103 FR-103.4 — PeaksData → zoom-aware pixel buckets + silence markers.
// Shapes frozen by tests/unit/timeline/unit103-api-contract.d.ts
// § '@ui/timeline/waveform'.
//
// The NATIVE peaks resolution is the truth: a visible-window pixel bucket
// that spans several native buckets merges them (min of mins, max of maxes —
// never an invented average); a bucket narrower than a native bucket copies
// the native value exactly (no invention when zoomed past native resolution).
// Buckets past the data end contribute nothing — an empty visible tail is an
// empty array.
//
// Pure: no React, no DOM globals, no canvas. Time bounds are quantized at
// 1e-10 (viewport.ts COORD_DECIMALS doctrine) so float accumulation on
// `t0 + i·bucketDurSec` cannot drift the bucket grid off its exact decimals.

import type { Seconds } from '../../engine/model'
import type { PeaksData } from '../../engine/protocol'
import type { TimelineViewport } from './viewport'

export interface WaveformBucket {
  t0: Seconds
  t1: Seconds
  min: number
  max: number
}

/** Default on-screen bucket width (CSS px) when the caller does not choose one. */
const DEFAULT_BUCKET_WIDTH_PX = 4

// Relative index tolerance: kills IEEE-754 boundary wobble (e.g. 3·0.01 =
// 0.030000000000000002) when mapping bucket edges onto native indices,
// without swallowing genuine sub-nanosecond overlaps.
const INDEX_EPSILON = 1e-9

const COORD_DECIMALS = 10

function quantize(value: number): number {
  if (!Number.isFinite(value)) return value
  return Number(value.toFixed(COORD_DECIMALS))
}

/**
 * Zoom-aware re-bucketing into `bucketWidthPx`-wide PIXEL buckets covering
 * the visible window [t0, t0 + widthPx/pxPerSec]: native buckets are merged
 * when a bucket spans several and split (exact copy, native resolution is
 * the truth) when zoomed past it. Empty visible tail → empty array.
 */
export function rebucketPeaks(peaks: PeaksData, v: TimelineViewport, widthPx: number, bucketWidthPx: number = DEFAULT_BUCKET_WIDTH_PX): WaveformBucket[] {
  if (!(widthPx > 0) || !(v.pxPerSec > 0) || !(peaks.bucketSec > 0) || peaks.min.length === 0) return []
  const bucketDurSec = bucketWidthPx / v.pxPerSec
  if (!(bucketDurSec > 0)) return []
  const lastNative = peaks.min.length - 1
  const visibleEnd = v.t0 + widthPx / v.pxPerSec
  const dataEnd = peaks.bucketSec * peaks.min.length
  const out: WaveformBucket[] = []
  for (let i = 0; ; i++) {
    const t0 = v.t0 + i * bucketDurSec
    const t1 = v.t0 + (i + 1) * bucketDurSec
    if (t0 >= t1) break
    // The window is the boundary; past the data end every remaining bucket
    // is empty (the visible tail) and contributes nothing.
    if (t0 >= visibleEnd - bucketDurSec * INDEX_EPSILON) break
    if (t0 >= dataEnd - peaks.bucketSec * INDEX_EPSILON) break
    const i0 = Math.max(0, Math.floor(t0 / peaks.bucketSec + INDEX_EPSILON))
    const i1 = Math.min(lastNative, Math.ceil(t1 / peaks.bucketSec - INDEX_EPSILON) - 1)
    if (i0 > i1) continue
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let n = i0; n <= i1; n++) {
      const lo = peaks.min[n] as number
      const hi = peaks.max[n] as number
      if (lo < min) min = lo
      if (hi > max) max = hi
    }
    out.push({ t0: quantize(t0), t1: quantize(t1), min, max })
  }
  return out
}

/** Maximal consecutive runs where both channels stay within ±maxAbs (FR-103.4 silence markers). */
export function silenceMarkers(peaks: PeaksData, maxAbs: number): Array<[Seconds, Seconds]> {
  const runs: Array<[Seconds, Seconds]> = []
  if (!(peaks.bucketSec > 0)) return runs
  let runStart = -1
  for (let i = 0; i < peaks.min.length; i++) {
    const silent = Math.abs(peaks.min[i] as number) <= maxAbs && Math.abs(peaks.max[i] as number) <= maxAbs
    if (silent && runStart < 0) runStart = i
    if (!silent && runStart >= 0) {
      runs.push([quantize(runStart * peaks.bucketSec), quantize(i * peaks.bucketSec)])
      runStart = -1
    }
  }
  if (runStart >= 0) runs.push([quantize(runStart * peaks.bucketSec), quantize(peaks.min.length * peaks.bucketSec)])
  return runs
}
