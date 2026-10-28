// CC-02.6 — WER harness golden tests (unit-02 risk: "WER harness scoring bugs
// silently poison the registry → the harness itself gets golden tests").
//
// CLI contract (FR-02.1, tools/eval/ eval harness):
//   node tools/eval/wer.mjs <ref-file> <hyp-file>
// prints the word error rate as a decimal fraction on stdout and exits 0.
// WER = (substitutions + deletions + insertions) / reference-word-count,
// computed after the JS port of the Whisper text normalizer (case folding,
// punctuation stripping) named by FR-02.1.
//
// The pinned transformers.js docs are the versioned 3.8.1 set:
// https://huggingface.co/docs/transformers.js/v3.8.1/en/index
// (docs-mcp indexes transformers.js main/4.x — citation per .agent/AGENTS.md).
//
// Today this suite is RED because `tools/eval/wer.mjs` does not exist yet —
// the assertions are about the CLI's exit code and printed score, not imports.
import { afterAll, expect, test } from 'vitest'
import { join } from 'node:path'
import { exists, isChildRun, runCommand, scratchDir, removeScratch, writeFixtureFile } from '../../helpers/repo'

const WER_CLI = 'tools/eval/wer.mjs'

// Reference transcript: 5 words → every expected score below is exact
// (multiples of 1/5), so "known WER score exactly" has no rounding ambiguity.
const REF = 'the quick brown fox jumps'
const REF_WORDS = 5

interface WerCase {
  slug: string
  name: string
  hyp: string
  expected: number
}

const CASES: WerCase[] = [
  { slug: 'perfect', name: 'perfect match scores 0', hyp: REF, expected: 0 },
  { slug: 'one-sub', name: 'one substitution in five words scores exactly 1/5', hyp: 'the quick red fox jumps', expected: 1 / REF_WORDS },
  { slug: 'one-del', name: 'one deletion scores exactly 1/5', hyp: 'the quick brown fox', expected: 1 / REF_WORDS },
  { slug: 'two-del', name: 'two deletions score exactly 2/5', hyp: 'the quick fox', expected: 2 / REF_WORDS },
  { slug: 'one-ins', name: 'one insertion scores exactly 1/5', hyp: 'the quick brown fox jumps high', expected: 1 / REF_WORDS },
  { slug: 'empty-hyp', name: 'empty hypothesis scores exactly 1 (all deletions)', hyp: '', expected: 1 },
  { slug: 'casing', name: 'casing differences normalize to exactly 0 (Whisper normalizer)', hyp: 'THE Quick brown FOX JUMPS', expected: 0 },
  { slug: 'punctuation', name: 'punctuation and stray whitespace normalize to exactly 0 (Whisper normalizer)', hyp: ' The, quick! brown? fox. jumps; ', expected: 0 },
  { slug: 'sub-plus-del', name: 'one substitution + one deletion score exactly 2/5', hyp: 'the quick red fox', expected: 2 / REF_WORDS },
]

const scratch = scratchDir('wer-golden')

afterAll(() => {
  removeScratch(scratch)
})

/** The score is the last number printed on stdout (the CLI contract). */
function lastNumber(text: string): number | null {
  const matches = text.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)
  if (!matches || matches.length === 0) return null
  const value = Number(matches[matches.length - 1])
  return Number.isFinite(value) ? value : null
}

for (const testCase of CASES) {
  test(`CC-02.6: WER golden — ${testCase.name}`, () => {
    if (isChildRun()) return
    expect(exists(WER_CLI), `FR-02.1 names the WER CLI "${WER_CLI}" (node ${WER_CLI} <ref> <hyp>)`).toBe(true)
    const refPath = writeFixtureFile(join(scratch, `ref-${testCase.slug}.txt`), REF)
    const hypPath = writeFixtureFile(join(scratch, `hyp-${testCase.slug}.txt`), testCase.hyp)
    const result = runCommand('node', [WER_CLI, refPath, hypPath], { timeoutMs: 30_000 })
    expect(
      result.status,
      `${result.slug} exited ${result.status}; stdout=${JSON.stringify(result.stdout.slice(0, 200))} stderr=${JSON.stringify(result.stderr.slice(0, 400))}`,
    ).toBe(0)
    const score = lastNumber(result.stdout)
    expect(score, `${WER_CLI} must print the WER score on stdout, got ${JSON.stringify(result.stdout.slice(0, 200))}`).not.toBeNull()
    expect(score as number, `WER for "${testCase.slug}" must equal the known score ${testCase.expected} exactly`).toBeCloseTo(testCase.expected, 10)
  }, 60_000)
}
