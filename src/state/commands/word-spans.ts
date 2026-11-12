// Word-time re-derivation rules frozen by the unit-102 contract:
//   * `block-edit-text`: words re-derived over the block's existing
//     [start,end] envelope by character weight (glossary § Word token —
//     "a text edit that turns one word into several splits its span
//     proportionally by character count"). Manual line breaks ('\' in the
//     edit text) survive as `breakAfter` on the preceding word (invariant 2).
//   * `block-retime`: word times scale proportionally into the new span.
// All writes go through the 3-decimal rule (invariant 6); rounding is
// monotonic so sortedness (invariant 1) survives.

import type { Seconds, WordToken } from '../../engine/model'
import { round3 } from './validators'

export interface Token {
  text: string
  breakAfter: boolean
}

/** Whitespace tokens with '\n' → `breakAfter` on the preceding token. */
export function tokenizeEditText(text: string): Token[] {
  const out: Token[] = []
  const segments = text.split('\n')
  for (let s = 0; s < segments.length; s++) {
    const tokens = (segments[s] ?? '').split(/\s+/).filter((t) => t.length > 0)
    for (const t of tokens) out.push({ text: t, breakAfter: false })
    if (s < segments.length - 1 && out.length > 0) {
      const last = out[out.length - 1]
      if (last !== undefined) last.breakAfter = true
    }
  }
  return out
}

function carriedField(oldWords: readonly WordToken[], mid: number, pick: (w: WordToken) => number | string | undefined): number | string | undefined {
  for (const w of oldWords) {
    if (w.start <= mid && mid < w.end) {
      const value = pick(w)
      if (value !== undefined) return value
    }
  }
  return undefined
}

/** Re-derive the block's words over [start,end] by character weight; speaker/probability carried from the old word covering the new token's midpoint.
 *  unit-104 CC-104.3 EDIT-PRESERVES-TIMING: when the token list maps 1:1 onto
 *  the old words with EQUAL text lengths (the "fixing spelling" case —
 *  US-2.1.3, design.md "editing never changes timings"; the same invariant the
 *  @104 EXTENDS `replace-text` contract row pins: "for same-length replacements
 *  of whole words the per-word times stay byte-identical"), each word keeps
 *  its own [start,end] BYTE-IDENTICALLY (the frozen
 *  `edit-preserves-timing.words.json` golden). Any other edit (word count or
 *  lengths changed) re-derives by character weight exactly as frozen. */
export function respanWords(oldWords: readonly WordToken[], tokens: readonly Token[], start: Seconds, end: Seconds): WordToken[] {
  const totalChars = tokens.reduce((sum, t) => sum + t.text.length, 0)
  if (totalChars === 0 || tokens.length === 0) return []
  const timingPreserved = tokens.length === oldWords.length && tokens.every((t, i) => oldWords[i]?.text.length === t.text.length)
  const span = end - start
  const words: WordToken[] = []
  let cursor = start
  let consumed = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === undefined) continue
    consumed += token.text.length
    const isLast = i === tokens.length - 1
    const naturalEnd = start + (consumed / totalChars) * span
    const carried = timingPreserved ? oldWords[i] : undefined
    const wordStart = carried !== undefined ? carried.start : round3(cursor)
    const wordEnd = carried !== undefined ? carried.end : round3(isLast ? end : naturalEnd)
    const mid = (wordStart + wordEnd) / 2
    const word: WordToken = { text: token.text, start: wordStart, end: wordEnd }
    const speakerId = carriedField(oldWords, mid, (w) => w.speakerId)
    if (typeof speakerId === 'string') word.speakerId = speakerId
    const probability = carriedField(oldWords, mid, (w) => w.probability)
    if (typeof probability === 'number') word.probability = probability
    if (token.breakAfter) word.breakAfter = true
    words.push(word)
    cursor = naturalEnd
  }
  return words
}

/** Proportional scale of word times from [oldStart,oldEnd] into [newStart,newEnd]. */
export function scaleWordsInto(words: readonly WordToken[], oldStart: Seconds, oldEnd: Seconds, newStart: Seconds, newEnd: Seconds): WordToken[] {
  const oldSpan = oldEnd - oldStart
  const ratio = oldSpan > 0 ? (newEnd - newStart) / oldSpan : 1
  return words.map((w) => ({
    ...w,
    start: round3(newStart + (w.start - oldStart) * ratio),
    end: round3(newStart + (w.end - oldStart) * ratio),
  }))
}
