// Unit-106 FROZEN API CONTRACT — test-author-owned ambient module declarations
// (unit-101/102/103/104 `@NN` precedent). The unit-106 suites (persistence
// service L1/L3, autosave L1, project list + save indicator L2, relink e2e)
// import the not-yet-built modules `src/state/services/persistence.ts`,
// `src/ui/shell/ProjectList.tsx` and the unit-106 EXTENDS of
// `src/ui/shell/Workbench.tsx` through their `@state/…` / `@ui/…` specifiers.
// None exists yet — that is the point: the suites fail at RUNTIME (missing
// module / missing export / failing assertion) while `pnpm typecheck` types
// them against the declarations below. The builder must export exactly these
// names/shapes; the runtime assertions (not these types) are the acceptance
// gate. Ambient `declare module` merges with the existing ambient blocks
// (unit-104's second `@state/commands` block precedent) — EXTENDS, never breaks.
//
// This file is an ambient SCRIPT (no top-level import/export, unit-05/101
// doctrine): `declare module` blocks carry their own imports; `interface
// Window` merges globally for the e2e bridge.
//
// Contract types are NOT redefined here: `Project`/`MediaFingerprint` come
// from the real `src/engine/model.ts` (re-exported through the persistence
// module's own surface, the unit-102 d.ts pattern) and `Selection`/
// `EditorStore` ONLY from `src/state/generated/contract-types.ts`
// (src/state/CONTRACT.md — downstream units import contract types from there).
//
// ── Pinned seam decisions (test-author resolutions of spec ambiguity; the
//    builder briefs must carry these) ───────────────────────────────────────
//  * `createProjectRow(name)` returns the fresh id — the new-project-button
//    flow needs no Project payload (the caller owns project creation; the
//    row lands with the canonical blank project the builder composes).
//  * `openProject(id)` returns the same shape as `loadProject(id)` AND
//    touches `lastOpened` on the blobCache row (FR-106.5 reopen context).
//  * A row with `schemaVersion > PERSISTENCE_SCHEMA_VERSION` loads with
//    `readOnly: true` + `onError('SCHEMA_FUTURE')`; a `saveNow` whose target
//    row (by the attached editor's project id) carries a newer schemaVersion
//    is REFUSED: outcome `'failed'`, `errorCode: 'SCHEMA_FUTURE'`, the stored
//    row bytes never change.
//  * Migration chain semantics: a row with `schemaVersion < CURRENT` is
//    upgraded by applying `MIGRATIONS[row.schemaVersion]`, then
//    `MIGRATIONS[row.schemaVersion + 1]`, … up to CURRENT before use.
//  * `openFilePicker` relink outcomes (pinned in the L3 contract runner):
//    permission-denied or handle-missing → picker; a PICKED file whose probe
//    matches the stored fingerprint → `{ kind: 'silent'; file }` (the picked
//    file IS the relinked media); picker cancelled →
//    `{ kind: 'picker-needed'; file: null }`; any fingerprint difference →
//    `{ kind: 'mismatch'; differs }` and the stored handle/fingerprint row is
//    NEVER overwritten (the caller asks "different file — replace or keep?").
//  * `ProjectList` props EXTEND the pinned `{ persistence, onOpen }` with an
//    OPTIONAL `timers` — the delete-undo toast expiry must run on the
//    injected timer source (conventions § Principles 3: no real timers), so
//    the component cannot reach for the global `setTimeout`.
//  * `SaveStateIndicator` is the StatusBar subcomponent seam unit-106 adds to
//    `src/ui/shell/Workbench.tsx` exports; the status bar renders it inside
//    the unit-101 `data-testid="status-bar"` footer as
//    `<span data-testid="save-state" aria-live="polite">` with the EXACT copy
//    `saved` | `saving…` | `not saved` | `unsaved changes`.

declare module '@state/services/persistence' {
  import type { Project, MediaFingerprint } from '@engine/model'
  import type { PeaksData } from '@engine/protocol'
  import type { EditorStore, Selection } from '@state/generated/contract-types'

  /** Re-exports of the engine contract types for tests (unit-102 d.ts pattern). */
  export type { MediaFingerprint, Project } from '@engine/model'

  /** FR-106.3 — the current persistence schema version (baseline). */
  export const PERSISTENCE_SCHEMA_VERSION: 1

