// CC-07.3 / US-07.3 (L1): word timings estimated inside an imported cue by
// CHARACTER WEIGHT with a punctuation PAUSE WEIGHT, `timing: 'estimated'`,
// within the pinned rule (tests/unit/captions/unit07-api-contract.d.ts
// header). Cue start/end are the file's truth (domain glossary
// "Estimated timing"); word times are bounded by them.
import { expect, test } from 'vitest'
import { array, assert, constantFrom, integer, property, record } from 'fast-check'
import { estimateCueWords } from '@engine/captions/estimate-timing'
import { textFromWords } from './project-support'

const EPS = 1e-9

function words(text: string, start: number, end: number) {
  return estimateCueWords({ start, end, text })
}

test('CC-07.3 / US-07.3: character weight — double the characters get double the width (golden)', () => {
  // "a bb" weights 1/2 over Σ3 on a 3 s cue → boundary at exactly 1.000 s.
  const result = words('a bb', 0, 3)
  expect(result.map((word) => word.text)).toEqual(['a', 'bb'])
  expect(result[0]!.start).toBe(0)
  expect(result[0]!.end).toBeCloseTo(1, 3)
  expect(result[1]!.start).toBeCloseTo(1, 3)
  expect(result[1]!.end).toBe(3)
})

test('CC-07.3 / US-07.3: punctuation adds a short pause weight after the word (golden)', () => {
  const bare = words('go now', 0, 2.1) // weights 2/3 over Σ5 → boundary 0.840
  const punctuated = words('go. now', 0, 2.1) // weights 3/3 over Σ6 → boundary 1.050
  expect(bare[1]!.start).toBeCloseTo(0.84, 3)
  expect(punctuated[1]!.start, 'the sentence-final punctuation pushes the next word later').toBeCloseTo(1.05, 3)
  expect(punctuated[1]!.start).toBeGreaterThan(bare[1]!.start)
  expect(punctuated[1]!.end).toBe(2.1)
})

test('CC-07.3: the pause weight is configurable in character-weight units', () => {
  const defaultPause = words('go. now', 0, 2.4)[1]!.start // (3+1)/7 of 2.4 → 1.371
  const widePause = estimateCueWords({ start: 0, end: 2.4, text: 'go. now' }, { punctuationPauseWeight: 2 })[1]!.start // (3+2)/8 → 1.500
  expect(defaultPause).toBeCloseTo(1.371, 3)
  expect(widePause).toBeCloseTo(1.5, 3)
})

test('CC-07.3 / invariant 2: line breaks become breakAfter on the preceding word; words stay the only atoms', () => {
  const result = words('a b\nc', 0, 3)
  expect(result.map((word) => word.text)).toEqual(['a', 'b', 'c'])
  expect(result[0]!.breakAfter, 'no break inside the line').toBeUndefined()
  expect(result[1]!.breakAfter, 'the manual line break belongs to the word before it').toBe(true)
  expect(result[2]!.breakAfter).toBeUndefined()
  expect(textFromWords(result), 'invariant 2: text re-derives from the words').toBe('a b\nc')
})

test('CC-07.3: a single-word cue spans the whole cue; empty/whitespace text yields no words', () => {
  const single = words('hi', 5, 5.5)
  expect(single).toHaveLength(1)
  expect(single[0]!.start).toBe(5)
  expect(single[0]!.end).toBe(5.5)
  expect(words('', 0, 1)).toEqual([])
  expect(words('   \n  ', 0, 1), 'whitespace-only cue has no timing atoms').toEqual([])
})

test('CC-07.3: runs of whitespace collapse — words carry no surrounding whitespace', () => {
  const result = words('  hello   world  ', 0, 1)
  expect(result.map((word) => word.text)).toEqual(['hello', 'world'])
  for (const word of result) {
    expect(word.text).toBe(word.text.trim())
  }
})

// --- property half ---------------------------------------------------------

interface CuePlan {
  startMs: number
  durationMs: number
  tokens: { word: string; punct: string }[]
}

const cueArb = record({
  startMs: integer({ min: 0, max: 100_000 }),
  durationMs: integer({ min: 100, max: 30_000 }),
  tokens: array(record({ word: constantFrom('alpha', 'bravo', 'charlie', 'del', 'i'), punct: constantFrom('', '.', ',', '!', '?') }), { minLength: 1, maxLength: 10 }),
})

function isRound3(value: number): boolean {
  return Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6
}

test('CC-07.3: estimated words satisfy invariant 1 inside the cue, are 3-decimal, and pinned to the cue bounds (property)', () => {
  assert(
    property(cueArb, (plan: unknown) => {
      const { startMs, durationMs, tokens } = plan as CuePlan
      const start = startMs / 1000
      const end = (startMs + durationMs) / 1000
      const text = tokens.map((token) => token.word + token.punct).join(' ')
      const result = estimateCueWords({ start, end, text })

      expect(result.map((word) => word.text), 'one atom per whitespace token').toEqual(tokens.map((token) => token.word + token.punct))
      for (const word of result) {
        expect(word.timing, 'imported word timings are estimates until aligned').toBe('estimated')
      }
      expect(result[0]!.start, 'first word starts at the cue start').toBe(start)
      expect(result[result.length - 1]!.end, 'last word ends at the cue end').toBe(end)
      for (const word of result) {
        expect(isRound3(word.start), `start ${word.start} is 3-decimal (invariant 6)`).toBe(true)
        expect(isRound3(word.end), `end ${word.end} is 3-decimal (invariant 6)`).toBe(true)
        expect(word.start, 'word never precedes the cue').toBeGreaterThanOrEqual(start - EPS)
        expect(word.end, 'word never exceeds the cue').toBeLessThanOrEqual(end + EPS)
      }
      for (let index = 0; index < result.length; index++) {
        const word = result[index]!
        expect(word.end, `invariant 1: start ≤ end (word ${index})`).toBeGreaterThanOrEqual(word.start - EPS)
        if (index + 1 < result.length) {
          expect(result[index + 1]!.start, `invariant 1: non-overlapping consecutive words (word ${index})`).toBeGreaterThanOrEqual(word.end - EPS)
        }
      }
    }),
    { seed: 0x07c30001, numRuns: 400 },
  )
})

test('CC-07.3: longer words never receive less time than shorter ones at the same position (property)', () => {
  const pairArb = record({ longLen: integer({ min: 2, max: 12 }), shortLen: integer({ min: 1, max: 2 }) })
  assert(
    property(pairArb, (plan: unknown) => {
      const { longLen, shortLen } = plan as { longLen: number; shortLen: number }
      const longWord = 'x'.repeat(longLen)
      const shortWord = 'y'.repeat(shortLen)
      const result = estimateCueWords({ start: 0, end: 10, text: `${longWord} ${shortWord}` })
      const longSpan = result[0]!.end - result[0]!.start
      const shortSpan = result[1]!.end - result[1]!.start
      expect(longSpan, `char weight: ${longLen} chars ≥ ${shortLen} chars gets no less time`).toBeGreaterThanOrEqual(shortSpan - 1e-6)
    }),
    { seed: 0x07c30002, numRuns: 200 },
  )
})
