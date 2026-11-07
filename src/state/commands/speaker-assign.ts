// `speaker-assign` (FR-102.1): assign blocks to a speaker through the
// injected engine-06 seam — word-level truth first (`reassignWords`, then
// unlabelled words take the target id), block display materialized by the
// pure `majoritySpeakerId` over the UPDATED words (domain § Speaker
// assignment). Unknown target speaker rejects (invariant 4). Any speaker
// mutation sets `speakerSource: 'manual'` (invariant 5).

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, SpeakerAssignPayload } from './types'
import { findBlockIndex, reject, resolveSpeakerId } from './validators'

export function createSpeakerAssignCommand(deps: CommandDeps): EditorCommand<'speaker-assign'> {
  return {
    id: 'speaker-assign',
    reduce(state: EditorRootState, payload: SpeakerAssignPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (!resolveSpeakerId(project.speakers, payload.speakerId)) return reject('DANGLING_SPEAKER_REF', payload.speakerId)
      const indices: number[] = []
      for (const id of payload.blockIds) {
        const index = findBlockIndex(project.blocks, id)
        if (index < 0) return reject('DANGLING_BLOCK_REF', id)
        indices.push(index)
      }
      if (indices.length === 0) return null
      for (const index of indices) {
        const block = project.blocks[index]
        if (block === undefined) return reject('DANGLING_BLOCK_REF', payload.blockIds[0] ?? '')
        let words = deps.speakerEngine.reassignWords(block.words, block.speakerId, payload.speakerId)
        words = words.map((w) => (w.speakerId === undefined ? { ...w, speakerId: payload.speakerId } : { ...w }))
        block.words = words
        block.speakerId = deps.speakerEngine.majoritySpeakerId(words, payload.speakerId)
      }
      project.speakerSource = 'manual'
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
