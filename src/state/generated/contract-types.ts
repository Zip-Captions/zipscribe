// GENERATED FILE — DO NOT EDIT BY HAND.
//
// src/state/CONTRACT.md (FR-102.7 contract freeze, unit-102 slice D) is the prose
// contract; this file is its mechanical counterpart, emitted by
// `scripts/gen-contract-types.mjs` from the implementation modules (single
// source of truth — every name is verified exported before emission).
//
// Downstream units (103/104/105/106, Intent 3) import contract types ONLY
// from here. The frozen acceptance shape is
// tests/unit/editor/unit102-api-contract.d.ts (ambient-wins resolution + the
// builder typecheck pin the implementation to it); contract.test.ts scans this
// file for the frozen export-name set.

import type { CommandId, CommandPayloads } from '../commands'
import type { EditorUiState } from '../editor'
import type { MediaClock } from '../services/playback/media-clock'
import type { Seconds } from '../../engine/model'
import type { SyncArbitrator, RafDriver } from '../services/playback/arbitrator'
import type { ZundoLimitType } from '../history'

export type {
  CommandId,
  CommandPayloads,
  CommandReject,
  CommandRejectCode,
  EditorCommand,
  EditorRootState,
  BlockSplitPayload,
  BlockMergePayload,
  BlockRetimePayload,
  BlockEditTextPayload,
  BlockDeletePayload,
  CaptionsRetimeAllPayload,
  CaptionsReflowPayload,
  CaptionsImportPayload,
  SpeakerAddPayload,
  SpeakerAssignPayload,
  SpeakerRenamePayload,
  SpeakerRecolorPayload,
  ProjectRenamePayload,
  TransportSeekPayload,
  TransportSkipPayload,
  TransportStepFramePayload,
  TransportStepSecondPayload,
  TransportLoopSetPayload,
  TransportRatePayload,
} from '../commands'
export type { EditorUiState, EditorStore, Selection } from '../editor'
export type { EditorHistoryApi, EditorApp, EditorAppDeps, Blockizer, SpeakerEngine } from '../history'
export type { MediaClock } from '../services/playback/media-clock'
export type { SyncArbitrator, RafDriver } from '../services/playback/arbitrator'
export type { ExportService, ExportHandle, ExportWorkerPort } from '../services/export'
export type { TranslationRules } from '../../engine/translate/track'

/** Derived from the frozen `ZUNDO_LIMIT = 150` (history.ts) — never restate the number here. */
export type ZUNDO_LIMIT_TYPE_CONTRACT = ZundoLimitType

// ── compile-time consistency checks (typecheck is the gate) ───────────────────
// These re-derive from the IMPLEMENTATION (relative imports), so drift between a
// reducer table and the frozen shape fails `pnpm typecheck`, silently and early.
type Assert<T extends true> = T
type KeySetEquals<A, B> = [keyof A] extends [B] ? ([B] extends [keyof A] ? true : false) : false

/** The payload table is exhaustive over the 26 frozen command ids (no extra, no missing). */
type _payloadDomain = Assert<KeySetEquals<CommandPayloads, CommandId>>

/** FR-102.3: the arbitrator layer is the sanctioned clock reader — `clockTime()` is
 *  part of the frozen surface (frozen d.ts § stage-video/bridge diagnostics). */
type _clockReader = Assert<
  SyncArbitrator extends { clockTime(): Seconds; subscribe(cb: (t: Seconds) => void): () => void; seek(t: Seconds): void; setLoop(region: [Seconds, Seconds] | null): void; rate: number } ? true : false
>

/** The MediaClock seam stays exactly the frozen six-plus-dispose surface shape. */
type _mediaClock = Assert<MediaClock extends { currentTime(): Seconds; seek(t: Seconds): void; setRate(rate: number): void } ? true : false>

/** The editor slice stays UI-only truth mirrors (playhead is the arbitrator mirror, FR-102.2/102.3). */
type _uiShape = Assert<EditorUiState extends { playhead: Seconds; playing: boolean; rate: number; loop: [Seconds, Seconds] | null } ? true : false>

/** The rAF seam stays injectable (no timers in tests, conventions § 3). */
type _rafs = Assert<RafDriver extends { request(cb: (timeMs: number) => void): number; frame(dtMs: number): void } ? true : false>

/** Frozen zundo configuration: limit 150 (the number lives ONLY in history.ts). */
type _zundoLimit = Assert<ZUNDO_LIMIT_TYPE_CONTRACT extends 150 ? true : false>

void (null as unknown as [_payloadDomain, _clockReader, _mediaClock, _uiShape, _rafs, _zundoLimit])
