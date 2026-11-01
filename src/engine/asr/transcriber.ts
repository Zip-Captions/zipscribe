// Engine-agnostic windowed ASR pipeline (FR-05.2 / FR-05.5 / FR-05.9 / US-05.1).
// Deterministic TypeScript: no SDK imports, no DOM globals, no I/O — the
// engine session arrives through `opts.createSession` DI (the adapter is the
// production implementation, a scripted fake in tests) and segmentation
// through `opts.vad` (FR-05.1's `vad:segments`, reused by diarization).
// Window packing is imported unchanged from `chunker.ts` (FR-05.1).
//
// Pipeline: pack VAD segments into windows (chunker), cut every window at
// its internal silences (gaps ≥ `minSilenceSec` are the only legal cut
// points — cuts land in silence with the chunker's midpoint-clamped padding,
// so each speech region gets its own engine call and progress streams per
// completed window, FR-05.5), one engine call per window with the fixed
// greedy option set (FR-05.7 determinism), window-relative word times offset
// by the window start → absolute seconds (FR-05.2). Windows longer than
// 28 s (continuous speech — the only legal way to exceed the ceiling) carry
// the vendored long-form recipe `chunk_length_s:30, stride_length_s:5`
// (binding unit-02 finding: transformers.js 3.8.1 silently truncates > 30 s
// audio without it).
//
// Hallucination guard (FR-05.9), per window, counters numeric only
// (SECURITY-03): same n-gram ≥ 4 consecutive copies → drop + count; text for
// a window the VAD marked < `minGuardedSpeechSec` speech → drop + count;
// `WindowOutput.maxTokensHit` → drop + count. The typed `LANGUAGE_REQUIRED`
// validation (US-05.1) returns before the session seam is even created.
//
// Backpressure (FR-05.2): the stream is pulled on demand — live buffer
// beyond the engine's consumed position never exceeds the current window's
// requirement, consumed chunks are pruned, and cross-window prefetch is
// capped at `maxBufferedAheadSec` (default 30 s). A single window > 30 s is
// one engine call — its audio is the input, not read-ahead.
//
// Cancellation (FR-05.6) is the worker host's abort flag (slice B): this
// contract exposes no cancel seam, so `cancelled` is only ever false here.

import type { Seconds } from '../model'
import type { AsrEvent, Device, EngineError, ModelId, PcmChunk, RawSegment, VadSegment } from '../protocol'
import { packWindows, type AsrWindow } from './chunker'

export interface EngineFlags {
  confidence: boolean
  punctuation: boolean
  languageDetect: boolean
}

export interface TranscribeSpec {
  modelId: ModelId
  device: Device
  /** BCP-47 primary tag; null = auto-detect when `engineFlags.languageDetect`. */
  language: string | null
  engineFlags: EngineFlags
}

/** The per-window engine call options (FR-05.2). The long-form recipe is present ONLY for windows > 28 s. */
export interface WindowCallOptions {
  return_timestamps: 'word'
  language: string | null
  task: 'transcribe'
  chunk_length_s?: number
  stride_length_s?: number
}

export interface WindowOutput {
  /** Engine output with WINDOW-RELATIVE times; the transcriber offsets by the window start (FR-05.2). */
  segments: RawSegment[]
  /** Decoder hit its max-token budget on this window (FR-05.9 trigger 3). */
  maxTokensHit?: boolean
}

/** DI seam: the engine adapter in production, a scripted fake in tests. */
export interface EngineSession {
  transcribeWindow(windowStart: Seconds, windowEnd: Seconds, audio: Float32Array, options: WindowCallOptions): Promise<WindowOutput>
  detectLanguage?(audio: Float32Array): Promise<string>
  dispose?(): void
}

/** Guard counters — numbers only, never content (SECURITY-03). */
export interface GuardStats {
  repeatedNgramDropped: number
  shortWindowDropped: number
  maxTokensDropped: number
}

export interface TranscribeGuard {
  /** Speech duration the VAD attributed to this window (seconds). */
  speechSec: number
}

