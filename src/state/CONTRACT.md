# Zipscribe editor state contract — unit-102 CONTRACT FREEZE (FR-102.7)

Status: **FROZEN** at unit-102 slice D. This is the shape Intent 3 (units 103–107,
201+, 301) builds against. Downstream units (103 timeline, 104 transcript editor,
105 command system, 106 persistence, Intent 3 caption styling/export) **import
types only** from `src/state/generated/contract-types.ts` — never from the
implementation modules directly, never from the test tree. The mechanical
counterpart of this document is that generated file
(`pnpm gen:contract` regenerates it from the implementation modules — single
source of truth; `scripts/gen-contract-types.mjs` refuses to emit a name the
implementation no longer exports). The frozen acceptance shape for everything
below is `tests/unit/editor/unit102-api-contract.d.ts` (test-author owned).

Changing anything here is a **contract change**: propose it in a unit report
under "Contract changes"; the orchestrator edits
`.ai-dlc/knowledge/architecture.md` first. Reducers stay pure; everything
impure or unmerged is injected (`CommandDeps` / `EditorAppDeps`).

## Store shapes

One zustand vanilla root `{ project, editor }` composed by `createEditorApp`
(`src/state/history.ts`), wrapped by zundo `temporal` with the FROZEN
configuration: `limit: 150` (`ZUNDO_LIMIT`, the number lives only in
`src/state/history.ts`), `partialize: { project }` — the `editor` slice is
`undoable:false` — and `equality` on the project reference. `jumpable:false`:
the history API exposes undo/redo/clear only (zundo 2.3.0 has no jump surface;
API absence IS the setting). The shell-side stores (`jobs`, `settings`,
plus the `project` view interface) keep the unit-101 frozen contract;
`createEditorApp` EXTENDS, never breaks it.

### `project` slice — `src/state/project.ts` (undoable)

`Project | null` (`Project`, `CaptionBlock`, `WordToken`, `Speaker`,
`MediaAsset`, `TranslationTrack`, `CaptionStyle` — all from
`src/engine/model.ts`, the unit-01 verbatim contract types). Public surface
(unit-101 frozen): `getState(): { project: Project | null }`, `subscribe`,
`createProject(asset, captionImport?)`, `hasBlocks()`, `setProjectName(name)`.
Mutations arrive exclusively as commands; the app-composed store
(`history.ts`) owns the same shape inside the history root.

### `editor` slice — `src/state/editor.ts` (UI-only, `undoable:false`)

```ts
interface EditorUiState {
  playhead: Seconds // mirror of the SyncArbitrator (FR-102.3) — never a private truth
  playing: boolean
  rate: number
  loop: [Seconds, Seconds] | null
  selection: Selection // { anchorBlockId: string | null; focusBlockId: string | null }
  searchOpen: boolean
}
interface EditorStore {
  getState(): EditorUiState
  subscribe(listener: () => void): () => void
  setPlayhead(t: Seconds): void
  setPlaying(playing: boolean): void
  setRate(rate: number): void
  setLoop(loop: [Seconds, Seconds] | null): void
  setSelection(selection: Selection): void
  setSearchOpen(open: boolean): void
}
```

Every field is UI-only: no editor mutation ever creates a history step and
undo/redo never move the playhead or selection (FR-102.2). `DEFAULT_EDITOR_STATE`:
playhead 0, not playing, rate 1, no loop/selection, search closed. The internal
storage type adds `lastLoop` only, so `transport-loop-toggle` (Y) can re-arm the
last region; that field is NOT part of the contract surface.

### `jobs` slice — `src/state/jobs.ts` (unit-101 frozen shape + unit-102 extension)

`JobsState { capability, tierNotice, modelOptions, running, progress, segments,
error, notices, pendingConfirmDownload }`, `JobsStore { getState, subscribe,
setCapability, setTierNotice, startTranscribe(options), cancel,
confirmModelDownload(model) }`, `StartTranscribeOptions { language, modelId,
diarize, mode: 'replace' | 'align' }`. Jobs state holds protocol objects,
codes and numbers only (SECURITY-03).

### `settings` slice — `src/state/settings.ts` (unit-101 frozen shape + MAJOR-5 EXTENDS)