  /**
   * FR-106.3 migration framework: `MIGRATIONS[v]` upgrades a row stored at
   * schemaVersion `v` one step toward CURRENT (`PERSISTENCE_SCHEMA_VERSION`).
   * `MIGRATIONS[1]` is the baseline identity migration (exported + tested).
   * A row below CURRENT is upgraded through the chain
   * `MIGRATIONS[v] → MIGRATIONS[v+1] → …` before use; a row above CURRENT is
   * never written over (read-only mode + `SCHEMA_FUTURE`).
   */
  export const MIGRATIONS: Record<number, (row: unknown) => { schemaVersion: number }>

  /** SECURITY-03: failure codes ONLY — persistence never surfaces content. */
  export type PersistenceErrorCode =
    | 'QUOTA_EXCEEDED'
    | 'DB_OPEN_FAILED'
    | 'DB_WRITE_FAILED'
    | 'DB_READ_FAILED'
    | 'SCHEMA_FUTURE'
    | 'FINGERPRINT_MISMATCH'
    | 'HANDLE_PERMISSION_DENIED'
    | 'PICKER_UNAVAILABLE'
    | 'IMPORT_INVALID'

  export type SaveOutcome = 'saved' | 'not-dirty' | 'failed'

  export type SaveStateName = 'idle' | 'dirty' | 'saving' | 'saved' | 'not-saved'

  export interface SaveState {
    state: SaveStateName
    lastSavedAt: number | null
    errorCode: PersistenceErrorCode | null
  }

  /** Structurally the protocol `PeaksData` — stored structured-cloneable. */
  export type PeaksLike = PeaksData

  /** FR-106.5 reopen context. The exclusion list (playing/rate/loop/
   *  searchOpen/live playhead mirror) is documented in the persistence.ts
   *  docblock and pinned by the CC-106.1 suite — never persisted. */
  export interface PanelState {
    activeTab: 'subtitles' | 'media' | 'style'
    collapsed: Record<string, boolean>
    panelSizes: Record<string, number>
    theme: 'dark' | 'light' | 'system'
    transcribe: { language: string | null; modelId: string | null; diarize: boolean }
    lastPlayhead: number
    selection: Selection | null
  }

  export interface ProjectRow {
    id: string
    schemaVersion: number
    name: string
    updatedAt: number
    /** The CANONICAL string from serializeProject — never re-implemented. */
    project: string
    peaks: PeaksLike | null
    panelState: PanelState | null
  }

  export interface MediaHandleRow {
    projectId: string
    handle?: FileSystemFileHandle
    fingerprint: MediaFingerprint
  }

  export interface BlobRow {
    projectId: string
    blob: Blob
    bytes: number
    lastOpened: number
  }

  export interface LoadedProject {
    project: Project
    peaks: PeaksLike | null
    panelState: PanelState | null
    readOnly: boolean
  }

  /** CC-106.4 outcome vocabulary — the e2e counterpart reuses these kinds. */
  export type RelinkOutcome =
    | { kind: 'silent'; file: File }
    | { kind: 'picker-needed'; file: File | null }
    | { kind: 'mismatch'; differs: readonly ('name' | 'size' | 'durationMs' | 'sampleHashes')[] }
    | { kind: 'no-handle' }

  export interface PersistenceTimers {
    setTimeout(cb: () => void, ms: number): number
    clearTimeout(id: number): void
  }

  export interface PersistenceDeps {
    /** fake-indexeddb in L1/L2/L3; the real factory in e2e. */
    indexedDB?: IDBFactory
    /** Injected wall clock (src/test-support/fake-clock.ts lineage). */
    clock: { now(): number }
    /** Deterministic timers; production wiring passes the globals. */
    timers: PersistenceTimers
    estimateStorage(): Promise<{ usage: number; quota: number }>
    requestPersist(): Promise<boolean>
    /** FR-106.8: the unit-04 media-worker probe — NEVER computed on main thread here. */
    probeFingerprint(file: File): Promise<MediaFingerprint>
    /** Prod: showOpenFilePicker; Firefox fallback <input type=file>. */
    openFilePicker(): Promise<File | null>
    saveBlobLimitBytes?: number
    onError?(code: PersistenceErrorCode): void
    /** visibilitychange source in prod; injectable in tests (fake captures the listener). */
    document?: Pick<Document, 'addEventListener'>
    firstSavePersistThresholdBytes?: number
  }

