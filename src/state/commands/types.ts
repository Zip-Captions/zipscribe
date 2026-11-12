// Command-system types — the frozen contract surface
// (tests/unit/editor/unit102-api-contract.d.ts § '@state/commands'). Names and
// shapes are byte-for-byte with the frozen declarations; downstream units
// (103/104/105/106, Intent 3) import them through `src/state/generated/contract-types.ts`.

import type { CaptionBlock, Project, Seconds, Speaker } from '../../engine/model'
import type { AsrWordInput } from '../../engine/captions/align'
import type { EditorUiState } from '../editor'

export type CommandId =
  | 'block-split'
  | 'block-merge'
  | 'block-retime'
  | 'block-edit-text'
  | 'block-delete'
  | 'block-delete-close-gap'
  | 'captions-retime-all'
  | 'captions-reflow'
  | 'captions-import'
  | 'speaker-add'
  | 'speaker-assign'
  | 'speaker-rename'
  | 'speaker-recolor'
  | 'project-rename'
  | 'transport-play'
  | 'transport-pause'
  | 'transport-seek'
  | 'transport-skip'
  | 'transport-step-frame'
  | 'transport-step-second'
  | 'transport-loop-set'
  | 'transport-loop-in'
  | 'transport-loop-out'
  | 'transport-loop-clear'
  | 'transport-loop-toggle'
  | 'transport-rate'
  // unit-104 EXTENDS (CONTRACT.md § Commands — unit-104 EXTENDS, orchestrator
  // adjudication 2026-11-11): the frozen 26 stay untouched; these four append.
  | 'speaker-merge'
  | 'speaker-split'
  | 'replace-text'
  | 'captions-align-apply'

export interface BlockSplitPayload {
  blockId: string
  /** Absolute media time strictly inside the block; both parts must keep ≥ 1 word. */
  at: Seconds
}
export interface BlockMergePayload {
  /** Exactly two ADJACENT block ids in timeline order. */
  blockIds: readonly [string, string]
}
export interface BlockRetimePayload {
  blockId: string
  start?: Seconds
  end?: Seconds
  /** Frozen behavior: word times scale proportionally into the new span. */
}
export interface BlockEditTextPayload {
  blockId: string
  /** '' deletes the block (invariant 3). Words are re-derived over the
   * block's existing [start,end] envelope by character weight (frozen). */
  text: string
}
export interface BlockDeletePayload {
  blockId: string
}
export interface CaptionsRetimeAllPayload {
  /** Uniform shift of the whole source track, clamped into [0, asset.duration];
   * relative gaps preserved; media is never moved (invariant 9). */
  offsetSec: Seconds
  /** @104 EXTENDS (CONTRACT.md captions-retime-all row, adjudicated
   * 2026-11-12, FR-104.8 two-point sync): optional stretch via the frozen
   * engine `retimeAll` map t → anchorSec + (t − anchorSec) × scale +
   * offsetSec, clamped into [0, asset.duration]. Omitted → the frozen
   * offset-only semantics byte-identically (scale 1, anchor 0). */
  scale?: number
  /** @104 EXTENDS: stretch anchor (engine default 0). See `scale`. */
  anchorSec?: number
}
export interface CaptionsReflowPayload {
  /** Policy knob handed to the injected `Blockizer`. */
  maxCharsPerLine?: number
}
export interface CaptionsImportPayload {
  /** Validated on entry: sorted & non-overlapping (invariants 1), words
   * sorted within [start,end], `text` == words join (invariant 2),
   * `speakerId` resolvable against `speakers` ∪ payload `speakers`. */
  blocks: readonly CaptionBlock[]
  speakers?: readonly Speaker[]
  replace: boolean
}
export interface SpeakerAddPayload {
  label: string
  color: string
}
export interface SpeakerAssignPayload {
  blockIds: readonly string[]
  speakerId: string
}
export interface SpeakerRenamePayload {
  speakerId: string
  label: string
}
export interface SpeakerRecolorPayload {
  speakerId: string
  color: string
}
export interface ProjectRenamePayload {
  name: string
}
export interface TransportSeekPayload {
  time: Seconds
}
export interface TransportSkipPayload {
  /** J/L = ±5 s, Shift+J/L = ±10 s (design.md) — command carries the step. */
  seconds: number
}
export interface TransportStepFramePayload {
  /** Signed frame count; |1/fps| per frame from `project.asset.fps`. */
  frames: number
}
export interface TransportStepSecondPayload {
  /** Shift+←/→ = ±1 s (design.md). */
  seconds: number
}
export interface TransportLoopSetPayload {
  start: Seconds
  end: Seconds
}
export interface TransportRatePayload {
  rate: number
}

// ── unit-104 EXTENDS payloads (CONTRACT.md § Commands — unit-104 EXTENDS) ───

