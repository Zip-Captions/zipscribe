// `captions-align-apply` (unit-104 EXTENDS, CONTRACT.md § Commands — unit-104
// EXTENDS; CC-104.7 "Align to audio"): the WHOLE apply is ONE undo step.
// Pure over (state, payload): delegates to the merged engine-07
// `alignCaptionsToWords` (src/engine/captions/align.ts — Needleman–Wunsch-
// style LCS matching, normalizeToken equality, matched times inside the
// block's own [start,end]) and writes the result onto the draft, mirroring
// how the engine-06 seam results are applied: matched words copy the ASR
// times with timing 'aligned'; unmatched re-interpolate evenly between
// aligned neighbours and stay 'estimated'; text/count/bounds/ids NEVER change
// (US-07.3). A fully identity align touches nothing — the store's
// project-reference equality keeps it step-free. The payload carries
// protocol objects only; nothing here logs content (SECURITY-03).

import { alignCaptionsToWords, type AsrWordInput } from '../../engine/captions/align'
import type { CaptionBlock, Project, WordToken } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CaptionsAlignApplyPayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { isFiniteNumber, reject } from './validators'

function isAsrWordInput(value: unknown): value is AsrWordInput {
  if (typeof value !== 'object' || value === null) return false
  const w = value as Record<string, unknown>
  return typeof w['text'] === 'string' && isFiniteNumber(w['start']) && isFiniteNumber(w['end'])
}

/** Align never changes text/ids/bounds — only word times/timing; this is the
 *  identity check that keeps a no-op apply step-free (immer reference
 *  equality is what the zundo equality consumes). */
function isIdentityBlock(current: CaptionBlock, next: CaptionBlock): boolean {
  if (current.id !== next.id || current.start !== next.start || current.end !== next.end || current.text !== next.text) return false
  if (current.words.length !== next.words.length) return false
  for (let i = 0; i < current.words.length; i++) {
    const a = current.words[i] as WordToken
    const b = next.words[i] as WordToken
    if (a.text !== b.text || a.start !== b.start || a.end !== b.end || a.timing !== b.timing) return false
  }
  return true
}

export function createCaptionsAlignApplyCommand(deps: CommandDeps): EditorCommand<'captions-align-apply'> {
  return {
    id: 'captions-align-apply',
    reduce(state: EditorRootState, payload: CaptionsAlignApplyPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (!Array.isArray(payload.asrWords)) return reject('INVALID_PAYLOAD', 'asrWords')
      for (let i = 0; i < payload.asrWords.length; i++) {
        if (!isAsrWordInput(payload.asrWords[i])) return reject('INVALID_PAYLOAD', `asrWords[${i}]`)
      }
      if (project.blocks.length === 0) return null
      const outcome = alignCaptionsToWords(project, payload.asrWords)
      let changed = false
      for (let i = 0; i < outcome.project.blocks.length; i++) {
        const current = project.blocks[i]
        const next = outcome.project.blocks[i]
        if (current === undefined || next === undefined) return reject('INVALID_PAYLOAD', String(i))
        if (!isIdentityBlock(current, next)) {
          changed = true
          break
        }
      }
      if (!changed) return null // fully identity apply: draft untouched → no history step
      project.blocks = outcome.project.blocks
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
