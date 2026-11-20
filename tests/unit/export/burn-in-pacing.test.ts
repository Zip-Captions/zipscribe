// CC-202.6/US-3.2.2 pacing (L1): ≥ 1 Hz progress while running, no
// duplicates/backwards, monotonic, final 100 % exactly once.
import { describe, expect, test } from 'vitest'
import { createProgressPacer } from '@engine/export/burn-in-pacing'

describe('burn-in progress pacer', () => {
  test('emits at most every interval while running and always the final', () => {
    let clock = 0
    const out: Array<[number, number]> = []
    const pacer = createProgressPacer(30, (p, t) => { out.push([p, t]) }, () => clock, 900)
    for (let t = 0; t <= 30; t += 0.1) {
      clock += 10 // 10 ms per 0.1 s of media → ~3 s wall over the run
      pacer.update(t)
    }
    pacer.finish()
    expect(out.length).toBeGreaterThanOrEqual(3) // 30 s / 0.9 s → ≥ 30 possible, ≥1 Hz guaranteed
    const values = out.map(([p]) => p)
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(out[out.length - 1]).toEqual([30, 30])
  })

  test('first update always emits; repeats/backwards are ignored', () => {
    let clock = 1000
    const out: number[] = []
    const pacer = createProgressPacer(10, (p) => { out.push(p) }, () => clock, 900)
    pacer.update(0.5)
    clock += 100
    pacer.update(0.4)
    pacer.update(0.5)
    expect(out).toEqual([0.5])
  })

  test('1 Hz guarantee: over a 10 s run every full second has an emission', () => {
    const emissions: number[] = []
    let clock = 0
    const pacer = createProgressPacer(10, (p) => { emissions.push(p) }, () => clock, 900)
    // a worker paced near real time: one media second per 950 ms wall
    for (let second = 0; second <= 10; second++) {
      clock += 950
      pacer.update(second)
    }
    // ≥ 1 Hz: no wall-second window goes without an emission
    for (let second = 0; second < 10; second++) {
      expect(emissions.some(v => v >= second && v < second + 1.05), `second ${second}`).toBe(true)
    }
  })

  test('finish() forces exactly one 100 % when the stream ended early', () => {
    const out: number[] = []
    const pacer = createProgressPacer(5, (p) => { out.push(p) }, () => 0, 900)
    pacer.update(4)
    pacer.finish()
    pacer.finish()
    expect(out).toEqual([4, 5])
  })
})
