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
  // Review round 1, finding 2 (reviewer adjudication of the F1 rebuttal,
  // accepted): the original assertions were UNSATISFIABLE, not violations —
  // corrected here per the prescribed disposition (correct, never delete).
  test("CC-05.7: 5×breakAfter words are split so EVERY block satisfies ≤ maxLines (default 2) and the char bound, manual '\\n' joins preserved, full word coverage", () => {
    // Five 4-char words joined by manual breaks. The original test asserted
    // toHaveLength(1) + ≤ 2 lines on that single block — unsatisfiable:
    // domain invariant 2 (block.text == words joined with '\n' after every
    // non-final breakAfter word) forces five '\n'-separated lines in one
    // block. The only US-1.2.6-legal remedy is the between-words split the
    // implementation performs (blockize.ts groupWords `overLines`), so the
    // bounds are asserted over EVERY block of the lawful output.
    const words = [0, 1, 2, 3, 4].map((i) => word('word', i * 0.5, i * 0.5 + 0.3, { breakAfter: true }))
    const blocks = blockize(words)
    expect(blocks).toHaveLength(3) // shipped compliant output (reviewer-verified)
    const covered: WordToken[] = []
    let preservedBreaks = 0
    for (const block of blocks) {
      const lines = block.text.split('\n')
      expect(lines.length, 'US-1.2.6: every block satisfies ≤ maxLines (default 2)').toBeLessThanOrEqual(2)
      for (const line of lines) {
        expect(line.length, `US-1.2.6: ≤ 42 chars/line estimate, got ${line.length}`).toBeLessThanOrEqual(42)
      }
      // Every word carries breakAfter, so every intra-block joiner is the
      // manual '\n' (invariant 2): the split never collapses a manual break
      // into a ' ' joiner.
      expect(block.text).toBe(block.words.map((w) => w.text).join('\n'))
      preservedBreaks += lines.length - 1
      covered.push(...block.words)
    }
    expect(covered).toEqual(words) // full coverage: every word in exactly one block, order kept
    // 4 breakAfter words, 2 intra-block '\n' survive; the block-final ones are
    // vacuous (blockText emits joiners only between words — invariant 2).
    expect(preservedBreaks).toBe(2)
  })

  test('CC-05.7: unbreakable-word residue — a 60-char atomic word stays intact (never mid-word), every OTHER line respects ≤ 42', () => {
    // The original assertion (every line ≤ 42) was unsatisfiable: the
    // 60-char word is ATOMIC — words are never split by block operations
    // (US-1.2.6 "never mid-word"; domain.md Word token: "Never split by
    // block operations") — so EVERY legal blockization leaves a ≥ 60-char
    // line. The premise that splitting before the second word
    // satisfies the bound is false: the over-long line IS the single first
    // word (domain invariant 2 keeps it as its own '\n'-line here). This is
    // the documented unrepairable residue; the enforceable bound — every
    // OTHER line ≤ 42 — is asserted.
    const long = 'a'.repeat(60)
    const short = 'b'.repeat(24)
    const blocks = blockize([word(long, 0, 0.5, { breakAfter: true }), word(short, 0.6, 1.1)])
    expect(blocks).toHaveLength(1)
    const [block] = blocks
    // The atomic word is intact — never mid-word split.
    expect(block!.words.map((w) => w.text)).toEqual([long, short])
    const lines = block!.text.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(long) // invariant 2: '\n' after the breakAfter word
    expect(lines[1]).toBe(short)
    for (const line of lines.slice(1)) {
      expect(line.length, `US-1.2.6: ≤ 42 chars/line estimate for every breakable line, got ${line.length}`).toBeLessThanOrEqual(42)
    }
  })
})