export interface TranscribeOptions {
  /** Injected segmentation (worker reuses it for diarization, FR-05.1); omit to let the transcriber run VAD itself. */
  vad?: readonly VadSegment[]
  createSession: () => EngineSession | Promise<EngineSession>
  /** Optional guard override: windows whose VAD speech is below this are text-rejected; default 0.5 (FR-05.9). */
  minGuardedSpeechSec?: number
  /** Optional backpressure ceiling for buffered PCM ahead of the engine; default 30 (FR-05.2). */
  maxBufferedAheadSec?: number
}

export interface TranscribeOutcome {
  ok: boolean
  /** Set (and NOTHING else happened — no session created, no window called) when validation fails (US-05.1). */
  validation?: 'LANGUAGE_REQUIRED'
  /** Emitted (kept) segments — sorted by start; guard-dropped windows are absent. */
  segments: RawSegment[]
  /** From `EngineSession.detectLanguage` when `language` was null and the engine detects. */
  detectedLanguage: string | null
  guardStats: GuardStats
  windowsCommitted: number
  cancelled: boolean
  error?: EngineError
}

const SAMPLE_RATE = 16_000
/** Window ceiling (FR-05.1) — strictly above it the long-form recipe applies (FR-05.2). */
const MAX_WINDOW_SEC = 28
const CHUNK_LENGTH_S = 30
const STRIDE_LENGTH_S = 5
/** Mirrors chunker.ts defaults (FR-05.1) for the transcriber's silence cuts. */
const PAD_SEC = 0.2
const MIN_SILENCE_SEC = 0.35
const DEFAULT_MIN_GUARDED_SPEECH_SEC = 0.5
const DEFAULT_MAX_BUFFERED_AHEAD_SEC = 30
/** FR-05.9 trigger 1: ≥ 4 consecutive copies of one 1–4-word sequence. */
const REPEAT_MIN_COPIES = 4
const REPEAT_MAX_NGRAM_WORDS = 4
const CONTAINMENT_EPS = 1e-9
/** Job identity belongs to the worker host (slice B), which re-tags relayed events; this is the standalone-pipeline placeholder. */
const ASR_JOB_ID = 'asr'

type JobDoneWithStats = Extract<AsrEvent, { t: 'job:done' }> & { stats: { guard: GuardStats } }

function zeroGuardStats(): GuardStats {
  return { repeatedNgramDropped: 0, shortWindowDropped: 0, maxTokensDropped: 0 }
}

/**
 * packWindows (chunker, FR-05.1) then cut each packed window at its internal
 * silences (gaps ≥ `minSilenceSec`, padding-clamped to the silence
 * midpoint). Cross-silence packing inside one window is lawful in the
 * chunker but the transcriber cuts at every legal silence: windows stay
 * single-speech-region, every boundary sits in silence (US-1.2.2) and
 * `job:segments` streams per completed window (FR-05.5).
 */
function planWindows(sortedSegments: readonly VadSegment[]): AsrWindow[] {
  const out: AsrWindow[] = []
  for (const window of packWindows(sortedSegments)) {
    const covered = sortedSegments.filter((s) => s.start >= window.start - CONTAINMENT_EPS && s.end <= window.end + CONTAINMENT_EPS)
    let partStart = window.start
    for (let i = 0; i + 1 < covered.length; i++) {
      const gap = covered[i + 1]!.start - covered[i]!.end
      if (gap < MIN_SILENCE_SEC) continue
      const pad = Math.min(PAD_SEC, gap / 2)
      out.push({ start: partStart, end: covered[i]!.end + pad })
      partStart = covered[i + 1]!.start - pad
    }
    out.push({ start: partStart, end: window.end })
  }
  return out
}

/** VAD speech time (seconds) attributed to the window (FR-05.9 trigger 2 input). */
function speechSecondsIn(window: AsrWindow, sortedSegments: readonly VadSegment[]): number {
  let total = 0
  for (const segment of sortedSegments) {
    const lo = Math.max(segment.start, window.start)
    const hi = Math.min(segment.end, window.end)
    if (hi > lo) total += hi - lo
  }
  return total
}

/** FR-05.9 trigger 1: the same 1–4-word sequence as ≥ 4 consecutive copies (Whisper repetition-loop pattern). */
function hasRepeatedNgram(words: readonly string[]): boolean {
  for (let n = 1; n <= REPEAT_MAX_NGRAM_WORDS; n++) {
    if (words.length < REPEAT_MIN_COPIES * n) continue
    for (let i = 0; i + REPEAT_MIN_COPIES * n <= words.length; i++) {
      let repeated = true
      for (let k = 1; k < REPEAT_MIN_COPIES && repeated; k++) {
        for (let j = 0; j < n; j++) {
          if (words[i + k * n + j] !== words[i + j]) {
            repeated = false
            break
          }
        }
      }
      if (repeated) return true
    }
  }
  return false
}

