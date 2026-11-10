// `block-split` (FR-102.1): split at `at` into two invariant-valid halves.
// Words are never split (glossary § Word token): non-straddlers split on
// their own span (end ≤ `at` → left, start ≥ `at` → right); a straddler goes
// WHOLE to the nearer-midpoint part (US-2.2.2, see reduce). An empty part
// rejects (invariant 3). The FIRST part keeps the block
// id (invariant-10 entry continuity — split keeps the entry on the first
// part); the second gets a store-generated id. The invariant-10 hook routes
// through the injected seam during the reduce (single transaction).

import type { CaptionBlock, WordToken } from '../../engine/model'
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
      // Words are never split (unit-103 spec US-2.2.2, ledger adjudication (8)
      // 2026-11-09T23:05Z): a word straddling `at` goes WHOLE to the part
      // whose MIDPOINT is nearer the word's own midpoint (ties → FIRST part).
      // Part midpoints are computed on the PART spans — part1 = [block.start,
      // at], part2 = [at, block.end] — NOT on word spans. The assigned part's
      // edge is clamped to `at` (3-decimal via round3 above): word start
      // clamped when it lands RIGHT, word end clamped when it lands LEFT.
      // Either part ending with zero words rejects SPLIT_EMPTY_PART
      // (invariant 3) regardless of side.
      const part1Mid = (block.start + at) / 2
      const part2Mid = (at + block.end) / 2
      const leftWords: WordToken[] = []
      const rightWords: WordToken[] = []
      for (const w of block.words) {
        if (w.end <= at) leftWords.push(w)
        else if (w.start >= at) rightWords.push({ ...w })
        else if (Math.abs((w.start + w.end) / 2 - part1Mid) <= Math.abs((w.start + w.end) / 2 - part2Mid)) leftWords.push({ ...w, end: at })
        else rightWords.push({ ...w, start: at })
      }
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
