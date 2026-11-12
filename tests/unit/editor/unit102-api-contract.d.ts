// Unit-102 FROZEN API CONTRACT — test-author-owned ambient module declarations.
//
// The RED-phase suite of unit-102 (Editor Core — Store, Commands, Playback &
// Sync) imports the production modules `src/state/commands/**`,
// `src/state/editor.ts`, `src/state/history.ts`, `src/state/selectors.ts`,
// `src/state/services/serialize.ts`, `src/state/services/export.ts`,
// `src/state/services/playback/{media-clock,arbitrator}.ts`,
// `src/state/generated/contract-types.ts`, `src/engine/translate/track.ts`,
// `src/ui/format.ts` and `src/ui/canvas/overlay.ts` through the `@state/…` /
// `@ui/…` / `@engine/…` specifiers (vite/vitest alias + tsconfig paths →
// `src/…`). None of them exist yet — that is the point: the tests import them
// and fail at *runtime* (missing module), while `pnpm typecheck` types the
// tests against the declarations below. The builder must export exactly these
// names/shapes (byte-for-byte); the runtime assertions (not these types) are
// the acceptance gate (unit-03/04/05/101 `@NN` precedent). Ambient `declare
// module` wins over path-alias resolution, so the builder's own code compiling
// against its own modules is what enforces "matches the contract";
// tests/unit/editor/contract.test.ts additionally scans the generated types
// file for the frozen export-name set.
//
// Contract types are NOT redefined here: the real `src/engine/protocol.ts` and
// `src/engine/model.ts` are pulled into this (type-only) program and
// re-exported under `@engine/protocol@102` / `@engine/model@102` so no test
// ever imports them by their bare alias (the `@102` suffix makes an accidental
// RUNTIME import impossible: nothing resolves it).
//
// Ownership boundary (intent.md § Boundaries): unit-101's frozen contract
// (`tests/unit/workbench/unit101-api-contract.d.ts`) stays authoritative for
// the shell-side members it declares (`@state/jobs`, `@state/settings`,
// `@state/project`, `@ui/shell/Workbench`, `@ui/commands/registry`). Unit-102
// EXTENDS, never breaks: `createEditorApp` composes the unit-101 stores
// (its `project` member is the `ProjectStore` of the 101 contract —
// `createProject`/`hasBlocks`/`setProjectName`/`getState`/`subscribe` stay
// green — the 101 frozen suites are the regression gate). `src/state/
// CONTRACT.md` itself is the BUILDER's deliverable (FR-102.7);
// contract.test.ts asserts it exists and the generated types file
// `src/state/generated/contract-types.ts` exports the frozen name set
// (unit-105/103/104/106 and Intent 3 import types only from it).
//
// EXTENDS clauses on unit-101 modules (tests cast through these interfaces;
// the builder adds them to the real modules):
//   WorkbenchSettings & { transcribe: TranscribePrefs }        (MAJOR-5)
//   SettingsStore     & { setTranscribePrefs(p: Partial<TranscribePrefs>): void }
// `TranscribePrefs` is declared in `@state/editor-prefs@102` below.
//
// UNMERGED-ENGINE SEAMS (ASSUMPTIONs, revisit when the units merge):
//   * `@engine/diarize@102` — engine-06 (diarization pure fns) is unmerged.
//     The `speaker-*` commands wrap these PURE functions through the
//     `SpeakerEngine` seam only; the declarations below are the minimal
//     majority-vote/reassign surface unit-102 needs (domain.md § Speaker
//     assignment). When unit-06 lands, `src/engine/diarize/assign.ts` must
//     export these VERBATIM and the seam default re-points there.
//   * `@engine/translate/track@102` — unit-301 owns the real invariant-10
//     rules; until then `src/engine/translate/track.ts` is the FR-102.1
//     NO-OP stub (every hook returns without touching the project). Commands
//     must route through the injected `TranslationRules` (default =
//     `NO_OP_TRANSLATION_RULES`) so swapping in 301's implementation is a
//     composition-root change only.
//
// Keyboard rule (conventions § UI conventions): components never bind keys —
// transport semantics (Space / J / L / ←/→ / Shift+←→, design.md shortcut
// table) are tested HERE at the store/arbitrator level through the command
// registry entries; the keyboard→command *binding* table is unit-105's.
// `TimecodeInput`, when it lands, must live on a `ui/**/editable/**` path and
// is the only component allowed an `onKeyDown` (Enter/Esc/IME handling).
//
// FR-102.8 REUSE (downstream units import these, do not re-create):
//   `tests/unit/editor/helpers/**` provide the deterministic double layer:
//     fixture-project.ts      deterministic Project/Block/Word builders (one
//                             block carries the SECURITY-03 canary marker —
//                             suites rendering it attach `createRedactionSpy`)
//     fake-rafs.ts            manual requestAnimationFrame queue (frame(dtMs))
//                             — NO timers in node tests (conventions § 3)
//     fake-media-clock.ts     MediaClock double over fake-rafs: recorded
//                             play/pause/seek/setRate calls, `frame(dtMs)`
//                             advances currentTime by dt·rate
//     fake-speaker-engine.ts  SpeakerEngine double (records calls, canned
//                             majority results) — replaces engine-06
//     fake-translation-rules.ts recording TranslationRules spy — invariant-10
//                             hook assertions
//     fake-export-port.ts     scripted MediaEvent/AsrEvent/DiarizeEvent/
//                             ExportEvent streams over the FR-102.8 seams
//                             (FakeWorkerSession lineage,
//                             src/test-support/fake-workers.ts) +
//                             FakeTranslationEngine (availability/ensurePair/
//                             translate/detectLanguage/dispose, architecture
//                             § Translation engine, zip-captions ADR-013
//                             shape)
//     editor-app.ts           createTestApp(): createEditorApp wired with all
//                             fakes above + an injected FakeClock (merge-window
//                             control) — the standard fixture for 102+ suites.
//
// `data-testid` contract (builder must use exactly these ids):
//   transport bar (design.md § Layout, FR-102.5):
//     transport-play-pause (role=button, aria-pressed = playing),
//     transport-skip-back · transport-skip-forward (J/L semantics, ±5 s),
//     transport-time-current · transport-time-total (tabular-nums,
//     formatTimecode output, `00:12.3/10:00` style),
//     transport-loop-toggle (Y; aria-pressed = loop on),
//     transport-loop-in · transport-loop-out (I/O from playhead; aria-disabled
//     when no loop), transport-rate (menu button),
//     stage-video (the <video> element the arbitrator's element-clock owns —
//     ONLY the arbitrator may read its currentTime),
//     overlay-canvas-layer is RESERVED by unit-101 (stage overlay layer,
//     FR-102.6: transparent, sized by letterboxGeometry, pointer-events none).
//   stage notice (FR-102.3 unplayable video): `stage-notice` (role=status)
//     carrying the Notice CODE (`PREVIEW_UNSUPPORTED`/`PLAYBACK_STALL`),
//     editing/transcription still functional while shown.

