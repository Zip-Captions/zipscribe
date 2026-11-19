// `translation-mark-reviewed` (FR-301.5 / US-301.3): accept a stale machine
// translation as-is — sourceHash moves to the CURRENT source text (entry
// leaves the stale set) and the text is unchanged. ONE undo step (zundo).

import type { Project } from '../../engine/model'
import { sourceHash } from '../../engine/translate/track'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, TranslationMarkReviewedPayload } from './types'
import { reject } from './validators'

export function createTranslationMarkReviewedCommand(deps: CommandDeps): EditorCommand<'translation-mark-reviewed'> {
  return {
    id: 'translation-mark-reviewed',
    reduce(state: EditorRootState, payload: TranslationMarkReviewedPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const track = project.translations.find((t) => t.language === payload.language)
      if (track === undefined) return reject('TRANSLATION_TRACK_ABSENT', payload.language)
      const block = project.blocks.find((b) => b.id === payload.blockId)
      if (block === undefined) return reject('DANGLING_BLOCK_REF', payload.blockId)
      const entry = track.entries[payload.blockId]
      if (entry === undefined) return reject('TRANSLATION_ENTRY_ABSENT', payload.blockId)
      entry.sourceHash = sourceHash(block.text)
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