  /** Structurally compatible with the frozen `EditorApp` (unit-102 contract). */
  export interface EditorAppLike {
    project: {
      getState(): { project: Project | null }
      subscribe(cb: () => void): () => void
    }
    editor: EditorStore
  }

  export interface StorageEstimateView {
    usage: number
    quota: number
    persisted: boolean
    blobCacheBytes: number
  }

  /**
   * FR-106.1: the ONE home of IndexedDB calls (database `zipscribe`, version
   * 1, stores `projects` keyPath `id`, `mediaHandles` keyPath `projectId`,
   * `blobCache` keyPath `projectId`). Docblock requirement (pinned by
   * CC-106.1): the module docblock lists the persisted-UI-state EXCLUSION
   * LIST — `playing`, `rate`, `loop`, `searchOpen`, the playhead-during-play
   * live mirror — which are UI state never persisted.
   */
  export interface PersistenceService {
    /** Opens the DB (version 1, creates the three stores) + migration check. */
    open(): Promise<void>
    /** Autosave subscription (FR-106.2). */
    attachEditor(app: EditorAppLike): void
    setPanelStateSource(fn: () => PanelState): void
    setPeaksSource(fn: () => PeaksLike | null): void
    /** `manual` forces regardless of pending/idle (⌘S); `hidden` forces when pending ≥ 1. */
    saveNow(reason: 'idle' | 'manual' | 'hidden'): Promise<SaveOutcome>
    getSaveState(): SaveState
    subscribeSaveState(cb: () => void): () => void
    listProjects(): Promise<ProjectRow[]>
    loadProject(id: string): Promise<LoadedProject | null>
    /** Loads + returns AND records `lastOpened` on the blobCache row (touch). */
    openProject(id: string): Promise<LoadedProject | null>
    createProjectRow(name: string): Promise<string>
    /** Fresh id + updatedAt now; copies project/peaks/panelState + mediaHandles row; blobCache NOT copied; name suffixed `" (copy)"`. */
    duplicateProject(id: string): Promise<string>
    /** Toast-undoable purge: the row REMAINS until `commit()` (all three stores); `undo()` cancels. */
    deleteProject(id: string): Promise<{ commit(): Promise<void>; undo(): void }>
    renameProject?(id: string, name: string): Promise<void>
    /** The canonical `project` string verbatim (byte-equal to serializeProject output). */
    exportProjectFile(id: string): Promise<string | null>
    /** parseProject (CODE-only ProjectParseError, SECURITY-03) + fresh id + updatedAt; unparseable → onError('IMPORT_INVALID') + reject with the code. */
    importProjectFile(json: string): Promise<string>
    storeMediaHandle(projectId: string, handle: FileSystemFileHandle | null, fingerprint: MediaFingerprint): Promise<void>
    getMediaHandle(projectId: string): Promise<MediaHandleRow | null>
    relinkMedia(projectId: string): Promise<RelinkOutcome>
    /** bytes = blob.size, lastOpened = clock.now(); then LRU eviction over blobCache ONLY (never projects/mediaHandles). */
    cacheMediaBlob(projectId: string, blob: Blob): Promise<void>
    /** Touch on read: updates lastOpened. */
    getMediaBlob(projectId: string): Promise<Blob | null>
    storageEstimate(): Promise<StorageEstimateView>
  }

  export function createPersistenceService(deps: PersistenceDeps): PersistenceService
}

declare module '@ui/shell/ProjectList' {
  import type { ReactNode } from 'react'
  import type { LoadedProject, PersistenceService, PersistenceTimers } from '@state/services/persistence'
  import type { EditorStore } from '@state/generated/contract-types'

  export interface ProjectListProps {
    persistence: PersistenceService
    /** Called with the loaded reopen context (FR-106.5) — null when the row vanished. */
    onOpen: (projectId: string, loaded: LoadedProject | null) => void
    /** Injected timers for the delete-undo toast expiry (deterministic L2). */
    timers?: PersistenceTimers
    /**
     * When given, opening a project RESTORES the reopen context (FR-106.5):
     * `panelState.lastPlayhead` → `editor.setPlayhead`, `panelState.selection`
     * → `editor.setSelection`. Test-author EXTENDS of the pinned
     * `{ persistence, onOpen }` — optional so every other mount path is
     * untouched; without it the restore is the caller's job via `onOpen`.
     */
    editor?: EditorStore
  }