declare module '@engine/protocol@102' {
  export type {
    AsrEvent,
    AsrRequest,
    DiarizeEvent,
    DiarizeRequest,
    EngineError,
    ExportEvent,
    ExportRequest,
    ExportSettings,
    JobEvent,
    MediaEvent,
    MediaRequest,
    ModelId,
    Notice,
    NoticeCode,
    RawSegment,
  } from '@engine/protocol'
}

declare module '@engine/model@102' {
  export type {
    CaptionBlock,
    CaptionStyle,
    MediaAsset,
    Project,
    ProjectSnapshot,
    Seconds,
    Speaker,
    TranslationEntry,
    TranslationTrack,
    WordToken,
  } from '@engine/model'
}

// ── ASSUMPTION seam: engine-06 pure speaker fns (unmerged) ─────────────────
declare module '@engine/diarize@102' {
  import type { Seconds, WordToken } from '@engine/model@102'

  /** Majority vote of `word.speakerId`; ties → the earliest id in word order;
   *  words without a speakerId are skipped; none at all → `fallback`. */
  export function majoritySpeakerId(words: readonly WordToken[], fallback: string): string

  /** Pure copy of `words` with every `speakerId === fromSpeakerId` set to `toSpeakerId`. */
  export function reassignWords(words: readonly WordToken[], fromSpeakerId: string, toSpeakerId: string): WordToken[]