`WorkbenchSettings { panels, collapsed, theme, transcribe }` with the
unit-102 `TranscribePrefs { language, modelId, diarize }` persisted under
`transcribe` (hydration-tolerant); `SettingsStore { getState, subscribe,
setPanelSize, toggleCollapsed, setTheme, setTranscribePrefs }`. Clamps
`MIN_SIDEBAR_PX = 240` / `MIN_TIMELINE_PX = 120` persist the clamped value.

## Commands — the 26-command registry (FR-102.1/FR-102.2)

Every mutation goes through `src/state/commands/<name>.ts` as a pure
`EditorCommand`: `reduce(state, payload)` mutates the immer draft ONLY when it
returns `null` (accepted); a returned `CommandReject` means the payload
violated a domain invariant and the reducer made **NO** change (structural:
the rejection aborts the immer draft — zero mutation, no history step).
Unknown ids throw. `CommandReject { code: CommandRejectCode; token: string }`
carries a code plus an entity id/number token — never user content
(SECURITY-03). `inverse?()` is the contract-checked undo-consistency surface
(zundo remains the runtime undo). Registry access:
`getEditorCommands(): readonly EditorCommand[]`, `getCommand(id)`,
`dispatch(id, payload)` on `EditorApp`.

Payload types (frozen shapes; all exported from the generated file):

| id                       | payload                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `block-split`            | `BlockSplitPayload { blockId, at }` — `at` strictly inside the block, both parts keep ≥ 1 word (else `SPLIT_EMPTY_PART`); a word straddling `at` goes WHOLE to the part whose MIDPOINT is nearer the word's own midpoint (ties → first part), its edge clamped to `at` — unit-103 US-2.2.2 (ledger 2026-11-09T23:05Z; side was never spec-pinned in unit-102: spec + this row were silent) |
| `block-merge`            | `BlockMergePayload { blockIds: readonly [string, string] }` — exactly two ADJACENT blocks in timeline order                                                                                                                                                                                                                                                                                |
| `block-retime`           | `BlockRetimePayload { blockId, start?, end? }` — word times scale proportionally into the new span                                                                                                                                                                                                                                                                                         |
| `block-edit-text`        | `BlockEditTextPayload { blockId, text }` — `''` deletes (invariant 3); words re-derived over the [start,end] envelope by character weight                                                                                                                                                                                                                                                  |
| `block-delete`           | `BlockDeletePayload { blockId }`                                                                                                                                                                                                                                                                                                                                                           |
| `block-delete-close-gap` | `BlockDeletePayload { blockId }` — delete + close the resulting gap                                                                                                                                                                                                                                                                                                                        |
| `captions-retime-all`    | `CaptionsRetimeAllPayload { offsetSec }` — uniform shift clamped into [0, asset.duration]; media never moves (invariant 9)                                                                                                                                                                                                                                                                 |
| `captions-reflow`        | `CaptionsReflowPayload { maxCharsPerLine? }` — policy knob for the injected `Blockizer` (invariant 12)                                                                                                                                                                                                                                                                                     |
| `captions-import`        | `CaptionsImportPayload { blocks, speakers?, replace }` — validated on entry (invariants 1/2, speaker resolvability)                                                                                                                                                                                                                                                                        |
| `speaker-add`            | `SpeakerAddPayload { label, color }`                                                                                                                                                                                                                                                                                                                                                       |
| `speaker-assign`         | `SpeakerAssignPayload { blockIds, speakerId }`                                                                                                                                                                                                                                                                                                                                             |
| `speaker-rename`         | `SpeakerRenamePayload { speakerId, label }`                                                                                                                                                                                                                                                                                                                                                |
| `speaker-recolor`        | `SpeakerRecolorPayload { speakerId, color }`                                                                                                                                                                                                                                                                                                                                               |
| `project-rename`         | `ProjectRenamePayload { name }`                                                                                                                                                                                                                                                                                                                                                            |
| `transport-play`         | `undefined`                                                                                                                                                                                                                                                                                                                                                                                |
| `transport-pause`        | `undefined`                                                                                                                                                                                                                                                                                                                                                                                |
| `transport-seek`         | `TransportSeekPayload { time }`                                                                                                                                                                                                                                                                                                                                                            |
| `transport-skip`         | `TransportSkipPayload { seconds }` — J/L ±5 s, Shift+J/L ±10 s                                                                                                                                                                                                                                                                                                                             |
| `transport-step-frame`   | `TransportStepFramePayload { frames }` — ±1/fps from `project.asset.fps`                                                                                                                                                                                                                                                                                                                   |
| `transport-step-second`  | `TransportStepSecondPayload { seconds }` — Shift+arrows ±1 s                                                                                                                                                                                                                                                                                                                               |
| `transport-loop-set`     | `TransportLoopSetPayload { start, end }`                                                                                                                                                                                                                                                                                                                                                   |
| `transport-loop-in`      | `undefined` — loop-in from playhead                                                                                                                                                                                                                                                                                                                                                        |
| `transport-loop-out`     | `undefined` — loop-out from playhead                                                                                                                                                                                                                                                                                                                                                       |
| `transport-loop-clear`   | `undefined`                                                                                                                                                                                                                                                                                                                                                                                |
| `transport-loop-toggle`  | `undefined` — Y; re-arms the last region                                                                                                                                                                                                                                                                                                                                                   |
| `transport-rate`         | `TransportRatePayload { rate }`                                                                                                                                                                                                                                                                                                                                                            |

