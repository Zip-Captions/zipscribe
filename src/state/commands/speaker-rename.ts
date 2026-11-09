// `speaker-rename` (FR-102.1): labels are cosmetic, ids are durable
// (glossary § Speaker; invariant 4): a payload CARRYING an id change is
// rejected (SPEAKER_ID_IMMUTABLE) and a rename touches ONLY the label — every
// block keeps its speakerId. Empty labels reject (SPEAKER_LABEL_EMPTY). Any
// speaker mutation sets `speakerSource: 'manual'` (invariant 5).

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, SpeakerRenamePayload } from './types'
import { reject } from './validators'

export function createSpeakerRenameCommand(deps: CommandDeps): EditorCommand<'speaker-rename'> {
  return {
    id: 'speaker-rename',
    reduce(state: EditorRootState, payload: SpeakerRenamePayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      // Invariant 4: ids never change — a payload attempting one is rejected outright.
      if (Object.prototype.hasOwnProperty.call(payload, 'id')) return reject('SPEAKER_ID_IMMUTABLE', payload.speakerId)
      const speaker = project.speakers.find((s) => s.id === payload.speakerId)
      if (speaker === undefined) return reject('DANGLING_SPEAKER_REF', payload.speakerId)
      if (typeof payload.label !== 'string' || payload.label.trim() === '') return reject('SPEAKER_LABEL_EMPTY', payload.speakerId)
      speaker.label = payload.label
      project.speakerSource = 'manual'
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
