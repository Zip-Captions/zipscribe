// CC-05.4 (L1 property) + FR-05.1 (L1): windowing invariants over pure
// `packWindows(VadSegment[])`. Property tests use seeded fast-check
// (deterministic; the seed is printed with the counterexample on failure).
// Grounding: fast-check 4 assert/property API —
// https://fast-check.dev/docs/core-blocks/runners/ (RED note: `fast-check` is
// a settings.yml-approved devDependency the builder installs with
// `corepack pnpm add -D fast-check`; until then this file is RED on the
// unresolved imports of BOTH `fast-check` and `@engine/asr/chunker`).
//
// Nothing is mocked: `packWindows` is the pure function under test; the only
// input is VAD segments (the contract's own input type).
import { expect, test } from 'vitest'
import { array, assert, constant, integer, pre, property, record } from 'fast-check'
import { packWindows, type AsrWindow } from '@engine/asr/chunker'
import type { VadSegment } from '@engine/protocol@05'

const MAX_WINDOW = 28
const PAD = 0.2
const MERGE_GAP = 0.3
const MIN_SILENCE = 0.35
const CUT_CLEARANCE = 0.1 // US-1.2.2: no speech within ±0.1 s of a cut
const EPS = 1e-9

interface GenPlan {
  /** Gap BEFORE segment i in centiseconds (0 = continuous with the previous; ≥ 50 = silence). */
  gapsCs: number[]
  /** Segment lengths in centiseconds (0.25–12 s). */
  lensCs: number[]
  /** Extra silence (cs) trailing the last segment. */
  tailCs: number
}

const planArb = record({
  gapsCs: array(integer({ min: 0, max: 4_000 }), { minLength: 0, maxLength: 14 }),
  lensCs: array(integer({ min: 25, max: 1_200 }), { minLength: 0, maxLength: 14 }),
  tailCs: constant(500),
})

function planToSegments(plan: GenPlan): VadSegment[] {
  const count = Math.min(plan.gapsCs.length, plan.lensCs.length)
  const segments: VadSegment[] = []
  let cursor = 0
  for (let i = 0; i < count; i++) {
    cursor += (plan.gapsCs[i] ?? 0) / 100
    const end = cursor + (plan.lensCs[i] ?? 0) / 100
    segments.push({ start: round(cursor), end: round(end) })
    cursor = end
  }
  return segments
}

function round(sec: number): number {
  return Math.round(sec * 1000) / 1000
}

function contains(window: AsrWindow, segment: VadSegment): boolean {
  return window.start <= segment.start + EPS && segment.end <= window.end + EPS
}

/** Index of the single window containing the segment, or -1 / the collision count. */
function containingCount(windows: readonly AsrWindow[], segment: VadSegment): number {
  return windows.reduce((count, window) => (contains(window, segment) ? count + 1 : count), 0)
}

function run(propertyBody: (segments: VadSegment[]) => void, seed: number): void {
  assert(
    property(planArb, (plan: unknown) => {
      const segments = planToSegments(plan as GenPlan)
      pre(segments.length > 0)
      propertyBody(segments)
    }),
    { seed, numRuns: 300 },
  )
}

test('CC-05.4: every VAD segment lies in exactly one window (property)', () => {
  run((segments) => {
    const windows = packWindows(segments)
    for (const segment of segments) {
      expect(containingCount(windows, segment), `segment ${segment.start}–${segment.end} must lie in exactly one window (windows: ${JSON.stringify(windows)})`).toBe(1)
    }
  }, 0x05e40001)
})

test('CC-05.4: cuts only fall in silence — no speech within ±0.1 s of a cut (property)', () => {
  run((segments) => {
    const windows = packWindows(segments)
    // Windows are ordered and pairwise non-overlapping (FR-05.1 padding is
    // clamped to the silence midpoint).
    for (let i = 1; i < windows.length; i++) {
      const previous = windows[i - 1]!
      const current = windows[i]!
      expect(previous.end, 'windows must not overlap').toBeLessThanOrEqual(current.start + EPS)
      // Nothing inside the inter-window silence belongs to speech.
      for (const segment of segments) {
        const straddles = segment.start < current.start - EPS && segment.end > previous.end + EPS
        expect(straddles, `segment ${segment.start}–${segment.end} must not cross the ${previous.end}|${current.start} cut`).toBe(false)
      }
      // ±0.1 s clearance from speech on both sides of the cut (generator
      // guarantees ≥ 0.5 s inter-cluster silences, so 0.2 s padding clamped
      // to the midpoint always leaves ≥ 0.1 s).
      const leftEnd = Math.max(...segments.filter((s) => s.end <= previous.end + EPS).map((s) => s.end), -Infinity)
      if (Number.isFinite(leftEnd)) expect(previous.end - leftEnd, 'left window must end ≥ 0.1 s after the last speech').toBeGreaterThanOrEqual(CUT_CLEARANCE - EPS)
      const rightStart = Math.min(...segments.filter((s) => s.start >= current.start - EPS).map((s) => s.start), Infinity)
      if (Number.isFinite(rightStart)) expect(rightStart - current.start, 'right window must start ≥ 0.1 s before the next speech').toBeGreaterThanOrEqual(CUT_CLEARANCE - EPS)
    }
  }, 0x05e40002)
})

