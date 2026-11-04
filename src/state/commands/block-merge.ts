// `block-merge` (FR-102.1): merge two ADJACENT blocks (timeline order) — the
// span is the union, text the space-joined words re-derived over the union
// (invariant 2), words the concatenation (already sorted by invariant 1). The
// merged block keeps the LEFT id (invariant-10: onBlockMerge receives
// mergedId + sourceIds). Non-adjacent pairs reject (MERGE_NOT_ADJACENT).

import type { CaptionBlock } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { BlockMergePayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { deriveBlockText } from './derive-text'
import { findBlockIndex, reject, validateTranslationIntegrity } from './validators'

export function createBlockMergeCommand(deps: CommandDeps): EditorCommand<'block-merge'> {
  return {
    id: 'block-merge',
    reduce(state: EditorRootState, payload: BlockMergePayload): CommandReject | null {
      const project = state.project as typeof state.project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const integrity = validateTranslationIntegrity(project)
      if (integrity !== null) return integrity
      const leftId = payload.blockIds[0]
      const rightId = payload.blockIds[1]
      if (leftId === undefined || rightId === undefined) return reject('INVALID_PAYLOAD', 'blockIds')
      const ia = findBlockIndex(project.blocks, leftId)
      if (ia < 0) return reject('DANGLING_BLOCK_REF', leftId)
      const ib = findBlockIndex(project.blocks, rightId)
      if (ib < 0) return reject('DANGLING_BLOCK_REF', rightId)
      if (ib !== ia + 1) return reject('MERGE_NOT_ADJACENT', rightId)
      const left = project.blocks[ia]
      const right = project.blocks[ib]
      if (left === undefined || right === undefined) return reject('DANGLING_BLOCK_REF', rightId)
      const words = [...left.words, ...right.words].map((w) => ({ ...w }))
      const merged: CaptionBlock = { ...left, id: left.id, start: left.start, end: right.end, words, text: deriveBlockText(words) }
      project.blocks.splice(ia, 2, merged)
      deps.translationRules.onBlockMerge(project, left.id, [leftId, rightId])
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
