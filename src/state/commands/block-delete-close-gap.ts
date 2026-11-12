// `block-delete-close-gap` (FR-102.1; FR-104.7/CC-104.8 unit-104
// adjudication, CONTRACT.md block-delete-close-gap row): delete + "close gap"
// by EXTENDING the neighbours (domain invariant 9). With BOTH neighbours they
// COLLAPSE TO MEET AT THE GAP MIDPOINT — `previous.end = next.start =
// round3((prevEnd + nextStart) / 2)` (the unit-102-era clamp-to-next-start
// reading is superseded; invariant 9's "never shifts later blocks" binds
// blocks BEYOND the two neighbours). Edge-only deletions extend the single
// neighbour to the removed block's far bound. Both re-timed neighbours fire
// onBlockRetime (invariant 10: retiming never marks stale); media is never
// cut.

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { BlockDeletePayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { findBlockIndex, reject, round3, validateTranslationIntegrity } from './validators'

export function createBlockDeleteCloseGapCommand(deps: CommandDeps): EditorCommand<'block-delete-close-gap'> {
  return {
    id: 'block-delete-close-gap',
    reduce(state: EditorRootState, payload: BlockDeletePayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const integrity = validateTranslationIntegrity(project)
      if (integrity !== null) return integrity
      const index = findBlockIndex(project.blocks, payload.blockId)
      if (index < 0) return reject('DANGLING_BLOCK_REF', payload.blockId)
      const removed = project.blocks[index]
      if (removed === undefined) return reject('DANGLING_BLOCK_REF', payload.blockId)
      const previous = index > 0 ? project.blocks[index - 1] : undefined
      const next = index < project.blocks.length - 1 ? project.blocks[index + 1] : undefined
      project.blocks.splice(index, 1)
      deps.translationRules.onBlockDelete(project, payload.blockId)
      if (previous !== undefined && next !== undefined) {
        // FR-104.7: the neighbours collapse to MEET at the gap midpoint.
        const meet = round3((previous.end + next.start) / 2)
        previous.end = meet
        next.start = meet
        deps.translationRules.onBlockRetime(project, previous.id)
        deps.translationRules.onBlockRetime(project, next.id)
      } else if (previous !== undefined) {
        previous.end = round3(removed.end)
        deps.translationRules.onBlockRetime(project, previous.id)
      } else if (next !== undefined) {
        next.start = round3(removed.start)
        deps.translationRules.onBlockRetime(project, next.id)
      }
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
