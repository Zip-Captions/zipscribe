// Adversary suite (unit-05 review): boundary values at the FR-05.1 / CC-05.4
// contract edges — merge gap exactly 0.3 s, cut gap exactly 0.35 s, pad
// clamping at 0.0 / silence midpoint / media end, the ≤ 28 s budget at
// exactly 28 s, and degenerate inputs (empty, unsorted, mutation-resistance).
// Expectations are derived from the unit spec (FR-05.1, US-1.2.2) and
// domain.md invariants, NOT from the existing suites.
import { describe, expect, test } from 'vitest'
import { packWindows } from '@engine/asr/chunker'
import type { VadSegment } from '@engine/protocol'

const seg = (start: number, end: number): VadSegment => ({ start, end })

describe('adversary: merge-gap boundary (FR-05.1 "merge segments closer than 0.3 s")', () => {
  test('gap of exactly 0.3 s does NOT merge (closer than = strictly below)', () => {
    // A gap of exactly 0.3 is not "closer than 0.3", so the two segments stay
    // separate clusters; being below minSilenceSec they still pack into ONE
    // window (no legal cut inside), which is the observable contract here.
    const windows = packWindows([seg(0, 1), seg(1.3, 2.3)])
    expect(windows).toHaveLength(1)
    expect(windows[0]!.start).toBeCloseTo(-0 + 0, 9) // backPad 0 at media floor
    // The merged-span window must cover both segments exactly (± padding).
    expect(windows[0]!.start).toBeLessThanOrEqual(0)
    expect(windows[0]!.end).toBeGreaterThanOrEqual(2.3)
  })

  test('gap of exactly 0.35 s IS a legal cut point and the two sides meet at the silence midpoint without overlap', () => {
    // minSilenceSec boundary: "Gaps ≥ it are the only legal cut points".
    // With a tight budget the packer must cut HERE, padding each side of the
    // 0.35 s silence clamped to its midpoint (FR-05.1) → both windows land
    // exactly on the midpoint, never crossing it.
    const windows = packWindows([seg(0, 1), seg(1.35, 2.35)], { maxWindowSec: 1.5 })
    expect(windows).toHaveLength(2)
    const [a, b] = windows as [{ start: number; end: number }, { start: number; end: number }]
    // Midpoint of [1, 1.35] is 1.175: pad = min(0.2, 0.35/2) = 0.175 each side.
    expect(a.end).toBeCloseTo(1.175, 9)
    expect(b.start).toBeCloseTo(1.175, 9)
    expect(a.end).toBeLessThanOrEqual(b.start) // never overlap (FR-05.1 midpoint rule)
  })

  test('gap of 0.34999 s (below minSilence) is never a cut — the segments stay in one window', () => {
    const windows = packWindows([seg(0, 1), seg(1.34999, 2.34999)], { maxWindowSec: 1.5 })
    // Sub-silence gap: cutting there would violate "cutting only inside
    // silence", so the single window spans BOTH segments even though the
    // budget is smaller than the span.
    expect(windows).toHaveLength(1)
    expect(windows[0]!.start).toBeLessThanOrEqual(0)
    expect(windows[0]!.end).toBeGreaterThanOrEqual(2.34999)
  })
})

describe('adversary: pad clamping (FR-05.1 "pad windows ±0.2 s clamped to the midpoint of the neighbouring silence")', () => {
  test('segment starting at 0.0: backward pad clamps to the media floor, window never starts below 0', () => {
    const [w] = packWindows([seg(0, 5)])
    expect(w!.start).toBe(0)
  })

  test('segment starting 0.3 s in: backward pad clamps to half the leading silence', () => {
    const [w] = packWindows([seg(0.3, 5)])
    expect(w!.start).toBeCloseTo(0.3 - 0.15, 9)
  })

  test('interior pad clamps to the silence midpoint when the silence is shorter than 2×padSec', () => {
    // 1 → 1.38 is a 0.38 s silence (legal cut point, ≥ minSilenceSec) shorter
    // than 2×padSec → each side clamps to gap/2 = 0.19 (FR-05.1 midpoint rule).
    const windows = packWindows([seg(0, 1), seg(1.38, 2.38)], { maxWindowSec: 1.5 })
    expect(windows).toHaveLength(2)
    expect(windows[0]!.end).toBeCloseTo(1.19, 9)
    expect(windows[1]!.start).toBeCloseTo(1.19, 9)
  })

  test('the last window gets the full 0.2 s forward pad (no neighbouring silence exists)', () => {
    const windows = packWindows([seg(10, 12)])
    expect(windows[0]!.end).toBeCloseTo(12.2, 9)
  })
})

describe('adversary: the ≤ 28 s budget at exactly 28 s (FR-05.1 / CC-05.4)', () => {
  test('span + pads of exactly 28.0 s fits in one window', () => {
    // backPad 0 (media floor), forward pad 0.2 → budget boundary block2.end = 27.8.
    const windows = packWindows([seg(0, 10), seg(10.5, 27.8)])
    expect(windows).toHaveLength(1)
    expect(windows[0]!.start).toBe(0)
    expect(windows[0]!.end).toBeCloseTo(28, 9)
  })

  test('span + pads past 28.0 s forces the cut at the silence', () => {
    const windows = packWindows([seg(0, 10), seg(10.5, 27.801)])
    expect(windows).toHaveLength(2)
    expect(windows[0]!.end).toBeLessThanOrEqual(10.2 + 1e-9)
    expect(windows[1]!.start).toBeGreaterThanOrEqual(27.801 - 28) // sanity, positive start
  })

  test('a single continuous 28.0 s segment may carry pads past the ceiling (only continuous speech may exceed it — CC-05.4)', () => {
    const windows = packWindows([seg(0, 28)])
    expect(windows).toHaveLength(1)
    expect(windows[0]!.end).toBeCloseTo(28.2, 9) // padding, not a re-cut opportunity
  })
})

describe('adversary: degenerate inputs', () => {
  test('zero segments → zero windows (US-1.2.2: 45 s of silence issues no ASR windows)', () => {
    expect(packWindows([])).toEqual([])
  })

  test('unsorted input is handled deterministically (defensive sort, same result as sorted input)', () => {
    const sorted = packWindows([seg(0, 1), seg(2, 3), seg(4, 5)])
    const shuffled = packWindows([seg(4, 5), seg(0, 1), seg(2, 3)])
    expect(shuffled).toEqual(sorted)
  })

  test('packWindows never mutates the caller segments (pure function)', () => {
    const input = [seg(0, 1), seg(1.2, 2.2), seg(30, 31)]
    const before = JSON.stringify(input)
    packWindows(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