export interface SpeakerMergePayload {
  /** US-1.3.3 merge: ALL effective words of `from` (explicit `speakerId` or
   * block-inherited) move to `into`; `from` leaves `speakers`; block
   * majorities re-materialize. `from === into` rejects
   * (`SPEAKER_MERGE_SELF`); unknown id rejects (`DANGLING_SPEAKER_REF`).
   * ONE undo step. */
  from: string
  into: string
}
export interface SpeakerSplitPayload {
  /** US-1.3.3 split: `speakerId`'s words with `start >= at` move to a NEW
   * APPENDED speaker (next free `SPK_<n>`, label `Speaker <n>`); `color`
   * omitted → the engine palette. Unknown id rejects
   * (`DANGLING_SPEAKER_REF`). ONE undo step. */
  speakerId: string
  at: Seconds
  color?: string
}
export interface ReplaceTextPayload {
  /** US-2.1.6 find/replace over ALL block texts (source track): ONE dispatch
   * replaces EVERY match = EXACTLY ONE undo step. Word TIMINGS unchanged
   * (edit-preserves-timing: per-token replacement keeps each word's span;
   * equal-length replacements are byte-identical through the frozen
   * `block-edit-text` character-weight rule). Zero matches → NO-OP: state
   * byte-identical and NO history step. */
  query: string
  replacement: string
  caseSensitive?: boolean
  wholeWord?: boolean
}
export interface CaptionsAlignApplyPayload {
  /** US-1.4 align-apply (CC-104.7): the merged engine-07
   * `alignCaptionsToWords` applied to the source track — matched words copy
   * the ASR times and get timing 'aligned'; unmatched re-interpolate and
   * stay 'estimated'; text NEVER changes. The WHOLE apply is ONE undo step.
   * SECURITY-03: protocol objects only, never logged. */
  asrWords: readonly AsrWordInput[]
}

export interface CommandPayloads {
  'block-split': BlockSplitPayload
  'block-merge': BlockMergePayload
  'block-retime': BlockRetimePayload
  'block-edit-text': BlockEditTextPayload
  'block-delete': BlockDeletePayload
  'block-delete-close-gap': BlockDeletePayload
  'captions-retime-all': CaptionsRetimeAllPayload
  'captions-reflow': CaptionsReflowPayload
  'captions-import': CaptionsImportPayload
  'speaker-add': SpeakerAddPayload
  'speaker-assign': SpeakerAssignPayload
  'speaker-rename': SpeakerRenamePayload
  'speaker-recolor': SpeakerRecolorPayload
  'project-rename': ProjectRenamePayload
  'transport-play': undefined
  'transport-pause': undefined
  'transport-seek': TransportSeekPayload
  'transport-skip': TransportSkipPayload
  'transport-step-frame': TransportStepFramePayload
  'transport-step-second': TransportStepSecondPayload
  'transport-loop-set': TransportLoopSetPayload
  'transport-loop-in': undefined
  'transport-loop-out': undefined
  'transport-loop-clear': undefined
  'transport-loop-toggle': undefined
  'transport-rate': TransportRatePayload
  // unit-104 EXTENDS (additive; the frozen 26 rows above are untouched).
  'speaker-merge': SpeakerMergePayload
  'speaker-split': SpeakerSplitPayload
  'replace-text': ReplaceTextPayload
  'captions-align-apply': CaptionsAlignApplyPayload
}

/** SECURITY-03: code + structural token (an id or a number) only. */
export type CommandRejectCode =
  | 'INVALID_PAYLOAD'
  | 'BLOCKS_UNSORTED'
  | 'BLOCKS_OVERLAP'
  | 'WORDS_UNSORTED'
  | 'WORD_OUT_OF_RANGE'
  | 'DANGLING_BLOCK_REF'
  | 'DANGLING_SPEAKER_REF'
  | 'DANGLING_TRANSLATION_REF'
  | 'TEXT_WORD_MISMATCH'
  | 'EMPTY_TEXT_REMOVED'
  | 'DURATION_NON_POSITIVE'
  | 'SPLIT_EMPTY_PART'
  | 'MERGE_NOT_ADJACENT'
  | 'SPEAKER_ID_IMMUTABLE'
  | 'SPEAKER_LABEL_EMPTY'
  /** unit-104 EXTENDS (CONTRACT.md § unit-104 EXTENDS): `speaker-merge` with
   * `from === into` — the frozen alias is not widened (frozen d.ts @104). */
  | 'SPEAKER_MERGE_SELF'
  | 'OUT_OF_MEDIA'
  | 'LOOP_RANGE_INVALID'
  | 'RATE_INVALID'

export interface CommandReject {
  code: CommandRejectCode
  /** Entity id or index the payload violated on; numbers/ids only. */
  token: string
}

/** The editor root: the undoable `project` + the UI-only `editor` slice. */
export interface EditorRootState {
  project: Project
  editor: EditorUiState
}

export interface EditorCommand<Id extends CommandId = CommandId> {
  id: Id
  reduce(state: EditorRootState, payload: CommandPayloads[Id]): CommandReject | null
  /** Optional inverse (patch undo); when present, `applyCommand(inverse)` must
   * undo `reduce` for the SAME payload (zundo remains the runtime undo — the
   * inverse is the contract-checked consistency surface). */
  inverse?(state: EditorRootState, payload: CommandPayloads[Id]): CommandReject | null
}
