#!/usr/bin/env node
// tools/eval/wer.mjs — the CC-02.6 WER CLI (FR-02.1 eval-harness hygiene):
//
//   node tools/eval/wer.mjs <ref-file> <hyp-file>
//
// prints the word error rate as a decimal fraction on stdout (the score is
// the last number printed) and exits 0. Both files are plain UTF-8 text.
// Scoring: JS port of the Whisper English text normalizer + Levenshtein WER,
// see tools/eval/wer-core.mjs. Transcripts given to this CLI live in scratch
// directories; the harness never writes transcripts into repo artifacts
// (SECURITY-03 — only scores and hashes are persisted).

import { readFileSync } from 'node:fs'
import { wordErrorRate } from './wer-core.mjs'

const [refPath, hypPath] = process.argv.slice(2)
if (!refPath || !hypPath) {
  console.error('usage: node tools/eval/wer.mjs <ref-file> <hyp-file>')
  process.exit(2)
}

let reference
let hypothesis
try {
  reference = readFileSync(refPath, 'utf8')
  hypothesis = readFileSync(hypPath, 'utf8')
} catch (error) {
  console.error(`wer: cannot read inputs: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const score = wordErrorRate(reference, hypothesis)
if (!Number.isFinite(score)) {
  console.error('wer: reference is empty (WER undefined)')
  process.exit(1)
}
process.stdout.write(`WER ${String(score)}\n`)
