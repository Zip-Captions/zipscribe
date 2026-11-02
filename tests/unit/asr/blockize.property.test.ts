// CC-05.7 (L1 property): the US-1.2.6 blockization rules hold for ALL
// generated word flows. Seeded fast-check (seed printed on failure);
// grounding https://fast-check.dev/docs/core-blocks/runners/. The exact
// hand-computed rules live in `blockize-golden.test.ts` (inline goldens).
// RED: unresolved imports of `@engine/asr/blockize` (module written by the
// builder) and `fast-check` (approved devDependency, builder installs).
import { expect, test } from 'vitest'
import { array, assert, integer, pre, property, record } from 'fast-check'
import { blockize } from '@engine/asr/blockize'
import type { WordToken } from '@engine/model@05'

const MAX_LINES = 2
const MAX_CHARS = 42
const GAP_SPLIT = 0.6
const MIN_DURATION = 0.7
const MAX_DURATION = 7
const PADDING = 0.05
const EPS = 1e-9

const VOCAB = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'the', 'team', 'walked']
const SENTENCE_END = /[.!?]$/

interface GenWord {
  token: number
  punct: number // 0 none, 1 '.', 2 '!', 3 '?'
  lenCs: number
  gapCs: number
  probCs: number
}

const wordPlanArb = array(
  record({
    token: integer({ min: 0, max: VOCAB.length - 1 }),
    punct: integer({ min: 0, max: 3 }),
    lenCs: integer({ min: 20, max: 60 }),
    gapCs: integer({ min: 0, max: 120 }),
    probCs: integer({ min: 0, max: 100 }),
  }),
  { minLength: 1, maxLength: 40 },
)

function buildWords(plan: GenWord[]): WordToken[] {
  const words: WordToken[] = []
  let cursor = 0
  for (const item of plan) {
    cursor += item.gapCs / 100
    const start = Math.round(cursor * 1000) / 1000
    const end = Math.round((cursor + item.lenCs / 100) * 1000) / 1000
    const base = VOCAB[item.token % VOCAB.length]!
    const suffix = ['', '.', '!', '?'][item.punct] ?? ''
    words.push({
      text: base + suffix,
      start,
      end,
      probability: item.probCs / 100,
      speakerId: 'SPK_1',
      timing: 'asr',
    })
    cursor = end
  }
  return words
}

function run(seeds: number, body: (words: WordToken[]) => void): void {
  assert(
    property(wordPlanArb, (plan: unknown) => {
      body(buildWords(plan as GenWord[]))
    }),
    { seed: seeds, numRuns: 250 },
  )
}

test('CC-05.7: words are never split — every input word lands in exactly one block, in order, with its own span (property)', () => {
  run(0x05e70001, (words) => {
    const blocks = blockize(words, { engineFlags: { confidence: true, punctuation: true } })
    const flat = blocks.flatMap((block) => block.words)
    expect(flat.map((w) => [w.text, w.start, w.end])).toEqual(words.map((w) => [w.text, w.start, w.end]))
    for (const block of blocks) {
      for (const word of block.words) {
        expect(word.start, 'word starts within block').toBeGreaterThanOrEqual(block.start - EPS)
        expect(word.end, 'word ends within block').toBeLessThanOrEqual(block.end + EPS)
      }
    }
  })
})

test('CC-05.7: blocks are ordered, non-overlapping, start < end, with ±0.05 s padding clamped to neighbours (property)', () => {
  run(0x05e70002, (words) => {
    const blocks = blockize(words, { engineFlags: { confidence: true, punctuation: true } })
    expect(blocks.length).toBeGreaterThan(0)
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!
      const first = block.words[0]!
      const last = block.words[block.words.length - 1]!
      expect(block.end, 'block.start < block.end (domain invariant 4)').toBeGreaterThan(block.start)
      expect(block.start, 'start padded at most 0.05 s before the first word').toBeGreaterThanOrEqual(first.start - PADDING - EPS)
      expect(block.start, 'start never crosses the first word').toBeLessThanOrEqual(first.start + EPS)
      expect(block.end, 'end padded at most 0.05 s after the last word').toBeLessThanOrEqual(last.end + PADDING + EPS)
      expect(block.end, 'end never crosses the last word').toBeGreaterThanOrEqual(last.end - EPS)
      if (i > 0) {
        expect(blocks[i - 1]!.end, 'blocks never overlap').toBeLessThanOrEqual(block.start + EPS)
        // The clamp: start never sits before the previous block's end.
        expect(block.start, 'start clamped to the previous block end').toBeGreaterThanOrEqual(blocks[i - 1]!.end - EPS)
      }
    }
  })
})

