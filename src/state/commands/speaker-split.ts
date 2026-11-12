// `speaker-split` (unit-104 EXTENDS, CONTRACT.md § Commands — unit-104
// EXTENDS; US-1.3.3 / CC-104.5): the unit-06 split semantics — `speakerId`'s
// words with `start >= at` move to a NEW APPENDED speaker (next free
// `SPK_<n>`, label `Speaker <n>`); block majorities re-materialize.
// Delegated VERBATIM to the injected `SpeakerEngine` seam (@104 additive
// member, same argument order as `assign.splitSpeaker`). Validation BEFORE
// delegating: unknown id rejects `DANGLING_SPEAKER_REF`, a non-finite `at`
// rejects `INVALID_PAYLOAD` — rejection = NO change and NO history step.
// `color` omitted → the engine palette (SPEAKER_PALETTE, cycled by the new
// speaker's append index). `speakerSource → 'manual'` is carried by the pure
// engine fn (invariant 5). ONE undo step (zundo); `updatedAt` via the clock.

import { SPEAKER_PALETTE } from '../../engine/diarize/assign'
import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, SpeakerSplitPayload } from './types'
import { isFiniteNumber, reject, resolveSpeakerId } from './validators'

export function createSpeakerSplitCommand(deps: CommandDeps): EditorCommand<'speaker-split'> {
  return {
    id: 'speaker-split',
    reduce(state: EditorRootState, payload: SpeakerSplitPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (typeof payload.speakerId !== 'string') return reject('INVALID_PAYLOAD', 'speaker')
      if (!isFiniteNumber(payload.at)) return reject('INVALID_PAYLOAD', 'at')
      if (!resolveSpeakerId(project.speakers, payload.speakerId)) return reject('DANGLING_SPEAKER_REF', payload.speakerId)
      if (payload.color !== undefined && typeof payload.color !== 'string') return reject('INVALID_PAYLOAD', 'color')
      const color = payload.color ?? SPEAKER_PALETTE[project.speakers.length % SPEAKER_PALETTE.length]
      if (color === undefined) return reject('INVALID_PAYLOAD', 'color')
      const splitProject = deps.speakerEngine.splitSpeaker?.(project, payload.speakerId, payload.at, color)
      if (splitProject === undefined) throw new Error('SPEAKER_ENGINE_UNAVAILABLE')
      project.blocks = splitProject.blocks
      project.speakers = splitProject.speakers
      project.speakerSource = splitProject.speakerSource
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
