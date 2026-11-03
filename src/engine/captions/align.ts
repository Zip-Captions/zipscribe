// CC-07.3 / FR-07.4 / US-07.3 — "Align to audio": Needleman–Wunsch-style
// GLOBAL alignment of the source track's words (block order, then word order)
// against the injected ASR words. Pure: the ASR words are an input (FR-07.4 —
// no SDK import here, so the unit tests run on fixtures), the input project
// is never mutated, and TEXT / WORD COUNT / BLOCK COUNT / BLOCK TEXT / BOUNDS
// / IDS NEVER CHANGE (US-07.3 — the frozen property test under perturbed
// timings pins this; one-undo-step semantics are store-side, unit-102).
//
// Matching rule (frozen contract header, tests/unit/captions/unit07-api-contract.d.ts):
// match iff normalizeToken equality where
//   normalizeToken(t) = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim()
// unit match score, unit gap penalties ⇒ maximum non-crossing matching (LCS).
// Matched words copy the ASR start/end (round3) and get timing 'aligned';
// unmatched words are re-interpolated LINEARLY (evenly) between the nearest
// aligned neighbours — or the block bounds where no aligned neighbour exists
// on that side — and stay/return 'estimated'.

import type { Project, Seconds, WordToken } from '../model'

export interface AsrWordInput {
  text: string
  start: Seconds
  end: Seconds
}

export interface AlignReport {
  wordsTotal: number
  wordsAligned: number
  /** wordsTotal === 0 → 0. */
  alignedRatio: number
}

export interface AlignOutcome {
  project: Project
  report: AlignReport
}

/** Pinned normalization (Whisper-normalizer cost): case-fold, strip punctuation, trim. */
const NON_WORD = /[^\p{L}\p{N}\s]/gu

function normalizeToken(text: string): string {
  return text.toLowerCase().replace(NON_WORD, '').trim()
}

/** Domain invariant 6: 3-decimal rule on every written time. */
function round3(value: Seconds): Seconds {
  const rounded = Math.round(value * 1000) / 1000
  return rounded === 0 ? 0 : rounded
}

/**
 * Longest-common-subsequence matching of the two normalized token streams
 * (equivalent to Needleman–Wunsch with unit match score and unit gap
 * penalties ⇒ maximum non-crossing matching). Returns, per caption word
 * index, the ASR word index it matched (deterministic tie-break: prefer the
 * diagonal on ties, then take the upper row).
 */
function alignTokenStreams(captionNorms: readonly string[], asrNorms: readonly string[]): (number | undefined)[] {
  const n = captionNorms.length
  const m = asrNorms.length
  const matched: (number | undefined)[] = new Array<number | undefined>(n)
  if (n === 0 || m === 0) return matched

  const width = m + 1
  const dp = new Int32Array((n + 1) * width)
  for (let i = 1; i <= n; i++) {
    const caption = captionNorms[i - 1]!
    const row = i * width
    const prev = row - width
    for (let j = 1; j <= m; j++) {
      const asr = asrNorms[j - 1]!
      if (caption !== '' && caption === asr) {
        dp[row + j] = dp[prev + j - 1]! + 1
      } else {
        const up = dp[prev + j]!
        const left = dp[row + j - 1]!
        dp[row + j] = up >= left ? up : left
      }
    }
  }

  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const caption = captionNorms[i - 1]!
    const asr = asrNorms[j - 1]!
    if (caption !== '' && caption === asr && dp[i * width + j] === dp[(i - 1) * width + j - 1]! + 1) {
      matched[i - 1] = j - 1
      i -= 1
      j -= 1
      continue
    }
    if (dp[(i - 1) * width + j]! >= dp[i * width + j - 1]!) i -= 1
    else j -= 1
  }
  return matched
}

/** Even linear spread of `count` words across [left, right] (right < left collapses). */
function interpolateRun(words: readonly WordToken[], left: Seconds, right: Seconds): WordToken[] {
  const count = words.length
  const from = left
  const to = right < left ? left : right
  return words.map((word, index) => ({
    ...word,
    start: round3(from + ((to - from) * index) / count),
    end: round3(from + ((to - from) * (index + 1)) / count),
    timing: 'estimated' as const,
  }))
}

/**
 * FR-07.4 — pure align. Never mutates word texts, word counts, block
 * count/text/bounds/ids/speakers; returns a NEW project object.
 */
export function alignCaptionsToWords(project: Project, asrWords: readonly AsrWordInput[]): AlignOutcome {
  const allWords = project.blocks.flatMap((block) => block.words)
  const matchedAsr = alignTokenStreams(
    allWords.map((word) => normalizeToken(word.text)),
    asrWords.map((word) => normalizeToken(word.text)),
  )

  let wordsAligned = 0
  let flatIndex = 0
  const blocks = project.blocks.map((block) => {
    const words = block.words
    const alignedEnds: (Seconds | undefined)[] = new Array<Seconds | undefined>(words.length)
    const alignedStarts: (Seconds | undefined)[] = new Array<Seconds | undefined>(words.length)
    for (let index = 0; index < words.length; index++) {
      const asrIndex = matchedAsr[flatIndex + index]
      if (asrIndex === undefined) continue
      const asr = asrWords[asrIndex]!
      alignedStarts[index] = round3(asr.start)
      alignedEnds[index] = round3(asr.end)
      wordsAligned += 1
    }

    const nextWords: WordToken[] = new Array<WordToken>(words.length)
    let at = 0
    while (at < words.length) {
      if (alignedStarts[at] !== undefined) {
        nextWords[at] = { ...words[at]!, start: alignedStarts[at]!, end: alignedEnds[at]!, timing: 'aligned' }
        at += 1
        continue
      }
      const runStart = at
      while (at < words.length && alignedStarts[at] === undefined) at += 1
      const left = runStart > 0 ? (alignedEnds[runStart - 1] ?? block.start) : block.start
      const right = at < words.length ? (alignedStarts[at] ?? block.end) : block.end
      const run = interpolateRun(words.slice(runStart, at), left, right)
      run.forEach((word, k) => {
        nextWords[runStart + k] = word
      })
    }
    flatIndex += words.length
    return { ...block, words: nextWords }
  })

  const wordsTotal = allWords.length
  return {
    project: { ...project, blocks },
    report: { wordsTotal, wordsAligned, alignedRatio: wordsTotal === 0 ? 0 : wordsAligned / wordsTotal },
  }
}
