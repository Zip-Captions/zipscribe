// `block-edit-text` (FR-102.1): replace the block's text. '' deletes the
// block (invariant 3 — no empty blocks persist, and the invariant-10 delete
// hook fires). Otherwise words are RE-DERIVED over the block's existing
// [start,end] envelope by character weight (frozen; glossary § Word token),
// text re-derived via `deriveBlockText` (invariant 2). The block keeps its
// id/span, so translation entries stay keyed (staleness is a sourceHash
// concern unit-301 surfaces — invariant 10 never silently retranslates).

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { BlockEditTextPayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { deriveBlockText } from './derive-text'
import { respanWords, tokenizeEditText } from './word-spans'
import { findBlockIndex, reject, validateTranslationIntegrity } from './validators'

export function createBlockEditTextCommand(deps: CommandDeps): EditorCommand<'block-edit-text'> {
  return {
    id: 'block-edit-text',
    reduce(state: EditorRootState, payload: BlockEditTextPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (typeof payload.text !== 'string') return reject('INVALID_PAYLOAD', payload.blockId)
      const index = findBlockIndex(project.blocks, payload.blockId)
      if (index < 0) return reject('DANGLING_BLOCK_REF', payload.blockId)
      const block = project.blocks[index]
      if (block === undefined) return reject('DANGLING_BLOCK_REF', payload.blockId)
      const tokens = tokenizeEditText(payload.text)
      if (tokens.length === 0) {
        // Invariant 3: empty text deletes the block — this IS a block delete
        // (key-changing), so the invariant-10 integrity pre-check applies.
        const integrity = validateTranslationIntegrity(project)
        if (integrity !== null) return integrity
        project.blocks.splice(index, 1)
        deps.translationRules.onBlockDelete(project, block.id)
        project.updatedAt = deps.clock.now()
        return null
      }
      const words = respanWords(block.words, tokens, block.start, block.end)
      block.words = words
      block.text = deriveBlockText(words)
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
