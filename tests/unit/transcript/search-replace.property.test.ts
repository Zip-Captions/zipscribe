// CC-104.4 (L1, property): the `replace-text` command (CONTRACT.md § Commands
// — unit-104 EXTENDS; US-2.1.6). Properties over generated corpora:
//  P1 oracle — match semantics (case-insensitive substring default;
//      caseSensitive exact substring; wholeWord = token-core equality with
//      normalizeToken(case-fold + strip non-alphanumerics, align.ts rule));
//      every match in every block replaced by ONE dispatch; block text stays
//      the words join (invariant 2).
//  P2 timing preservation — for equal-length replacements the per-token
//      character weights are unchanged, so the frozen `block-edit-text`
//      character-weight re-derivation reproduces every word's start/end
//      BYTE-IDENTICALLY (US-2.1.6 "keeps word timings").
//  P3 one undo step — accepted dispatch with ≥1 match: exactly +1
//      `undoCount`, and `history.undo()` restores the project BYTE-equal.
//  P4 zero matches — state byte-identical and NO history step.
// Deterministic seed (log on failure — numbers only, SECURITY-03).
// RED: `replace-text` is not registered yet (dispatch throws unknown id).
import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { block, word } from '../editor/helpers/fixture-project'
import { serializeProject } from '@state/services/serialize'
import { transcriptProject } from './helpers/transcript-fixture'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import type { CaptionBlock, Project, WordToken } from '@engine/model@104'
import type { EditorApp } from '@state/history'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'
const SEED = 20261111
const NUM_RUNS = 150

const VOCAB_PURE = ['cat', 'Cat', 'CAT', 'cats', 'concat', 'scatter', 'dog', 'Dog']
const VOCAB_PUNCT = [...VOCAB_PURE, 'cat.', 'CAT!', 'dogs?']
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['cat', 'cot'],
  ['Cat', 'Cot'],
  ['CAT', 'COT'],
]

