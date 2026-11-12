// `replace-text` (unit-104 EXTENDS, CONTRACT.md § Commands — unit-104
// EXTENDS; US-2.1.6 / CC-104.4): ONE find-and-replace pass over EVERY block's
// text = ONE dispatch = ONE undo step. Match semantics (frozen by the CC-104.4
// property oracle): default = case-insensitive substring per word token;
// `caseSensitive` = exact substring; `wholeWord` = token-core equality with
// normalizeToken (case-fold + strip non-alphanumerics, the align.ts rule).
// Word TIMINGS unchanged (edit-preserves-timing): replacement is per token
// and each word keeps its own [start,end] — for equal-length replacements the
// per-token character weights are unchanged, so this is byte-identical to the
// frozen `block-edit-text` character-weight re-derivation over the
// [start,end] envelope (word-spans.ts `respanWords`). `block.text` is
// re-derived through `deriveBlockText` (invariant 2); no speaker data is
// touched, the Beta badge never flips (contract: replace-text is not a
// speaker mutation). Zero matches → return null WITHOUT touching the draft,
// so the store's project-reference equality yields NO history step.
// SECURITY-03: rejections carry codes + field-name tokens only.

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, ReplaceTextPayload } from './types'
import { deriveBlockText } from './derive-text'
import { reject } from './validators'

/** Whole-word token core: case-fold + strip everything non-alphanumeric
 *  (the frozen normalizeToken family, align.ts, minus the kept whitespace —
 *  word tokens carry no spaces). */
function normalizeCore(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
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

/** New token text on a match, `null` when the token does not match. */
function replaceInToken(text: string, query: string, replacement: string, caseSensitive: boolean, wholeWord: boolean): string | null {
  if (wholeWord) {
    const equal = caseSensitive ? text === query : normalizeCore(text) === normalizeCore(query)
    return equal ? replacement : null
  }
  if (caseSensitive) return text.includes(query) ? text.split(query).join(replacement) : null
  return text.toLowerCase().includes(query.toLowerCase()) ? replaceInsensitive(text, query.toLowerCase(), replacement) : null
}

export function createReplaceTextCommand(deps: CommandDeps): EditorCommand<'replace-text'> {
  return {
    id: 'replace-text',
    reduce(state: EditorRootState, payload: ReplaceTextPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (typeof payload.query !== 'string' || payload.query.length === 0) return reject('INVALID_PAYLOAD', 'query')
      if (typeof payload.replacement !== 'string') return reject('INVALID_PAYLOAD', 'replacement')
      // A newline inside a token would break the invariant-2 join — manual
      // breaks are `breakAfter`, never embedded whitespace in word text.
      if (/[\n\r]/.test(payload.query) || /[\n\r]/.test(payload.replacement)) return reject('INVALID_PAYLOAD', 'query')
      if (payload.caseSensitive !== undefined && typeof payload.caseSensitive !== 'boolean') return reject('INVALID_PAYLOAD', 'caseSensitive')
      if (payload.wholeWord !== undefined && typeof payload.wholeWord !== 'boolean') return reject('INVALID_PAYLOAD', 'wholeWord')
      if (project.blocks.length === 0) return null
      const caseSensitive = payload.caseSensitive === true
      const wholeWord = payload.wholeWord === true
      let matched = false
      for (const block of project.blocks) {
        let blockChanged = false
        const words = block.words.map((w) => {
          const next = replaceInToken(w.text, payload.query, payload.replacement, caseSensitive, wholeWord)
          if (next === null) return w
          blockChanged = true
          return { ...w, text: next }
        })
        if (blockChanged) {
          // Per-token replacement: every word keeps its [start,end] (timings
          // frozen); text is re-derived from the words (invariant 2).
          block.words = words
          block.text = deriveBlockText(words)
          matched = true
        }
      }
      if (!matched) return null // zero matches: draft untouched → no history step
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