The `speaker-*` family is the engine-06 SEAM: the commands wrap the pure
majority-vote/reassign functions through the injected `SpeakerEngine`
(`majoritySpeakerId`, `reassignWords`) only. When unit-06 merges,
`src/engine/diarize/assign.ts` exports them verbatim and the production default
re-points; the seam default is typed-not-implemented (dispatch without an
injected engine fails with the CODE `SPEAKER_ENGINE_UNAVAILABLE`).

The `captions-*` / `block-*` mutations route the invariant-10 translation rules
through the injected `TranslationRules` (`src/engine/translate/track.ts`) —
today the FR-102.1 NO-OP stub (`NO_OP_TRANSLATION_RULES`: delete/split/merge/
retime hooks leave tracks byte-identical); unit-301 swaps the implementation at
the composition root, no command edits.

Transport semantics (Space, J/L, arrows, Y, I/O, rate) are pinned HERE at the
command/arbitrator level. The keyboard→command BINDING table is **unit-105**
(conventions § UI conventions: components never bind keys; the only allowed
`onKeyDown` lives on the editable-component allowlist path (conventions:
`ui` … `editable`, e.g. `TimecodeInput`) — the keyboard-allowlist lint rule is
the unit-105 seed).

## SyncArbitrator interface (FR-102.3, US-2.1.5)

`src/state/services/playback/arbitrator.ts` — ONE truth for playback position.
It EXTENDS FR-102.3's four required members (`subscribe`, `seek`, `setLoop`,
`rate`) with the full frozen surface, so **components never touch a media
element's `currentTime`**: the SyncArbitrator layer (`src/state/services/playback/`
directory, the only `currentTime` home) is the single clock reader, enforced by
the CC-102.5 lint rule (`2:zipscribe/no-media-current-time`) plus the frozen
contract-scan test.

```ts
interface SyncArbitrator {
  subscribe(cb: (playhead: Seconds) => void): () => void
  seek(t: Seconds): void // EXACTLY ONE clock.seek per call; subscribers notified synchronously; playing state kept
  setLoop(region: [Seconds, Seconds] | null): void
  rate: number // assignment proxies clock.setRate; effect on next sample; default 1
  play(): void
  pause(): void
  readonly playing: boolean
  readonly loop: [Seconds, Seconds] | null
  readonly playhead: Seconds
  clockTime(): Seconds // the element clock's real position — the bridge/diagnostics read the clock ONLY through here
  beginScrub(): void
  scrubTo(t: Seconds): void // seeks paused, no autoplay
  endScrub(): void // resumes the PRE-scrub play state at the scrub position WITHOUT another clock.seek
  dispose(): void
}
```

Single rAF loop (injected `RafDriver` — no timers anywhere) with dt-based
smoothing; a raw clock change is always followed (the clock is the truth, dt
only fills the gap between element deliveries); loop regions wrap [b → a]
within one frame; `visibilitychange` resyncs after background throttling.
`MediaClock` (`src/state/services/playback/media-clock.ts`) is the seam behind
it: `duration`, `currentTime()`, `paused`, `play`, `pause`, `seek`, `setRate`,
`dispose` — element clock today, unit-107 adds the decoded clock behind the
same interface. `createSyncArbitrator({ clock, rafs, onPlayhead? })`.
`EditorApp.arbitrator` exists exactly when `deps.mediaClock` was injected.
Unplayable video surfaces a coded `stage-notice` (`PREVIEW_UNSUPPORTED` /
`PLAYBACK_STALL`); editing and transcription keep working while shown.

