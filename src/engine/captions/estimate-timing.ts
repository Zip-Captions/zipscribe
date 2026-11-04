// CC-07.3 / US-07.3 (FR-07.4): word timings inside an imported cue estimated
// by CHARACTER WEIGHT with a punctuation PAUSE WEIGHT. Implements the pinned
// rule of the frozen contract verbatim
// (tests/unit/captions/unit07-api-contract.d.ts header) — the CC-07.1 goldens
// are byte-equal against it:
//
//   tokens  = text split on whitespace runs; empty → []; a token followed by
//             a '\n' in the original text gets breakAfter: true.
//   weight  = max(1, codePointCount(text_i))
//             + (/[.,!?;:]$/.test(text_i) ? punctuationPauseWeight : 0)
//   bounds  = start_i = round3(start + (end − start) × (Σ_{j<i} w_j) / Σ w)
//             end_i   = round3(start + (end − start) × (Σ_{j≤i} w_j) / Σ w)
//             with start_0 = cue start and end_{n−1} = cue end exactly.
//   timing  = 'estimated'; word texts are the tokens (invariant 2 joinability).
//
// Pure: no DOM/React/SDK surface (engine-purity), no wall-clock, no state.

import type { Seconds, WordToken } from '../model'

export interface EstimateOptions {
  /** Punctuation pause expressed in character-weight units; default 1. */
  punctuationPauseWeight?: number
}

/** Sentence-final punctuation adds the pause weight (pinned set). */
const PUNCTUATION_TAIL = /[.,!?;:]$/u

/** Non-whitespace runs, in order. */
const TOKEN = /\S+/g

function codePointCount(text: string): number {
  let count = 0
  for (const _char of text) count += 1
  return count
}

/** Domain invariant 6: 3-decimal rule on every written time. */
function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return rounded === 0 ? 0 : rounded
}

interface TokenPlan {
  text: string
  breakAfter: boolean
  weight: number
}

/**
 * Estimate word timings for one cue. `cue.start`/`cue.end` are the file's
 * truth (domain glossary "Estimated timing"): the first word starts exactly
 * at the cue start, the last ends exactly at the cue end, and every interior
 * boundary is the weight-proportional position, 3-decimal quantized.
 */
export function estimateCueWords(cue: { start: Seconds; end: Seconds; text: string }, opts: EstimateOptions = {}): WordToken[] {
  const pauseWeight = opts.punctuationPauseWeight ?? 1

  const plans: TokenPlan[] = []
  let previousEnd = 0
  for (const match of cue.text.matchAll(TOKEN)) {
    const text = match[0]
    const index = match.index
    const gap = cue.text.slice(previousEnd, index)
    if (plans.length > 0 && gap.includes('\n')) plans[plans.length - 1]!.breakAfter = true
    const weight = Math.max(1, codePointCount(text)) + (PUNCTUATION_TAIL.test(text) ? pauseWeight : 0)
    plans.push({ text, breakAfter: false, weight })
    previousEnd = index + text.length
  }
  if (plans.length > 0 && cue.text.slice(previousEnd).includes('\n')) plans[plans.length - 1]!.breakAfter = true
  if (plans.length === 0) return []

  const span = cue.end - cue.start
  const total = plans.reduce((sum, plan) => sum + plan.weight, 0)
  const last = plans.length - 1

  let cumulative = 0
  return plans.map((plan, index) => {
    const start = index === 0 ? cue.start : round3(cue.start + span * (cumulative / total))
    cumulative += plan.weight
    const end = index === last ? cue.end : round3(cue.start + span * (cumulative / total))
    const word: WordToken = { text: plan.text, start, end, timing: 'estimated' }
    if (plan.breakAfter) word.breakAfter = true
    return word
  })
}
