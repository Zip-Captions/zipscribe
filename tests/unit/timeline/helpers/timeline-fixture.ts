// Unit-103 deterministic timeline fixtures (conventions § Mocks and fakes).
// PURE DATA ONLY: imports the unit-102 fixture builders (existing modules) —
// never a not-yet-built `@ui/timeline/*` module (the RED-seam doctrine lives
// in the test files; helpers must load in the gates child run). All block
// text is synthetic (SECURITY-03); projects built through `createTestApp`
// from `tests/unit/editor/helpers/editor-app.ts` carry the canary block and
// therefore attach `createRedactionSpy` in the suites that render them.
import { block, joinWords, speaker, word } from '../../editor/helpers/fixture-project'
import type { CaptionBlock, Seconds, Speaker, WordToken } from '@engine/model@103'
import type { PeaksData } from '@engine/protocol@103'
import type { TimelineViewport } from '@ui/timeline/viewport'

export const TIMELINE_SPEAKERS: Speaker[] = [speaker('SPK_1', 'Speaker 1', '#4c8dff'), speaker('SPK_2', 'Speaker 2', '#e5534b')]

export const TIMELINE_WIDTH_PX = 800
export const TIMELINE_DURATION = 121.44

/** Deterministic default viewport used by the unit suites (1 s = 100 px). */
export const TIMELINE_VIEWPORT: TimelineViewport = { t0: 0, pxPerSec: 100 }

/**
 * Five sorted synthetic blocks (no canary) with words, speakers and
 * confidence values — the CC-103.1 hit-test/visual data set.
 * blk_v1 0.5–2.5 (SPK_1, conf 0.95) | blk_v2 3–5 (SPK_2, conf 0.2 LOW) |
 * blk_v3 6–8.2 (SPK_1, no conf) | blk_v4 9–11 (SPK_1, conf 0.75) |
 * blk_v5 12–14 (SPK_2, conf 0.98)
 */
export function timelineBlocks(): CaptionBlock[] {
  return [
    block('blk_v1', 0.5, 2.5, 'SPK_1', [word('alpha', 0.5, 1.2), word('beta', 1.3, 1.9), word('gamma', 2.0, 2.5)], { confidence: 0.95 }),
    block('blk_v2', 3.0, 5.0, 'SPK_2', [word('delta', 3.0, 3.6), word('epsilon', 3.7, 4.3), word('zeta', 4.4, 5.0)], { confidence: 0.2 }),
    block('blk_v3', 6.0, 8.2, 'SPK_1', [word('eta', 6.0, 7.0), word('theta', 7.1, 8.2)]),
    block('blk_v4', 9.0, 11.0, 'SPK_1', [word('iota', 9.0, 10.0), word('kappa', 10.1, 11.0)], { confidence: 0.75 }),
    block('blk_v5', 12.0, 14.0, 'SPK_2', [word('lambda', 12.0, 13.0), word('mu', 13.1, 14.0)], { confidence: 0.98 }),
  ]
}

/**
 * 40 evenly spaced blocks (0.5 s long, 0.5 s gap) for the hit-test parity
 * sweep (CC-103.1): block k occupies [k, k + 0.5).
 */
export function indexBlocks(): CaptionBlock[] {
  return Array.from({ length: 40 }, (_, k) => {
    const start = k as Seconds
    return block(`blk_idx_${String(k).padStart(2, '0')}`, start, start + 0.5, 'SPK_1', [word(`w${String(k)}a`, start, start + 0.25), word(`w${String(k)}b`, start + 0.25, start + 0.5)])
  })
}

/** Deterministic 3-word block spanning [start, end] (midpoint-split fixture). */
export function straddleBlock(id: string, start: Seconds, end: Seconds, words: WordToken[]): CaptionBlock {
  return block(id, start, end, 'SPK_1', words)
}

/**
 * Adjacency/constraint data set for CC-103.3 (pxPerSec 100, view from 0):
 *   prev    [1.0, 2.0]  | target [3.0, 5.0] (words 3.0–3.6, 3.7–4.3, 4.4–5.0)
 *   | next [6.0, 7.0]
 */
export function constraintBlocks(): CaptionBlock[] {
  return [
    block('blk_prev', 1.0, 2.0, 'SPK_1', [word('one', 1.0, 1.5), word('two', 1.6, 2.0)]),
    block('blk_mid', 3.0, 5.0, 'SPK_1', [word('three', 3.0, 3.6), word('four', 3.7, 4.3), word('five', 4.4, 5.0)]),
    block('blk_next', 6.0, 7.0, 'SPK_2', [word('six', 6.0, 6.5), word('seven', 6.6, 7.0)]),
  ]
}

/** Plain synthetic merge pair (no canary): text joins with a single space. */
export function mergePairBlocks(): CaptionBlock[] {
  return [block('blk_m1', 1.0, 2.0, 'SPK_1', [word('alpha', 1.0, 1.5), word('beta', 1.6, 2.0)]), block('blk_m2', 2.1, 3.0, 'SPK_1', [word('gamma', 2.1, 2.5), word('delta', 2.6, 3.0)])]
}

/** Peaks fake: `bucketSec`-wide buckets over [0, count·bucketSec). */
export function makePeaks(bucketSec: number, count: number, amplitude: (i: number) => number = (i) => ((i % 20 === 0 ? 0 : ((i * 37) % 100) / 100) * 0.9 + 0.05)): PeaksData {
  const min = new Float32Array(count)
  const max = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const a = amplitude(i)
    min[i] = -a
    max[i] = a
  }
  return { bucketSec, min, max }
}

/** Peaks with a silent run over buckets [silentStart, silentEnd) (both channels 0). */
export function makePeaksWithSilence(bucketSec: number, count: number, silentStart: number, silentEnd: number): PeaksData {
  return makePeaks(bucketSec, count, (i) => (i >= silentStart && i < silentEnd ? 0 : 0.5))
}

/**
 * 10 000-block perf data set (US-2.2.6 / CC-103.4 e2e seed): block k spans
 * [k·0.012, k·0.012 + 0.01] — sorted, non-overlapping, within the 121.44 s
 * asset, text == words joined (invariant 2 so `captions-import` accepts).
 */
export function perfBlocksFrom(index: number, count: number): CaptionBlock[] {
  return Array.from({ length: count }, (_, j) => {
    const k = index + j
    const start = Math.round(k * 0.012 * 1000) / 1000
    const end = Math.round((start + 0.01) * 1000) / 1000
    const mid = Math.round((start + 0.005) * 1000) / 1000
    const words = [word(`w${String(k)}a`, start, mid), word(`w${String(k)}b`, mid, end)]
    return { id: `blk_perf_${String(k)}`, start, end, text: joinWords(words), words, speakerId: 'SPK_1' }
  })
}
