// `block-retime` (FR-102.1): move the block's start/end. Frozen behavior:
// word times scale PROPORTIONALLY into the new span (every write 3-decimal,
// invariant 6; rounding monotonic so invariant 1 survives). Guards:
// duration positive (DURATION_NON_POSITIVE), inside the media
// (OUT_OF_MEDIA — invariant 9: the asset is never written), no neighbour
// overlap (BLOCKS_OVERLAP — invariant 1). Retiming never marks translations
// stale (invariant 10) — the onBlockRetime hook exists to make that call
// observable.

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { BlockRetimePayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { scaleWordsInto } from './word-spans'
import { findBlockIndex, isFiniteNumber, reject, round3 } from './validators'

export function createBlockRetimeCommand(deps: CommandDeps): EditorCommand<'block-retime'> {
  return {
    id: 'block-retime',
    reduce(state: EditorRootState, payload: BlockRetimePayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const index = findBlockIndex(project.blocks, payload.blockId)
      if (index < 0) return reject('DANGLING_BLOCK_REF', payload.blockId)
      const block = project.blocks[index]
      if (block === undefined) return reject('DANGLING_BLOCK_REF', payload.blockId)
      if (payload.start !== undefined && !isFiniteNumber(payload.start)) return reject('INVALID_PAYLOAD', block.id)
      if (payload.end !== undefined && !isFiniteNumber(payload.end)) return reject('INVALID_PAYLOAD', block.id)
      const newStart = payload.start ?? block.start
      const newEnd = payload.end ?? block.end
      if (newEnd <= newStart) return reject('DURATION_NON_POSITIVE', block.id)
      const duration = project.asset.duration
      if (newStart < 0 || newEnd > duration) return reject('OUT_OF_MEDIA', block.id)
      const previous = index > 0 ? project.blocks[index - 1] : undefined
      const next = index < project.blocks.length - 1 ? project.blocks[index + 1] : undefined
      if (previous !== undefined && newStart < previous.end) return reject('BLOCKS_OVERLAP', block.id)
      if (next !== undefined && newEnd > next.start) return reject('BLOCKS_OVERLAP', block.id)
      block.words = scaleWordsInto(block.words, block.start, block.end, newStart, newEnd)
      block.start = round3(newStart)
      block.end = round3(newEnd)
      deps.translationRules.onBlockRetime(project, block.id)
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
