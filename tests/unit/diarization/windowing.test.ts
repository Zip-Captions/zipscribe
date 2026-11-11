// CC-06.1 (L1): FR-06.2 embedding windows from VAD segments — min 0.5 s,
// max 3 s, 50 % hop on long segments — and the reuse-vs-own-pass selection
// (a forwarded `vad` wins; without it the diarizer runs its own Silero pass
// through an injected unit-05 `VadScorer`). `src/engine/diarize/windowing.ts`
// does not exist yet: every test resolves it through a DYNAMIC import and
// fails with the module-resolution error (sanctioned unit-05 RED precedent;
// frozen shapes in ./unit06-api-contract.d.ts).
//
// Gates-child run: skipped under ZIPSCRIBE_CHILD=1 (in-file guard,
// gates.test.ts:31 precedent — vitest.config.ts is builder-owned).
import { describe, expect, test } from 'vitest'
import { isChildRun } from '../../helpers/repo'
import type { PcmChunk, VadSegment } from '@engine/protocol@06'
import type { VadScorer } from '@engine/asr/vad'

const gated = isChildRun() ? describe.skip : describe

type WindowingModule = typeof import('@engine/diarize/windowing')

async function loadWindowing(): Promise<WindowingModule> {
  return (await import('@engine/diarize/windowing')) as WindowingModule
}

function seg(start: number, end: number): VadSegment {
  return { start, end }
}

const SR = 16_000
const FRAME_SEC = 512 / SR

/** Deterministic PCM: `voiced` lists of [start,end] seconds score 1, silence 0. */
function scriptedScorer(voiced: [number, number][]): VadScorer & { calls: number } {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    scoreWindow(frame: Float32Array): number {
      void frame
      const at = calls * FRAME_SEC
      calls += 1
      return voiced.some(([a, b]) => at >= a - FRAME_SEC / 2 && at < b - FRAME_SEC / 2) ? 1 : 0
    },
  }
}

async function* pcmChunks(seconds: number): AsyncIterable<PcmChunk> {
  for (let s = 0; s < seconds; s++) {
    yield { startSec: s, samples: new Float32Array(SR) }
  }
}

function assertCovered(windows: { start: number; end: number }[], segment: VadSegment): void {
  expect(windows.length, 'a speech segment always yields ≥ 1 window').toBeGreaterThan(0)
  let coveredTo = segment.start
  for (const w of windows.filter((x) => x.end > segment.start && x.start < segment.end).sort((a, b) => a.start - b.start)) {
    expect(w.start, 'window never starts before its segment').toBeGreaterThanOrEqual(segment.start - 0.001)
    expect(w.end, 'window never ends after its segment (short-segment clamp at 0 aside)').toBeLessThanOrEqual(segment.end + (segment.start < 0.5 ? 0.5 : 0.001))
    expect(w.start, 'no coverage gap').toBeLessThanOrEqual(coveredTo + 0.001)
    coveredTo = Math.max(coveredTo, w.end)
  }
  expect(coveredTo, 'the union covers the segment').toBeGreaterThanOrEqual(segment.end - 0.001)
}

