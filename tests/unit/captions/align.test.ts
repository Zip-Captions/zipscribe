// CC-07.3 (L1) / FR-07.4 / US-07.3: align.ts is PURE with the ASR words
// INJECTED (no SDK import — "align.ts takes ASR words as input so it's unit-
// testable with fixtures"). Needleman–Wunsch-style normalized-token global
// alignment; matched words get ASR times ('aligned'), unmatched words are
// re-interpolated between aligned neighbours and stay 'estimated'; TEXT AND
// CUE COUNT NEVER CHANGE (US-07.3 — asserted as a property under perturbed
// timings). The end-to-end honest-MAE case (real pipeline ASR words on the
// en-clean fixture, 1.5× the unit-02 direct-transcription baseline) is the
// L4 spec e2e/captions/align-mae.spec.ts.
import { expect, test } from 'vitest'
import { array, assert, integer, property, record } from 'fast-check'
import { alignCaptionsToWords } from '@engine/captions/align'
import type { AsrWordInput } from '@engine/captions/contract@07'
import type { Project, WordToken } from '@engine/model@07'
import { canonical } from './canonical'
import { makeBlock, makeProject, makeWord, spacedWords } from './project-support'

function projectWith(blocks: { start: number; end: number; words: WordToken[] }[]): Project {
  return makeProject({
    duration: 60,
    blocks: blocks.map((block, index) => makeBlock(block.start, block.end, block.words, `SPK_TEST_${index + 1}`, `blk-align-${index + 1}`)),
    speakers: blocks.map((_, index) => ({ id: `SPK_TEST_${index + 1}`, label: `Speaker ${index + 1}`, color: '#fff' })),
    speakerSource: 'manual',
  })
}

test('CC-07.3 / US-07.3: matched words take the ASR times and become \'aligned\'', () => {
  const project = projectWith([{ start: 0, end: 3, words: [makeWord('the', 0, 1, { timing: 'estimated' }), makeWord('quick', 1, 2, { timing: 'estimated' }), makeWord('brown', 2, 3, { timing: 'estimated' })] }])
  const asrWords: AsrWordInput[] = [
    { text: 'the', start: 0.05, end: 0.45 },
    { text: 'quick', start: 0.9, end: 1.4 },
    { text: 'fox', start: 1.5, end: 1.8 }, // in ASR but not in the captions
    { text: 'brown', start: 2.2, end: 2.6 },
  ]
  const { project: aligned, report } = alignCaptionsToWords(project, asrWords)
  const words = aligned.blocks[0]!.words
  expect(words[0]!.start, 'ASR time transferred').toBe(0.05)
  expect(words[0]!.end).toBe(0.45)
  expect(words[0]!.timing).toBe('aligned')
  expect(words[2]!.start).toBe(2.2)
  expect(words[2]!.timing).toBe('aligned')
  expect(report.wordsTotal).toBe(3)
  expect(report.wordsAligned, "ASR-only 'fox' does not create caption words").toBe(3)
  expect(report.alignedRatio).toBeCloseTo(1, 3)
  expect(aligned.blocks[0]!.text, 'text NEVER changes (US-07.3)').toBe('the quick brown')
})

test('CC-07.3: normalized matching — punctuation and case differences still align', () => {
  const project = projectWith([{ start: 0, end: 2, words: [makeWord('Hello,', 0, 1, { timing: 'estimated' }), makeWord('world.', 1, 2, { timing: 'estimated' })] }])
  const { project: aligned, report } = alignCaptionsToWords(project, [
    { text: 'hello', start: 0.2, end: 0.6 },
    { text: 'WORLD', start: 1.1, end: 1.7 },
  ])
  expect(report.wordsAligned).toBe(2)
  expect(aligned.blocks[0]!.words[0]!.start).toBe(0.2)
  expect(aligned.blocks[0]!.words[1]!.start).toBe(1.1)
})

test('CC-07.3: unmatched words are re-interpolated between aligned neighbours and stay \'estimated\'', () => {
  const project = projectWith([{ start: 0, end: 5, words: [makeWord('alpha', 0, 1, { timing: 'estimated' }), makeWord('beta', 1, 3, { timing: 'estimated' }), makeWord('gamma', 3, 5, { timing: 'estimated' })] }])
  const { project: aligned, report } = alignCaptionsToWords(project, [
    { text: 'alpha', start: 0, end: 1 },
    { text: 'gamma', start: 4, end: 5 },
  ])
  const beta = aligned.blocks[0]!.words[1]!
  expect(beta.timing, 'unmatched stays estimated').toBe('estimated')
  expect(beta.start, 're-interpolated after the aligned neighbour').toBeGreaterThanOrEqual(1 - 1e-9)
  expect(beta.end, 're-interpolated before the next aligned neighbour').toBeLessThanOrEqual(4 + 1e-9)
  expect(beta.end, 'invariant 1 survives').toBeGreaterThanOrEqual(beta.start)
  expect(report.wordsAligned).toBe(2)
  expect(report.alignedRatio, 'report gives % words aligned (US-07.3)').toBeCloseTo(2 / 3, 3)
})

test('CC-07.3: empty ASR input leaves the project unchanged and reports 0 % aligned', () => {
  const project = projectWith([{ start: 0, end: 2, words: spacedWords('alpha bravo', 0, 2, 'estimated') }])
  const before = canonical(project)
  const { project: aligned, report } = alignCaptionsToWords(project, [])
  expect(canonical(aligned), 'no aligned neighbours → nothing to move').toBe(before)
  expect(report).toEqual({ wordsTotal: 2, wordsAligned: 0, alignedRatio: 0 })
})