  /**
   * FR-106.5 Media-tab project list. Pinned testids/texts (builder + test
   * author agreement): container `data-testid="project-list"`; rows
   * `project-row-<id>` in updatedAt DESC order; buttons `project-open-<id>` /
   * `project-duplicate-<id>` / `project-delete-<id>`; `new-project-button`;
   * `storage-estimate` (e.g. `1.2 MB of 5 GB · persistent on`); the delete
   * undo toast `delete-undo-toast` with `delete-undo-button` (expiry on the
   * injected timers commits the purge); `interrupted-transcription` when the
   * loaded project has `transcription: 'partial'` (copy contains the kept
   * block count, a number only); `read-only-banner` for a future-schema row;
   * relink mismatch `relink-mismatch-warning` with `relink-keep-button` /
   * `relink-replace-button`.
   */
  export function ProjectList(props: ProjectListProps): ReactNode
}

// ── unit-106 EXTENDS of the frozen unit-101 Workbench module (merges) ──────
declare module '@ui/shell/Workbench' {
  import type { ReactNode } from 'react'
  import type { SaveState } from '@state/services/persistence'

  /** The injectable seam of the save-state indicator (plain object — fake ok). */
  export interface SaveStateSource {
    getSaveState(): SaveState
    subscribeSaveState(cb: () => void): () => void
  }

  /**
   * FR-106.2 save-state subcomponent seam (unit-101 StatusBar EXTENDS):
   * renders `<span data-testid="save-state" aria-live="polite">` inside the
   * `data-testid="status-bar"` footer. Exact copy: `saved` | `saving…` |
   * `not saved` | `unsaved changes` (dirty). Persistent-failure rule
   * (CC-I2.12 backing): `not saved` stays until a later successful save.
   */
  export function SaveStateIndicator(props: { persistence: SaveStateSource }): ReactNode
}

/**
 * e2e-only persistence bridge (unit-106): installed under the same
 * `?ziptest=1` gate as the editor bridge (`src/ui/testing/
 * persistence-bridge.ts`, builder-owned). STRICT gate: nothing installs
 * without the flag. SECURITY-03: protocol objects, canonical JSON strings and
 * diagnostic NUMBERS only — nothing logs content.
 */
interface Window {
  /** e2e test furniture: FSA surface audit counters (installed by the specs'
   *  addInitScript, never by app code). */
  __zipFsaAudit?: {
    permissionChecks: { mode?: string }[]
    pickerCalls: number
  }
  __zipPersistenceBridge?: {
    saveNow(reason: 'idle' | 'manual' | 'hidden'): Promise<'saved' | 'not-dirty' | 'failed'>
    getSaveState(): { state: 'idle' | 'dirty' | 'saving' | 'saved' | 'not-saved'; lastSavedAt: number | null; errorCode: string | null }
    listProjects(): Promise<{ id: string; schemaVersion: number; name: string; updatedAt: number; project: string; peaks: unknown; panelState: unknown }[]>
    openProject(id: string): Promise<{ project: unknown; peaks: unknown; panelState: unknown; readOnly: boolean } | null>
    exportProjectFile(id: string): Promise<string | null>
    importProjectFileJson(json: string): Promise<string>
    relinkMedia(projectId: string): Promise<{ kind: 'silent'; file: { name: string; size: number } | null } | { kind: 'picker-needed'; file: { name: string; size: number } | null } | { kind: 'mismatch'; differs: string[] } | { kind: 'no-handle' }>
    /** handleLike is constructed IN-PAGE (functions cannot cross evaluate boundaries). */
    seedMediaHandle(projectId: string, handleLike: { queryPermission(descriptors?: { mode?: string }): Promise<string>; getFile(): Promise<File> }, fingerprint: { name: string; size: number; durationMs: number; sampleHashes: string[] }): Promise<void>
    setProbeResult(fingerprint: { name: string; size: number; durationMs: number; sampleHashes: string[] } | 'reject'): void
    setEstimate(estimate: { usage: number; quota: number }): void
    setPersisted(persisted: boolean): void
    deleteProject(id: string): Promise<void>
    undoDelete(): Promise<void>
    commitDelete(): Promise<void>
    cacheMediaBlob(projectId: string, sizeBytes: number): Promise<void>
    setInterrupted(keptBlocks: number): void
    ready(): Promise<void>
  }
}
