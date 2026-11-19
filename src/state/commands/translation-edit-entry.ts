// `translation-edit-entry` (FR-301.5): user edits a translation → status
// 'edited' (CC-I4.3). Undoable. sourceHash untouched: an edited entry stays
// "reviewed" against the source text it was made from.

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, TranslationEditEntryPayload } from './types'
import { reject } from './validators'

export function createTranslationEditEntryCommand(deps: CommandDeps): EditorCommand<'translation-edit-entry'> {
  return {
    id: 'translation-edit-entry',
    reduce(state: EditorRootState, payload: TranslationEditEntryPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const track = project.translations.find((t) => t.language === payload.language)
      if (track === undefined) return reject('TRANSLATION_TRACK_ABSENT', payload.language)
      if (project.blocks.findIndex((b) => b.id === payload.blockId) < 0) return reject('DANGLING_BLOCK_REF', payload.blockId)
      const entry = track.entries[payload.blockId]
      if (entry === undefined) return reject('TRANSLATION_ENTRY_ABSENT', payload.blockId)
      if (typeof payload.text !== 'string') return reject('INVALID_PAYLOAD', payload.blockId)
      entry.text = payload.text
      entry.status = 'edited'
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