gated('CC-06.1 CC-06.5 CC-06.6: FR-06.2 embeddingWindows — min/max/hop geometry (deterministic tiling)', () => {
  test('CC-06.1: the FR-06.2 constants are 0.5 s min, 3 s max, 50 % hop', async () => {
    const { EMBED_WINDOW_MIN_SEC, EMBED_WINDOW_MAX_SEC, EMBED_WINDOW_HOP_RATIO } = await loadWindowing()
    expect(EMBED_WINDOW_MIN_SEC).toBe(0.5)
    expect(EMBED_WINDOW_MAX_SEC).toBe(3)
    expect(EMBED_WINDOW_HOP_RATIO).toBe(0.5)
  })

  test('CC-06.1: a short segment (< 0.5 s) expands to the 0.5 s minimum, never dropped', async () => {
    const { embeddingWindows } = await loadWindowing()
    const [w] = embeddingWindows([seg(1.0, 1.4)])
    expect(w).toBeDefined()
    expect(w!.end - w!.start, 'minimum window length').toBeGreaterThanOrEqual(0.5 - 1e-9)
    expect(w!.start, 'window still contains the segment').toBeLessThanOrEqual(1.0)
    expect(w!.end).toBeGreaterThanOrEqual(1.4)
    const [atZero] = embeddingWindows([seg(0.0, 0.4)])
    expect(atZero!.start, 'expansion clamps at media start, never below 0').toBeGreaterThanOrEqual(0)
    expect(atZero!.end - atZero!.start).toBeGreaterThanOrEqual(0.5 - 1e-9)
  })

  test('CC-06.1: segments within [0.5, 3] s yield exactly one window equal to the segment', async () => {
    const { embeddingWindows } = await loadWindowing()
    for (const [a, b] of [
      [0.5, 1.0],
      [2.0, 4.5],
      [7.25, 10.25],
    ] as const) {
      const windows = embeddingWindows([seg(a, b)])
      expect(windows, `segment ${a}–${b} is one window`).toEqual([{ start: a, end: b }])
    }
  })

  test('CC-06.1: a long segment tiles at max length with a 50 % hop and a tail backfill', async () => {
    const { embeddingWindows } = await loadWindowing()
    const fourHalf = embeddingWindows([seg(0, 4.5)])
    for (const w of fourHalf) expect(w.end - w.start, 'every window is maxSec on long segments').toBeCloseTo(3, 9)
    expect(fourHalf.map((w) => w.start), 'stride = maxSec × hopRatio = 1.5 s (50 % hop)').toEqual([0, 1.5])
    expect(fourHalf.at(-1)!.end, 'coverage reaches the segment end').toBeCloseTo(4.5, 9)

    const four = embeddingWindows([seg(0, 4)])
    expect(four.map((w) => [w.start, w.end]), 'stride windows fully inside + [end − max, end] backfill (contract d.ts)', ).toEqual([
      [0, 3],
      [1, 4],
    ])

    const six = embeddingWindows([seg(0, 6)])
    expect(six.map((w) => [w.start, w.end])).toEqual([
      [0, 3],
      [1.5, 4.5],
      [3, 6],
    ])
  })

  test('CC-06.1: every ≥ 0.5 s segment is fully covered by in-segment windows', async () => {
    const { embeddingWindows } = await loadWindowing()
    const segments = [seg(1.0, 2.2), seg(5.0, 11.0), seg(20, 21.5)]
    const windows = embeddingWindows(segments)
    for (const segment of segments) {
      const own = windows.filter((w) => w.start >= segment.start - 1e-9 && w.end <= segment.end + 1e-9)
      expect(own.length, `segment ${segment.start}–${segment.end} has in-segment windows`).toBeGreaterThan(0)
      assertCovered(own, segment)
      for (const w of own) {
        expect(w.end - w.start, 'in range: [min, max]').toBeGreaterThanOrEqual(0.5 - 1e-9)
        expect(w.end - w.start).toBeLessThanOrEqual(3 + 1e-9)
      }
    }
  })

  test('CC-06.1 CC-06.6: empty input → []; output sorted; deterministic', async () => {
    const { embeddingWindows } = await loadWindowing()
    expect(embeddingWindows([])).toEqual([])
    const segments = [seg(8, 12), seg(0, 0.3), seg(3, 4)]
    const first = embeddingWindows(segments)
    expect(first.map((w) => w.start), 'sorted by start').toEqual([...first.map((w) => w.start)].sort((a, b) => a - b))
    expect(embeddingWindows(segments), 'pure + deterministic').toEqual(first)
  })
})

gated('CC-06.1 CC-06.6: FR-06.2 resolveEmbeddingWindows — forwarded vad reuse vs own Silero pass', () => {
  test('CC-06.1: a forwarded `vad` is reused and the scorer is never touched', async () => {
    const { resolveEmbeddingWindows } = await loadWindowing()
    const scorer = scriptedScorer([[0, 10]])
    const result = await resolveEmbeddingWindows({ vad: [seg(0.5, 2.5)], pcm: pcmChunks(10), scorer })
    expect(result.source, 'the forwarded segments win (FR-06.2)').toBe('forwarded')
    expect(scorer.calls, 'no own pass when vad is present').toBe(0)
    expect(result.windows).toEqual([{ start: 0.5, end: 2.5 }])
  })

  test('CC-06.1: without `vad` the own Silero pass runs through the injected scorer', async () => {
    const { resolveEmbeddingWindows } = await loadWindowing()
    const scorer = scriptedScorer([[0.5, 1.5]])
    const result = await resolveEmbeddingWindows({ pcm: pcmChunks(2), scorer })
    expect(result.source).toBe('own-pass')
    expect(scorer.calls, 'the stream was scored frame by frame (512-sample frames @ 16 kHz)').toBeGreaterThan(0)
    expect(result.windows.length).toBeGreaterThan(0)
    for (const w of result.windows) {
      expect(w.start, 'own-pass windows track the scripted speech region').toBeGreaterThanOrEqual(0.4)
      expect(w.end).toBeLessThanOrEqual(1.7)
    }
  })

  test('CC-06.1: a silent stream yields no windows (own pass) — no crashes on empty input', async () => {
    const { resolveEmbeddingWindows, embeddingWindows } = await loadWindowing()
    const scorer = scriptedScorer([])
    const result = await resolveEmbeddingWindows({ pcm: pcmChunks(1), scorer })
    expect(result.source).toBe('own-pass')
    expect(result.windows).toEqual([])
    expect(Array.isArray(embeddingWindows([])), 'empty segment list is a total function').toBe(true)
  })
})
