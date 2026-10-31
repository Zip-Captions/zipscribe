// Streaming min/max waveform peaks (FR-04.4 / US-1.2.4). Pure deterministic
// TypeScript: no DOM globals, no SDK imports, no randomness. `PeaksData` is
// the protocol type (unit-106's IndexedDB cache consumes the serializable
// form) — never redefined here. The exported surface is the frozen unit-04
// contract (`tests/unit/media/unit04-api-contract.d.ts`).
//
// Bucketing: absolute sample-index buckets, `bucketSamples =
// round(bucketSec × rate)` samples wide. The accumulator consumes the 16 kHz
// decode feed (`PcmChunk.samples`) in media order, so partial trailing
// buckets publish the extremes of the samples received so far. `bucketSecFor`
// guarantees ≤ `TARGET_PEAK_BUCKETS` buckets for any duration: 10-minute
// media keep the ~50 ms detail, 2-hour media widen to ~360 ms.

import type { PeaksData } from '../protocol'

/** Hard cap on the number of buckets a single media item produces. */
export const TARGET_PEAK_BUCKETS = 20_000

/** Waveform detail for media up to `TARGET_PEAK_BUCKETS × 0.05` s (≈ 16 min). */
export const DEFAULT_BUCKET_SEC = 0.05

/** The accumulator consumes the decode feed's contract rate (16 kHz mono f32). */
const FEED_SAMPLE_RATE = 16_000

export interface PeaksOptions {
  /** Absolute media seconds per bucket (~50 ms for ≤ 1000 s files); default derived so buckets ≤ `TARGET_PEAK_BUCKETS`. */
  bucketSec?: number
  /** Total media duration in seconds (`PeaksData.bucketSec` is authoritative for the UI). */
  duration?: number
}

/** Streaming min/max bundler: feed 16 kHz mono chunks, get a serializable `PeaksData`. */
export interface PeaksAccumulator {
  push(samples: Float32Array): void
  result(): PeaksData
}

function bucketSamplesFor(bucketSec: number, sampleRate: number): number {
  return Math.max(1, Math.round(bucketSec * sampleRate))
}

/**
 * Bucket width for `durationSec` such that `ceil(durationSec / bucketSec)`
 * never exceeds `TARGET_PEAK_BUCKETS`. Dividing by one fewer than the cap
 * keeps the ceiling honest under floating-point rounding.
 */
export function bucketSecFor(durationSec: number): number {
  return Math.max(DEFAULT_BUCKET_SEC, durationSec / (TARGET_PEAK_BUCKETS - 1))
}

export function createPeaksAccumulator(options: PeaksOptions = {}): PeaksAccumulator {
  const bucketSec = options.bucketSec ?? bucketSecFor(options.duration ?? 0)
  const bucketSamples = bucketSamplesFor(bucketSec, FEED_SAMPLE_RATE)
  let min = new Float32Array(0)
  let max = new Float32Array(0)
  let buckets = 0
  let written = 0

  const grow = (needed: number): void => {
    if (needed <= min.length) return
    let capacity = Math.max(16, min.length * 2)
    while (capacity < needed) capacity *= 2
    const nextMin = new Float32Array(capacity)
    const nextMax = new Float32Array(capacity)
    nextMin.set(min)
    nextMax.set(max)
    min = nextMin
    max = nextMax
  }

  return {
    push(samples: Float32Array): void {
      for (let index = 0; index < samples.length; index++) {
        const bucket = Math.floor(written / bucketSamples)
        const value = samples[index]!
        if (bucket >= buckets) {
          // The feed is contiguous, so buckets are first touched in order.
          grow(bucket + 1)
          min[bucket] = value
          max[bucket] = value
          buckets = bucket + 1
        } else {
          if (value < min[bucket]!) min[bucket] = value
          if (value > max[bucket]!) max[bucket] = value
        }
        written++
      }
    },
    result(): PeaksData {
      return { bucketSec, min: min.slice(0, buckets), max: max.slice(0, buckets) }
    },
  }
}

/** One-shot form of `createPeaksAccumulator`: buckets `samples` at `sampleRate` into `bucketSec`-wide min/max pairs. */
export function computePeaks(samples: Float32Array, options: { sampleRate: number; bucketSec?: number; duration?: number }): PeaksData {
  const bucketSec = options.bucketSec ?? bucketSecFor(options.duration ?? samples.length / options.sampleRate)
  const bucketSamples = bucketSamplesFor(bucketSec, options.sampleRate)
  const buckets = Math.ceil(samples.length / bucketSamples)
  const min = new Float32Array(buckets)
  const max = new Float32Array(buckets)
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = bucket * bucketSamples
    const end = Math.min(start + bucketSamples, samples.length)
    let bucketMin = samples[start]!
    let bucketMax = bucketMin
    for (let index = start + 1; index < end; index++) {
      const value = samples[index]!
      if (value < bucketMin) bucketMin = value
      else if (value > bucketMax) bucketMax = value
    }
    min[bucket] = bucketMin
    max[bucket] = bucketMax
  }
  return { bucketSec, min, max }
}