  /** Frame-span → per-word speaker labels (engine-06 lands the real one; unit-102 tests the seam with the fake). */
  export interface DiarizeFrame {
    start: Seconds
    end: Seconds
    speaker: number
    prob: number
  }
  export function framesToWordSpeakers(frames: readonly DiarizeFrame[], words: readonly WordToken[], speakerIds: readonly string[]): WordToken[]
}

// ── FR-102.1: invariant-10 rules over the translation tracks ───────────────
// Production module `src/engine/translate/track.ts` ships the NO-OP stub
// until unit-301 lands the real rules; commands receive the rules by
// injection (`createEditorApp` deps, default = the production stub export).
declare module '@engine/translate/track@102' {
  import type { Project } from '@engine/model@102'

  /** Hooks mirror domain invariant 10. All mutate the immer draft `project`;
   *  the no-op stub leaves every `TranslationTrack` byte-identical. */
  export interface TranslationRules {
    onBlockDelete(project: Project, deletedBlockId: string): void
    /** `sourceId` entry: kept on `firstId` marked stale; `secondId` gets an empty stale entry; merge-concat happens in `onBlockMerge`. */
    onBlockSplit(project: Project, sourceId: string, firstId: string, secondId: string): void
    /** Space-joined text of the sources' entries, marked stale (status keeps `edited` where any source was `edited`). */
    onBlockMerge(project: Project, mergedId: string, sourceIds: readonly string[]): void
    /** Retiming NEVER marks stale (invariant 10) — the hook exists so the call is observable/testable. */
    onBlockRetime(project: Project, blockId: string): void
  }

  /** The FR-102.1 stub: every hook returns without touching the project. */
  export const NO_OP_TRANSLATION_RULES: TranslationRules
}

// ── Command registry (FR-102.1/FR-102.2) — pure reducers ───────────────────
// `reduce(state, payload)` mutates the immer draft `state` ONLY when it
// returns `null` (accepted); a returned `CommandReject` means the payload
// violated a domain invariant and the reducer made NO change. Unknown ids
// throw (registry.ts precedent). SECURITY-03: `CommandReject` carries a code
// + an entity id/number token, never user content.
declare module '@state/commands' {
  import type { CaptionBlock, Project, Seconds, Speaker, WordToken } from '@engine/model@102'

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
     *  block's existing [start,end] envelope by character weight (frozen). */
    text: string
  }
  export interface BlockDeletePayload {
    blockId: string
  }
  export interface CaptionsRetimeAllPayload {
    /** Uniform shift of the whole source track, clamped into [0, asset.duration];
     *  relative gaps preserved; media is never moved (invariant 9). */
    offsetSec: Seconds
    /** @104 EXTENDS (CONTRACT.md captions-retime-all row, adjudicated
     *  2026-11-12, FR-104.8): optional two-point-sync stretch via the frozen
     *  engine `retimeAll` map `t → anchorSec + (t − anchorSec) × scale +
     *  offsetSec`, clamped into [0, asset.duration]. Omitted → the frozen
     *  offset-only semantics byte-identically (scale 1, anchor 0). */
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
     *  sorted within [start,end], `text` == words join (invariant 2),
     *  `speakerId` resolvable against `speakers` ∪ payload `speakers`. */
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
    editor: import('@state/editor').EditorUiState
  }

  export interface EditorCommand<Id extends CommandId = CommandId> {
    id: Id
    reduce(state: EditorRootState, payload: CommandPayloads[Id]): CommandReject | null
    /** Optional inverse (patch undo); when present, `applyCommand(inverse)` must
     *  undo `reduce` for the SAME payload (zundo remains the runtime undo — the
     *  inverse is the contract-checked consistency surface). */
    inverse?(state: EditorRootState, payload: CommandPayloads[Id]): CommandReject | null
  }

  export function getEditorCommands(): readonly EditorCommand[]
  export function getCommand(id: CommandId): EditorCommand | undefined

  /** Pure helper re-exported for reducers + tests: `words` joined by ' ',
   *  '\n' instead after a `breakAfter` word (domain invariant 2). */
  export function deriveBlockText(words: readonly WordToken[]): string
}

