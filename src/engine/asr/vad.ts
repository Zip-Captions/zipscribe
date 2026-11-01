// Pure Silero VAD scoring/thresholding (FR-05.1 / CC-05.4). Deterministic
// TypeScript: no SDK imports, no DOM globals, no I/O, no randomness — the
// ONNX session is INJECTED as a `VadScorer` (the ort glue that wraps
// `onnx-community/silero-vad` is slice C; it must produce exactly this seam).
//
// Silero parameters per FR-05.1 (defaults settable, tuned via spike corpus):
// 512-sample scoring window at 16 kHz, speech threshold 0.5, min-speech
// 0.25 s, min-silence 0.35 s. The state machine is the standard hangover
// model: a speech run becomes a committed segment once silence ≥
// `minSilenceSec` has elapsed after its last above-threshold frame, and it
// is kept only when the speech lasted ≥ `minSpeechSec` (shorter runs are
// discarded, sub-`minSilenceSec` silences bridge). A run still open at
// stream end is flushed when it already reaches `minSpeechSec`.
//
// Frames are the contiguous `windowSamples`-slices of the stream starting at
// the first chunk's `startSec` (protocol.ts PcmChunk: 16 kHz mono f32,
// contiguous batches). Scores outside [0, 1] are treated as their clamped
// value only through the threshold comparison (no normalization invented).

import type { PcmChunk, VadSegment } from '../protocol'
import type { Seconds } from '../model'

/** Contract sample rate for ASR/VAD PCM (protocol.ts PcmChunk). */
export const VAD_SAMPLE_RATE = 16_000
/** Silero scoring window in samples at 16 kHz (FR-05.1). */
export const VAD_WINDOW_SAMPLES = 512
/** Speech-probability cut (FR-05.1). */
export const DEFAULT_VAD_THRESHOLD = 0.5
/** Speech runs shorter than this are discarded (FR-05.1). */
export const DEFAULT_MIN_SPEECH_SEC = 0.25
/** Silence runs shorter than this bridge the segment (FR-05.1); chunker.ts `minSilenceSec` mirrors it. */
export const DEFAULT_MIN_SILENCE_SEC = 0.35

/** DI seam: production wraps an ort InferenceSession (slice C); tests inject a scripted scorer. */
export interface VadScorer {
  /** Speech probability [0, 1] for one `windowSamples` frame (a private copy — the scorer may retain it). */
  scoreWindow(frame: Float32Array): number | Promise<number>
}

export interface VadOptions {
  /** PCM sample rate; default 16000 (FR-05.1 contract rate). */
  sampleRate?: number
  /** Scoring window in samples; default 512 (FR-05.1). */
  windowSamples?: number
  /** Speech-probability cut; default 0.5 (FR-05.1). */
  threshold?: number
  /** Minimum kept speech duration; default 0.25 (FR-05.1). */
  minSpeechSec?: number
  /** Minimum silence duration that closes a segment; default 0.35 (FR-05.1). */
  minSilenceSec?: number
}

export interface VadThresholds {
  threshold: number
  minSpeechSec: number
  minSilenceSec: number
}

function requirePositive(value: number, name: string): void {
  if (!(value > 0) || !Number.isFinite(value)) throw new RangeError(`vad ${name} must be a positive finite number`)
}

/**
 * Pure hangover state machine over per-frame speech probabilities (one score
 * per `frameSec` window, in stream order). No I/O, no scorer — this is the
 * thresholding half of FR-05.1, directly unit-testable.
 */
export function segmentsFromProbabilities(probabilities: readonly number[], frameSec: number, thresholds: VadThresholds): VadSegment[] {
  requirePositive(frameSec, 'frameSec')
  const segments: VadSegment[] = []
  let speechStart: Seconds | null = null
  let lastSpeechEnd = 0
  let silenceRun = 0
  for (let i = 0; i < probabilities.length; i++) {
    const t0 = i * frameSec
    const t1 = t0 + frameSec
    if ((probabilities[i] ?? 0) >= thresholds.threshold) {
      if (speechStart === null) speechStart = t0
      lastSpeechEnd = t1
      silenceRun = 0
    } else if (speechStart !== null) {
      silenceRun += frameSec
      if (silenceRun >= thresholds.minSilenceSec) {
        if (lastSpeechEnd - speechStart >= thresholds.minSpeechSec) segments.push({ start: speechStart, end: lastSpeechEnd })
        speechStart = null
        silenceRun = 0
      }
    }
  }
  // Stream-end flush: an open run that already reaches min-speech is kept at
  // its last above-threshold frame end.
  if (speechStart !== null && lastSpeechEnd - speechStart >= thresholds.minSpeechSec) {
    segments.push({ start: speechStart, end: lastSpeechEnd })
  }
  return segments
}

/**
 * Score the PCM stream through the injected scorer and threshold it into
 * `VadSegment[]` (absolute seconds). The scorer is the only external
 * dependency — the same function pair drives production (ort session, slice
 * C) and scripted tests (FR-05.1 "pure scoring/thresholding over an injected
 * session/scorer").
 */
export async function runVad(stream: AsyncIterable<PcmChunk>, scorer: VadScorer, opts: VadOptions = {}): Promise<VadSegment[]> {
  const sampleRate = opts.sampleRate ?? VAD_SAMPLE_RATE
  const windowSamples = opts.windowSamples ?? VAD_WINDOW_SAMPLES
  const threshold = opts.threshold ?? DEFAULT_VAD_THRESHOLD
  const minSpeechSec = opts.minSpeechSec ?? DEFAULT_MIN_SPEECH_SEC
  const minSilenceSec = opts.minSilenceSec ?? DEFAULT_MIN_SILENCE_SEC
  requirePositive(sampleRate, 'sampleRate')
  requirePositive(windowSamples, 'windowSamples')
  requirePositive(minSpeechSec, 'minSpeechSec')
  requirePositive(minSilenceSec, 'minSilenceSec')
  const frameSec = windowSamples / sampleRate

  const probabilities: number[] = []
  let residual: Float32Array = new Float32Array(0)
  for await (const chunk of stream) {
    if (chunk.samples.length === 0) continue
    const merged = new Float32Array(residual.length + chunk.samples.length)
    merged.set(residual, 0)
    merged.set(chunk.samples, residual.length)
    let offset = 0
    while (offset + windowSamples <= merged.length) {
      probabilities.push(await scorer.scoreWindow(merged.slice(offset, offset + windowSamples)))
      offset += windowSamples
    }
    residual = merged.slice(offset)
  }
  return segmentsFromProbabilities(probabilities, frameSec, { threshold, minSpeechSec, minSilenceSec })
}
