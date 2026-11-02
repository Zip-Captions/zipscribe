// CC-05.4 / FR-05.1 (L1): the pure Silero thresholding/hangover logic over
// injected scorer output — `segmentsFromProbabilities` (state machine) and
// `runVad` (512-sample framing through the `VadScorer` DI seam). Every
// assertion derives from the unit spec (FR-05.1 defaults: 512-sample window,
// threshold 0.5, min-speech 0.25 s, min-silence 0.35 s — defaults settable)
// and the stream invariants (protocol.ts PcmChunk: contiguous 16 kHz mono f32
// batches; US-1.2.2: every speech region reaches exactly one ASR window).
// The ONNX session is the injected boundary — nothing under test is mocked.
import { expect, test } from 'vitest'
import {
  DEFAULT_MIN_SPEECH_SEC,
  DEFAULT_MIN_SILENCE_SEC,
  DEFAULT_VAD_THRESHOLD,
  VAD_SAMPLE_RATE,
  VAD_WINDOW_SAMPLES,
  runVad,
  segmentsFromProbabilities,
  type VadScorer,
} from '@engine/asr/vad'
import type { PcmChunk, VadSegment } from '@engine/protocol@05'

const EPS = 1e-9
/** FR-05.1 frame time at the contract rate: 512 samples / 16 kHz. */
const FRAME_SEC = VAD_WINDOW_SAMPLES / VAD_SAMPLE_RATE // 0.032 s

const SPEECH = 0.9
const SILENCE = 0.1

function probs(speechFrames: number, silenceFrames: number): number[] {
  return [...Array.from({ length: speechFrames }, () => SPEECH), ...Array.from({ length: silenceFrames }, () => SILENCE)]
}

const DEFAULTS = { threshold: DEFAULT_VAD_THRESHOLD, minSpeechSec: DEFAULT_MIN_SPEECH_SEC, minSilenceSec: DEFAULT_MIN_SILENCE_SEC }

/** Deterministic filler samples (no transcript content, SECURITY-03 safe). */
function fillerSample(globalIndex: number): number {
  return (globalIndex % 251) / 251
}

function samples(totalSamples: number): Float32Array {
  const out = new Float32Array(totalSamples)
  for (let i = 0; i < out.length; i++) out[i] = fillerSample(i)
  return out
}

/** The PCM stream in `chunkSamples`-sized PcmChunk batches (contiguous). */
async function* pcm(totalSamples: number, chunkSamples: number, emptyEvery = 0): AsyncGenerator<PcmChunk> {
  const data = samples(totalSamples)
  let produced = 0
  for (let at = 0; at < totalSamples; at += chunkSamples) {
    yield { startSec: at / VAD_SAMPLE_RATE, samples: data.slice(at, at + chunkSamples) }
    produced += 1
    if (emptyEvery > 0 && produced % emptyEvery === 0) yield { startSec: (at + chunkSamples) / VAD_SAMPLE_RATE, samples: new Float32Array(0) }
  }
}

interface ScriptedScorer {
  scorer: VadScorer
  frameLengths: number[]
  orderViolations: number
  calls: number
}

/**
 * Boundary fake for the `VadScorer` DI seam (FR-05.1 "the ONNX session is
 * INJECTED"): replays a scripted probability sequence and verifies each frame
 * it receives is the expected 512-sample slice of the stream at the expected
 * stream offset (frame order + content, observable at the seam).
 * Returns `number` on even calls and `Promise<number>` on odd calls — the
 * declared public contract is `number | Promise<number>`.
 */
function scriptedScorer(probabilities: readonly number[]): ScriptedScorer {
  const frameLengths: number[] = []
  let orderViolations = 0
  let calls = 0
  const scorer: VadScorer = {
    scoreWindow(frame: Float32Array): number | Promise<number> {
      const frameIndex = calls
      frameLengths.push(frame.length)
      for (let j = 0; j < frame.length; j++) {
        if (frame[j] !== Math.fround(fillerSample(frameIndex * frame.length + j))) orderViolations += 1
      }
      const p = probabilities[frameIndex] ?? 0
      calls += 1
      return frameIndex % 2 === 0 ? p : Promise.resolve(p)
    },
  }
  return { scorer, frameLengths, get orderViolations() { return orderViolations }, get calls() { return calls } }
}

async function runScripted(probabilities: readonly number[], opts = {}, chunkSamples = 1024): Promise<VadSegment[]> {
  const scripted = scriptedScorer(probabilities)
  const segments = await runVad(pcm(probabilities.length * VAD_WINDOW_SAMPLES, chunkSamples), scripted.scorer, opts)
  return segments
}

// --- FR-05.1 defaults (spec-named constants) --------------------------------

