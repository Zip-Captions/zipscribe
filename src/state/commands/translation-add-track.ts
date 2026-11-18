// `translation-add-track` (FR-301.5): add a TranslationTrack for a language.
// At most one track per language (model invariant). `origin: 'machine'`
// requires the engine (US-301.2 — unsupported browsers keep manual/imported
// paths working, CC-I4.5). Undoable (zundo).

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, TranslationAddTrackPayload } from './types'
import { reject } from './validators'

const BCP47 = /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export function createTranslationAddTrackCommand(deps: CommandDeps): EditorCommand<'translation-add-track'> {
  return {
    id: 'translation-add-track',
    reduce(state: EditorRootState, payload: TranslationAddTrackPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (typeof payload.language !== 'string' || !BCP47.test(payload.language)) return reject('INVALID_PAYLOAD', 'LANGUAGE')
      if (project.translations.some((t) => t.language === payload.language)) return reject('TRANSLATION_TRACK_EXISTS', payload.language)
      if (payload.origin === 'machine' && deps.translationEngineAvailable?.() === false) return reject('TRANSLATION_ENGINE_UNAVAILABLE', payload.language)
      project.translations.push({
        language: payload.language,
        origin: payload.origin,
        engine: payload.origin === 'machine' ? 'chrome-translator' : null,
        entries: {},
      })
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
