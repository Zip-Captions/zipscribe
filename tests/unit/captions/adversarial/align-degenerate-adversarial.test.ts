// Adversarial round (EMPTY/ABSENT/DEGENERATE category): degenerate ASR-word
// inputs to `alignCaptionsToWords`. Contract: unit-07 US-07.3 line 30
// ("matched words get ASR times ('aligned'), unmatched words are
// re-interpolated between aligned neighbours and stay 'estimated'; text and
// cue count never change"), frozen contract d.ts lines 56–64 (global
// normalized-token alignment; NEVER mutates texts/counts/block bounds/ids),
// model.ts line 30 (`words: WordToken[] // invariant: sorted, within
// [start, end]`) and domain.md line 56 (invariant 1). FR-07.4: ASR words are
// pure injected input, so degenerate streams are in scope.
import { expect, test } from 'vitest'
import { alignCaptionsToWords } from '@engine/captions/align'
import type { Project } from '@engine/model@07'
import { canonical } from '../canonical'
import { makeBlock, makeProject, makeWord } from '../project-support'

function track(): Project {
  return makeProject({
    duration: 60,
    blocks: [
      makeBlock(0, 2, [makeWord('hello', 0.1, 0.9, { timing: 'estimated' }), makeWord('world', 1.0, 1.9, { timing: 'estimated' })], 'SPK_ADV', 'blk-adv-a1'),
      makeBlock(10, 11, [makeWord('delta', 10.2, 10.8, { timing: 'estimated' })], 'SPK_ADV', 'blk-adv-a2'),
    ],
    speakers: [{ id: 'SPK_ADV', label: 'Adv', color: '#fff' }],
    speakerSource: 'manual',
  })
}

function assertInvariantOne(project: Project): void {
  for (const block of project.blocks) {
    let previousEnd = block.start
    for (const word of block.words) {
      expect(word.start, `invariant 1: word start ≥ previous end (${block.id})`).toBeGreaterThanOrEqual(previousEnd - 1e-9)
      expect(word.end, `invariant 1: end ≥ start (${block.id})`).toBeGreaterThanOrEqual(word.start)
      previousEnd = word.end
    }
  }
}

test('ADVERSARIAL (degenerate): align with ZERO ASR words — every word is re-interpolated across its own block bounds, stays estimated, monotone (invariant 1), and text/word-count/block bounds are untouched; alignedRatio 0 (US-07.3)', () => {
  const project = track()
  const snapshot = canonical(project)
  const { project: aligned, report } = alignCaptionsToWords(project, [])
  expect(report).toEqual({ wordsTotal: 3, wordsAligned: 0, alignedRatio: 0 })
  assertInvariantOne(aligned)
  for (const block of aligned.blocks) {
    for (const word of block.words) {
      expect(word.timing, 'no ASR evidence → estimated').toBe('estimated')
      expect(word.start, 'interpolation inside the block').toBeGreaterThanOrEqual(block.start)
      expect(word.end, 'interpolation inside the block').toBeLessThanOrEqual(block.end)
    }
  }
  expect(aligned.blocks.map((block) => block.text)).toEqual(['hello world', 'delta'])
  expect(canonical(project), 'input project never mutated').toBe(snapshot)
})

test('ADVERSARIAL (degenerate): ASR words entirely outside all block bounds with no lexical match (timestamps 400–500 s, texts match nothing) — every caption word stays unmatched and estimated inside its block bounds; text and count unchanged (US-07.3)', () => {
  const project = track()
  const before = project.blocks.map((block) => [block.id, block.text, block.words.map((word) => word.text)])
  const { project: aligned, report } = alignCaptionsToWords(project, [
    { text: 'zzz', start: 400, end: 400.4 },
    { text: 'qqq', start: 400.5, end: 500 },
  ])
  expect(report.wordsAligned).toBe(0)
  expect(report.alignedRatio).toBe(0)
  const words = aligned.blocks.flatMap((block) => block.words)
  expect(words.every((word) => word.timing === 'estimated'), 'nothing matched').toBe(true)
  assertInvariantOne(aligned)
  const after = aligned.blocks.map((block) => [block.id, block.text, block.words.map((word) => word.text)])
  expect(after, 'text and word count never change').toEqual(before)
  for (const block of aligned.blocks) {
    for (const word of block.words) {
      expect(word.end, 'unmatched re-interpolation never leaves the block').toBeLessThanOrEqual(block.end)
    }
  }
})

test('ADVERSARIAL (degenerate): a pure-punctuation word token against a punctuation-only ASR stream — normalizing to empty must not fabricate an alignment at the ASR token time (the token keeps its estimated intra-block timing); builder-pinned at src/engine/captions/align.test.ts:69, consistent with reading "matching on normalizeToken equality" (d.ts:58) as requiring word content', () => {
  const project = makeProject({
    duration: 60,
    blocks: [makeBlock(0, 1, [makeWord('...', 0.1, 0.5, { timing: 'estimated' }), makeWord('alpha', 0.5, 0.9, { timing: 'estimated' })], 'SPK_ADV', 'blk-adv-punct')],
    speakers: [{ id: 'SPK_ADV', label: 'Adv', color: '#fff' }],
    speakerSource: 'manual',
  })
  const { project: aligned, report } = alignCaptionsToWords(project, [
    { text: '!!!', start: 0.2, end: 0.3 },
    { text: 'alpha', start: 0.6, end: 0.8 },
  ])
  expect(report.wordsAligned, 'only the real word matches').toBe(1)
  const words = aligned.blocks[0]!.words
  expect(words[0]!.timing).toBe('estimated')
  expect(words[0]!.start, 'the punctuation token keeps an in-block estimate').toBeGreaterThanOrEqual(0)
  expect(words[0]!.end).toBeLessThanOrEqual(1)
  expect(words[1]!.timing).toBe('aligned')
  assertInvariantOne(aligned)
})

test('degenerate VIOLATION: a lexically matching ASR word far outside the block bounds is copied verbatim — matched words escape [block.start, block.end] and the unmatched neighbour is interpolated up to the foreign ASR time (model.ts:30 "invariant: sorted, within [start, end]"; domain.md:46 "CaptionBlock 1—* WordToken (ordered, non-overlapping, within block bounds)"; US-07.3 "matched words get ASR times" is specified with no bounds rule — align.ts:142 copies ASR times unguarded)', () => {
  const project = track()
  const { project: aligned } = alignCaptionsToWords(project, [{ text: 'world', start: 120, end: 120.4 }])
  const block = aligned.blocks[0]!
  for (const word of block.words) {
    expect(word.start, `word "${word.text}" must not start before the block (${block.start})`).toBeGreaterThanOrEqual(block.start)
    expect(word.end, `word "${word.text}" must not end after the block (${block.end}) — got ${word.end}`).toBeLessThanOrEqual(block.end)
  }
})
