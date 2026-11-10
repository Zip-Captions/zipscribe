// CC-06.1 (L1): the test-owned diarization acceptance math — per-word speaker
// accuracy (confusion-matrix-optimal 1:1 mapping) and the DER-style breakdown
// (miss + confusion + false-alarm decomposition) that the L4 2-speaker
// accuracy spec scores against. Goldens are hand-built frame/annotation cases
// with exact expected decompositions (0 % / 100 % / miss-vs-confusion-vs-FA
// separation). Frame resolution: 10 ms bins on the absolute second grid
// (documented in ./helpers/metrics.ts) — these goldens use 0.1 s bins so every
// expected value is hand-computable.
//
// This suite exercises the TEST-OWNED calculator (it exists and must be
// correct before any L4 threshold claim means anything); the unit-under-test
// suites (clustering/assign/windowing/worker-core/speaker-history) are the
// import-RED ones.
import { describe, expect, test } from 'vitest'
import { DEFAULT_FRAME_SEC, bestSpeakerMapping, derStyle, dominantFrameSpeaker, median, wordSpeakerAccuracy, type GtWord, type ScoreFrame } from './helpers/metrics'

const R = 0.1

function frame(start: number, end: number, speaker: number): ScoreFrame {
  return { start, end, speaker }
}

function word(start: number, end: number, speaker: string): GtWord {
  return { start, end, speaker }
}

describe('CC-06.1: dominant frame speaker (duration-weighted majority)', () => {
  test('CC-06.1: overlap seconds decide; ties resolve to the smaller speaker id', () => {
    expect(dominantFrameSpeaker(0, 1, [frame(0, 0.6, 3), frame(0.6, 1, 1)])).toBe(3)
    expect(dominantFrameSpeaker(0, 1, [frame(0, 0.5, 1), frame(0.5, 1, 0)])).toBe(0)
    expect(dominantFrameSpeaker(0, 1, [])).toBeUndefined()
    expect(dominantFrameSpeaker(2, 3, [frame(0, 1, 0)]), 'no overlap → silence').toBeUndefined()
  })
})

describe('CC-06.1: per-word speaker accuracy with optimal 1:1 mapping', () => {
  const words = [word(0, 1, 'ann'), word(1, 2, 'bob')]

  test('CC-06.1: perfect match scores 1.0 regardless of label↔cluster permutation', () => {
    expect(wordSpeakerAccuracy(words, [frame(0, 1, 0), frame(1, 2, 1)]).accuracy).toBe(1)
    const swapped = wordSpeakerAccuracy(words, [frame(0, 1, 9), frame(1, 2, 5)])
    expect(swapped.accuracy, 'optimal mapping rescues a permuted labeling').toBe(1)
    expect(swapped.mapping.get('ann')).toBe(9)
    expect(swapped.mapping.get('bob')).toBe(5)
  })

  test('CC-06.1: a silent word and a wrong word each cost their span (50 % golden)', () => {
    const acc = wordSpeakerAccuracy(words, [frame(0, 1, 0)])
    expect(acc.matched).toBe(1)
    expect(acc.total).toBe(2)
    expect(acc.accuracy).toBe(0.5)
    expect(wordSpeakerAccuracy(words, []).accuracy).toBe(0)
  })

  test('CC-06.1: best mapping maximizes matched words (confusion-matrix optimal)', () => {
    const three = [word(0, 1, 'a'), word(1, 2, 'b'), word(2, 3, 'c')]
    const frames = [frame(0, 1, 1), frame(1, 2, 1), frame(2, 3, 0)]
    const result = bestSpeakerMapping(three, frames)
    expect(result.matched, 'one speaker covers a+b, the other c → 2/3 optimal').toBe(2)
    expect(result.mapping.get('c')).toBe(0)
  })
})

