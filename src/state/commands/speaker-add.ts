// `speaker-add` (FR-102.1): create the next durable `SPK_<n>` identity — ids
// come from the store, never the label (glossary § Speaker). Any speaker
// mutation flips `speakerSource` to 'manual' (invariant 5 — reverting to auto
// is explicit only).

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, SpeakerAddPayload } from './types'
import { reject } from './validators'

export function createSpeakerAddCommand(deps: CommandDeps): EditorCommand<'speaker-add'> {
  return {
    id: 'speaker-add',
    reduce(state: EditorRootState, payload: SpeakerAddPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (typeof payload.label !== 'string' || payload.label.trim() === '') return reject('SPEAKER_LABEL_EMPTY', 'label')
      if (typeof payload.color !== 'string' || payload.color.trim() === '') return reject('INVALID_PAYLOAD', 'color')
      let highest = 0
      for (const s of project.speakers) {
        const match = /^SPK_(\d+)$/.exec(s.id)
        const n = match?.[1] === undefined ? 0 : Number(match[1])
        if (Number.isFinite(n) && n > highest) highest = n
      }
      project.speakers.push({ id: `SPK_${highest + 1}`, label: payload.label, color: payload.color })
      project.speakerSource = 'manual'
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