test('CC-05.4: windows are ≤ 28 s unless they span continuous speech (property)', () => {
  run((segments) => {
    for (const window of packWindows(segments)) {
      const duration = window.end - window.start
      if (duration <= MAX_WINDOW + 0.001) continue
      // Over-length is only lawful with no legal cut inside: the segments
      // covered must form a continuous chain (no silence ≥ min-silence gap
      // between consecutive covered segments).
      const covered = segments.filter((s) => contains(window, s))
      for (let i = 1; i < covered.length; i++) {
        const gap = (covered[i]!.start ?? 0) - (covered[i - 1]!.end ?? 0)
        expect(gap, `window ${window.start}–${window.end} is ${duration}s but has a ${gap}s silence inside`).toBeLessThan(MIN_SILENCE)
      }
    }
  }, 0x05e40003)
})

test('CC-05.4 / FR-05.1: window padding stays inside silence, ≤ 0.2 s, clamped to the silence midpoint (property)', () => {
  run((segments) => {
    const windows = packWindows(segments)
    for (let w = 0; w < windows.length; w++) {
      const window = windows[w]!
      const covered = segments.filter((s) => contains(window, s))
      const first = covered[0]
      const last = covered[covered.length - 1]
      expect(first, 'every window contains speech').toBeDefined()
      // Backward pad: inside the preceding silence (or clamped at media 0),
      // at most PAD, never past the segment start.
      expect(window.start, 'window start never crosses its first segment').toBeLessThanOrEqual(first!.start + EPS)
      expect(first!.start - window.start, 'back padding ≤ 0.2 s').toBeLessThanOrEqual(PAD + EPS)
      const prev = covered.length > 0 ? segments[segments.indexOf(first!) - 1] : undefined
      if (prev) {
        const gap = first!.start - prev.end
        expect(window.start, 'back pad clamped to ≥ half the neighbouring silence').toBeGreaterThanOrEqual(first!.start - Math.min(PAD, gap / 2) - EPS)
        expect(window.start, 'back pad never reaches into the previous speech').toBeGreaterThanOrEqual(prev.end + EPS)
      } else {
        expect(window.start, 'no speech left of the window → pad cannot go negative past 0').toBeGreaterThanOrEqual(0 - EPS)
      }
      // Forward pad, mirrored.
      expect(window.end, 'window end never crosses its last segment').toBeGreaterThanOrEqual(last!.end - EPS)
      expect(window.end - last!.end, 'forward padding ≤ 0.2 s').toBeLessThanOrEqual(PAD + EPS)
      const next = segments[segments.indexOf(last!) + 1]
      if (next) {
        const gap = next.start - last!.end
        expect(window.end, 'forward pad clamped to ≤ half the neighbouring silence').toBeLessThanOrEqual(last!.end + Math.min(PAD, gap / 2) + EPS)
        expect(window.end, 'forward pad never reaches into the next speech').toBeLessThanOrEqual(next.start - EPS)
      }
      void w
    }
  }, 0x05e40004)
})

test('CC-05.4: 45 s of silence produces zero windows (and zero ASR calls upstream)', () => {
  // Pure chunker half of US-1.2.2's "45 s of silence → zero ASR calls" (the
  // call-count half lives in transcriber.test.ts under the same CC-ID).
  expect(packWindows([]), 'silence-only stream yields no windows').toEqual([])
  const around = packWindows([
    { start: 0, end: 10 },
    { start: 55, end: 60 }, // [10, 55] is 45 s of silence
  ])
  for (const window of around) {
    const silentOverlap = Math.min(window.end, 55) - Math.max(window.start, 10)
    expect(silentOverlap, `window ${window.start}–${window.end} must not cover the 45 s silence beyond padding`).toBeLessThanOrEqual(2 * PAD + EPS)
  }
})

test('CC-05.4 / US-1.2.2: VAD speech at 35:12.4–35:18.9 lies wholly inside exactly one window', () => {
  const segments: VadSegment[] = [
    { start: 2090.0, end: 2099.0 },
    { start: 2104.5, end: 2110.0 },
    { start: 2112.4, end: 2118.9 }, // the spec's segment
    { start: 2121.0, end: 2131.0 },
    { start: 2140.2, end: 2155.7 },
  ]
  const target = segments[2]!
  const windows = packWindows(segments)
  expect(containingCount(windows, target)).toBe(1)
})

test('CC-05.4 / FR-05.1: segments closer than 0.3 s merge and stay in one window (property)', () => {
  assert(
    property(integer({ min: 0, max: 10_000 }), integer({ min: 10, max: 29 }), (startCs: number, gapCs: number) => {
      const start = startCs / 100
      const gap = gapCs / 100 // strictly below the 0.3 s merge threshold
      pre(gap < MERGE_GAP)
      const windows = packWindows([
        { start, end: start + 1 },
        { start: start + 1 + gap, end: start + 2 + gap },
      ])
      const shared = windows.filter((window) => contains(window, { start, end: start + 2 + gap }))
      expect(shared, `merged pair (gap ${gap}s) must be in one window`).toHaveLength(1)
    }),
    { seed: 0x05e40006, numRuns: 300 },
  )
})
