// `speaker-merge` (unit-104 EXTENDS, CONTRACT.md § Commands — unit-104
// EXTENDS; US-1.3.3 / CC-104.5): the unit-06 reassign-sequence semantics —
// EVERY effective word of `from` (explicit `speakerId` or block-inherited)
// moves to `into`, `from` leaves `speakers`, block majorities re-materialize
// — delegated VERBATIM to the injected `SpeakerEngine` seam (@104 additive
// member; direction (from, into), production wraps
// `assign.mergeSpeakers(project, into, from)`). Ids are validated BEFORE
// delegating: `from === into` rejects `SPEAKER_MERGE_SELF`, an unknown id
// rejects `DANGLING_SPEAKER_REF` — a rejection makes NO change and NO history
// step. `speakerSource → 'manual'` is carried by the pure engine fn
// (invariant 5). ONE undo step (zundo); `updatedAt` via the injected clock.

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, SpeakerMergePayload } from './types'
import { reject, resolveSpeakerId } from './validators'

export function createSpeakerMergeCommand(deps: CommandDeps): EditorCommand<'speaker-merge'> {
  return {
    id: 'speaker-merge',
    reduce(state: EditorRootState, payload: SpeakerMergePayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (typeof payload.from !== 'string' || typeof payload.into !== 'string') return reject('INVALID_PAYLOAD', 'speaker')
      if (payload.from === payload.into) return reject('SPEAKER_MERGE_SELF', payload.from)
      if (!resolveSpeakerId(project.speakers, payload.from)) return reject('DANGLING_SPEAKER_REF', payload.from)
      if (!resolveSpeakerId(project.speakers, payload.into)) return reject('DANGLING_SPEAKER_REF', payload.into)
      const merged = deps.speakerEngine.mergeSpeakers?.(project, payload.from, payload.into)
      if (merged === undefined) throw new Error('SPEAKER_ENGINE_UNAVAILABLE')
      project.blocks = merged.blocks
      project.speakers = merged.speakers
      project.speakerSource = merged.speakerSource
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
