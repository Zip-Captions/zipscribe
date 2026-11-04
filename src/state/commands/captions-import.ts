// `captions-import` (FR-102.1, invariants 1–4): validated-on-entry source-
// track replacement (replace:true) or append. Every payload block must be
// well-formed (sorted non-overlapping track, words sorted within
// [start,end], `text` == words join, positive duration, resolvable
// `speakerId` against `speakers` ∪ payload `speakers`, unique ids) — an
// invalid payload rejects with a CODE and zero mutation (CC-102.3). A
// successful import sets `captionOrigin: 'imported'` (model.ts).

import type { CaptionBlock, Project, Speaker } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CaptionsImportPayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { findExistingOverlap, reject, resolveSpeakerId, validateBlockShape, validateSortedNonOverlapping, validateTranslationIntegrity } from './validators'

export function createCaptionsImportCommand(_deps: CommandDeps): EditorCommand<'captions-import'> {
  return {
    id: 'captions-import',
    reduce(state: EditorRootState, payload: CaptionsImportPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      // NOTE: no `Array.isArray(payload.blocks)` guard — on a `readonly T[]`
      // the narrowing widens to `any[]` (TS #17002 family); every field below
      // is validated structurally anyway.
      // replace:true removes blocks (translation keys die) — invariant-10 tracks must resolve first.
      if (payload.replace) {
        const integrity = validateTranslationIntegrity(project)
        if (integrity !== null) return integrity
      }
      const seen = new Set<string>()
      for (const b of payload.blocks) {
        if (typeof b.id !== 'string' || b.id === '' || seen.has(b.id)) return reject('INVALID_PAYLOAD', b.id)
        seen.add(b.id)
      }
      const track = validateSortedNonOverlapping(payload.blocks)
      if (track !== null) return track
      const extraSpeakers: readonly Speaker[] = payload.speakers ?? []
      for (const s of extraSpeakers) {
        if (typeof s.id !== 'string' || s.id === '' || typeof s.label !== 'string' || s.label.trim() === '' || typeof s.color !== 'string' || s.color === '')
          return reject('INVALID_PAYLOAD', typeof s.id === 'string' ? s.id : 'speaker')
      }
      const knownSpeaker = (id: string): boolean => resolveSpeakerId(project.speakers, id) || resolveSpeakerId(extraSpeakers, id)
      const existingIds = new Set(project.blocks.map((b) => b.id))
      for (const b of payload.blocks) {
        const shape = validateBlockShape(b)
        if (shape !== null) return shape
        if (!knownSpeaker(b.speakerId)) return reject('DANGLING_SPEAKER_REF', b.speakerId)
        if (!payload.replace) {
          if (existingIds.has(b.id)) return reject('INVALID_PAYLOAD', b.id)
          if (findExistingOverlap(project.blocks, b)) return reject('BLOCKS_OVERLAP', b.id)
        }
      }
      const imported: CaptionBlock[] = payload.blocks.map((b) => ({ ...b, words: b.words.map((w) => ({ ...w })) }))
      project.blocks = payload.replace ? imported : [...project.blocks, ...imported].sort((x, y) => x.start - y.start)
      for (const s of extraSpeakers) {
        if (!resolveSpeakerId(project.speakers, s.id)) project.speakers.push({ ...s })
      }
      project.captionOrigin = 'imported'
      project.updatedAt = _deps.clock.now()
      return null
    },
  }
}