/** Applies the three FR-05.9 triggers; counts every trigger the window trips, returns true when its text is dropped. */
function windowTripsGuard(output: WindowOutput, guard: TranscribeGuard, minGuardedSpeechSec: number, stats: GuardStats): boolean {
  let dropped = false
  if (output.maxTokensHit === true) {
    stats.maxTokensDropped += 1
    dropped = true
  }
  const words = output.segments
    .flatMap((segment) => segment.words)
    .sort((a, b) => a.start - b.start)
    .map((word) => word.text.trim().toLowerCase())
  if (hasRepeatedNgram(words)) {
    stats.repeatedNgramDropped += 1
    dropped = true
  }
  const hasText = words.length > 0 || output.segments.some((segment) => segment.text.trim() !== '')
  if (hasText && guard.speechSec < minGuardedSpeechSec) {
    stats.shortWindowDropped += 1
    dropped = true
  }
  return dropped
}

/** Window-relative → media-absolute times (FR-05.2); input objects are never mutated. */
function offsetWindowSegments(segments: readonly RawSegment[], windowStart: Seconds): RawSegment[] {
  return segments.map((segment) => ({
    ...segment,
    start: segment.start + windowStart,
    end: segment.end + windowStart,
    words: segment.words.map((word) => ({ ...word, start: word.start + windowStart, end: word.end + windowStart })),
  }))
}

interface BufferedChunk {
  startSec: Seconds
  endSec: Seconds
  samples: Float32Array
}

/**
 * On-demand PCM reader (FR-05.2 backpressure): chunks are pulled only as far
 * as the current window needs, chunks fully behind the engine are pruned,
 * and the optional cross-window prefetch never runs ahead of the engine's
 * consumed position by more than `maxBufferedAheadSec`.
 */
function createPcmReader(stream: AsyncIterable<PcmChunk>, maxBufferedAheadSec: number) {
  const iterator = stream[Symbol.asyncIterator]()
  const pending: BufferedChunk[] = []
  let exhausted = false
  let endSec = 0
  let consumedSec = 0

  function coveredEnd(): number {
    const last = pending[pending.length - 1]
    return last === undefined ? 0 : last.endSec
  }

  async function ensure(uptoSec: number): Promise<void> {
    while (!exhausted && coveredEnd() < uptoSec) {
      const next = await iterator.next()
      if (next.done === true) {
        exhausted = true
        break
      }
      const chunk: PcmChunk = next.value
      const chunkEnd = chunk.startSec + chunk.samples.length / SAMPLE_RATE
      pending.push({ startSec: chunk.startSec, endSec: chunkEnd, samples: chunk.samples })
      endSec = Math.max(endSec, chunkEnd)
    }
  }

  return {
    /** Engine consumed everything before `neededFromSec` — drop those chunks (keeps the live buffer ≈ one window). */
    pruneBefore(neededFromSec: number): void {
      while (pending.length > 0 && (pending[0]?.endSec ?? 0) <= neededFromSec) pending.shift()
      consumedSec = Math.max(consumedSec, neededFromSec)
    },
    /** Pull only as far as the next window needs, capped at the backpressure ceiling beyond the engine. */
    async prefetch(uptoSec: number): Promise<void> {
      await ensure(Math.min(uptoSec, consumedSec + maxBufferedAheadSec))
    },
    /** Contiguous f32 audio for [window.start, window.end); zero-filled past the stream end. */
    async audioFor(window: AsrWindow): Promise<Float32Array> {
      await ensure(window.end)
      const from = Math.max(0, Math.round(window.start * SAMPLE_RATE))
      const to = Math.round(window.end * SAMPLE_RATE)
      const audio = new Float32Array(Math.max(0, to - from))
      for (const chunk of pending) {
        const chunkFrom = Math.round(chunk.startSec * SAMPLE_RATE)
        const lo = Math.max(from, chunkFrom)
        const hi = Math.min(to, chunkFrom + chunk.samples.length)
        if (hi <= lo) continue
        audio.set(chunk.samples.subarray(lo - chunkFrom, hi - chunkFrom), lo - from)
      }
      return audio
    },
    /** Highest media time pulled from the stream so far (progress totals). */
    endSeconds(): number {
      return endSec
    },
  }
}