// ── Editor slice (FR-102.1/FR-102.2) — UI-only, undoable:false ──────────────
declare module '@state/editor' {
  import type { Seconds } from '@engine/model@102'

  export interface Selection {
    anchorBlockId: string | null
    focusBlockId: string | null
  }

  /** EVERY field is UI-only (FR-102.2 `undoable:false`): zundo `partialize`
   *  keeps `{ project }` only, so no editor mutation ever creates a history
   *  step and undo/redo never move the playhead or selection. */
  export interface EditorUiState {
    playhead: Seconds
    playing: boolean
    rate: number
    loop: [Seconds, Seconds] | null
    selection: Selection
    searchOpen: boolean
  }

  export interface EditorStore {
    getState(): EditorUiState
    subscribe(listener: () => void): () => void
    setPlayhead(t: Seconds): void
    setPlaying(playing: boolean): void
    setRate(rate: number): void
    setLoop(loop: [Seconds, Seconds] | null): void
    setSelection(selection: Selection): void
    setSearchOpen(open: boolean): void
  }

  export function createEditorStore(): EditorStore

  export const DEFAULT_EDITOR_STATE: EditorUiState
}

// ── App composition + zundo history (FR-102.1/FR-102.2, US-2.1.4) ──────────
declare module '@state/history' {
  import type { CommandId, CommandPayloads, CommandReject, EditorCommand } from '@state/commands'
  import type { EditorStore } from '@state/editor'
  import type { Project } from '@engine/model@102'
  import type { ProjectStore } from '@state/project'
  import type { TranslationRules } from '@engine/translate/track@102'
  import type { WordToken } from '@engine/model@102'
  import type { MediaClock } from '@state/services/playback/media-clock'
  import type { RafDriver, SyncArbitrator } from '@state/services/playback/arbitrator'

  /** Frozen zundo configuration (FR-102.2). `jumpable:false`: the history API
   *  exposes undo/redo/clear ONLY — no jump (zundo 2.3.0 pinned has no jump
   *  surface; the contract test asserts none appears). */
  export const ZUNDO_LIMIT: 150
  export const EDIT_TEXT_MERGE_WINDOW_MS: 1000

  /** Consecutive accepted `block-edit-text` commands for the SAME blockId
   *  within `EDIT_TEXT_MERGE_WINDOW_MS` (injected `clock.now()`, exclusive
   *  upper bound: `< 1000 ms` coalesce, `≥ 1000 ms` separate) collapse into
   *  ONE undo step. Any other accepted command ends the merge chain. */
  export interface EditorHistoryApi {
    undo(steps?: number): void
    redo(steps?: number): void
    clear(): void
    undoCount(): number
    redoCount(): void
    isTracking(): boolean
  }

  /** Pure word→blocks grouping seam for `captions-reflow` (invariant 12: the
   *  re-flow is a separate undoable command; production default = the merged
   *  unit-05 blockizer, tests inject a fake). */
  export type Blockizer = (words: readonly WordToken[], opts: { maxCharsPerLine?: number }) => { start: number; end: number; text: string; words: WordToken[]; speakerId: string }[]

  export interface SpeakerEngine {
    majoritySpeakerId(words: readonly WordToken[], fallback: string): string
    reassignWords(words: readonly WordToken[], fromSpeakerId: string, toSpeakerId: string): WordToken[]
  }

  export interface EditorAppDeps {
    /** Injected wall clock — the merge-window time source (fake in tests). */
    clock: { now(): number }
    rafs: RafDriver
    mediaClock?: MediaClock
    speakerEngine?: SpeakerEngine
    translationRules?: TranslationRules
    blockizer?: Blockizer
    /** Test composition seam: start from a full project (the production
     *  composition root omits it — projects arrive via `project.createProject`). */
    initialProject?: Project
  }

