// CC-04.4 / US-1.2.4 (L1): streaming min/max waveform peaks (FR-04.4).
//
// Contract: `engine/audio/peaks.ts` bundles 16 kHz mono samples into min/max
// pairs ~50 ms wide, streamed incrementally while decode runs, with a bucket
// width derived from duration so a long file never exceeds 20 000 buckets,
// and a serializable `PeaksData { bucketSec, min, max }` (protocol.ts) for the
// IndexedDB cache unit-106 consumes.
import { describe, expect, test } from 'vitest'
import { bucketSecFor, computePeaks, createPeaksAccumulator, DEFAULT_BUCKET_SEC, TARGET_PEAK_BUCKETS } from '@engine/audio/peaks'
import { lcg } from './helpers/wav'

/** Deterministic signal with known per-bucket extremes: sawtooth ramps + 1.0 / −1.0 spikes. */
function signalWithKnownPeaks(): { samples: Float32Array; sampleRate: number; expected: { min: number; max: number }[] } {
  const sampleRate = 16000
  const bucketSamples = Math.round(DEFAULT_BUCKET_SEC * sampleRate)
  const buckets = 40
  const samples = new Float32Array(bucketSamples * buckets)
  const expected: { min: number; max: number }[] = []
  for (let bucket = 0; bucket < buckets; bucket++) {
    const base = bucket * bucketSamples
    for (let index = 0; index < bucketSamples; index++) {
      samples[base + index] = Math.sin((2 * Math.PI * (bucket + 1) * index) / bucketSamples) * (0.1 + bucket * 0.02)
    }
    const max = 0.1 + bucket * 0.02
    const min = -max
    samples[base + 3] = max // exact bucket max
    samples[base + bucketSamples - 3] = min // exact bucket min
    expected.push({ min, max })
  }
  return { samples, sampleRate, expected }
}

describe('CC-04.4: min/max peaks bucketing (~50 ms), serializable PeaksData', () => {
  test('CC-04.4: one-shot computePeaks reports exact min/max per ~50 ms bucket', () => {
    const { samples, sampleRate, expected } = signalWithKnownPeaks()
    const peaks = computePeaks(samples, { sampleRate, bucketSec: DEFAULT_BUCKET_SEC })
    expect(peaks.bucketSec).toBeCloseTo(DEFAULT_BUCKET_SEC, 6)
    expect(peaks.min).toBeInstanceOf(Float32Array)
    expect(peaks.max).toBeInstanceOf(Float32Array)
    expect(peaks.min.length).toBe(expected.length)
    expect(peaks.max.length).toBe(expected.length)
    expected.forEach((bucket, index) => {
      expect(peaks.max[index], `bucket ${index} max`).toBeCloseTo(bucket.max, 5)
      expect(peaks.min[index], `bucket ${index} min`).toBeCloseTo(bucket.min, 5)
    })
  })

  test('CC-04.4: default bucket width is ~50 ms (0.05 s ± 10%)', () => {
    expect(DEFAULT_BUCKET_SEC).toBeGreaterThanOrEqual(0.045)
    expect(DEFAULT_BUCKET_SEC).toBeLessThanOrEqual(0.055)
  })

  test('CC-04.4: streaming accumulator yields the same buckets as the one-shot form (decode-order chunks)', () => {
    const { samples, sampleRate, expected } = signalWithKnownPeaks()
    const accumulator = createPeaksAccumulator({ bucketSec: DEFAULT_BUCKET_SEC })
    const random = lcg(0x9e3779)
    for (let start = 0; start < samples.length; ) {
      const size = 1 + Math.floor(random() * 9000) // chunks that straddle bucket edges
      accumulator.push(samples.subarray(start, start + size))
      start += size
    }
    const peaks = accumulator.result()
    expect(peaks.min.length).toBe(expected.length)
    expected.forEach((bucket, index) => {
      expect(peaks.max[index]).toBeCloseTo(bucket.max, 5)
      expect(peaks.min[index]).toBeCloseTo(bucket.min, 5)
    })
    expect(sampleRate).toBe(16000)
  })

  test('CC-04.4: partial trailing bucket is published from the samples received so far', () => {
    const accumulator = createPeaksAccumulator({ bucketSec: 0.05 })
    accumulator.push(new Float32Array(16000 * 0.05).fill(0.25)) // exactly one bucket
    accumulator.push(new Float32Array(100).fill(-0.75)) // 10 ms of a second bucket
    const peaks = accumulator.result()
    expect(peaks.min.length).toBe(2)
    expect(peaks.max[0]).toBeCloseTo(0.25, 6)
    expect(peaks.min[1]).toBeCloseTo(-0.75, 6)
  })

  test('CC-04.4: bucket count never exceeds 20 000 for long files (120 min)', () => {
    expect(TARGET_PEAK_BUCKETS).toBe(20_000)
    const twoHours = bucketSecFor(7200)
    expect(twoHours, 'bucket width grows for long media').toBeGreaterThan(DEFAULT_BUCKET_SEC)
    expect(Math.ceil(7200 / twoHours)).toBeLessThanOrEqual(TARGET_PEAK_BUCKETS)
    // And a 10-minute file keeps the ~50 ms detail.
    expect(bucketSecFor(600)).toBeCloseTo(DEFAULT_BUCKET_SEC, 6)
    expect(Math.ceil(600 / bucketSecFor(600))).toBeLessThanOrEqual(TARGET_PEAK_BUCKETS)
  })

  test('CC-04.4: PeaksData survives structured clone unchanged (IndexedDB-cacheable)', () => {
    const { samples, sampleRate } = signalWithKnownPeaks()
    const peaks = computePeaks(samples, { sampleRate })
    const cloned = structuredClone(peaks) as typeof peaks
    expect(cloned.bucketSec).toBe(peaks.bucketSec)
    expect(Array.from(cloned.min)).toEqual(Array.from(peaks.min))
    expect(Array.from(cloned.max)).toEqual(Array.from(peaks.max))
  })

  test('CC-04.4: silence yields zero min and max (no NaN from an empty bucket)', () => {
    const peaks = computePeaks(new Float32Array(16000), { sampleRate: 16000 })
    expect(peaks.max.every((value: number) => value === 0)).toBe(true)
    expect(peaks.min.every((value: number) => value === 0)).toBe(true)
  })
})