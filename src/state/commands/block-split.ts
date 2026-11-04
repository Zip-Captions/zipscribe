// `block-split` (FR-102.1): split at `at` into two invariant-valid halves.
// Words are never split (glossary § Word token): left = words ending at-or-
// before `at`; right = the rest, straddlers included with `start` clamped to
// `at`. An empty part rejects (invariant 3). The FIRST part keeps the block
// id (invariant-10 entry continuity — split keeps the entry on the first
// part); the second gets a store-generated id. The invariant-10 hook routes
// through the injected seam during the reduce (single transaction).

import type { CaptionBlock } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { BlockSplitPayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { deriveBlockText } from './derive-text'
import { findBlockIndex, isFiniteNumber, reject, round3, validateTranslationIntegrity } from './validators'

export function createBlockSplitCommand(deps: CommandDeps): EditorCommand<'block-split'> {
  return {
    id: 'block-split',
    reduce(state: EditorRootState, payload: BlockSplitPayload): CommandReject | null {
      const project = state.project as typeof state.project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const integrity = validateTranslationIntegrity(project)
      if (integrity !== null) return integrity
      const index = findBlockIndex(project.blocks, payload.blockId)
      if (index < 0) return reject('DANGLING_BLOCK_REF', payload.blockId)
      const block = project.blocks[index]
      if (block === undefined) return reject('DANGLING_BLOCK_REF', payload.blockId)
      if (!isFiniteNumber(payload.at) || payload.at <= block.start || payload.at >= block.end) return reject('INVALID_PAYLOAD', block.id)
      const at = round3(payload.at)
      // Words are never split: a word straddling `at` goes WHOLE into the
      // RIGHT part with its start clamped to `at` (the left part can only
      // hold words ending at/before `at` — the frozen `at: 0.6` case must
      // reject SPLIT_EMPTY_PART, which is only consistent if straddlers
      // leave the left part).
      const leftWords = block.words.filter((w) => w.end <= at)
      const rightWords = block.words
        .filter((w) => w.start >= at || w.end > at)
        .map((w) => (w.start < at ? { ...w, start: at } : { ...w }))
      if (leftWords.length === 0 || rightWords.length === 0) return reject('SPLIT_EMPTY_PART', block.id)
      const secondId = deps.newBlockId()
      const first: CaptionBlock = { ...block, end: at, words: leftWords, text: deriveBlockText(leftWords) }
      const second: CaptionBlock = { ...block, id: secondId, start: at, end: block.end, words: rightWords, text: deriveBlockText(rightWords) }
      project.blocks.splice(index, 1, first, second)
      deps.translationRules.onBlockSplit(project, block.id, first.id, secondId)
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
