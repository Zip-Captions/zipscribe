// Adversary suite (unit-05 review): VAD thresholding at the exact FR-05.1
// boundaries (threshold 0.5 inclusive, min-speech 0.25 s, min-silence 0.35 s)
// including settable window sizes whose frame length divides the boundary
// exactly, an empty stream, and the US-1.2.2 "45 s of silence → zero ASR
// calls" premise checked end-to-end through runVad → packWindows.
import { describe, expect, test } from 'vitest'
import { runVad, segmentsFromProbabilities, VAD_WINDOW_SAMPLES } from '@engine/asr/vad'
import { packWindows } from '@engine/asr/chunker'
import type { PcmChunk } from '@engine/protocol'

const FRAME_SEC_DEFAULT = VAD_WINDOW_SAMPLES / 16_000 // 0.032
const DEFAULTS = { threshold: 0.5, minSpeechSec: 0.25, minSilenceSec: 0.35 }

function probs(total: number, speech: readonly number[]): number[] {
  const set = new Set(speech)
  return Array.from({ length: total }, (_, i) => (set.has(i) ? 0.9 : 0.05))
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => from + i)
}

async function* chunksFrom(samplesPerChunk: number, chunks: number): AsyncGenerator<PcmChunk> {
  for (let c = 0; c < chunks; c++) {
    await Promise.resolve()
    yield { startSec: (c * samplesPerChunk) / 16_000, samples: new Float32Array(samplesPerChunk) }
  }
}

describe('adversary: threshold boundary (FR-05.1 speech threshold 0.5)', () => {
  test('a score of exactly 0.5 counts as speech (threshold inclusive)', () => {
    const p = Array.from({ length: 20 }, (_, i) => (i >= 5 && i <= 12 ? 0.5 : 0.4999))
    const segments = segmentsFromProbabilities(p, FRAME_SEC_DEFAULT, DEFAULTS)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.start).toBeCloseTo(5 * FRAME_SEC_DEFAULT, 9)
    expect(segments[0]!.end).toBeCloseTo(13 * FRAME_SEC_DEFAULT, 9)
  })

  test('a score just below 0.5 never opens a run', () => {
    const p = Array.from({ length: 20 }, () => 0.49999999)
    expect(segmentsFromProbabilities(p, FRAME_SEC_DEFAULT, DEFAULTS)).toEqual([])
  })
})

describe('adversary: min-speech 0.25 s boundary', () => {
  test('a run of exactly 0.25 s (5 frames at a settable 800-sample window) is kept — silence of exactly minSilence closes it', () => {
    // frameSec = 800/16000 = 0.05: 5 speech frames = 0.25 s exactly,
    // 7 silence frames = 0.35 s exactly — both spec boundaries land on exact
    // multiples and must commit per FR-05.1 (min-speech/min-silence are
    // lower bounds: "≥").
    const p = probs(12, range(0, 5))
    const segments = segmentsFromProbabilities(p, 0.05, DEFAULTS)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.start).toBe(0)
    expect(segments[0]!.end).toBeCloseTo(0.25, 9)
  })

  test('a run one frame under min-speech is discarded', () => {
    const p = probs(12, range(0, 4))
    expect(segmentsFromProbabilities(p, 0.05, DEFAULTS)).toEqual([])
  })
})

describe('adversary: min-silence 0.35 s boundary', () => {
  test('silence of exactly 7 frames at frameSec 0.05 (= exactly 0.35 s) CLOSES the segment', () => {
    const p = probs(20, [...range(0, 8), ...range(15, 20)])
    const segments = segmentsFromProbabilities(p, 0.05, DEFAULTS)
    expect(segments).toHaveLength(2)
  })

  test('silence of 6 frames (0.30 s < 0.35) bridges the two runs into one segment', () => {
    const p = probs(20, [...range(0, 8), ...range(14, 20)])
    const segments = segmentsFromProbabilities(p, 0.05, DEFAULTS)
    expect(segments).toHaveLength(1)
  })

  test('default 512-sample window: 11 silence frames (0.352 s) close, 10 (0.32 s) bridge', () => {
    const close = segmentsFromProbabilities(probs(27, [...range(0, 8), ...range(19, 27)]), FRAME_SEC_DEFAULT, DEFAULTS)
    expect(close).toHaveLength(2)
    const bridge = segmentsFromProbabilities(probs(26, [...range(0, 8), ...range(18, 26)]), FRAME_SEC_DEFAULT, DEFAULTS)
    expect(bridge).toHaveLength(1)
  })
})

describe('adversary: empty/absent input', () => {
  test('empty PCM stream → zero segments', async () => {
    const scorer = { scoreWindow: () => 0.9 }
    const segments = await runVad({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined as never }) }) }, scorer)
    expect(segments).toEqual([])
  })

  test('45 s of silence yields zero segments AND zero windows (US-1.2.2 premise: zero ASR calls)', async () => {
    const scorer = { scoreWindow: () => 0.02 }
    const segments = await runVad(chunksFrom(16_000, 45), scorer)
    expect(segments).toEqual([])
    expect(packWindows(segments)).toEqual([])
  })
})
