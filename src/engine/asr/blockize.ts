// Pure word → CaptionBlock[] grouping (FR-05.4 / US-1.2.6 / CC-05.7).
// Deterministic TypeScript: no SDK imports, no DOM globals, no I/O, no
// randomness. The exported surface is the frozen unit-05 contract
// (`tests/unit/asr/unit05-api-contract.d.ts`).
//
// Rules (US-1.2.6): greedy left-to-right grouping; a block ends after a word
// whose engine-provided text ends in sentence-final punctuation, before a
// word whose gap to the previous word is strictly greater than `gapSplitSec`,
// and before a word that would push the block past the char estimate
// (`maxLines` lines × `maxCharsPerLine`, joiners counted — the estimate is
// enforced as the total joined-length bound the CC-05.7 suite checks) or past
// a `maxDurationSec` word span. Words are never split (domain invariant 1)
// and `block.text` is the (punctuation-flag-filtered) word texts joined with
// ' ', using '\n' after `breakAfter` words (domain invariant 2).
//
// Padding: `block.start = firstWord.start − paddingSec`,
// `block.end = lastWord.end + paddingSec`, each clamped into the inter-word
// gap [prevLastEnd, nextFirstStart] at the shared boundary, so blocks are
// ordered, never overlap and never cross their own words (domain invariant 1,
// CC-05.7). When the two padded candidates overlap, the boundary follows the
// next block's start candidate — the earlier block's end padding is dropped —
// unless that boundary would leave the next block below `minDurationSec`
// where its words could otherwise reach it: the 0.7 s floor then protects the
// earlier block's end padding and the next block's start is clamped up to it
// (the two golden clamp cases in `blockize-golden.test.ts` pin exactly this
// resolution; the floor comparison is done on the raw IEEE-754 subtraction,
// no epsilon, as the goldens' hand-computed values require).
//
// `confidence` is set to the block's mean word probability when the engine
// flag `confidence` is true and the mean is below `lowConfidenceThreshold`;
// it is NEVER fabricated when the flag is false (invariant 7).
// `punctuation: false` means the engine never emitted punctuation: any
// [.!?] characters in word texts are dropped from `block.text` (the word
// tokens themselves are handed through unchanged).

import type { CaptionBlock, Seconds, WordToken } from '../model'

/** Engine capability flags from the registry (invariant 7 — never promise what the engine does not emit). */
export interface BlockizeEngineFlags {
  confidence: boolean
  punctuation: boolean
}

export interface BlockizeOptions {
  /** Default 2 (US-1.2.6). */
  maxLines?: number
  /** Per-line character estimate; default 42 (US-1.2.6). */
  maxCharsPerLine?: number
  /** Split at inter-word gaps strictly greater than this; default 0.6. */
  gapSplitSec?: number
  /** Default 0.7 (where word timings allow). */
  minDurationSec?: number
  /** Default 7. */
  maxDurationSec?: number
  /** Start/end padding; default 0.05, clamped to neighbour bounds (US-1.2.6). */
  paddingSec?: number
  /** `confidence` is set when engine has probabilities and block mean word probability < this; default 0.45. */
  lowConfidenceThreshold?: number
  /** Default `{ confidence: false, punctuation: false }`. */
  engineFlags?: BlockizeEngineFlags
}

const DEFAULT_MAX_LINES = 2
const DEFAULT_MAX_CHARS_PER_LINE = 42
const DEFAULT_GAP_SPLIT_SEC = 0.6
const DEFAULT_MIN_DURATION_SEC = 0.7
const DEFAULT_MAX_DURATION_SEC = 7
const DEFAULT_PADDING_SEC = 0.05
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.45

const SENTENCE_END = /[.!?]$/
const PUNCTUATION_CHARS = /[.!?]/g

/** Float slack on the duration-premise comparisons (CC-05.7 mirrors this). */
const EPS = 1e-9

interface ResolvedOptions {
  charBudget: number
  gapSplitSec: number
  minDurationSec: number
  maxDurationSec: number
  paddingSec: number
  lowConfidenceThreshold: number
  engineFlags: BlockizeEngineFlags
}

function resolveOptions(opts: BlockizeOptions): ResolvedOptions {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES
  const maxCharsPerLine = opts.maxCharsPerLine ?? DEFAULT_MAX_CHARS_PER_LINE
  return {
    // The 42-chars-per-line estimate is enforced as the total joined-length
    // bound (lines + joiners), the bound the CC-05.7 suite pins.
    charBudget: maxLines * maxCharsPerLine + (maxLines - 1),
    gapSplitSec: opts.gapSplitSec ?? DEFAULT_GAP_SPLIT_SEC,
    minDurationSec: opts.minDurationSec ?? DEFAULT_MIN_DURATION_SEC,
    maxDurationSec: opts.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC,
    paddingSec: opts.paddingSec ?? DEFAULT_PADDING_SEC,
    lowConfidenceThreshold: opts.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD,
    engineFlags: opts.engineFlags ?? { confidence: false, punctuation: false },
  }
}