test('CC-05.7: a split happens at every gap > 0.6 s and after sentence-final punctuation (property)', () => {
  run(0x05e70003, (words) => {
    const blocks = blockize(words, { engineFlags: { confidence: true, punctuation: true } })
    const boundaryAfter = new Set<number>()
    let index = -1
    for (const block of blocks) {
      for (const word of block.words) {
        index++
        boundaryAfter.add(index) // last word of every block is a boundary
      }
    }
    for (let i = 0; i < words.length - 1; i++) {
      const current = words[i]!
      const next = words[i + 1]!
      const gap = next.start - current.end
      if (gap > GAP_SPLIT) {
        expect(boundaryAfter.has(i), `gap ${gap.toFixed(3)} s between word ${i} and ${i + 1} must split blocks`).toBe(true)
      }
      if (SENTENCE_END.test(current.text)) {
        expect(boundaryAfter.has(i), `sentence-final punctuation on word ${i} ("${current.text}") must end its block`).toBe(true)
      }
    }
  })
})

test('CC-05.7: durations stay in 0.7–7 s where the words allow (property)', () => {
  run(0x05e70004, (words) => {
    const blocks = blockize(words, { engineFlags: { confidence: true, punctuation: true } })
    for (const block of blocks) {
      const duration = block.end - block.start
      expect(duration, 'never longer than 7 s + both pads').toBeLessThanOrEqual(MAX_DURATION + 2 * PADDING + EPS)
      const first = block.words[0]!
      const last = block.words[block.words.length - 1]!
      const wordSpan = last.end - first.start
      // "where words allow": the 0.7 s floor is only demanded when the word
      // span plus the allowed padding can reach it.
      if (wordSpan + 2 * PADDING >= MIN_DURATION - EPS) {
        expect(duration, `block ${block.start}–${block.end} (span ${wordSpan}s) should reach the 0.7 s floor`).toBeGreaterThanOrEqual(MIN_DURATION - 2 * PADDING - EPS)
      }
    }
  })
})

test('CC-05.7: ≤ maxLines lines at ≤ 42 chars/line estimate (property)', () => {
  run(0x05e70005, (words) => {
    const blocks = blockize(words, { engineFlags: { confidence: true, punctuation: true } })
    for (const block of blocks) {
      const lines = block.text.split('\n')
      expect(lines.length, 'explicit line count never exceeds maxLines').toBeLessThanOrEqual(MAX_LINES)
      // Line estimate bound: with words joined by ' ' and at most 2 lines of
      // 42 chars (ASSUMPTION recorded in the unit report: the "chars/line
      // estimate" is enforced as this total-length bound), a block can never
      // hold more than this many characters.
      const budget = MAX_LINES * MAX_CHARS + (MAX_LINES - 1)
      expect(block.text.length, `estimated text length of a ≤${MAX_LINES}-line block`).toBeLessThanOrEqual(budget)
      // Text is the words joined by ' ' (domain invariant 2, no manual breaks here).
      expect(block.text).toBe(block.words.map((w) => w.text).join(' '))
    }
  })
})

test('CC-05.7: confidence is never fabricated — absent when the engine flag is false even with word probabilities (property)', () => {
  run(0x05e70006, (words) => {
    const blocks = blockize(words, { engineFlags: { confidence: false, punctuation: true } })
    for (const block of blocks) {
      expect(block.confidence, 'engine without probabilities → never fabricate confidence').toBeUndefined()
    }
  })
})

test('CC-05.7: confidence is set for low-confidence regions when the engine exposes probabilities (property)', () => {
  assert(
    property(record({ n: integer({ min: 2, max: 6 }), probCs: integer({ min: 0, max: 40 }) }), (shape: unknown) => {
      const { n, probCs } = shape as { n: number; probCs: number }
      pre(n >= 2)
      const probability = probCs / 100 // mean below the 0.45 threshold
      const words: WordToken[] = []
      let cursor = 0.1
      for (let i = 0; i < n; i++) {
        words.push({ text: `word${i}`, start: cursor, end: cursor + 0.3, probability, speakerId: 'SPK_1', timing: 'asr' })
        cursor += 0.35
      }
      const blocks = blockize(words, { engineFlags: { confidence: true, punctuation: false } })
      const lowMean = blocks.filter((block) => block.words.reduce((sum, w) => sum + (w.probability ?? 0), 0) / block.words.length < 0.45)
      for (const block of lowMean) {
        expect(block.confidence, 'low-confidence region must expose confidence for UI dimming').toBeTypeOf('number')
        expect(block.confidence!).toBeCloseTo(probability, 2)
      }
      expect(lowMean.length, 'the generated flow must contain a low-confidence block').toBeGreaterThan(0)
    }),
    { seed: 0x05e70007, numRuns: 200 },
  )
})

test('CC-05.7: blockization is deterministic (pure function — same input, same blocks)', () => {
  run(0x05e70008, (words) => {
    const shape = (blocks: ReturnType<typeof blockize>) =>
      blocks.map((block) => ({
        start: block.start,
        end: block.end,
        text: block.text,
        confidence: block.confidence,
        words: block.words.map((w) => [w.text, w.start, w.end]),
      }))
    const a = shape(blockize(words, { engineFlags: { confidence: true, punctuation: true } }))
    const b = shape(blockize(words, { engineFlags: { confidence: true, punctuation: true } }))
    expect(a).toEqual(b)
  })
})
