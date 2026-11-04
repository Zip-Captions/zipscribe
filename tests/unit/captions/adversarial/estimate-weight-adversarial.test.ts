// Adversarial round (boundary-value category): the pinned word-timing rule at
// its weight edges — frozen contract (tests/unit/captions/unit07-api-contract.
// d.ts lines 42-54, mirrored at estimate-timing.ts lines 7-14):
//   weight = max(1, codePointCount(text_i)) + (/[.,!?;:]$/ ? pause : 0)
//   bounds share round3 positions; start_0 = cue start and end_{n−1} = cue end
//   EXACTLY. Code-point (not UTF-16-unit) counting and the pure-punctuation
//   token are the edges probed here; invariant 1 (non-overlapping words,
//   domain.md) must hold at every quantization.
import { describe, expect, test } from 'vitest'
import { estimateCueWords } from '@engine/captions/estimate-timing'

const BOUND = { start: 0, end: 3 }

describe('code-point weight edges', () => {
  test('non-BMP token weighs its CODE POINTS (1), not UTF-16 units (2): [0,3] "😀 ab" splits at 1.0 s', () => {
    const words = estimateCueWords({ ...BOUND, text: '😀 ab' })
    expect(words).toHaveLength(2)
    expect(words[0]!.start).toBe(0)
    expect(words[0]!.end, 'weight 1 vs 2 → 3 × 1/3 = 1.0 s (UTF-16 counting would give 1.5)').toBeCloseTo(1, 9)
    expect(words[1]!.start).toBeCloseTo(1, 9)
    expect(words[1]!.end, 'last word ends exactly at the cue end').toBe(3)
    expect(words[0]!.timing).toBe('estimated')
  })

  test('non-BMP token with a punctuation tail: 😀! = 2 code points + 1 pause = weight 3', () => {
    const words = estimateCueWords({ start: 0, end: 5, text: '😀! ab' })
    // weights 3 and 2 → first boundary 5 × 3/5 = 3.0 s
    expect(words[0]!.end).toBeCloseTo(3, 9)
    expect(words[1]!.start).toBeCloseTo(3, 9)
    expect(words[1]!.end).toBe(5)
  })

  test('surrogate-pair run: two flags (2 code points each) are equal-weighted', () => {
    const words = estimateCueWords({ start: 0, end: 2, text: '🇺🇸 🇬🇧' }) // each flag = 2 regional-indicator code points
    expect(words[0]!.end, 'weights 2 and 2 → exact midpoint').toBeCloseTo(1, 9)
    expect(words[1]!.start).toBeCloseTo(1, 9)
  })
})

describe('pure-punctuation and pinned-set edges', () => {
  test('pure-punctuation tokens count characters AND take the pause: "a ..." → weights 1 and 4', () => {
    const words = estimateCueWords({ start: 0, end: 5, text: 'a ...' })
    expect(words[0]!.end, '5 × 1/(1+4) = 1.0 s').toBeCloseTo(1, 9)
    expect(words[1]!.start).toBeCloseTo(1, 9)
    expect(words[1]!.end).toBe(5)
  })

  test('a lone "!" is max(1,1) + pause = weight 2 (single word still gets the exact cue bounds)', () => {
    const words = estimateCueWords({ start: 0.111, end: 2.333, text: '!' })
    expect(words).toHaveLength(1)
    expect(words[0]!.start, 'start_0 = cue start exactly').toBe(0.111)
    expect(words[0]!.end, 'end_{n−1} = cue end exactly').toBe(2.333)
  })

  test('non-pinned punctuation (em dash) takes no pause weight', () => {
    const words = estimateCueWords({ start: 0, end: 2, text: 'a —' })
    expect(words[0]!.end, 'weights 1 and 1 → exact midpoint (a trailing `.` would push it to 2/3)').toBeCloseTo(1, 9)
  })

  test('interior token ending in pinned punctuation takes the pause: "a b.." → weights 1 and 4', () => {
    const words = estimateCueWords({ start: 0, end: 4, text: 'a b..' })
    expect(words[0]!.end).toBeCloseTo(0.8, 9)
    expect(words[1]!.start).toBeCloseTo(0.8, 9)
  })

  test('punctuationPauseWeight override 0 disables the pause', () => {
    const withPause = estimateCueWords({ start: 0, end: 2, text: 'hi. ok' })
    expect(withPause[0]!.end, 'weights 3+1 and 2 → 2 × 4/6').toBeCloseTo(1.333, 3)
    const without = estimateCueWords({ start: 0, end: 2, text: 'hi. ok' }, { punctuationPauseWeight: 0 })
    expect(without[0]!.end, 'weights 3 and 2 → 2 × 3/5').toBeCloseTo(1.2, 3)
  })
})

describe('one-word / equal-weight / quantization edges', () => {
  test('single word takes the cue bounds verbatim, weight-independent', () => {
    const words = estimateCueWords({ start: 0.111, end: 2.333, text: 'word' })
    expect(words[0]!.start).toBe(0.111)
    expect(words[0]!.end).toBe(2.333)
  })

  test('empty and whitespace-only text estimate to no words', () => {
    expect(estimateCueWords({ start: 0, end: 1, text: '' })).toEqual([])
    expect(estimateCueWords({ start: 0, end: 1, text: '   \n  ' })).toEqual([])
  })

  test('equal weights split evenly', () => {
    const words = estimateCueWords({ start: 0, end: 2, text: 'ab cd' })
    expect(words[0]!.start).toBe(0)
    expect(words[0]!.end).toBeCloseTo(1, 9)
    expect(words[1]!.start).toBeCloseTo(1, 9)
    expect(words[1]!.end).toBe(2)
  })

  test('interior bounds are the shared 3-decimal value on both neighbours (invariant 1: word[i].end ≤ word[i+1].start)', () => {
    const words = estimateCueWords({ start: 0, end: 1, text: 'a bb ccc' }) // weights 1, 2, 3
    expect(words[0]!.end).toBe(0.167)
    expect(words[1]!.start).toBe(0.167)
    expect(words[1]!.end).toBe(0.5)
    expect(words[2]!.start).toBe(0.5)
    expect(words[2]!.end).toBe(1)
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index]!.start).toBeGreaterThanOrEqual(words[index - 1]!.end)
    }
  })

  test('sub-millisecond cue: quantization collapses interiors but never inverts (invariant 1)', () => {
    const words = estimateCueWords({ start: 0, end: 0.001, text: 'a b c' })
    expect(words[0]!.start).toBe(0)
    expect(words[2]!.end).toBe(0.001)
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index]!.start).toBeGreaterThanOrEqual(words[index - 1]!.end)
    }
    for (const word of words) expect(word.start).toBeLessThanOrEqual(word.end)
  })

  test('zero-span cue keeps every word degenerate but ordered', () => {
    const words = estimateCueWords({ start: 2, end: 2, text: 'a bb' })
    for (const word of words) {
      expect(word.start).toBe(2)
      expect(word.end).toBe(2)
    }
  })
})