  export interface EditorApp {
    /** The unit-101-frozen ProjectStore (EXTENDS, never breaks its members). */
    project: ProjectStore
    editor: EditorStore
    /** Present when `deps.mediaClock` was given — the single clock owner. */
    arbitrator: SyncArbitrator | null
    getEditorCommands(): readonly EditorCommand[]
    getCommand(id: CommandId): EditorCommand | undefined
    /** Accepted → null (state changed, history step unless UI-only/merged).
     *  Invalid payload → CommandReject, state UNCHANGED, no history step.
     *  Unknown id → throws. */
    dispatch<Id extends CommandId>(id: Id, payload: CommandPayloads[Id]): CommandReject | null
    history: EditorHistoryApi
    dispose(): void
  }

  export function createEditorApp(deps: EditorAppDeps): EditorApp
}

// ── Selectors (FR-102.4) ────────────────────────────────────────────────────
declare module '@state/selectors' {
  import type { CaptionBlock, Seconds, WordToken } from '@engine/model@102'

  /** Binary search over the block's word times. Active iff
   *  `word.start <= t < word.end`; null before the block, inside an internal
   *  word gap, and at `t >= block.end` (the last word is half-open too). */
  export function activeWord(block: CaptionBlock, playhead: Seconds): WordToken | null

  /** The block containing `t` (`start <= t < end`), or null. */
  export function activeBlock(blocks: readonly CaptionBlock[], playhead: Seconds): CaptionBlock | null
}

// ── MediaClock + SyncArbitrator (FR-102.3, US-2.1.5) ───────────────────────
declare module '@state/services/playback/media-clock' {
  import type { Seconds } from '@engine/model@102'

  /** The single time source behind the playhead (architecture § Playback &
   *  preview). ONLY the SyncArbitrator reads `currentTime` — components never
   *  touch a media element's `currentTime` (CC-102.5 lint + scan). */
  export interface MediaClock {
    readonly duration: Seconds
    currentTime(): Seconds
    readonly paused: boolean
    play(): void
    pause(): void
    /** Applies the seek immediately (a single element seek per call). */
    seek(t: Seconds): void
    setRate(rate: number): void
    dispose(): void
  }
}

declare module '@state/services/playback/arbitrator' {
  import type { Seconds } from '@engine/model@102'
  import type { MediaClock } from '@state/services/playback/media-clock'

  /** Manual animation-frame driver: `request` queues a callback (timestamp in
   *  ms, monotonic from the injected clock), `frame(dtMs)` advances the clock
   *  and flushes the queue — no timers anywhere (conventions § 3). */
  export interface RafDriver {
    request(cb: (timeMs: number) => void): number
    cancel(id: number): void
    /** Test-side driver: advances time by dtMs and runs the pending callbacks once. */
    frame(dtMs: number): void
  }

  /** One truth for playback position (US-2.1.5). A single rAF loop samples
   *  `clock.currentTime()` with dt-based smoothing; seeks take effect within
   *  ONE frame (subscriber notified synchronously on `seek`, then every frame
   *  while playing); during a loop region the playhead wraps `[b → a]`. */
  export interface SyncArbitrator {
    subscribe(cb: (playhead: Seconds) => void): () => void
    /** Proxies EXACTLY ONE `clock.seek` per call (no double-seek); notifies
     *  subscribers synchronously; keeps playing state across the seek. */
    seek(t: Seconds): void
    setLoop(region: [Seconds, Seconds] | null): void
    /** Playback rate: assignment proxies `clock.setRate` and takes effect on
     *  the next sample. `1` default. */
    rate: number
    play(): void
    pause(): void
    readonly playing: boolean
    readonly loop: [Seconds, Seconds] | null
    readonly playhead: Seconds
    /** Scrub session (US-2.1.5): `scrubTo` seeks (paused, no autoplay);
     *  `endScrub` resumes the PRE-scrub play state at the scrub position
     *  WITHOUT issuing another `clock.seek` (the release never double-seeks). */
    beginScrub(): void
    scrubTo(t: Seconds): void
    endScrub(): void
    dispose(): void
  }

  export function createSyncArbitrator(deps: { clock: MediaClock; rafs: RafDriver; /** Optional sink — the editor store's setPlayhead. */ onPlayhead?: (playhead: Seconds) => void }): SyncArbitrator
}

// ── Canonical serialization (FR-102.9, invariant 8) ─────────────────────────
declare module '@state/services/serialize' {
  import type { Project } from '@engine/model@102'

