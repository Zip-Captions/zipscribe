// Adversary suite (unit-05 review): blockize boundary values straight from
// US-1.2.6 / CC-05.7 — "≤ maxLines (default 2), ≤ 42 chars/line estimate,
// duration 0.7–7 s where words allow, split at gaps > 0.6 s …, never
// mid-word" — plus the confidence threshold at exactly 0.45 and degenerate
// word lists. Expectations are derived from the unit spec text, not from the
// existing suites. `breakAfter` is part of the WordToken contract
// (domain.md glossary: "text + start/end (+ optional probability, speakerId,
// breakAfter)") and blockize's own frozen contract documents '\n'-joins after
// breakAfter words (domain.md invariant 2) — so the ≤ maxLines / ≤ 42
// per-line bounds must hold for lines formed by breakAfter as well.
import { describe, expect, test } from 'vitest'
import { blockize } from '@engine/asr/blockize'
import type { WordToken } from '@engine/model'

const word = (text: string, start: number, end: number, extra: Partial<WordToken> = {}): WordToken => ({ text, start, end, timing: 'asr', ...extra })

describe('adversary: gap split at the exact 0.6 s boundary (US-1.2.6 "split at gaps > 0.6 s")', () => {
  test('a gap equal to exactly the double 0.6 does NOT split (only strictly greater splits)', () => {
    // (end 0.4, start 1.0): the IEEE subtraction fl(1.0 - 0.4) is exactly the
    // double 0.6 (Sterbenz: both operands in [0.5, 1]), so the contract bound
    // "gap > 0.6" is false → no split.
    const start2 = 1.0
    const end1 = 0.4
    expect(start2 - end1).toBe(0.6) // pin the construction itself
    const blocks = blockize([word('alpha', 0, end1), word('beta', start2, start2 + 0.3)])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.text).toBe('alpha beta')
  })

  test('one ulp past 0.6 DOES split', () => {
    const start2 = 1 + Number.EPSILON
    expect(start2 - 0.4).toBeGreaterThan(0.6) // pin: strictly above the bound
    const blocks = blockize([word('alpha', 0, 0.4), word('beta', start2, start2 + 0.3)])
    expect(blocks).toHaveLength(2)
  })
})

describe('adversary: duration ceiling at exactly 7.0 s (US-1.2.6 "duration 0.7–7 s")', () => {
  test('a word span of exactly 7.0 s is still one block (bound inclusive)', () => {
    const blocks = blockize([word('one', 0, 2), word('two', 2.2, 4.4), word('three', 4.6, 7)])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.words).toHaveLength(3)
  })

  test('a word span just past 7.0 s splits', () => {
    const blocks = blockize([word('one', 0, 2), word('two', 2.2, 4.4), word('three', 4.6, 7.000000001)])
    expect(blocks).toHaveLength(2)
  })
})

describe('adversary: confidence threshold at exactly 0.45 (US-1.2.6 "mean word probability < 0.45")', () => {
  const flags = { confidence: true, punctuation: false }

  test('mean word probability of exactly 0.45 does NOT set confidence (strict <)', () => {
    const blocks = blockize([word('ok', 0, 0.4, { probability: 0.45 }), word('fine', 0.5, 0.9, { probability: 0.45 })], { engineFlags: flags })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.confidence).toBeUndefined()
  })

  test('just below 0.45 sets it', () => {
    const blocks = blockize([word('hm', 0, 0.4, { probability: 0.44 })], { engineFlags: flags })
    expect(blocks[0]!.confidence).toBe(0.44)
  })

  test('confidence is never fabricated when the engine flag is false, even at probability 0', () => {
    const blocks = blockize([word('x', 0, 0.4, { probability: 0 })])
    expect(blocks[0]!.confidence).toBeUndefined()
  })
})

describe('adversary: degenerate word lists', () => {
  test('empty word list → no blocks (domain invariant 3: no empty blocks)', () => {
    expect(blockize([])).toEqual([])
  })

  test('single word → exactly one block holding the word unsplit (never mid-word)', () => {
    const blocks = blockize([word('solo', 1, 1.3)])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.words).toEqual([word('solo', 1, 1.3)])
    expect(blocks[0]!.text).toBe('solo')
  })
})

describe('adversary: breakAfter words must respect the same block bounds as engine words', () => {
  test('VIOLATION CANDIDATE: breakAfter words beyond maxLines stay in one block (US-1.2.6: every block satisfies ≤ maxLines, default 2)', () => {
    // Five 4-char words joined by manual breaks: nothing in groupWords splits
    // (no punctuation, gap 0.2 < 0.6, joined 4*5+4 = 24 ≤ 85 char budget,
    // span 2.3 s < 7 s) → one block whose text has five '\n'-separated lines.
    const words = [0, 1, 2, 3, 4].map((i) => word('word', i * 0.5, i * 0.5 + 0.3, { breakAfter: true }))
    const blocks = blockize(words)
    expect(blocks).toHaveLength(1) // grouping itself
    const lines = blocks[0]!.text.split('\n')
    expect(lines.length, 'US-1.2.6: every block satisfies ≤ maxLines (default 2)').toBeLessThanOrEqual(2)
  })

  test('VIOLATION CANDIDATE: a breakAfter line longer than the 42-char estimate is not re-split (US-1.2.6: every block satisfies ≤ 42 chars/line estimate)', () => {
    // joined length 60 + 1 + 24 = 85 = the char budget → stays one block with
    // a first line of 60 characters; splitting BEFORE the second word (never
    // mid-word) would satisfy the bound, so "where words allow" is met.
    const long = 'a'.repeat(60)
    const short = 'b'.repeat(24)
    const blocks = blockize([word(long, 0, 0.5, { breakAfter: true }), word(short, 0.6, 1.1)])
    expect(blocks).toHaveLength(1)
    const lines = blocks[0]!.text.split('\n')
    for (const line of lines) {
      expect(line.length, `US-1.2.6: ≤ 42 chars/line estimate, got ${line.length}`).toBeLessThanOrEqual(42)
    }
  })
})
