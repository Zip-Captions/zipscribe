// L1 coverage for the peaks surface the frozen CC-04.4 suite pins at the
// contract level: one-shot extremes, streaming/bucket-edge equivalence,
// partial trailing buckets, the silence and clone invariants, and option
// derivation. (unit-03 precedent for source-adjacent tests; supports the
// per-file coverage gate on `src/engine/**` for child runs that exclude
// `tests/unit/audio/**`.)
import { describe, expect, test } from 'vitest'
import { bucketSecFor, computePeaks, createPeaksAccumulator, DEFAULT_BUCKET_SEC, TARGET_PEAK_BUCKETS } from './peaks'

const RATE = 16_000

/** Per-bucket square wave of amplitude `0.2 + 0.02·bucket` with an off-centre positive tilt. */
function knownSignal(buckets: number): { samples: Float32Array; expected: { min: number; max: number }[] } {
  const bucketSamples = Math.round(DEFAULT_BUCKET_SEC * RATE)
  const samples = new Float32Array(bucketSamples * buckets)
  const expected: { min: number; max: number }[] = []
  for (let bucket = 0; bucket < buckets; bucket++) {
    const max = 0.2 + bucket * 0.02
    const base = bucket * bucketSamples
    for (let index = 0; index < bucketSamples; index++) samples[base + index] = index % 7 === 0 ? max : -max * 0.5
    expected.push({ min: -max * 0.5, max })
  }
  return { samples, expected }
}

describe('peaks: one-shot bucketing (FR-04.4)', () => {
  test('computePeaks reports exact per-bucket extremes with absolute-index buckets', () => {
    const { samples, expected } = knownSignal(24)
    const peaks = computePeaks(samples, { sampleRate: RATE, bucketSec: DEFAULT_BUCKET_SEC })
    expect(peaks.bucketSec).toBe(DEFAULT_BUCKET_SEC)
    expect(peaks.min.length).toBe(24)
    expected.forEach((bucket, index) => {
      expect(peaks.max[index]).toBeCloseTo(bucket.max, 6)
      expect(peaks.min[index]).toBeCloseTo(bucket.min, 6)
    })
  })

  test('a ragged tail forms one partial bucket; silence yields zeros, never NaN', () => {
    const peaks = computePeaks(new Float32Array(Math.round(RATE * 0.05) + 13), { sampleRate: RATE })
    expect(peaks.min.length).toBe(2)
    expect(peaks.max[1]).toBe(0)
    expect(peaks.min[1]).toBe(0)
    expect(Number.isNaN(peaks.min[0])).toBe(false)
  })

  test('bucketSec defaults to the duration-derived width when not supplied', () => {
    const short = computePeaks(new Float32Array(RATE * 60), { sampleRate: RATE }) // 60 s
    expect(short.bucketSec).toBeCloseTo(DEFAULT_BUCKET_SEC, 6)
    const long = computePeaks(new Float32Array(RATE * 60), { sampleRate: RATE, duration: 4000 }) // 1 min of feed, 66+ min media
    expect(long.bucketSec).toBeGreaterThan(DEFAULT_BUCKET_SEC)
    expect(long.min.length).toBe(Math.ceil((RATE * 60) / Math.round(long.bucketSec * RATE)))
  })
})

describe('peaks: streaming accumulator (US-1.2.4)', () => {
  test('straddling chunk sizes yield the same buckets as the one-shot form', () => {
    const { samples } = knownSignal(30)
    const oneShot = computePeaks(samples, { sampleRate: RATE, bucketSec: DEFAULT_BUCKET_SEC })
    const accumulator = createPeaksAccumulator({ bucketSec: DEFAULT_BUCKET_SEC })
    for (let start = 0; start < samples.length; start += 997) accumulator.push(samples.subarray(start, start + 997))
    const streamed = accumulator.result()
    expect(Array.from(streamed.min)).toEqual(Array.from(oneShot.min))
    expect(Array.from(streamed.max)).toEqual(Array.from(oneShot.max))
  })

  test('a partial trailing bucket publishes the extremes seen so far; result() is a snapshot', () => {
    const accumulator = createPeaksAccumulator({ bucketSec: 0.05 })
    accumulator.push(new Float32Array(800).fill(0.6))
    accumulator.push(new Float32Array(50).fill(-0.2))
    const peaks = accumulator.result()
    expect(peaks.min.length).toBe(2)
    expect(peaks.max[1]).toBeCloseTo(-0.2, 6)
    peaks.max[0] = 999 // mutating the snapshot must not disturb the accumulator
    expect(accumulator.result().max[0]).toBeCloseTo(0.6, 6)
  })

  test('accumulator with no options buckets at the ~50 ms default', () => {
    const accumulator = createPeaksAccumulator()
    accumulator.push(new Float32Array(RATE).fill(0.4)) // 1 s of 16 kHz feed
    const peaks = accumulator.result()
    expect(peaks.bucketSec).toBeCloseTo(DEFAULT_BUCKET_SEC, 6)
    expect(peaks.min.length).toBe(20)
    expect(peaks.max[19]).toBeCloseTo(0.4, 6)
  })

  test('accumulator with only a duration widens to honour the 20 000-bucket cap', () => {
    const bucketSec = createPeaksAccumulator({ duration: 7200 }).result().bucketSec
    expect(bucketSec).toBeGreaterThan(DEFAULT_BUCKET_SEC)
    expect(Math.ceil(7200 / bucketSec)).toBeLessThanOrEqual(TARGET_PEAK_BUCKETS)
  })
})

describe('peaks: bucketSecFor (≤ 20 000 buckets for any duration)', () => {
  test('keeps ~50 ms detail up to the cap and widens beyond it', () => {
    expect(bucketSecFor(600)).toBe(DEFAULT_BUCKET_SEC)
    expect(bucketSecFor(0)).toBe(DEFAULT_BUCKET_SEC)
    const twoHours = bucketSecFor(7200)
    expect(twoHours).toBeGreaterThan(DEFAULT_BUCKET_SEC)
    expect(Math.ceil(7200 / twoHours)).toBeLessThanOrEqual(TARGET_PEAK_BUCKETS)
    expect(bucketSecFor(7201)).toBeGreaterThanOrEqual(twoHours)
  })
})
