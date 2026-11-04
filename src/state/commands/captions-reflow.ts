// `captions-reflow` (FR-102.1, invariant 12): re-group all source words into
// blocks through the injected `Blockizer` (production default = the merged
// unit-05 blockizer; tests inject a deterministic fake). Separate UNDOABLE
// command — import keeps the file's segmentation, re-flowing is explicit.
// Output is re-validated (invariants 1–3) and every `speakerId` must resolve
// (invariant 4); the blockizer's `text` is advisory — text is re-derived
// (invariant 2 is reducer-enforced, never trusted).

import type { CaptionBlock, Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CaptionsReflowPayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { deriveBlockText } from './derive-text'
import { isFiniteNumber, reject, resolveSpeakerId, round3, validateSortedNonOverlapping, validateTranslationIntegrity } from './validators'

export function createCaptionsReflowCommand(deps: CommandDeps): EditorCommand<'captions-reflow'> {
  return {
    id: 'captions-reflow',
    reduce(state: EditorRootState, payload: CaptionsReflowPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      // Key-changing (all old block ids are replaced) — invariant-10 tracks must resolve first.
      const integrity = validateTranslationIntegrity(project)
      if (integrity !== null) return integrity
      const allWords = project.blocks.flatMap((b) => b.words.map((w) => ({ ...w })))
      const groups = deps.blockizer(allWords, { maxCharsPerLine: payload.maxCharsPerLine })
      const shaped: CaptionBlock[] = []
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i]
        if (group === undefined) return reject('INVALID_PAYLOAD', String(i))
        if (!isFiniteNumber(group.start) || !isFiniteNumber(group.end)) return reject('INVALID_PAYLOAD', String(i))
        if (group.end <= group.start) return reject('DURATION_NON_POSITIVE', String(i))
        if (group.words.length === 0) return reject('INVALID_PAYLOAD', String(i))
        for (const w of group.words) {
          if (w.start < group.start || w.end > group.end || w.start > w.end) return reject('WORD_OUT_OF_RANGE', String(i))
        }
        if (!resolveSpeakerId(project.speakers, group.speakerId)) return reject('DANGLING_SPEAKER_REF', group.speakerId)
        const words = group.words.map((w) => ({ ...w }))
        shaped.push({ id: deps.newBlockId(), start: round3(group.start), end: round3(group.end), words, text: deriveBlockText(words), speakerId: group.speakerId })
      }
      const order = validateSortedNonOverlapping(shaped)
      if (order !== null) return reject('INVALID_PAYLOAD', order.token)
      project.blocks = shaped
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