describe('CC-06.1: DER-style breakdown (frame resolution 0.1 s goldens)', () => {
  const words = [word(0, 1, 'ann'), word(1, 2, 'bob')]

  test('CC-06.1: 0 % — perfect system scores the exact zero decomposition', () => {
    const d = derStyle(words, [frame(0, 1, 0), frame(1, 2, 1)], { frameSec: R })
    expect(d.totalRefBins, '20 reference bins at 0.1 s over 2 s of speech').toBe(20)
    expect(d.der).toBe(0)
    expect(d.miss).toBe(0)
    expect(d.confusion).toBe(0)
    expect(d.falseAlarm).toBe(0)
  })

  test('CC-06.1: 100 % — a forced worst-case mapping is pure confusion (decomposition)', () => {
    const d = derStyle(words, [frame(0, 1, 0), frame(1, 2, 1)], { frameSec: R, mapping: new Map([['ann', 1], ['bob', 0]]) })
    expect(d.confusion, 'every reference bin disagrees → confusion 1.0').toBe(1)
    expect(d.miss).toBe(0)
    expect(d.falseAlarm).toBe(0)
    expect(d.der).toBe(1)
  })

  test('CC-06.1: miss vs confusion vs false-alarm decompose independently', () => {
    const silentB = derStyle(words, [frame(0, 1, 0)], { frameSec: R })
    expect(silentB.miss, 'half the reference uncovered → miss 0.5').toBe(0.5)
    expect(silentB.confusion).toBe(0)
    expect(silentB.falseAlarm).toBe(0)
    expect(silentB.der).toBe(0.5)

    const extra = derStyle(words, [frame(0, 1, 0), frame(1, 2, 1), frame(2, 3, 1)], { frameSec: R })
    expect(extra.falseAlarm, '10 extra system bins over 20 reference bins → FA 0.5').toBe(0.5)
    expect(extra.miss).toBe(0)
    expect(extra.confusion).toBe(0)
    expect(extra.der).toBe(0.5)

    const mixed = derStyle([word(0, 1, 'a'), word(1, 2, 'b'), word(2, 3, 'c')], [frame(0, 1, 0), frame(2, 3, 1)], { frameSec: R })
    expect(mixed.miss, 'the `b` region is missed').toBeCloseTo(1 / 3, 9)
    expect(mixed.confusion).toBe(0)
    expect(mixed.falseAlarm).toBe(0)
    expect(mixed.der).toBeCloseTo(1 / 3, 9)
  })

  test('CC-06.1: der equals the exact sum of the three normalized components', () => {
    const d = derStyle([word(0.5, 1.5, 'x')], [frame(0, 0.8, 0), frame(0.9, 2, 1)], { frameSec: R })
    expect(d.der).toBeCloseTo(d.miss + d.confusion + d.falseAlarm, 12)
    expect(d.frameSec).toBe(R)
  })

  test('CC-06.1: adjacent same-speaker words never double-count (half-open bins)', () => {
    const d = derStyle([word(0, 1, 'a'), word(1, 2, 'a')], [frame(0, 2, 4)], { frameSec: R })
    expect(d.totalRefBins, 'contiguous same-speaker words = 20 bins, not 21').toBe(20)
    expect(d.der).toBe(0)
  })

  test('CC-06.1: overlapping DIFFERENT-speaker reference turns are rejected, not averaged', () => {
    expect(() => derStyle([word(0, 1.5, 'a'), word(1, 2, 'b')], [], { frameSec: R })).toThrow(/overlapping reference turns/)
  })

  test('CC-06.1: sub-bin words still occupy their grid cell; the default resolution is 10 ms', () => {
    expect(DEFAULT_FRAME_SEC).toBe(0.01)
    const d = derStyle([word(0, 0.05, 'a')], [frame(0, 0.01, 0)], { frameSec: R })
    expect(d.totalRefBins, 'one covered bin at 0.1 s resolution').toBe(1)
    expect(d.miss, 'bin covered by the system frame').toBe(0)
    expect(d.der).toBe(0)
  })

  test('CC-06.1: the 3-run median is the middle value (no cherry-picking)', () => {
    expect(median([0.9, 0.7, 0.8])).toBe(0.8)
    expect(median([1, 0, 0])).toBe(0)
    expect(() => median([])).toThrow(/empty/)
  })
})