  export const SERIALIZE_PRECISION_DIGITS: 3

  /** Canonical bytes (invariant 8): recursively SORTED object keys
   *  (Array#sort code-unit order), `undefined`-valued keys omitted, every
   *  number rounded via the 3-decimal rule (`Math.round(v * 1000) / 1000`)
   *  and emitted by `JSON.stringify` with NO whitespace. Used by autosave,
   *  `.zipscribe.json` export and every golden. */
  export function canonicalize(value: unknown): string

  export function serializeProject(project: Project): string
  /** Strict inverse of `serializeProject`; malformed input throws a
   *  `ZipscribeError` subclass with a CODE (never content). */
  export function parseProject(json: string): Project
}

// ── Export service seam (FR-102.7 signatures, unit-106/Intent-3 import only) ─
declare module '@state/services/export' {
  import type { ProjectSnapshot } from '@engine/model@102'
  import type { ExportEvent, ExportRequest, ExportSettings } from '@engine/protocol@102'

  export interface ExportWorkerPort {
    postExport(request: ExportRequest): void
    onExportEvent(listener: (event: ExportEvent) => void): () => void
    dispose(): void
  }

  export interface ExportHandle {
    subscribe(cb: (event: ExportEvent) => void): () => void
    /** Posts the `cancel` request for the handle's jobId (idempotent). */
    cancel(): void
    readonly jobId: string
  }

  export interface ExportService {
    /** The snapshot is IMMUTABLE input: post-start project edits must never
     *  reach the export (domain § Project snapshot). */
    start(snapshot: ProjectSnapshot, file: File, settings: ExportSettings): ExportHandle
  }

  export function createExportService(deps: { engine: ExportWorkerPort; newJobId(): string }): ExportService
}

// ── Shared timecode formatting (conventions § State & commands; minor-11 pin) ─
declare module '@ui/format' {
  import type { Seconds } from '@engine/model@102'

  /** THE single timecode formatter (shared, `ui/format.ts`): `MM:SS.TENTHS`
   *  (`'00:12.3'`) by default; with `{ fps }` → `MM:SS:FF` frames; leading
   *  `H:` when ≥ 1 h. Shell + transport + timeline render through it — no
   *  second implementation (asserted by carried-101 static scan). */
  export function formatTimecode(seconds: Seconds, options?: { fps?: number }): string

  /** `formatTimecode`'s inverse; unparseable → null (no silent clamp). */
  export function parseTimecode(text: string, options?: { fps?: number }): Seconds | null
}

// ── Canvas overlay layer (FR-102.6) ─────────────────────────────────────────
declare module '@ui/canvas/overlay' {
  import type { Project, Seconds } from '@engine/model@102'

  export interface Box {
    width: number
    height: number
  }
  export interface StageGeometry {
    x: number
    y: number
    width: number
    height: number
  }

  /** `object-fit: contain` parity: aspect-fit `content` into `contentBox`,
   *  centered (letterbox/pillarbox offsets). Audio projects (asset 0×0) call
   *  this with the 16:9 stage box (unit-107 visualizer underneath). */
  export function letterboxGeometry(contentBox: Box, content: Box): StageGeometry

  export interface OverlayRenderer {
    resize(geometry: StageGeometry, dpr: number): void
    render(playhead: Seconds, project: Project): void
    dispose(): void
  }

  /** FR-102.6 default (Intent 3 supplies the caption renderer). */
  export const NO_OP_OVERLAY_RENDERER: OverlayRenderer

  /** Layer contract: transparent, sized to `letterboxGeometry`,
   *  `pointer-events: none` (pass-through), rAF-rendered via the injected
   *  renderer. The DOM node itself is unit-101's reserved
   *  `[data-testid=overlay-canvas-layer]`… `[data-testid=preview-canvas-layer]`. */
  export interface OverlayLayer {
    setRenderer(renderer: OverlayRenderer): void
    fitTo(contentBox: Box, content: Box | null): StageGeometry
    start(): void
    stop(): void
    dispose(): void
  }
}

