// CC-02.6 — adversarial complement to wer-golden.test.ts: the measurement
// tool itself (unit-02 risk: "a WER harness scoring bug silently poisons the
// registry"). wer-golden pins the happy-path edit-distance table; this file
// probes the CLI's failure modes and the *normalizer port* against upstream.
//
// Contract anchors:
// - FR-02.1 (unit-02 spec): "computes WER with a JS port of the Whisper text
//   normalizer" — a port, so its output must match the upstream English
//   normalizer on the inputs the port claims to handle:
//   https://github.com/openai/whisper/blob/main/whisper/normalizers/english.py
//   (whisper/normalizers/english.py — the module header of tools/eval/
//   wer-core.mjs cites whisper_normalizer/english.py, a 404 path; the
//   behaviour verified against the real file is documented per case below).
// - tools/eval/wer.mjs CLI contract: usage + exit 2 on missing args; exit 1
//   on unreadable input or an empty reference; "WER <score>" on stdout.
//
// Deliberately run as a subprocess (the thing under test is the CLI contract,
// not the module's internals).
import { afterAll, beforeAll, expect, test } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT, runCommand } from '../../helpers/repo'

const WER_CLI = 'tools/eval/wer.mjs'

let dir: string
let fileCounter = 0

function writeText(contents: string): string {
  const path = join(dir, `w${fileCounter++}.txt`)
  writeFileSync(path, contents)
  return path
}

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
  /** The score printed on stdout, parsed from the "WER <score>" line. */
  score: number
  scoreLine: string
}

function wer(ref: string, hyp: string): CliResult {
  const refPath = writeText(ref)
  const hypPath = writeText(hyp)
  const res = runCommand('node', [WER_CLI, refPath, hypPath], { cwd: REPO_ROOT, timeoutMs: 20_000 })
  const line = res.stdout.trim().split('\n').filter(Boolean).at(-1) ?? ''
  const score = Number.parseFloat(line.replace(/^WER\s+/, ''))
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, score, scoreLine: line }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'zsap-wer-adversarial-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('CC-02.6: wer CLI rejects missing arguments with a usage line and exit 2', () => {
  const missingBoth = runCommand('node', [WER_CLI], { cwd: REPO_ROOT, timeoutMs: 20_000 })
  expect(missingBoth.status, `missing both args must exit 2, got ${missingBoth.status} (${missingBoth.output})`).toBe(2)
  expect(missingBoth.stderr + missingBoth.stdout).toMatch(/usage/i)
  const missingOne = runCommand('node', [WER_CLI, writeText('a b'),], { cwd: REPO_ROOT, timeoutMs: 20_000 })
  expect(missingOne.status, 'missing the hyp argument must exit 2 too').toBe(2)
})

test('CC-02.6: wer CLI fails on unreadable inputs without printing a score', () => {
  const missing = join(dir, 'does-not-exist.txt')
  const res = runCommand('node', [WER_CLI, missing, writeText('a b')], { cwd: REPO_ROOT, timeoutMs: 20_000 })
  expect(res.status, `ENOENT input must exit non-zero, got ${res.status}`).not.toBe(0)
  expect(res.stdout, 'a failed run must not print a score the harness could parse').not.toMatch(/WER\s+\d/)
})

test('CC-02.6: wer CLI refuses to score an empty reference (WER undefined)', () => {
  // The CLI's own guard prints "reference is empty (WER undefined)" and
  // exits 1 — scoring an empty reference as anything would fabricate a
  // measurement (FR-02.1 hygiene).
  const res = wer('', 'the quick brown fox')
  expect(res.status).toBe(1)
  expect(res.stdout + res.stderr).toMatch(/reference is empty/i)
})

test('CC-02.6: the ported normalizer expands punctuated contractions before punctuation removal (upstream parity)', () => {
  // Upstream English normalizer (whisper/normalizers/english.py) expands
  // contractions with word-boundary regexes BEFORE punctuation removal, so
  // "Don't," becomes "do not," → "do not". The port's contraction map is
  // keyed on the bare token ("don't"), so a comma (or any punctuation)
  // after the contraction defeats expansion and the word scores as a
  // substitution. The header of wer-core.mjs documents the same order.
  const ref = 'do not stop here'
  const res = wer(ref, "Don't, stop here.")
  expect(res.score, `punctuated contraction must normalise to "do not" (upstream parity), got score ${res.score} from "${res.scoreLine}"`).toBe(0)
})

test('CC-02.6: the ported normalizer does not invent contractions upstream does not expand', () => {
  // Upstream expands only apostrophe forms (regexes require the apostrophe);
  // "dont" (no apostrophe) stays one token and is a substitution against
  // "do not". The port's APOSTROPHE_FORMS map additionally expands "dont" →
  // "do not", silently flattering any engine that drops apostrophes.
  const ref = 'do not stop here'
  const res = wer(ref, 'dont stop here')
  expect(res.score, `"dont" must not silently match "do not" (upstream leaves it as one token → 2 edits / 4 words), got ${res.score}`).toBe(0.5)
})

test('CC-02.6: normalization folds accents, case, fullwidth and NBSP compat forms to identical words', () => {
  // NFKD + lowercasing (documented in wer-core.mjs). NBSP (U+00A0) and
  // fullwidth forms have canonical/compat decompositions to ASCII/space.
  const res = wer('hello world', 'Héllo  ＷＯＲＬＤ\u00a0')
  expect(res.score).toBe(0)
})

test('CC-02.6: BOM and CRLF framing do not change the score', () => {
  // "Both files are plain UTF-8 text" (CLI header) — invisible framing
  // bytes must not shift the alignment.
  const clean = wer('hello world', 'hello world')
  const framed = wer('hello world', '\uFEFFhello world\r\n')
  expect(clean.score).toBe(0)
  expect(framed.score, 'BOM/CRLF must be inert').toBe(clean.score)
})

test('CC-02.6: the score is a ratio (may exceed 1) and is the last number on stdout', () => {
  // 2 ref words, 6 hyp words → (0 sub + 0 del + 4 ins) / 2 = 2. The harness
  // parses the last printed token; it must be the ratio itself, unclamped.
  const res = wer('a b', 'a b c d e f')
  expect(res.scoreLine).toMatch(/^WER (0|1|[01]\.\d+|\d+\.\d+|\d+)$/)
  expect(res.score).toBe(2)
})

test('CC-02.6: the CLI is deterministic across repeated invocations', () => {
  // A measurement tool that fluctuates on fixed inputs cannot produce
  // median-of-3 rows (FR-02.1).
  const first = wer('the quick brown fox jumps', 'the quick red fox jumps')
  const second = wer('the quick brown fox jumps', 'the quick red fox jumps')
  expect(second.score).toBe(first.score)
  expect(second.score).toBe(0.2)
})

test('CC-02.6: pathological inputs (zero-width chars, lone surrogates, combining accents) do not crash the tool', () => {
  // No engine output may take the measurement tool down — it must either
  // score (any finite value) or refuse with a non-zero exit.
  const res = wer('hello world', 'hello\u200bworld \uD800end café')
  expect([0, 1]).toContain(res.status)
  if (res.status === 0) expect(Number.isFinite(res.score)).toBe(true)
})
