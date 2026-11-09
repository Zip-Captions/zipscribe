// `speaker-recolor` (FR-102.1): the color is cosmetic (glossary § Speaker);
// ids/labels untouched (invariant 4). Any speaker mutation sets
// `speakerSource: 'manual'` (invariant 5).

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, SpeakerRecolorPayload } from './types'
import { reject } from './validators'

export function createSpeakerRecolorCommand(deps: CommandDeps): EditorCommand<'speaker-recolor'> {
  return {
    id: 'speaker-recolor',
    reduce(state: EditorRootState, payload: SpeakerRecolorPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const speaker = project.speakers.find((s) => s.id === payload.speakerId)
      if (speaker === undefined) return reject('DANGLING_SPEAKER_REF', payload.speakerId)
      if (typeof payload.color !== 'string' || payload.color.trim() === '') return reject('INVALID_PAYLOAD', payload.speakerId)
      speaker.color = payload.color
      project.speakerSource = 'manual'
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
