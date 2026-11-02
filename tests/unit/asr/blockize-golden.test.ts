// CC-05.7 (L1 inline goldens): the hand-computed US-1.2.6 cases. Every
// expected value below is derived in a comment from the rule text in
// unit-05 US-1.2.6 — never from an implementation. The property half of
// CC-05.7 is in `blockize.property.test.ts`.
import { expect, test } from 'vitest'
import { blockize } from '@engine/asr/blockize'
import type { WordToken } from '@engine/model@05'

const FLAGS = { confidence: false, punctuation: true }

function word(text: string, start: number, end: number, extra: Partial<WordToken> = {}): WordToken {
  return { text, start, end, speakerId: 'SPK_1', timing: 'asr', ...extra }
}

test('CC-05.7 / US-1.2.6: a short continuous phrase is one block with ±0.05 s padding (golden)', () => {
  const words = [word('the', 0.3, 0.55), word('cat', 0.6, 0.85), word('sat', 0.9, 1.15), word('down', 1.2, 1.6)]
  const blocks = blockize(words, { engineFlags: FLAGS })
  expect(blocks).toHaveLength(1)
  const block = blocks[0]!
  // start = 0.3 − 0.05 = 0.25; end = 1.6 + 0.05 = 1.65 (no neighbours to clamp against).
  expect(block.start).toBeCloseTo(0.25, 3)
  expect(block.end).toBeCloseTo(1.65, 3)
  expect(block.text).toBe('the cat sat down')
  expect(block.speakerId).toBe('SPK_1')
  expect(block.confidence, 'engine flag false → absent').toBeUndefined()
  expect(block.words.map((w) => w.text)).toEqual(['the', 'cat', 'sat', 'down'])
})

test('CC-05.7 / US-1.2.6: split at a gap > 0.6 s (golden)', () => {
  const words = [
    word('alpha', 0.1, 0.4),
    word('bravo', 0.45, 0.75),
    // gap 0.85 s > 0.6 → split here
    word('charlie', 1.6, 1.95),
    word('delta', 2.0, 2.3),
  ]
  const blocks = blockize(words, { engineFlags: FLAGS })
  expect(blocks).toHaveLength(2)
  expect(blocks[0]!.words.map((w) => w.text)).toEqual(['alpha', 'bravo'])
  expect(blocks[1]!.words.map((w) => w.text)).toEqual(['charlie', 'delta'])
})

test('CC-05.7 / US-1.2.6: split after sentence-final punctuation, punctuation preserved when the engine provides it (golden)', () => {
  const words = [word('hello', 0.1, 0.45), word('world.', 0.5, 0.9), word('next', 1.0, 1.3), word('time', 1.35, 1.7)]
  const blocks = blockize(words, { engineFlags: { confidence: false, punctuation: true } })
  expect(blocks).toHaveLength(2)
  expect(blocks[0]!.text).toBe('hello world.')
  expect(blocks[1]!.text).toBe('next time')

  const stripped = blockize(words, { engineFlags: { confidence: false, punctuation: false } })
  for (const block of stripped) {
    expect(block.text, 'engine without punctuation must not surface fabricated punctuation').not.toMatch(/[.!?]/)
  }
})

test('CC-05.7 / US-1.2.6: padding clamps — end stops at the next block start (golden)', () => {
  // Forced punctuation split with a tight neighbour: A's +0.05 pad (10.05)
  // would cross B's start (10.06 − 0.05 = 10.01), so A.end clamps to 10.01.
  const words = [word('first.', 9.5, 10.0), word('second', 10.06, 10.4), word('third', 10.45, 10.75)]
  const blocks = blockize(words, { engineFlags: { confidence: false, punctuation: true } })
  expect(blocks).toHaveLength(2)
  const [a, b] = blocks as [NonNullable<(typeof blocks)[number]>, NonNullable<(typeof blocks)[number]>]
  expect(b.start).toBeCloseTo(10.01, 3)
  expect(a.end).toBeCloseTo(10.01, 3) // clamped to the next block start, never past the word end at 10.0
  expect(a.end).toBeGreaterThanOrEqual(10.0)
  // Words always stay inside their block bounds.
  expect(a.words[0]!.end).toBeLessThanOrEqual(a.end + 1e-9)
})

test('CC-05.7 / US-1.2.6: start padding clamps to the previous block end (golden)', () => {
  // A ("one.") ends its word at 10.5 → A.end candidate 10.55. B's first word
  // starts at 10.57 → B.start candidate 10.52 < 10.55, so B.start clamps UP
  // to the previous block end (10.55) — still ≤ the word start (10.57).
  const words = [word('one.', 10.1, 10.5), word('two', 10.57, 10.9), word('three', 10.95, 11.2)]
  const blocks = blockize(words, { engineFlags: { confidence: false, punctuation: true } })
  expect(blocks).toHaveLength(2)
  const a = blocks[0]!
  const b = blocks[1]!
  expect(a.end).toBeCloseTo(10.55, 3)
  expect(b.start, 'start clamped to the previous block end').toBeCloseTo(10.55, 3)
  expect(b.start).toBeGreaterThanOrEqual(a.end - 1e-9)
  expect(b.start, 'a clamped start never crosses the first word').toBeLessThanOrEqual(10.57 + 1e-9)
})

test('CC-05.7 / US-1.2.6: long runs respect the 2-line/42-char estimate and the 7 s ceiling (golden)', () => {
  const words: WordToken[] = []
  let cursor = 0
  for (let i = 0; i < 40; i++) {
    words.push(word('characteristic', cursor, cursor + 0.45, { speakerId: 'SPK_1', timing: 'asr' }))
    cursor += 0.5
  }
  const blocks = blockize(words, { engineFlags: FLAGS })
  expect(blocks.length).toBeGreaterThan(1)
  for (const block of blocks) {
    expect(block.text.length, '≤ 2 lines × 42 chars + joiner (estimate)').toBeLessThanOrEqual(2 * 42 + 1)
    expect(block.end - block.start, 'duration ceiling 7 s + both pads').toBeLessThanOrEqual(7.1 + 1e-9)
  }
  // Full coverage, never mid-word.
  expect(blocks.flatMap((b) => b.words.map((w) => w.text))).toEqual(words.map((w) => w.text))
})

test('CC-05.7 / US-1.2.6: confidence — set below the 0.45 mean, absent when the engine has no probabilities (golden)', () => {
  const low = [
    word('mumble', 0.1, 0.5, { probability: 0.3 }),
    word('jumble', 0.55, 0.95, { probability: 0.35 }),
    word('grumble', 1.0, 1.5, { probability: 0.25 }),
  ]
  const flagged = blockize(low, { engineFlags: { confidence: true, punctuation: false } })
  for (const block of flagged) {
    const mean = block.words.reduce((sum, w) => sum + (w.probability ?? 0), 0) / block.words.length
    expect(mean).toBeLessThan(0.45)
    expect(block.confidence, 'low-confidence region carries confidence for UI dimming').toBeTypeOf('number')
    expect(block.confidence!).toBeCloseTo(mean, 2)
  }
  const notConfident = blockize(low, { engineFlags: { confidence: false, punctuation: false } })
  for (const block of notConfident) {
    expect(block.confidence, 'confidence:false engine → NEVER fabricated, even with word probabilities').toBeUndefined()
  }
})