// ── FR-102.7 generated types (path: src/state/generated/contract-types.ts) ──
// The builder GENERATES this file from the same source as CONTRACT.md. While
// absent, this ambient fallback keeps typecheck green and gives the contract
// test its counterpart; `contract.test.ts` scans the real file for this exact
// export-name set once the builder commits it (ambient vs. real divergence is
// caught by the builder's own typecheck — ambient wins resolution).
declare module '@state/generated/contract-types' {
  export type { CommandId, CommandPayloads, CommandReject, CommandRejectCode, EditorCommand, EditorRootState } from '@state/commands'
  export type { EditorUiState, EditorStore, Selection } from '@state/editor'
  export type { EditorHistoryApi, EditorApp, EditorAppDeps } from '@state/history'
  export type { MediaClock } from '@state/services/playback/media-clock'
  export type { SyncArbitrator, RafDriver } from '@state/services/playback/arbitrator'
  export type { ExportService, ExportHandle, ExportWorkerPort } from '@state/services/export'
  export type { TranslationRules } from '@engine/translate/track@102'
  export type { SpeakerEngine } from '@state/history'
  /** Marker type: the generated file must re-export this shape (limit 150). */
  export type ZUNDO_LIMIT_TYPE_CONTRACT = 150
}

// ── MAJOR-5 EXTENDS clause (unit-101 settings slice) ────────────────────────
declare module '@state/editor-prefs@102' {
  import type { ModelId } from '@engine/protocol@102'

  /** Transcribe-popover memory (design.md § Transcribe popover: language /
   *  model / diarize — "Remembered per settings"). Persisted inside
   *  WorkbenchSettings under key `transcribe` (hydration tolerant like the
   *  rest of the slice). */
  export interface TranscribePrefs {
    language: string | null
    modelId: ModelId | null
    diarize: boolean
  }
}

/**
 * E2E-only injection bridge (FR-2.0.6 doctrine; sibling of unit-101's
 * `__zipWorkbenchBridge`, lazily installed under `?ziptest=1`). Declared via
 * interface merging (this file is an ambient script). SECURITY-03: everything
 * crossing here is protocol objects, generated blocks (synthetic content) and
 * diagnostics NUMBERS — never real user strings; nothing logs content.
 */
