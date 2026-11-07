// `block-delete-close-gap` (FR-102.1): delete + "close gap" by EXTENDING the
// neighbours (domain invariant 9): with both neighbours the previous block's
// end extends to the next block's start; the later block is NEVER shifted
// (media never cut). Edge-only deletions extend the single neighbour to the
// removed block's far bound. The extended neighbour fires onBlockRetime
// (invariant 10: retiming never marks stale).

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
        previous.end = round3(next.start)
        deps.translationRules.onBlockRetime(project, previous.id)
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
