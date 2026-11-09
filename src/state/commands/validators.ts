// Shared reducer validation — domain invariants 1–4 and 9 (CC-102.3). Every
// violation surfaces a CommandReject CODE + an entity id/index token, never
// user content (SECURITY-03); a rejected payload means the reducer made NO
// change (dispatch applies the reducer inside an immer produce, so a thrown
// reject aborts the draft — zero mutation is structural, not a discipline).

import type { CaptionBlock, Project, Seconds, Speaker } from '../../engine/model'
import type { CommandReject, CommandRejectCode } from './types'
import { deriveBlockText } from './derive-text'

/** Invariant 6: 3-decimal precision ceiling on everything the reducers write. CH.8 (unit-102 adversary): -0 normalizes to 0 — the canonical byte form (invariant 8) cannot represent negative zero, so the store's value domain never contains it (parse(serialize) roundtrip stays exact). */
export function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return rounded === 0 ? 0 : rounded
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function reject(code: CommandRejectCode, token: string): CommandReject {
  return { code, token }
}

export function findBlockIndex(blocks: readonly CaptionBlock[], id: string): number {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i]?.id === id) return i
  }
  return -1
}

/** Structural validation of one payload block (invariants 1–3 + 2-join). */
export function validateBlockShape(block: CaptionBlock): CommandReject | null {
  if (!isFiniteNumber(block.start) || !isFiniteNumber(block.end)) return reject('INVALID_PAYLOAD', block.id)
  if (block.end <= block.start) return reject('DURATION_NON_POSITIVE', block.id)
  if (!Array.isArray(block.words) || block.words.length === 0) return reject('INVALID_PAYLOAD', block.id)
  let previousWordEnd = Number.NEGATIVE_INFINITY
  for (const w of block.words) {
    if (!isFiniteNumber(w.start) || !isFiniteNumber(w.end)) return reject('INVALID_PAYLOAD', block.id)
    if (w.start < previousWordEnd) return reject('WORDS_UNSORTED', block.id)
    if (w.start > w.end) return reject('WORDS_UNSORTED', block.id)
    if (w.start < block.start || w.end > block.end) return reject('WORD_OUT_OF_RANGE', block.id)
    previousWordEnd = w.end
  }
  if (block.text !== deriveBlockText(block.words)) return reject('TEXT_WORD_MISMATCH', block.id)
  return null
}

/** Timeline-order validation of a payload batch (invariant 1): starts must be non-decreasing (unsorted) and no block may start before the previous ends (overlap). */
export function validateSortedNonOverlapping(blocks: readonly CaptionBlock[]): CommandReject | null {
  let previousStart = Number.NEGATIVE_INFINITY
  let previousEnd = Number.NEGATIVE_INFINITY
  for (const b of blocks) {
    if (b.start < previousStart) return reject('BLOCKS_UNSORTED', b.id)
    if (b.start < previousEnd) return reject('BLOCKS_OVERLAP', b.id)
    previousStart = b.start
    previousEnd = b.end
  }
  return null
}

/** Append-mode collision of a payload block against the existing track (invariant 1). */
export function findExistingOverlap(blocks: readonly CaptionBlock[], candidate: CaptionBlock): boolean {
  for (const b of blocks) {
    if (b.start < candidate.end && candidate.start < b.end) return true
  }
  return false
}

/**
 * Invariant-10 pre-validation for key-changing commands (split/merge/delete/
 * close-gap): every `TranslationEntry` key must resolve to an existing source
 * block. The invariant-10 ENTRY cleanup is unit-301's job (NO-OP stub until
 * then), so these commands refuse to run on a project whose tracks are
 * already dangling — the state can never be made worse by an accepted command.
 */
export function validateTranslationIntegrity(project: Project): CommandReject | null {
  for (const track of project.translations) {
    for (const key of Object.keys(track.entries)) {
      if (findBlockIndex(project.blocks, key) < 0) return reject('DANGLING_TRANSLATION_REF', key)
    }
  }
  return null
}

export function resolveSpeakerId(speakers: readonly Speaker[], id: string): boolean {
  return speakers.some((s) => s.id === id)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Invariant 9 guard: caption timing edits never move media (the asset is read-only to reducers). */
export function mediaDuration(project: Project | null): Seconds {
  return project?.asset.duration ?? Number.POSITIVE_INFINITY
}