## exportService seam (FR-102.7 signatures; unit-106/Intent-3 import only)

`src/state/services/export.ts` — thin correlation layer over the export worker
port (the production provider lands with unit-106; today the seam + the
scripted fake). The handed `ProjectSnapshot` is IMMUTABLE input: the request
carries a deep copy, post-start edits never reach the export.

```ts
interface ExportWorkerPort {
  postExport(request: ExportRequest): void
  onExportEvent(listener: (event: ExportEvent) => void): () => void
  dispose(): void
}
interface ExportHandle {
  subscribe(cb: (event: ExportEvent) => void): () => void
  cancel(): void // posts the cancel for this jobId (idempotent)
  readonly jobId: string
}
interface ExportService {
  start(snapshot: ProjectSnapshot, file: File, settings: ExportSettings): ExportHandle
}
// createExportService(deps: { engine: ExportWorkerPort; newJobId(): string }): ExportService
```

`ExportRequest`/`ExportEvent`/`ExportSettings` are the unit-01 protocol types
(`src/engine/protocol.ts`).

## Serialize contract (FR-102.9, invariant 8)

`src/state/services/serialize.ts` — the ONE canonical byte form used by
autosave, `.zipscribe.json` export and every golden: recursively sorted object
keys (`Array#sort` code-unit order), `undefined`-valued keys omitted, every
number rounded via the 3-decimal rule (`SERIALIZE_PRECISION_DIGITS = 3`,
`Math.round(v * 1000) / 1000`), emitted by `JSON.stringify` with no
whitespace. `canonicalize(value)`, `serializeProject(project)`, and the strict
inverse `parseProject(json)` — malformed input throws a `ZipscribeError`
subclass carrying a CODE (`ProjectParseError`, codes like `INVALID_BLOCK`) —
never an input fragment (SECURITY-03).

## Fake-engine harness (FR-102.8) — downstream units REUSE, never re-create

`tests/unit/editor/helpers/` is the deterministic double layer every 103+
suite builds on (no real inference in CI per-PR, no timers, no network):

- `fixture-project.ts` — deterministic Project/Block/Word builders; one block
  carries the SECURITY-03 canary marker (suites rendering it attach
  `createRedactionSpy`).
- `fake-rafs.ts` — manual `requestAnimationFrame` queue (`frame(dtMs)`),
  monotonic timestamps from the injected clock.
- `fake-media-clock.ts` — `MediaClock` double: recorded play/pause/seek/setRate
  calls; `frame(dtMs)` advances by dt·rate.
- `fake-speaker-engine.ts` — `SpeakerEngine` double (records calls, canned
  majority results) replacing unmerged engine-06.
- `fake-translation-rules.ts` — recording `TranslationRules` spy for
  invariant-10 hook assertions.
- `fake-export-port.ts` — scripted `MediaEvent`/`AsrEvent`/`DiarizeEvent`/
  `ExportEvent` streams (FakeWorkerSession lineage) + `FakeTranslationEngine`
  (availability/ensurePair/translate/detectLanguage/dispose).
- `editor-app.ts` — `createTestApp()`: `createEditorApp` wired with ALL fakes
  plus an injected fake clock (merge-window control). THE standard fixture.

## What downstream units import (types-only)

`CommandId`, `CommandPayloads`, `CommandReject`, `CommandRejectCode`,
`EditorCommand`, `EditorRootState`, `EditorUiState`, `EditorStore`, `Selection`,
`EditorHistoryApi`, `EditorApp`, `EditorAppDeps`, `MediaClock`,
`SyncArbitrator`, `RafDriver`, `ExportService`, `ExportHandle`,
`ExportWorkerPort`, `TranslationRules`, `SpeakerEngine`,
`ZUNDO_LIMIT_TYPE_CONTRACT` — every one re-exported by
`src/state/generated/contract-types.ts`, which derives them from the
implementation modules (the frozen command count and the zundo 150 limit are
compile-checked there). Run `pnpm gen:contract` after any contract-surface
change to the implementation; the file is committed, never hand-edited.