test('CC-05.4 / FR-05.1: Silero defaults are the spec values — 512-sample window at 16 kHz, threshold 0.5, min-speech 0.25 s, min-silence 0.35 s', () => {
  expect(VAD_SAMPLE_RATE).toBe(16_000)
  expect(VAD_WINDOW_SAMPLES).toBe(512)
  expect(DEFAULT_VAD_THRESHOLD).toBe(0.5)
  expect(DEFAULT_MIN_SPEECH_SEC).toBe(0.25)
  expect(DEFAULT_MIN_SILENCE_SEC).toBe(0.35)
})

// --- segmentsFromProbabilities: pure hangover state machine ------------------

test('CC-05.4 / FR-05.1: speech reaching min-speech is kept as one segment, closed by min-silence', () => {
  // 8 frames = 0.256 s ≥ 0.25 s; 12 silence frames = 0.384 s ≥ 0.35 s closes it.
  const segments = segmentsFromProbabilities(probs(8, 12), FRAME_SEC, DEFAULTS)
  expect(segments).toHaveLength(1)
  expect(segments[0]!.start).toBeCloseTo(0, 9)
  expect(segments[0]!.end, 'ends at the last above-threshold frame').toBeCloseTo(8 * FRAME_SEC, 9)
})

test('CC-05.4 / FR-05.1: a speech run shorter than min-speech (0.25 s) is discarded, not segmented', () => {
  // 6 frames = 0.192 s < 0.25 s; the silence after it is long enough to close.
  const segments = segmentsFromProbabilities(probs(6, 20), FRAME_SEC, DEFAULTS)
  expect(segments, 'sub-min-speech run never becomes a segment').toEqual([])
})

test('CC-05.4 / FR-05.1: silence shorter than min-silence (0.35 s) does NOT split — the run is bridged into one segment', () => {
  // Gap of 9 frames = 0.288 s < 0.35 s between two speech runs.
  const sequence = [...probs(10, 0), ...Array.from({ length: 9 }, () => SILENCE), ...probs(10, 12)]
  const segments = segmentsFromProbabilities(sequence, FRAME_SEC, DEFAULTS)
  expect(segments, 'the sub-min-silence gap bridges').toHaveLength(1)
  expect(segments[0]!.start).toBeCloseTo(0, 9)
  expect(segments[0]!.end).toBeCloseTo(29 * FRAME_SEC, 9) // last above-threshold frame end
})

test('CC-05.4 / FR-05.1: silence of at least min-silence closes a segment — two runs yield two segments', () => {
  // Gap of 11 frames = 0.352 s ≥ 0.35 s.
  const sequence = [...probs(10, 0), ...Array.from({ length: 11 }, () => SILENCE), ...probs(10, 12)]
  const segments = segmentsFromProbabilities(sequence, FRAME_SEC, DEFAULTS)
  expect(segments).toHaveLength(2)
  expect(segments[0]!.start).toBeCloseTo(0, 9)
  expect(segments[0]!.end).toBeCloseTo(10 * FRAME_SEC, 9)
  expect(segments[1]!.start).toBeCloseTo(21 * FRAME_SEC, 9)
  expect(segments[1]!.end).toBeCloseTo(31 * FRAME_SEC, 9)
})

test('CC-05.4 / US-1.2.2: an open speech run at stream end is flushed — the final utterance must reach the window packer', () => {
  // Trailing run of 10 frames = 0.32 s ≥ 0.25 s with NO following silence.
  // Dropping it would leave the media's last utterance in no ASR window
  // (US-1.2.2: every VAD segment lies in exactly one window).
  const segments = segmentsFromProbabilities(probs(10, 0), FRAME_SEC, DEFAULTS)
  expect(segments).toHaveLength(1)
  expect(segments[0]!.end).toBeCloseTo(10 * FRAME_SEC, 9)

  const tooShort = segmentsFromProbabilities(probs(5, 0), FRAME_SEC, DEFAULTS)
  expect(tooShort, 'an open run below min-speech stays discarded').toEqual([])
})

test('FR-05.1 / CC-05.4: thresholding is deterministic — the same probability sequence yields identical segments (seeded)', () => {
  // Seeded LCG (printed on failure per conventions § Hermetic): no Math.random.
  const seed = 0x5eed
  let state = seed
  const lcg = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x1_0000_0000)
  const sequence = Array.from({ length: 200 }, lcg)
  expect(sequence.some((p) => p >= 0.5) && sequence.some((p) => p < 0.5), `seed ${seed.toString(16)}: sequence spans the threshold`).toBe(true)
  const first = segmentsFromProbabilities(sequence, FRAME_SEC, DEFAULTS)
  state = seed // re-seed: identical input sequence
  const second = segmentsFromProbabilities(Array.from({ length: 200 }, lcg), FRAME_SEC, DEFAULTS)
  expect(second, 'pure function of the probability sequence').toEqual(first)
})