/** Text as the engine really provided it: [.!?] only exists when it says so. */
function effectiveText(word: WordToken, punctuationFlagOn: boolean): string {
  return punctuationFlagOn ? word.text : word.text.replace(PUNCTUATION_CHARS, '')
}

/** A run of words belonging to one block: inclusive word index range. */
interface Group {
  first: number
  last: number
}

function groupWords(words: readonly WordToken[], opts: ResolvedOptions): Group[] {
  const groups: Group[] = []
  let first = 0
  let joinedLength = 0
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const text = effectiveText(word, opts.engineFlags.punctuation)
    if (i > first) {
      const previous = words[i - 1]!
      const previousText = effectiveText(previous, opts.engineFlags.punctuation)
      const gap = word.start - previous.end
      const overChars = joinedLength + 1 + text.length > opts.charBudget
      const overDuration = word.end - words[first]!.start > opts.maxDurationSec
      const forced = SENTENCE_END.test(previousText) || gap > opts.gapSplitSec
      if (forced || overChars || overDuration) {
        groups.push({ first, last: i - 1 })
        first = i
        joinedLength = 0
      }
    }
    joinedLength += (i > first ? 1 : 0) + text.length
  }
  if (words.length > 0) {
    groups.push({ first, last: words.length - 1 })
  }
  return groups
}

/**
 * Shared boundary value between two adjacent groups. The two padded
 * candidates compete; the IEEE-754 subtraction deciding the next block's
 * floored duration carries no epsilon (the goldens pin this exactly).
 */
function resolveBoundary(prevLastEnd: Seconds, nextFirstStart: Seconds, endsPrev: Seconds, startsNext: Seconds, nextLastEnd: Seconds, opts: ResolvedOptions): Seconds {
  const nextSpanAllowsFloor = nextLastEnd - nextFirstStart + 2 * opts.paddingSec >= opts.minDurationSec - EPS
  const nextFlooredAtPrevEnd = nextLastEnd + opts.paddingSec - endsPrev >= opts.minDurationSec
  const candidate = nextSpanAllowsFloor && nextFlooredAtPrevEnd ? startsNext : endsPrev
  return Math.min(Math.max(candidate, prevLastEnd), nextFirstStart)
}

/** Majority `speakerId` over the block's words; ties keep first appearance. */
function majoritySpeakerId(words: readonly WordToken[]): string {
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const word of words) {
    const id = word.speakerId
    if (id === undefined) continue
    const seen = counts.get(id)
    if (seen === undefined) {
      counts.set(id, 1)
      order.push(id)
    } else {
      counts.set(id, seen + 1)
    }
  }
  let best = ''
  let bestCount = -1
  for (const id of order) {
    const count = counts.get(id)!
    if (count > bestCount) {
      best = id
      bestCount = count
    }
  }
  return best
}

function blockText(words: readonly WordToken[], punctuationFlagOn: boolean): string {
  let text = ''
  for (let i = 0; i < words.length; i++) {
    if (i > 0) text += words[i - 1]!.breakAfter === true ? '\n' : ' '
    text += effectiveText(words[i]!, punctuationFlagOn)
  }
  return text
}

function meanWordProbability(words: readonly WordToken[]): number {
  let sum = 0
  for (const word of words) sum += word.probability ?? 0
  return sum / words.length
}

function newBlockId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `block-${Math.abs(blockIdSalt++).toString(36)}`
}
let blockIdSalt = 0

/**
 * Pure: word → blocks grouping implementing US-1.2.6 (FR-05.4). Deterministic,
 * exported unchanged for unit-06 reassignment reuse. Input words are sorted,
 * non-overlapping (domain invariant 1).
 */
export function blockize(words: readonly WordToken[], opts: BlockizeOptions = {}): CaptionBlock[] {
  const resolved = resolveOptions(opts)
  const groups = groupWords(words, resolved)
  if (groups.length === 0) return []

  const starts: Seconds[] = []
  const ends: Seconds[] = []
  for (const group of groups) {
    starts.push(words[group.first]!.start - resolved.paddingSec)
    ends.push(words[group.last]!.end + resolved.paddingSec)
  }
  for (let i = 0; i + 1 < groups.length; i++) {
    if (ends[i]! <= starts[i + 1]!) continue
    const boundary = resolveBoundary(words[groups[i]!.last]!.end, words[groups[i + 1]!.first]!.start, ends[i]!, starts[i + 1]!, words[groups[i + 1]!.last]!.end, resolved)
    ends[i] = boundary
    starts[i + 1] = boundary
  }

  const blocks: CaptionBlock[] = []
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!
    const blockWords = words.slice(group.first, group.last + 1)
    const block: CaptionBlock = {
      id: newBlockId(),
      start: starts[i]!,
      end: ends[i]!,
      text: blockText(blockWords, resolved.engineFlags.punctuation),
      words: blockWords,
      speakerId: majoritySpeakerId(blockWords),
    }
    if (resolved.engineFlags.confidence) {
      const mean = meanWordProbability(blockWords)
      if (mean < resolved.lowConfidenceThreshold) {
        block.confidence = mean
      }
    }
    blocks.push(block)
  }
  return blocks
}