/**
 * Engine-agnostic pipeline (FR-05.2): stream → VAD (injected or module) →
 * packWindows → one engine call per window → absolute-time `job:segments`
 * streamed per completed window (sorted, FR-05.5) → `job:progress` /
 * `job:done` (with numeric guard `stats` — see the proposed protocol
 * addition) via `onEvent`. Greedy, fixed options (FR-05.7 determinism).
 */
export async function transcribe(stream: AsyncIterable<PcmChunk>, spec: TranscribeSpec, opts: TranscribeOptions, onEvent: (event: AsrEvent) => void): Promise<TranscribeOutcome> {
  // US-05.1: refusal BEFORE any worker/engine boundary — no session, no window, no event.
  if (spec.language === null && !spec.engineFlags.languageDetect) {
    return { ok: false, validation: 'LANGUAGE_REQUIRED', segments: [], detectedLanguage: null, guardStats: zeroGuardStats(), windowsCommitted: 0, cancelled: false }
  }

  const guardStats = zeroGuardStats()
  const minGuardedSpeechSec = opts.minGuardedSpeechSec ?? DEFAULT_MIN_GUARDED_SPEECH_SEC
  const sortedVad = [...(opts.vad ?? [])].sort((a, b) => a.start - b.start)
  const windows = planWindows(sortedVad)
  const reader = createPcmReader(stream, opts.maxBufferedAheadSec ?? DEFAULT_MAX_BUFFERED_AHEAD_SEC)
  const kept: RawSegment[] = []
  let windowsCommitted = 0
  let detectedLanguage: string | null = null
  let session: EngineSession | undefined

  try {
    session = await opts.createSession()
    // US-05.1: a detecting engine probes the first window and reports the
    // detection; an explicit `language` still forces the engine call.
    if (spec.engineFlags.languageDetect && windows.length > 0 && session.detectLanguage !== undefined) {
      detectedLanguage = await session.detectLanguage(await reader.audioFor(windows[0]!))
    }
    const language = spec.language ?? detectedLanguage
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i]!
      reader.pruneBefore(window.start)
      const audio = await reader.audioFor(window)
      const options: WindowCallOptions = { return_timestamps: 'word', language, task: 'transcribe' }
      if (window.end - window.start > MAX_WINDOW_SEC) {
        options.chunk_length_s = CHUNK_LENGTH_S
        options.stride_length_s = STRIDE_LENGTH_S
      }
      const output = await session.transcribeWindow(window.start, window.end, audio, options)
      const processedSec = Math.min(window.end, reader.endSeconds())
      onEvent({ t: 'job:progress', jobId: ASR_JOB_ID, processedSec, totalSec: Math.max(reader.endSeconds(), processedSec) })
      if (windowTripsGuard(output, { speechSec: speechSecondsIn(window, sortedVad) }, minGuardedSpeechSec, guardStats)) continue
      const batch = offsetWindowSegments(output.segments, window.start).sort((a, b) => a.start - b.start)
      kept.push(...batch)
      windowsCommitted += 1
      onEvent({ t: 'job:segments', jobId: ASR_JOB_ID, segments: batch })
      const nextWindow = windows[i + 1]
      if (nextWindow !== undefined) await reader.prefetch(nextWindow.end)
    }
  } catch {
    // detail is a fixed code, never message content (SECURITY-03).
    const error: EngineError = { code: 'ENGINE_INTERNAL', retryable: false, detail: 'transcribe_window_failed' }
    onEvent({ t: 'job:error', jobId: ASR_JOB_ID, error })
    return { ok: false, segments: kept, detectedLanguage, guardStats, windowsCommitted, cancelled: false, error }
  } finally {
    session?.dispose?.()
  }

  const done: JobDoneWithStats = { t: 'job:done', jobId: ASR_JOB_ID, stats: { guard: { ...guardStats } } }
  onEvent(done)
  return { ok: true, segments: kept.sort((a, b) => a.start - b.start), detectedLanguage, guardStats, windowsCommitted, cancelled: false }
}
