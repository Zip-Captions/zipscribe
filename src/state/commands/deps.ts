// Injectable seams + deps for the command reducers (FR-102.1). Reducers are
// pure over (state, payload) — everything impure or unmerged arrives through
// this injected bag (unit-101 intake-seam precedent): the merge-window clock,
// the engine-06 speaker functions, the unit-301 translation rules and the
// unit-05 blockizer.

import type { WordToken } from '../../engine/model'
import type { TranslationRules } from '../../engine/translate/track'
import { blockize } from '../../engine/asr/blockize'

/** Pure word→blocks grouping seam for `captions-reflow` (invariant 12: the re-flow is a separate undoable command; production default = the merged unit-05 blockizer, tests inject a fake). */
export type Blockizer = (words: readonly WordToken[], opts: { maxCharsPerLine?: number }) => { start: number; end: number; text: string; words: WordToken[]; speakerId: string }[]

/**
 * ASSUMPTION (frozen contract, engine-06 unmerged): `speaker-*` commands wrap
 * the engine-06 PURE functions through this seam only. When unit-06 lands,
 * `src/engine/diarize/assign.ts` must export `majoritySpeakerId`/`reassignWords`
 * VERBATIM (majority = most word.speakerId occurrences, earliest id in word
 * order on ties, words without a speakerId skipped, none at all → fallback)
 * and the production default re-points there.
 */
export interface SpeakerEngine {
  majoritySpeakerId(words: readonly WordToken[], fallback: string): string
  reassignWords(words: readonly WordToken[], fromSpeakerId: string, toSpeakerId: string): WordToken[]
}

/**
 * Typed-not-implemented production default (unit-101 intake-seam pattern):
 * dispatching a `speaker-*` command without an injected engine fails with a
 * CODE — never user content (SECURITY-03). Tests inject the fake
 * (`tests/unit/editor/helpers/fake-speaker-engine.ts`).
 */
export const NOT_IMPLEMENTED_SPEAKER_ENGINE: SpeakerEngine = {
  majoritySpeakerId(): string {
    throw new Error('SPEAKER_ENGINE_UNAVAILABLE')
  },
  reassignWords(): WordToken[] {
    throw new Error('SPEAKER_ENGINE_UNAVAILABLE')
  },
}

/** Production blockizer default — the merged unit-05 pure `blockize` (src/engine/asr/blockize.ts). */
export const DEFAULT_BLOCKIZER: Blockizer = (words, opts) => blockize(words, { maxCharsPerLine: opts.maxCharsPerLine })

export interface CommandDeps {
  /** Injected wall clock — the merge-window time source + `updatedAt` (fake in tests). */
  clock: { now(): number }
  speakerEngine: SpeakerEngine
  translationRules: TranslationRules
  blockizer: Blockizer
  /** Store-generated block ids (split parts, re-flow, import keep ids unique). */
  newBlockId(): string
}