test('FR-05.1: segmentsFromProbabilities rejects a non-positive frame length', () => {
  expect(() => segmentsFromProbabilities([0.9], 0, DEFAULTS)).toThrow()
})

// --- runVad: 512-sample framing + thresholding over the injected scorer ------

test('FR-05.1: runVad scores the stream in contiguous 512-sample frames through the injected scorer', async () => {
  const probabilities = [...probs(8, 32)]
  const scripted = scriptedScorer(probabilities)
  const segments = await runVad(pcm(probabilities.length * VAD_WINDOW_SAMPLES, 1500), scripted.scorer) // 1500-sample chunks: non-multiple of 512
  expect(scripted.calls, 'one score per full 512-sample frame').toBe(probabilities.length)
  expect([...new Set(scripted.frameLengths)], 'every frame is exactly 512 samples').toEqual([VAD_WINDOW_SAMPLES])
  expect(scripted.orderViolations, 'frames are the contiguous stream slices, in order').toBe(0)
  expect(segments).toHaveLength(1)
  expect(segments[0]!.start).toBeCloseTo(0, 9)
  expect(segments[0]!.end, 'the 8 speech frames (0.256 s) commit at min-silence').toBeCloseTo(8 * FRAME_SEC, 9)
})

test('FR-05.1: VAD output depends on the samples only, never on PcmChunk batching (empty chunks contribute nothing)', async () => {
  const probabilities = [...probs(10, 12)]
  const single = await runScripted(probabilities, {}, probabilities.length * VAD_WINDOW_SAMPLES)
  const tiny = await runScripted(probabilities, {}, 512)
  const uneven = await runScripted(probabilities, {}, 1500)
  const withEmpty = await runVad(pcm(probabilities.length * VAD_WINDOW_SAMPLES, 1000, 2), scriptedScorer(probabilities).scorer)
  expect(tiny).toEqual(single)
  expect(uneven, 'chunk boundaries must not move a segment edge').toEqual(single)
  expect(withEmpty, 'a zero-sample PcmChunk adds no frames and changes nothing').toEqual(single)
})

test('FR-05.1: explicit options matching the spec defaults reproduce the default run exactly', async () => {
  const probabilities = [...probs(10, 12)]
  const byDefault = await runScripted(probabilities)
  const explicit = await runScripted(probabilities, { sampleRate: 16_000, windowSamples: 512, threshold: 0.5, minSpeechSec: 0.25, minSilenceSec: 0.35 })
  expect(explicit).toEqual(byDefault)
})

// --- FR-05.1 "defaults settable" ---------------------------------------------

test('FR-05.1 (defaults settable): the threshold param retunes what counts as speech', async () => {
  const probabilities = [...Array.from({ length: 10 }, () => 0.6), ...Array.from({ length: 12 }, () => 0.4)]
  const kept = await runScripted(probabilities)
  expect(kept, 'p=0.6 is speech at the 0.5 default').toHaveLength(1)
  const rejected = await runScripted(probabilities, { threshold: 0.7 })
  expect(rejected, 'p=0.6 < 0.7 is silence when the threshold is raised').toEqual([])
})

test('FR-05.1 (defaults settable): minSpeechSec retunes the short-run rejection', async () => {
  const probabilities = [...probs(10, 12)] // run of 0.32 s
  expect(await runScripted(probabilities), 'kept at the 0.25 s default').toHaveLength(1)
  expect(await runScripted(probabilities, { minSpeechSec: 0.5 }), 'dropped at a 0.5 s minimum').toEqual([])
})

test('FR-05.1 (defaults settable): minSilenceSec retunes where a segment splits', async () => {
  // Gap of 9 frames = 0.288 s: bridges at the 0.35 s default, splits at 0.2.
  const sequence = [...probs(10, 0), ...Array.from({ length: 9 }, () => SILENCE), ...probs(10, 12)]
  const total = sequence.length * VAD_WINDOW_SAMPLES
  const bridged = await runVad(pcm(total, 1024), scriptedScorer(sequence).scorer)
  expect(bridged, '0.288 s gap bridges at the default').toHaveLength(1)
  const split = await runVad(pcm(total, 1024), scriptedScorer(sequence).scorer, { minSilenceSec: 0.2 })
  expect(split, '0.288 s gap ≥ 0.2 s splits into two segments').toHaveLength(2)
})

test('FR-05.1 (defaults settable): non-positive tunings are rejected, not silently segmented', async () => {
  const probabilities = [...probs(10, 12)]
  for (const opts of [{ sampleRate: 0 }, { windowSamples: 0 }, { minSpeechSec: 0 }, { minSilenceSec: -1 }]) {
    await expect(runScripted(probabilities, opts), `rejects ${JSON.stringify(opts)}`).rejects.toThrow()
  }
})
