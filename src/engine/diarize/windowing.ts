// FR-06.2 embedding windows: VAD segments → fixed-length embedding windows
// (min 0.5 s, max 3 s, 50 % hop on long segments) and the reuse-vs-own-pass
// selection (a forwarded `vad` wins — the scorer is never called; otherwise
// the diarizer runs its own Silero pass through the injected unit-05
// `VadScorer`, i.e. `runVad` with 512-sample frames @ 16 kHz).
//
// Pure, deterministic, no SDK imports, no DOM globals. Frozen shape:
// `tests/unit/diarization/unit06-api-contract.d.ts`.

import type { PcmChunk, VadSegment } from '../protocol'
import type { Seconds } from '../model'
import { runVad } from '../asr/vad'
import type { VadScorer } from '../asr/vad'

/** One embedding window in absolute media seconds. */
export interface EmbeddingWindow {
  start: Seconds
  end: Seconds
}

export interface WindowingOptions {
  /** FR-06.2 minimum window length; default 0.5. */
  minSec?: number
  /** FR-06.2 maximum window length; default 3. */
  maxSec?: number
  /** FR-06.2 stride ratio on long segments (0.5 = 50 % hop); default 0.5. */
  hopRatio?: number
}

/** FR-06.2 minimum embedding-window length (seconds). */
export const EMBED_WINDOW_MIN_SEC = 0.5
/** FR-06.2 maximum embedding-window length (seconds). */
export const EMBED_WINDOW_MAX_SEC = 3
/** FR-06.2 hop ratio on long segments (50 %). */
export const EMBED_WINDOW_HOP_RATIO = 0.5

/** Float slack on tile/coverage comparisons (3-decimal timing ceiling). */
const EPS = 1e-9

/**
 * FR-06.2: VAD segments → embedding windows. Per segment (windows never
 * cross a segment boundary): shorter than `minSec` → expand symmetrically
 * about the segment center to `minSec`, clamped at media start 0; within
 * `[minSec, maxSec]` → exactly one window equal to the segment; longer →
 * tile `maxSec`-long windows at a `maxSec × hopRatio` stride, and when the
 * last stride window stops short of the segment end, backfill a final
 * `[end − maxSec, end]` window. The union covers every segment; the output
 * is sorted by start and deterministic.
 */
export function embeddingWindows(segments: readonly VadSegment[], opts: WindowingOptions = {}): EmbeddingWindow[] {
  const minSec = opts.minSec ?? EMBED_WINDOW_MIN_SEC
  const maxSec = opts.maxSec ?? EMBED_WINDOW_MAX_SEC
  const hopRatio = opts.hopRatio ?? EMBED_WINDOW_HOP_RATIO

  const windows: EmbeddingWindow[] = []
  for (const segment of segments) {
    const length = segment.end - segment.start
    if (length < minSec) {
      const center = (segment.start + segment.end) / 2
      const start = Math.max(0, center - minSec / 2)
      windows.push({ start, end: start + minSec })
    } else if (length <= maxSec) {
      windows.push({ start: segment.start, end: segment.end })
    } else {
      const stride = maxSec * hopRatio
      let cursor = segment.start
      let coveredTo = segment.start
      while (cursor + maxSec <= segment.end + EPS) {
        windows.push({ start: cursor, end: cursor + maxSec })
        coveredTo = cursor + maxSec
        cursor += stride
      }
      if (coveredTo < segment.end - EPS) {
        windows.push({ start: segment.end - maxSec, end: segment.end })
      }
    }
  }
  return windows.sort((a, b) => a.start - b.start)
}

/** Selection input: forwarded VAD segments win; otherwise own Silero pass. */
export interface ResolveWindowsInput {
  vad?: VadSegment[]
  pcm: AsyncIterable<PcmChunk>
  scorer: VadScorer
  opts?: WindowingOptions & { threshold?: number; minSpeechSec?: number; minSilenceSec?: number }
}

/**
 * FR-06.2 reuse-vs-own-pass: a forwarded `vad` is windowed directly (the
 * scorer is never touched — `source: 'forwarded'`); without it the stream is
 * scored through the injected `VadScorer` via unit-05 `runVad` (512-sample
 * frames @ 16 kHz) and windowed from the result (`source: 'own-pass'`).
 */
export async function resolveEmbeddingWindows(input: ResolveWindowsInput): Promise<{ windows: EmbeddingWindow[]; source: 'forwarded' | 'own-pass' }> {
  if (input.vad !== undefined) {
    return { windows: embeddingWindows(input.vad, input.opts), source: 'forwarded' }
  }
  const segments = await runVad(input.pcm, input.scorer, {
    threshold: input.opts?.threshold,
    minSpeechSec: input.opts?.minSpeechSec,
    minSilenceSec: input.opts?.minSilenceSec,
  })
  return { windows: embeddingWindows(segments, input.opts), source: 'own-pass' }
}