test('CC-07.3: align is pure — the input project object is never mutated', () => {
  const project = projectWith([{ start: 0, end: 3, words: spacedWords('the quick brown', 0, 3, 'estimated') }])
  const snapshot = structuredClone(project)
  alignCaptionsToWords(project, [
    { text: 'the', start: 0.1, end: 0.5 },
    { text: 'brown', start: 2.5, end: 2.9 },
  ])
  expect(canonical(project), 'input untouched (new project handed back)').toBe(canonical(snapshot))
})

test('CC-07.3: alignment is deterministic — same inputs, byte-equal output', () => {
  const project = projectWith([
    { start: 0, end: 2, words: spacedWords('alpha bravo charlie', 0, 2, 'estimated') },
    { start: 3, end: 4, words: spacedWords('delta echo', 3, 4, 'estimated') },
  ])
  const asr: AsrWordInput[] = [
    { text: 'alpha', start: 0.1, end: 0.4 },
    { text: 'bravo', start: 0.6, end: 0.9 },
    { text: 'charlie', start: 1.4, end: 1.8 },
    { text: 'delta', start: 3.1, end: 3.4 },
    { text: 'echo', start: 3.6, end: 3.9 },
  ]
  expect(canonical(alignCaptionsToWords(project, asr).project)).toBe(canonical(alignCaptionsToWords(project, asr).project))
})

// --- property half: text and cue count NEVER change under perturbed timings

const POOL = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']

interface AlignPlan {
  totalWords: number
  blockCount: number
  shiftCs: number
}

const planArb = record({
  totalWords: integer({ min: 3, max: 12 }),
  blockCount: integer({ min: 1, max: 3 }),
  shiftCs: integer({ min: 0, max: 1_000 }),
})

function buildProject(totalWords: number, blockCount: number, shiftSec: number): { project: Project; tokens: string[] } {
  const tokens = Array.from({ length: totalWords }, (_, index) => POOL[index % POOL.length]!)
  const blocks: { start: number; end: number; words: WordToken[] }[] = []
  let tokenAt = 0
  for (let block = 0; block < blockCount; block++) {
    const remaining = totalWords - tokenAt
    const remainingBlocks = blockCount - block
    const take = Math.max(1, Math.round(remaining / remainingBlocks))
    const words: WordToken[] = []
    const start = block * 5 + shiftSec
    const step = 4 / take
    for (let k = 0; k < take; k++) {
      const text = tokens[tokenAt]!
      tokenAt += 1
      words.push(makeWord(text, start + k * step, start + (k + 1) * step, { timing: 'estimated' }))
    }
    blocks.push({ start, end: start + 4, words })
  }
  return { project: projectWith(blocks), tokens }
}

function asrFor(project: Project): AsrWordInput[] {
  // Monotone perturbation of the caption times: +1 ms per word keeps ASR
  // order (real ASR order) while making the times visibly different.
  const words = project.blocks.flatMap((block) => block.words)
  return words.map((word, index) => ({ text: word.text, start: word.start + index * 0.001, end: word.end }))
}

function shapeOf(project: Project): unknown {
  // Everything align must NEVER change: block count/bounds/text, word order/text.
  return canonical(
    project.blocks.map((block) => ({
      start: block.start,
      end: block.end,
      text: block.text,
      words: block.words.map((word) => word.text),
    })),
  )
}

test('CC-07.3: text and cue count NEVER change under perturbed timings; invariant 1 holds after align (property)', () => {
  assert(
    property(planArb, (plan: unknown) => {
      const { totalWords, blockCount, shiftCs } = plan as AlignPlan
      const unperturbed = buildProject(totalWords, blockCount, 0)
      const perturbed = buildProject(totalWords, blockCount, shiftCs / 100)

      const resultA = alignCaptionsToWords(unperturbed.project, asrFor(unperturbed.project))
      const resultB = alignCaptionsToWords(perturbed.project, asrFor(perturbed.project))

      // (a) align never rewrites structure — compared against the INPUT.
      expect(shapeOf(resultA.project), 'text and cue count unchanged by align').toBe(shapeOf(unperturbed.project))
      expect(shapeOf(resultB.project), 'text and cue count unchanged under PERTURBED caption timings').toBe(shapeOf(perturbed.project))
      expect(resultA.project.blocks.map((b) => b.words.length), 'word count never changes').toEqual(unperturbed.project.blocks.map((b) => b.words.length))

      // (b) identical caption texts align identically regardless of the
      // perturbation: same aligned count (full match is available both times).
      expect(resultB.report.wordsAligned, 'full text match ⇒ every word alignable both times').toBe(resultA.report.wordsAligned)
      expect(resultA.report.wordsAligned, 'unit match/gap score aligns an identical text fully').toBe(totalWords)

      // (c) aligned words carry ASR times; invariant 1 holds inside blocks.
      for (const block of resultA.project.blocks) {
        for (const word of block.words) expect(['aligned', 'estimated'], 'timing vocabulary').toContain(word.timing)
        for (let index = 1; index < block.words.length; index++) {
          expect(block.words[index]!.start, 'invariant 1 after align').toBeGreaterThanOrEqual(block.words[index - 1]!.end - 1e-9)
        }
      }
    }),
    { seed: 0x07c30010, numRuns: 200 },
  )
})