function normalizeCore(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

interface Sample {
  wholeWord: boolean
  caseSensitive: boolean
  pair: readonly [string, string]
  lists: string[][]
}

function corpusArb(wholeWord: boolean, vocab: readonly string[]): fc.Arbitrary<Sample> {
  return fc.record({
    wholeWord: fc.constant(wholeWord),
    caseSensitive: fc.boolean(),
    pair: fc.constantFrom<readonly [string, string]>(...PAIRS),
    lists: fc.array(fc.array(fc.constantFrom(...vocab), { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 6 }),
  }) as unknown as fc.Arbitrary<Sample>
}

const sampleArb: fc.Arbitrary<Sample> = fc.oneof(corpusArb(true, VOCAB_PURE), corpusArb(false, VOCAB_PUNCT)) as fc.Arbitrary<Sample>

function corpusBlocks(lists: string[][]): CaptionBlock[] {
  return lists.map((texts, blockIndex) => {
    const start = blockIndex * 10
    const words = texts.map<WordToken>((text, j) => word(text, start + j * 0.5, start + j * 0.5 + 0.45))
    return block(`blk_x${blockIndex}`, start, start + Math.max(0.9, texts.length * 0.5 - 0.05), blockIndex % 2 === 0 ? 'SPK_1' : 'SPK_2', words)
  })
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

/** Oracle per word token: expected new text + whether it matched. */
function oracleWord(text: string, query: string, replacement: string, caseSensitive: boolean, wholeWord: boolean): { text: string; matched: boolean } {
  if (wholeWord) {
    const equal = caseSensitive ? text === query : normalizeCore(text) === normalizeCore(query)
    return { text: equal ? replacement : text, matched: equal }
  }
  const haystack = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const matched = haystack.includes(needle)
  const next = caseSensitive ? text.split(query).join(replacement) : replaceInsensitive(text, needle, replacement)
  return { text: next, matched }
}

function replaceInsensitive(text: string, lowerNeedle: string, replacement: string): string {
  const lower = text.toLowerCase()
  let out = ''
  let at = 0
  let found = lower.indexOf(lowerNeedle, at)
  while (found !== -1) {
    out += text.slice(at, found) + replacement
    at = found + lowerNeedle.length
    found = lower.indexOf(lowerNeedle, at)
  }
  return out + text.slice(at)
}

function joinText(words: readonly WordToken[]): string {
  return words.map((w, i) => (i > 0 && w.breakAfter === true ? '\n' : i > 0 ? ' ' : '') + w.text).join('')
}

interface ReplaceOutcome {
  threw: boolean
  reject: { code: string } | null
}

function dispatchReplace(app: EditorApp, payload: unknown): ReplaceOutcome {
  try {
    return { threw: false, reject: (app as unknown as { dispatch(id: string, payload?: unknown): { code: string } | null }).dispatch('replace-text', payload) }
  } catch {
    return { threw: true, reject: null }
  }
}

function mount(lists: string[][]): { t: ReturnType<typeof createTestApp>; blocks: CaptionBlock[] } {
  const blocks = corpusBlocks(lists)
  const project = transcriptProject(blocks)
  const t = createTestApp({ project })
  return { t, blocks }
}

describe('CC-104.4: replace-text properties (oracle · timing preservation · one undo step · zero-match no-op)', () => {
  test('CC-104.4: generated corpora obey the frozen match/replace/timing/history oracle', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    try {
      fc.assert(
        fc.property(sampleArb, (sample: Sample) => {
          const [query, replacement] = sample.pair
          const { t, blocks } = mount(sample.lists)
          try {
            const before = serializeProject(t.app.project.getState().project as Project)
            const undoBefore = t.app.history.undoCount()

            const expectedBlocks = blocks.map((b) => {
              const words = b.words.map((w) => ({ ...w, text: oracleWord(w.text, query, replacement, sample.caseSensitive, sample.wholeWord).text }))
              return { id: b.id, text: joinText(words), words }
            })
            const totalMatches = blocks.reduce(
              (sum, b) => sum + b.words.filter((w) => oracleWord(w.text, query, replacement, sample.caseSensitive, sample.wholeWord).matched).length,
              0,
            )

            const outcome = dispatchReplace(t.app, { query, replacement, caseSensitive: sample.caseSensitive, wholeWord: sample.wholeWord })
            if (outcome.threw) throw new Error("replace-text is not registered in the command registry (expected id 'replace-text')")
            expect(outcome.reject, `replace-text rejected a valid payload (${outcome.reject?.code ?? 'n/a'})`).toBeNull()

            const project = t.app.project.getState().project as Project
            expect(project.blocks.length, 'block count is unchanged').toBe(blocks.length)
            for (let i = 0; i < blocks.length; i++) {
              const expected = expectedBlocks[i]!
              const actual = project.blocks[i]!
              expect(actual.id, 'block ids are stable').toBe(expected.id)
              expect(actual.start, 'block envelope start is fixed').toBe(blocks[i]!.start)
              expect(actual.end, 'block envelope end is fixed').toBe(blocks[i]!.end)
              expect(actual.text, `block ${actual.id} text after replace`).toBe(expected.text)
              expect(actual.words.length, `word count of ${actual.id}`).toBe(expected.words.length)
              for (let w = 0; w < expected.words.length; w++) {
                expect(actual.words[w]!.text, `word ${w} of ${actual.id}`).toBe(expected.words[w]!.text)
                // P2: equal-length replacements keep per-token character weights
                // ⇒ byte-identical times through the frozen re-derivation.
                expect(actual.words[w]!.start, `word ${w} start of ${actual.id}`).toBe(expected.words[w]!.start)
                expect(actual.words[w]!.end, `word ${w} end of ${actual.id}`).toBe(expected.words[w]!.end)
              }
              // Invariant 1 on re-derived words.
              for (let w = 1; w < actual.words.length; w++) {
                expect(actual.words[w]!.start >= actual.words[w - 1]!.end, `words sorted in ${actual.id}`).toBe(true)
              }
            }

            // P3: one accepted dispatch with ≥1 match ⇒ exactly one step, undo byte-equal.
            const matchedSomething = totalMatches > 0
            expect(t.app.history.undoCount(), `undo step count after replace (matches=${totalMatches})`).toBe(undoBefore + (matchedSomething ? 1 : 0))
            t.app.history.undo()
            expect(serializeProject(t.app.project.getState().project as Project), 'undo restores byte-equal project').toBe(before)
          } finally {
            t.app.dispose()
          }
          return true
        }),
        { numRuns: NUM_RUNS, seed: SEED },
      )
    } catch (error) {
      throw new Error(`CC-104.4 property failed — re-run with seed ${SEED} numRuns ${NUM_RUNS}: ${error instanceof Error ? error.message.slice(0, 900) : 'fail'}`)
    } finally {
      redaction.restore()
    }
  })

  test('CC-104.4: zero matches — state byte-identical, NO history step, no canary leak', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    try {
      const { t } = mount([['cat', 'dog'], ['scatter']])
      const projectBefore = t.app.project.getState().project as Project
      const before = serializeProject(projectBefore)
      const undoBefore = t.app.history.undoCount()
      // Advance the fake clock BEFORE the dispatch (PR #15 review F8): with a
      // constant clock a mutant writing `updatedAt = clock.now()` in the
      // zero-match branch is elided by immer (equal-value write) and survives.
      // A time that MOVED makes any such write observable as a serializeProject
      // difference; the correct zero-match no-op leaves the draft untouched
      // (reference-unchanged) and creates no history step.
      t.clock.advance(60_000)
      const outcome = dispatchReplace(t.app, { query: 'zxq', replacement: 'zyq' })
      if (outcome.threw) throw new Error("replace-text is not registered in the command registry (expected id 'replace-text')")
      expect(outcome.reject).toBeNull()
      expect(serializeProject(t.app.project.getState().project as Project), 'zero matches — state byte-identical even though the clock advanced').toBe(before)
      expect(t.app.project.getState().project, 'zero matches — project reference unchanged (no draft commit)').toBe(projectBefore)
      expect(t.app.history.undoCount(), 'zero matches — NO history step').toBe(undoBefore)
      expect(redaction.settle().clean).toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })

  test('CC-104.4: caseSensitive + wholeWord honored on the fixed corpus (3 whole-word matches for beta)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    try {
      // searchBlocks oracle: whole-word ci 'beta' → Beta(s1) + BETA(s2) + beta(s3) = 3, not 'betas'/'alphabet'.
      const blocks = corpusBlocks([['Beta', 'alpha'], ['BETA', 'alphabet'], ['beta', 'betas']])
      const t = createTestApp({ project: transcriptProject(blocks) })
      const undoBefore = t.app.history.undoCount()
      const outcome = dispatchReplace(t.app, { query: 'beta', replacement: 'veto', caseSensitive: false, wholeWord: true })
      if (outcome.threw) throw new Error("replace-text is not registered in the command registry (expected id 'replace-text')")
      expect(outcome.reject).toBeNull()
      const project = t.app.project.getState().project as Project
      expect(project.blocks[0]!.text).toBe('veto alpha')
      expect(project.blocks[1]!.text).toBe('veto alphabet')
      expect(project.blocks[2]!.text, "'betas' is NOT a whole-word match").toBe('veto betas')
      expect(t.app.history.undoCount()).toBe(undoBefore + 1)
      // Case-sensitive: 'Beta' only.
      const undoMid = t.app.history.undoCount()
      const second = dispatchReplace(t.app, { query: 'veto', replacement: 'beta', caseSensitive: true, wholeWord: true })
      expect(second.reject).toBeNull()
      expect((t.app.project.getState().project as Project).blocks[2]!.text, "case-sensitive 'veto' still matches lowercase 'veto'").toBe('beta betas')
      expect(t.app.history.undoCount()).toBe(undoMid + 1)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })
})
