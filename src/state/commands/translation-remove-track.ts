// `translation-remove-track` (FR-301.5): remove the track for a language.
// Undoable (FR-301.5 calls this out explicitly — covered by zundo, asserted
// in tests/unit/translate/commands.test.ts).

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, TranslationRemoveTrackPayload } from './types'
import { reject } from './validators'

export function createTranslationRemoveTrackCommand(deps: CommandDeps): EditorCommand<'translation-remove-track'> {
  return {
    id: 'translation-remove-track',
    reduce(state: EditorRootState, payload: TranslationRemoveTrackPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const index = project.translations.findIndex((t) => t.language === payload.language)
      if (index < 0) return reject('TRANSLATION_TRACK_ABSENT', payload.language)
      project.translations.splice(index, 1)
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