interface Window {
  __zipEditorBridge?: {
    /** Opens a project AND mounts the stage `<video data-testid=stage-video>`
     *  with `src = srcUrl` (the preview-served `/fixtures/…` copy — the app
     *  itself never fetches fixtures; specs pass the URL). The video is
     *  `muted` + `playsInline` (headless autoplay). Seeds blocks through the
     *  same `captions-import` command path when given. */
    openProjectWithMedia(asset: import('@engine/model@102').MediaAsset, srcUrl: string, blocks?: readonly import('@engine/model@102').CaptionBlock[]): void
    /** Dispatches an EDITOR command (same `EditorApp.dispatch`), returning the
     *  reject object or null. Transport semantics (play/seek/loop/rate) go
     *  through THIS path — never direct element writes. */
    command(id: string, payload?: unknown): { code: string } | null
    /** Diagnostics: numbers only. `playhead` = editor slice truth,
     *  `clockTime` = arbitrator-sampled clock time, `seekCount` = total
     *  `MediaClock.seek` invocations since open (single-seek assertions). */
    getEditorState(): { playhead: number; playing: boolean; loop: [number, number] | null; rate: number; blockCount: number; clockTime: number; seekCount: number; videoReady: boolean }
    /** Scrub session through the arbitrator (US-2.1.5 scrub-release):
     *  `scrubTo` seeks (no autoplay), `releaseScrub` resumes the pre-scrub
     *  play state at the scrub position with NO additional clock seek. */
    scrubTo(time: number): void
    releaseScrub(): void
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// @104 EXTENDS — unit-104 (Transcript Editor) additive contract.
// APPENDED by the unit-104 test author (2026-11-11) per
// `src/state/CONTRACT.md` § Commands — unit-104 EXTENDS. Everything above this
// line is unit-102 FROZEN and untouched; everything below is ADDITIVE
// (module-merge augmentation only — new ids/payload keys/optional seam
// members), so every pre-104 suite (101/102/103) stays green untouched.
// ═══════════════════════════════════════════════════════════════════════════

declare module '@state/commands' {
  import type { AsrWordInput } from '@engine/captions/align'
  import type { Seconds } from '@engine/model@102'

  /** The four unit-104 command ids (CONTRACT.md § unit-104 EXTENDS). The
   *  builder adds these to `CommandId`/`CommandPayloads` in
   *  `src/state/commands/**`; unknown ids still throw on dispatch. */
  export type CommandId104 = 'speaker-merge' | 'speaker-split' | 'replace-text' | 'captions-align-apply'

  /** US-1.3.3 merge: ALL effective words of `from` move to `into`; `from` is
   *  removed from `speakers`; block majorities materialize; one undo step.
   *  Maps to the merged engine fn as `mergeSpeakers(project, into, from)`
   *  (src/engine/diarize/assign.ts direction: b→a). Rejections: `from ===
   *  into` → code `SPEAKER_MERGE_SELF` (the frozen alias is not widened —
   *  compare via `String(reject.code)`); unknown speaker id →
   *  `DANGLING_SPEAKER_REF`. Rejected = no state change, NO history step. */
  export interface SpeakerMergePayload {
    from: string
    into: string
  }
  /** US-1.3.3 split: `speakerId`'s words with `start >= at` move to a NEW
   *  APPENDED speaker (next free `SPK_<n>`, label `Speaker <n>`);
   *  `color` omitted → command-supplied default from the engine palette. One
   *  undo step. Unknown id → `DANGLING_SPEAKER_REF`. */
  export interface SpeakerSplitPayload {
    speakerId: string
    at: Seconds
    color?: string
  }
  /** US-2.1.6 find/replace over ALL block texts (source track): one dispatch
   *  replaces EVERY match and produces EXACTLY ONE undo step (US-2.1.6).
   *  Word times are re-derived by the frozen `block-edit-text` character-
   *  weight rule per affected block; for same-length replacements of whole
   *  words the per-word times stay byte-identical (the property-test
   *  invariant). Zero matches → accepted as a NO-OP: state byte-identical and
   *  NO history step. */
  export interface ReplaceTextPayload {
    query: string
    replacement: string
    caseSensitive?: boolean
    wholeWord?: boolean
  }
  /** US-1.4 align-apply (CC-104.7): the scripted ASR word stream
   *  (`jobs.startTranscribe({ mode: 'align' })` → `job:segments`) applied to
   *  the source track via the merged `alignCaptionsToWords`
   *  (src/engine/captions/align.ts): matched words → timing 'aligned',
   *  unmatched keep 'estimated'. The WHOLE apply is ONE undo step — the
   *  command mutates every affected block inside a single reduce. SECURITY-03:
   *  the payload crosses test bridges as the protocol `AsrWordInput` array
   *  only (synthetic fixture content), never logged. */
  export interface CaptionsAlignApplyPayload {
    asrWords: readonly AsrWordInput[]
  }

  export interface CommandPayloads {
    'speaker-merge': SpeakerMergePayload
    'speaker-split': SpeakerSplitPayload
    'replace-text': ReplaceTextPayload
    'captions-align-apply': CaptionsAlignApplyPayload
  }
}

declare module '@state/history' {
  import type { CommandId104, CommandPayloads, CommandReject } from '@state/commands'
  import type { Project, Seconds } from '@engine/model@102'

  export interface SpeakerEngine {
    /** OPTIONAL (unit-06 is merged — the production default wires the REAL
     *  `src/engine/diarize/assign.ts` exports; the unit-102
     *  `FakeSpeakerEngine` omits these and stays valid). Optional so every
     *  pre-104 fake/consumer typechecks unchanged (CC-06.4 runs through the
     *  REAL functions wired into `createTestApp`). */
    mergeSpeakers?(project: Project, from: string, into: string): Project
    splitSpeaker?(project: Project, speakerId: string, at: Seconds, newColor: string): Project
  }

  export interface EditorApp {
    /** EXTENDS: the four unit-104 ids dispatch through the SAME `dispatch`
     *  (same reject/throw/undo-step semantics as above). Overload form so the
     *  pre-104 `CommandId` generic is untouched. */
    dispatch<Id extends CommandId104>(id: Id, payload: CommandPayloads[Id]): CommandReject | null
  }
}
