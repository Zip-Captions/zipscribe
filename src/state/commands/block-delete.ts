// `block-delete` (FR-102.1): remove a block, LEAVING THE GAP — later blocks
// keep their times (invariant 9: caption timing edits never move media, v1
// has no media cutting). Deleting a block never deletes its speaker
// (invariant 4 — label reuse until project close). The invariant-10 delete
// hook routes through the injected seam.

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { BlockDeletePayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { findBlockIndex, reject, validateTranslationIntegrity } from './validators'

export function createBlockDeleteCommand(deps: CommandDeps): EditorCommand<'block-delete'> {
  return {
    id: 'block-delete',
    reduce(state: EditorRootState, payload: BlockDeletePayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const integrity = validateTranslationIntegrity(project)
      if (integrity !== null) return integrity
      const index = findBlockIndex(project.blocks, payload.blockId)
      if (index < 0) return reject('DANGLING_BLOCK_REF', payload.blockId)
      project.blocks.splice(index, 1)
      deps.translationRules.onBlockDelete(project, payload.blockId)
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
