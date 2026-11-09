// CC-07.3 (L1, colocated coverage suite for CC-07.7): branches of the pinned
// estimation rule not exercised by the frozen acceptance suite
// (tests/unit/captions/estimate-timing.test.ts): the full punctuation set,
// internal (non-final) punctuation, code-point (not code-unit) counting,
// breakAfter from interior AND trailing newlines, and the weight-0 pause.
import { describe, expect, test } from 'vitest'
import { estimateCueWords } from './estimate-timing'

function boundary(text: string, end: number, punctuationPauseWeight?: number): number {
  return estimateCueWords({ start: 0, end, text }, punctuationPauseWeight === undefined ? {} : { punctuationPauseWeight })[1]!.start
}

describe('CC-07.3: pinned estimation rule — branch coverage', () => {
  test('every pinned punctuation mark adds exactly the pause weight', () => {
    const bare = boundary('go now', 2.1)
    expect(bare, 'control: bare 2/5 of 2.1').toBeCloseTo(0.84, 3)
    for (const mark of ['.', ',', '!', '?', ';', ':']) {
      const punctuated = boundary(`go${mark} now`, 2.1)
      expect(punctuated, `'${mark}' lifts the boundary above the bare map (4/7 of 2.1)`).toBeCloseTo(1.2, 3)
    }
  })

  test('NON-final punctuation carries no pause weight (regex is anchored at $)', () => {
    const internal = estimateCueWords({ start: 0, end: 2, text: 'a.b c' })
    expect(internal.map((word) => word.text)).toEqual(['a.b', 'c'])
    expect(internal[1]!.start, 'weights 3/1 → 3/4 boundary 1.500 (no +1 pause)').toBeCloseTo(1.5, 3)
  })

  test('weight uses CODE POINTS: one astral char (2 code units) weighs 1', () => {
    const result = estimateCueWords({ start: 0, end: 2, text: '\u{1F600} x' })
    expect(result[1]!.start, 'weights 1/1 → boundary 1.000 (2 code units would weigh 2 → 1.333)').toBe(1)
  })

  test('weight floor of 1: the empty token case cannot arise, single chars weigh 1', () => {
    const result = estimateCueWords({ start: 0, end: 2, text: 'a b' })
    expect(result[0]!.end).toBe(1)
  })

  test('breakAfter from an interior newline and from a trailing newline; multiple spaces collapse', () => {
    const interior = estimateCueWords({ start: 0, end: 2, text: 'a  \n  b' })
    expect(interior[0]!.breakAfter).toBe(true)
    expect(interior[1]!.breakAfter, 'last word: no trailing newline').toBeUndefined()
    const trailing = estimateCueWords({ start: 0, end: 1, text: 'a b\n' })
    expect(trailing[1]!.breakAfter, 'the last token is followed by a newline in the source').toBe(true)
  })

  test('punctuationPauseWeight 0 removes the pause entirely', () => {
    expect(boundary('go. now', 2.1, 0), 'weights 3/3 → boundary 1.050').toBeCloseTo(1.05, 3)
  })

  test('single-word cue with punctuation still pins to both cue bounds exactly', () => {
    const result = estimateCueWords({ start: 4.25, end: 6.75, text: 'hi.' }, { punctuationPauseWeight: 3 })
    expect(result).toHaveLength(1)
    expect(result[0]!.start).toBe(4.25)
    expect(result[0]!.end).toBe(6.75)
    expect(result[0]!.timing).toBe('estimated')
  })

  test('whitespace-only and empty texts yield no atoms (no division by Σ0)', () => {
    expect(estimateCueWords({ start: 0, end: 5, text: ' \t\n ' })).toEqual([])
    expect(estimateCueWords({ start: 0, end: 5, text: '' })).toEqual([])
  })
})
