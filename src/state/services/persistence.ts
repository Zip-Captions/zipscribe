// Unit-106 persistence service (FR-106.1 … FR-106.8) — the ONE home of
// IndexedDB calls. Database `zipscribe`, version 1, exactly three stores:
//
//   projects     keyPath `id`        { id, schemaVersion, name, updatedAt, project, peaks, panelState }
//   mediaHandles keyPath `projectId` { projectId, handle?, fingerprint }
//   blobCache    keyPath `projectId` { projectId, blob, bytes, lastOpened }
//
// `projects.project` is ALWAYS the canonical string produced by
// `serializeProject` (./serialize.ts is the ONE byte form — never
// re-implemented, never bypassed); `peaks` is stored structured-cloneable as
// produced by the peaks source; `panelState` carries only the reopen context
// pinned by FR-106.5 (activeTab, collapsed, panelSizes, theme, transcribe,
// lastPlayhead snapshot, selection).
//
// PERSISTED-UI-STATE EXCLUSION LIST (CC-106.1): the following are UI state and
// are NEVER persisted — `playing`, `rate`, `loop`, `searchOpen`, and the live
// playhead mirror during playback. Dirty detection counts ACCEPTED project
// changes observed since `attachEditor` or the last successful save
// (clean-on-attach: a pre-existing project attaches CLEAN — the baseline the
// FR-106.2 suites pin), so a pure UI change can never mark the project dirty
// or reach a row. In production `project.subscribe` IS the root store
// subscription (editor commits notify too), which is exactly why the change
// handler gates on the project REFERENCE first: an unchanged reference is a
// UI notification and returns without serializing.
//
// Save semantics (FR-106.2, US-2.4.1): one `readwrite` transaction per save
// across every row it writes — a save is fully-old-or-fully-new by native IDB
// transaction atomicity (CC-106.3). Autosave: the 2 s debounce timer is
// scheduled ONLY when pending becomes ≥ 1 and RESETS on every further change;
// `visibilitychange→hidden` and `⌘S`-style `manual` flushes bypass the
// debounce when pending ≥ 1. All three reasons share the pending-count rule —
// a clean project (0 changes since attach or the last successful save)
// performs NO write (`not-dirty`). Racing saves run in-flight-guarded with a
// single queued follow-up carrying the LATEST state (last-completed-wins).
//
// Migrations (FR-106.3): `MIGRATIONS[v]` steps a row stored at v one version
// up; rows below `PERSISTENCE_SCHEMA_VERSION` are chain-upgraded before use
// (writable); rows ABOVE it load read-only with `SCHEMA_FUTURE` and saves for
// them are refused — newer bytes are never written over.
//
// Storage (FR-106.7, CC-105.5): blobCache rows beyond `saveBlobLimitBytes`
// evict LOWEST `lastOpened` first; projects and mediaHandles rows are NEVER
// evicted (the project JSON + peaks survive; media re-link covers the blob).
// `navigator.storage.persist()` (via deps) is requested exactly once, on the
// first successful save of a NEW project.
//
// Re-link (FR-106.4/FR-106.8): the fingerprint is COMPARED, never computed
// here — `deps.probeFingerprint` (the unit-04 media worker in production) is
// the only fingerprint source. The stored handle/fingerprint row is never
// overwritten by a relink; replace-or-keep is the caller's decision.
//
// SECURITY-03: this module never logs and never interpolates content into an
// error — failures surface `PersistenceErrorCode` values (codes + numbers)
// through `deps.onError` and code-only `ZipscribeError`s.
//
// NOTE on `idb` (REMOVED from the dependency manifest — no unused deps): the
// promise helpers are hand-rolled on the INJECTED factory instead of idb's
// openDB/wrap because idb@8 dereferences the bare global `indexedDB`/
// `IDBRequest` constructors at call time, which do not exist in the
// deps-injected L1/L3 node environment (fake-indexeddb ships PER INSTANCE with
// no globals — a `wrap()`/`openDB()` call throws ReferenceError there, so the
// package was never importable under the injected-factory contract). The
// request→promise/transaction-settle helpers below implement the same
// semantics against `deps.indexedDB` (browser factory in production).

import { parseProject, serializeProject, ZipscribeError } from './serialize'
import { newProjectId } from '../ids'
import type { CaptionStyle, MediaAsset, MediaFingerprint, Project } from '../../engine/model'
import type { PeaksData } from '../../engine/protocol'
import type { EditorStore, Selection } from '../generated/contract-types'

/** Re-exports of the engine contract types for tests (unit-102 d.ts pattern). */
export type { MediaFingerprint, Project } from '../../engine/model'

/** FR-106.3 — the current persistence schema version (baseline). */
export const PERSISTENCE_SCHEMA_VERSION = 1 as const

/**
 * FR-106.3 migration framework: `MIGRATIONS[v]` upgrades a row stored at
 * schemaVersion `v` one step toward CURRENT (`PERSISTENCE_SCHEMA_VERSION`).
 * `MIGRATIONS[1]` is the baseline identity migration (exported + tested).
 * A row below CURRENT is upgraded through the chain
 * `MIGRATIONS[v] → MIGRATIONS[v+1] → …` before use; a row above CURRENT is
 * never written over (read-only mode + `SCHEMA_FUTURE`).
 */
export const MIGRATIONS: Record<number, (row: unknown) => { schemaVersion: number }> = {
  1: (row: unknown) => row as { schemaVersion: number },
}

/** SECURITY-03: failure codes ONLY — persistence never surfaces content. */
export type PersistenceErrorCode =
  'QUOTA_EXCEEDED' | 'DB_OPEN_FAILED' | 'DB_WRITE_FAILED' | 'DB_READ_FAILED' | 'SCHEMA_FUTURE' | 'FINGERPRINT_MISMATCH' | 'HANDLE_PERMISSION_DENIED' | 'PICKER_UNAVAILABLE' | 'IMPORT_INVALID'

export type SaveOutcome = 'saved' | 'not-dirty' | 'failed'

export type SaveStateName = 'idle' | 'dirty' | 'saving' | 'saved' | 'not-saved'

export interface SaveState {
  state: SaveStateName
  lastSavedAt: number | null
  errorCode: PersistenceErrorCode | null
}

/** Structurally the protocol `PeaksData` — stored structured-cloneable. */
export type PeaksLike = PeaksData

/** FR-106.5 reopen context (the exclusion list lives in the module docblock). */
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
export type RelinkField = 'name' | 'size' | 'durationMs' | 'sampleHashes'

export type RelinkOutcome = { kind: 'silent'; file: File } | { kind: 'picker-needed'; file: File | null } | { kind: 'mismatch'; differs: readonly RelinkField[] } | { kind: 'no-handle' }

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
 * FR-106.1: the ONE home of IndexedDB calls (database `zipscribe`, version 1,
 * stores `projects` keyPath `id`, `mediaHandles` keyPath `projectId`,
 * `blobCache` keyPath `projectId`). See the module docblock for the persisted
 * UI-state EXCLUSION LIST and the save/migration/eviction semantics.
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

const DB_NAME = 'zipscribe'
const STORE_PROJECTS = 'projects'
const STORE_HANDLES = 'mediaHandles'
const STORE_BLOBS = 'blobCache'
/** FR-106.2 autosave idle window. */
const AUTOSAVE_DEBOUNCE_MS = 2_000
/** FR-106.7 blob cache policy ceiling (500 MB) absent an injected limit. */
const DEFAULT_SAVE_BLOB_LIMIT_BYTES = 500 * 1024 * 1024

/** createProjectRow's canonical blank payload (the caller owns project content;
 *  this must survive a loadProject → parseProject round-trip). */
const BLANK_ASSET: MediaAsset = {
  id: 'asset_blank',
  name: '',
  kind: 'audio',
  container: '',
  audioCodec: null,
  videoCodec: null,
  duration: 0,
  width: 0,
  height: 0,
  fps: 0,
  fingerprint: { name: '', size: 0, durationMs: 0, sampleHashes: ['', '', ''] },
}

/** Mirrors the shell broadcast defaults (src/state/project.ts). */
const BLANK_STYLE: CaptionStyle = {
  fontFamily: 'Inter',
  fontWeight: 400,
  fontSizePct: 8,
  textTransform: 'none',
  color: '#e8eaed',
  highlightColor: '#4c8dff',
  outlineColor: '#0d0f12',
  outlineWidth: 2,
  backgroundOpacity: 0,
  position: 'bottom',
  marginVPct: 6,
  alignment: 'center',
  maxLinesPerBlock: 2,
  highlightMode: 'none',
  showSpeakerBar: false,
}

/** The `queryPermission` surface is Chromium-only — probed, never assumed. */
interface QueryPermissionCapable {
  queryPermission?: (descriptors?: { mode?: string }) => Promise<PermissionState>
}

/** Internal control-flow signal: the target row carries a FUTURE schema. */
class SaveRefused extends Error {
  readonly code: PersistenceErrorCode
  constructor(code: PersistenceErrorCode) {
    super(code)
    this.name = 'SaveRefused'
    this.code = code
  }
}

function errorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return undefined
}

/** Shape gates for UNTRUSTED fingerprint data — stored rows and probe results
 *  are both external input. Field VALUES are never named or logged
 *  (SECURITY-03); only the field NAMEs reach the coded `mismatch` outcome. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
}

function isWellFormedFingerprint(value: unknown): value is MediaFingerprint {
  const fp = value as Partial<MediaFingerprint> | null
  return typeof fp === 'object' && fp !== null && typeof fp.name === 'string' && typeof fp.size === 'number' && typeof fp.durationMs === 'number' && isStringArray(fp.sampleHashes)
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error ?? new ZipscribeError('DB_READ_FAILED')))
  })
}

function transactionSettled(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => reject(transaction.error ?? new ZipscribeError('DB_WRITE_FAILED')))
    transaction.addEventListener('abort', () => reject(transaction.error ?? new ZipscribeError('DB_WRITE_FAILED')))
  })
}

export function createPersistenceService(deps: PersistenceDeps): PersistenceService {
  const clock = deps.clock
  const timers = deps.timers
  const saveBlobLimitBytes = deps.saveBlobLimitBytes ?? DEFAULT_SAVE_BLOB_LIMIT_BYTES

  function reportError(code: PersistenceErrorCode): void {
    deps.onError?.(code)
  }

  // ── database ───────────────────────────────────────────────────────────────

  let db: IDBDatabase | null = null
  let opening: Promise<void> | null = null

  async function open(): Promise<void> {
    if (db !== null) return
    if (opening === null) {
      opening = doOpen().catch((error: unknown) => {
        opening = null
        throw error
      })
    }
    await opening
  }

  async function doOpen(): Promise<void> {
    const factory = deps.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB
    if (factory === undefined) {
      reportError('DB_OPEN_FAILED')
      throw new ZipscribeError('DB_OPEN_FAILED')
    }
    const request = factory.open(DB_NAME, PERSISTENCE_SCHEMA_VERSION)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_PROJECTS)) database.createObjectStore(STORE_PROJECTS, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(STORE_HANDLES)) database.createObjectStore(STORE_HANDLES, { keyPath: 'projectId' })
      if (!database.objectStoreNames.contains(STORE_BLOBS)) database.createObjectStore(STORE_BLOBS, { keyPath: 'projectId' })
    })
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result))
      request.addEventListener('error', () => reject(request.error ?? new ZipscribeError('DB_OPEN_FAILED')))
    })
    // FR-106.2: hidden→flush (the pending-count rule inside saveNow keeps it
    // a no-op unless pending work ≥ 1 — exactly the pinned `hidden` policy).
    deps.document?.addEventListener('visibilitychange', () => {
      void service.saveNow('hidden')
    })
  }

  async function requireDb(): Promise<IDBDatabase> {
    if (db === null) await open()
    if (db === null) throw new ZipscribeError('DB_OPEN_FAILED')
    return db
  }

  /**
   * One `readwrite` (or `readonly`) transaction per call — every row a single
   * logical write touches lives inside ONE transaction, so a mid-save failure
   * (quota injection, CC-106.3) leaves each row fully-old or fully-new.
   */
  async function inTransaction<T>(storeNames: string | string[], mode: IDBTransactionMode, run: (transaction: IDBTransaction) => Promise<T>): Promise<T> {
    const database = await requireDb()
    const transaction = database.transaction(storeNames, mode)
    const done = transactionSettled(transaction)
    try {
      const result = await run(transaction)
      await done
      return result
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        /* transaction already finished — nothing to roll back */
      }
      await done.catch(() => undefined)
      throw error
    }
  }

  async function getRow<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return inTransaction(store, 'readonly', async (transaction) => (await requestResult(transaction.objectStore(store).get(key) as IDBRequest<unknown>)) as T | undefined)
  }

  async function getAllRows<T>(store: string): Promise<T[]> {
    return inTransaction(store, 'readonly', async (transaction) => (await requestResult(transaction.objectStore(store).getAll() as IDBRequest<unknown>)) as T[])
  }

  // ── save state (FR-106.2 indicator seam) ──────────────────────────────────

  let saveState: SaveState = { state: 'idle', lastSavedAt: null, errorCode: null }
  const saveListeners = new Set<() => void>()

  function setSaveState(patch: Partial<SaveState>): void {
    saveState = { ...saveState, ...patch }
    // A throwing subscriber is contained (CC-106.3): the save-state machine —
    // and every queued save waiter riding on it — is never stranded by a
    // subscriber. SECURITY-03: subscriber failures are never logged.
    for (const listener of [...saveListeners]) {
      try {
        listener()
      } catch {
        /* a subscriber failure belongs to the subscriber, not the queue */
      }
    }
  }

  function subscribeSaveState(cb: () => void): () => void {
    saveListeners.add(cb)
    return () => {
      saveListeners.delete(cb)
    }
  }

  // ── autosave state machine (FR-106.2) ─────────────────────────────────────
  //
  // PENDING-COUNT, CLEAN-ON-ATTACH (orchestrator adjudication): `attachEditor`
  // does NOT mark a pre-existing project dirty. `dirty` := ≥ 1 ACCEPTED
  // project change observed since attach or since the last successful save —
  // a change counter, deliberately NOT a byte comparison (a command ping-pong
  // that nets the canonical bytes back is still pending work; a byte baseline
  // attached-dirty instead, which the FR-106.2 suites reject).

  let app: EditorAppLike | null = null
  let unsubscribeEditor: (() => void) | null = null
  let panelStateSource: (() => PanelState) | null = null
  let peaksSource: (() => PeaksLike | null) | null = null
  let debounceId: number | null = null

  /** Accepted project changes observed; `savedChanges` is the count the last
   *  SUCCESSFUL save wrote. dirty := projectChanges > savedChanges. */
  let projectChanges = 0
  let savedChanges = 0

  /** Last observed {id, canonical bytes}. A null→entry sighting (or an id
   *  change) is an attach-equivalent baseline, never a change; a callback
   *  with UNCHANGED bytes is a UI-store notification (the docblock exclusion
   *  list — the editor store shares the subscription), never a change. */
  let baseline: { id: string; bytes: string } | null = null

  /** Last observed project REFERENCE (unit-106 perf fix). `project.subscribe`
   *  is the ROOT zustand subscription, so it also fires on every editor-slice
   *  commit — the playhead mirror alone notifies once per rAF tick. The
   *  project reference is STABLE across all editor-only commits (immer keeps
   *  untouched subtrees), so an unchanged reference is the hot-path proof of
   *  "nothing project-relevant happened": return without serializing. Only a
   *  reference CHANGE may pay for serializeProject — the byte-transition
   *  count below is otherwise unchanged (reference change + bytes equal to
   *  the last observed bytes stays a UI-notification-shaped no-count, exactly
   *  as before this memoization; a command ping-pong changes the reference
   *  twice and each byte transition still counts, [106-ADJ 2/3]). */
  let lastProjectRef: Project | null = null

  /** In-flight guard + single queued follow-up (last-completed-wins). */
  let inFlight: Promise<SaveOutcome> | null = null
  const queuedWaiters: Array<(outcome: SaveOutcome) => void> = []

  function currentProject(): Project | null {
    return app === null ? null : app.project.getState().project
  }

  function clearDebounce(): void {
    if (debounceId !== null) {
      timers.clearTimeout(debounceId)
      debounceId = null
    }
  }

  /** THE only place the autosave timer is scheduled (pending ≥ 1). */
  function scheduleDebounce(): void {
    clearDebounce()
    debounceId = timers.setTimeout(() => {
      debounceId = null
      void service.saveNow('idle')
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  function onProjectChanged(): void {
    const project = currentProject()
    if (project === null) {
      baseline = null
      lastProjectRef = null
      return
    }
    // Hot-path gate (unit-106 perf fix): the root subscription notifies on
    // EVERY commit including editor-only ones (playhead mirror per rAF tick).
    // A stable project reference means the project object was untouched by
    // this commit — return WITHOUT serializing (the byte check below could
    // only ever re-derive the same bytes for the same object).
    if (project === lastProjectRef) return
    lastProjectRef = project
    const bytes = serializeProject(project)
    if (baseline === null || baseline.id !== project.id) {
      // First sighting of this project (attach with a late load, or a
      // project switch) — an attach-equivalent baseline, never a change.
      baseline = { id: project.id, bytes }
      return
    }
    if (bytes === baseline.bytes) {
      // Identical canonical bytes: a UI-store notification (the exclusion
      // list lives in the editor store but shares this subscription) — never
      // pending work, never a timer, never a write.
      return
    }
    baseline = { id: project.id, bytes }
    // Accepted project change: pending becomes/stays ≥ 1. (Counted per
    // TRANSITION, not against the save baseline — a command ping-pong that
    // nets the bytes back is still ≥ 1 accepted change, [106-ADJ 2/3].)
    projectChanges += 1
    // Persistent-failure rule (CC-I2.12): `not-saved` survives edits and
    // clears only on a LATER successful save.
    if (saveState.state !== 'not-saved') setSaveState({ state: 'dirty' })
    // Each change RESETS the 2 s idle window.
    scheduleDebounce()
  }

  function attachEditor(next: EditorAppLike): void {
    if (unsubscribeEditor !== null) unsubscribeEditor()
    app = next
    // CLEAN-ON-ATTACH: zero pending, no timer, no save-state transition.
    projectChanges = 0
    savedChanges = 0
    // Attach-time serialization is the ONE allowed serializeProject per attach
    // (the clean baseline); the reference memo starts here so the very first
    // editor-only tick after attach already short-circuits.
    const initial = next.project.getState().project
    lastProjectRef = initial
    baseline = initial === null ? null : { id: initial.id, bytes: serializeProject(initial) }
    clearDebounce()
    unsubscribeEditor = next.project.subscribe(onProjectChanged)
  }

  function classifyWriteError(error: unknown): PersistenceErrorCode {
    return errorName(error) === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : 'DB_WRITE_FAILED'
  }

  async function writeProjectRow(row: ProjectRow): Promise<boolean> {
    return inTransaction(STORE_PROJECTS, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_PROJECTS)
      const existing = (await requestResult(store.get(row.id) as IDBRequest<unknown>)) as ProjectRow | undefined
      // FR-106.3: never write over a newer schema — refuse instead.
      if (existing !== undefined && existing.schemaVersion > PERSISTENCE_SCHEMA_VERSION) throw new SaveRefused('SCHEMA_FUTURE')
      await requestResult(store.put(row))
      return existing === undefined
    })
  }

  async function performSave(): Promise<SaveOutcome> {
    const project = currentProject()
    if (project === null) return 'not-dirty'
    if (projectChanges === savedChanges) return 'not-dirty'
    // Snapshot the state AND the change count together: changes landing while
    // the write is in flight stay PENDING, so the queued follow-up (single,
    // LATEST state — CC-106.3 last-completed-wins) still carries them.
    const snapshotChanges = projectChanges
    setSaveState({ state: 'saving' })
    try {
      // Row materialization lives INSIDE the try, after the DB handshake: a
      // throwing peaks/panelState source or serializer is contained like any
      // other save failure — a FAILED save, never a rejected saveNow, never a
      // stranded queued waiter, never a machine stuck on 'saving'.
      await requireDb()
      const row: ProjectRow = {
        id: project.id,
        schemaVersion: PERSISTENCE_SCHEMA_VERSION,
        name: project.name,
        updatedAt: project.updatedAt,
        project: serializeProject(project),
        peaks: peaksSource === null ? null : peaksSource(),
        panelState: panelStateSource === null ? null : panelStateSource(),
      }
      const isNewProject = await writeProjectRow(row)
      savedChanges = snapshotChanges
      clearDebounce()
      setSaveState({ state: 'saved', lastSavedAt: clock.now(), errorCode: null })
      // FR-106.7: exactly once, on the first successful save of a NEW project.
      // The persist request is post-save honesty metadata ONLY — a rejecting
      // request never turns a LANDED write into 'failed'/DB_WRITE_FAILED (no
      // blocking prompt): the success outcome stands and `persisted`
      // degrades to false.
      if (!persistRequested && isNewProject) {
        persistRequested = true
        try {
          persisted = await deps.requestPersist()
        } catch {
          persisted = false
        }
      }
      return 'saved'
    } catch (error) {
      const code = error instanceof SaveRefused ? error.code : classifyWriteError(error)
      reportError(code)
      setSaveState({ state: 'not-saved', errorCode: code })
      return 'failed'
    }
  }

  async function saveNow(reason: 'idle' | 'manual' | 'hidden'): Promise<SaveOutcome> {
    if (reason === 'manual') clearDebounce()
    if (inFlight !== null) {
      // Single queued follow-up: every queued caller rides the ONE next save,
      // which re-reads the latest snapshot when it runs.
      return new Promise<SaveOutcome>((resolve) => {
        queuedWaiters.push(resolve)
      })
    }
    const chain: Promise<SaveOutcome> = (async () => {
      const first = await performSave()
      while (queuedWaiters.length > 0) {
        const waiters = queuedWaiters.splice(0, queuedWaiters.length)
        const followUp = await performSave()
        for (const resolve of waiters) resolve(followUp)
      }
      return first
    })()
    inFlight = chain
    try {
      return await chain
    } finally {
      if (inFlight === chain) inFlight = null
    }
  }

  // ── migrations (FR-106.3) ─────────────────────────────────────────────────

  function migrateRow(row: ProjectRow): { row: ProjectRow; readOnly: boolean } | null {
    if (row.schemaVersion > PERSISTENCE_SCHEMA_VERSION) {
      reportError('SCHEMA_FUTURE')
      return { row, readOnly: true }
    }
    let current = row
    while (current.schemaVersion < PERSISTENCE_SCHEMA_VERSION) {
      const step: ((row: unknown) => { schemaVersion: number }) | undefined = MIGRATIONS[current.schemaVersion]
      if (step === undefined) {
        reportError('DB_READ_FAILED')
        return null
      }
      const upgraded = step(current) as ProjectRow
      if (upgraded.schemaVersion <= current.schemaVersion) {
        // A step that does not advance would loop the chain forever.
        reportError('DB_READ_FAILED')
        return null
      }
      current = upgraded
    }
    return { row: current, readOnly: false }
  }

  async function loadProject(id: string): Promise<LoadedProject | null> {
    const stored = await getRow<ProjectRow>(STORE_PROJECTS, id)
    if (stored === undefined) return null
    const migrated = migrateRow(stored)
    if (migrated === null) return null
    return {
      project: parseProject(migrated.row.project),
      peaks: migrated.row.peaks,
      panelState: migrated.row.panelState,
      readOnly: migrated.readOnly,
    }
  }

  async function openProject(id: string): Promise<LoadedProject | null> {
    const loaded = await loadProject(id)
    if (loaded === null) return null
    // FR-106.5 reopen context: record recency on the blob cache row.
    await inTransaction(STORE_BLOBS, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_BLOBS)
      const row = (await requestResult(store.get(id) as IDBRequest<unknown>)) as BlobRow | undefined
      if (row === undefined) return
      await requestResult(store.put({ ...row, lastOpened: clock.now() }))
    })
    return loaded
  }

  // ── project lifecycle (FR-106.5/FR-106.6) ─────────────────────────────────

  async function listProjects(): Promise<ProjectRow[]> {
    const rows = await getAllRows<ProjectRow>(STORE_PROJECTS)
    return [...rows].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async function createProjectRow(name: string): Promise<string> {
    const id = newProjectId()
    const now = clock.now()
    const project: Project = {
      id,
      name,
      schemaVersion: 1,
      asset: structuredClone(BLANK_ASSET),
      blocks: [],
      captionOrigin: 'none',
      translations: [],
      speakers: [],
      speakerSource: 'none',
      language: null,
      modelId: null,
      style: structuredClone(BLANK_STYLE),
      outputAspect: 'source',
      transcription: 'none',
      updatedAt: now,
    }
    const row: ProjectRow = {
      id,
      schemaVersion: PERSISTENCE_SCHEMA_VERSION,
      name,
      updatedAt: now,
      project: serializeProject(project),
      peaks: null,
      panelState: panelStateSource === null ? null : panelStateSource(),
    }
    await inTransaction(STORE_PROJECTS, 'readwrite', async (transaction) => {
      await requestResult(transaction.objectStore(STORE_PROJECTS).put(row))
    })
    return id
  }

  async function duplicateProject(id: string): Promise<string> {
    const copyId = newProjectId()
    await inTransaction([STORE_PROJECTS, STORE_HANDLES], 'readwrite', async (transaction) => {
      const projects = transaction.objectStore(STORE_PROJECTS)
      const source = (await requestResult(projects.get(id) as IDBRequest<unknown>)) as ProjectRow | undefined
      if (source === undefined) throw new ZipscribeError('PROJECT_NOT_FOUND')
      await requestResult(projects.put({ ...source, id: copyId, name: `${source.name} (copy)`, updatedAt: clock.now() }))
      const handles = transaction.objectStore(STORE_HANDLES)
      const handleRow = (await requestResult(handles.get(id) as IDBRequest<unknown>)) as MediaHandleRow | undefined
      if (handleRow !== undefined) await requestResult(handles.put({ ...handleRow, projectId: copyId }))
    })
    return copyId
  }

  function deleteProject(id: string): Promise<{ commit(): Promise<void>; undo(): void }> {
    // Toast-undoable (US-2.4.3): NOTHING is written until `commit()`.
    let settled = false
    return Promise.resolve({
      undo: () => {
        settled = true
      },
      commit: async () => {
        if (settled) return
        settled = true
        inMemoryHandles.delete(id)
        await inTransaction([STORE_PROJECTS, STORE_HANDLES, STORE_BLOBS], 'readwrite', (transaction) => {
          transaction.objectStore(STORE_PROJECTS).delete(id)
          transaction.objectStore(STORE_HANDLES).delete(id)
          transaction.objectStore(STORE_BLOBS).delete(id)
          return Promise.resolve()
        })
      },
    })
  }

  async function renameProject(id: string, name: string): Promise<void> {
    await inTransaction(STORE_PROJECTS, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_PROJECTS)
      const row = (await requestResult(store.get(id) as IDBRequest<unknown>)) as ProjectRow | undefined
      if (row === undefined) throw new ZipscribeError('PROJECT_NOT_FOUND')
      // FR-106.3 (writeProjectRow's guard, mirrored): this write path
      // RE-SERIALIZES the stored bytes, so a FUTURE-schema row is refused —
      // unknown bytes never pass through the v1 canonicalizer. The remaining
      // write paths need no guard: the blobCache touches (openProject,
      // getMediaBlob) and storeMediaHandle rewrite rows of this module's own
      // schema, deleteProject only deletes, duplicateProject copies the
      // future bytes verbatim, create/import write fresh v1 rows under fresh
      // ids.
      if (row.schemaVersion > PERSISTENCE_SCHEMA_VERSION) {
        reportError('SCHEMA_FUTURE')
        throw new SaveRefused('SCHEMA_FUTURE')
      }
      const parsed = parseProject(row.project)
      const stamped: Project = { ...parsed, name, updatedAt: clock.now() }
      await requestResult(store.put({ ...row, name, updatedAt: stamped.updatedAt, project: serializeProject(stamped) }))
    })
  }

  async function exportProjectFile(id: string): Promise<string | null> {
    const row = await getRow<ProjectRow>(STORE_PROJECTS, id)
    return row === undefined ? null : row.project
  }

  async function importProjectFile(json: string): Promise<string> {
    let parsed: Project
    try {
      parsed = parseProject(json)
    } catch (error) {
      // SECURITY-03: ProjectParseError carries the CODE only.
      reportError('IMPORT_INVALID')
      throw error
    }
    const id = newProjectId()
    const now = clock.now()
    const stamped: Project = { ...parsed, id, updatedAt: now }
    const row: ProjectRow = {
      id,
      schemaVersion: PERSISTENCE_SCHEMA_VERSION,
      name: stamped.name,
      updatedAt: now,
      project: serializeProject(stamped),
      peaks: null,
      panelState: null,
    }
    await inTransaction(STORE_PROJECTS, 'readwrite', async (transaction) => {
      await requestResult(transaction.objectStore(STORE_PROJECTS).put(row))
    })
    return id
  }

  // ── media handles + relink (FR-106.4/FR-106.8) ────────────────────────────

  /**
   * Session-visible handles. A FileSystemFileHandle is structured-cloneable in
   * Chromium (persisted across reloads for the silent path); test/e2e handle
   * DOUBLES are not clone-able (functions), so `storeMediaHandle` falls back
   * to persisting fingerprint-only and this map keeps the handle usable for
   * the session's relink. Never a substitute for persisted storage.
   */
  const inMemoryHandles = new Map<string, FileSystemFileHandle>()

  async function putHandleRow(projectId: string, fingerprint: MediaFingerprint, handle: FileSystemFileHandle | undefined): Promise<void> {
    const row: MediaHandleRow = { projectId, fingerprint }
    if (handle !== undefined) row.handle = handle
    await inTransaction(STORE_HANDLES, 'readwrite', async (transaction) => {
      await requestResult(transaction.objectStore(STORE_HANDLES).put(row))
    })
  }

  async function storeMediaHandle(projectId: string, handle: FileSystemFileHandle | null, fingerprint: MediaFingerprint): Promise<void> {
    if (handle === null) {
      inMemoryHandles.delete(projectId)
      await putHandleRow(projectId, fingerprint, undefined)
      return
    }
    inMemoryHandles.set(projectId, handle)
    try {
      await putHandleRow(projectId, fingerprint, handle)
    } catch (error) {
      if (errorName(error) !== 'DataCloneError') throw error
      await putHandleRow(projectId, fingerprint, undefined)
    }
  }

  async function getMediaHandle(projectId: string): Promise<MediaHandleRow | null> {
    const row = await getRow<MediaHandleRow>(STORE_HANDLES, projectId)
    if (row === undefined) return null
    const memory = inMemoryHandles.get(projectId)
    if (memory !== undefined) return { ...row, handle: memory }
    return { ...row }
  }

  async function validateAgainstFingerprint(file: File, stored: MediaFingerprint): Promise<RelinkOutcome> {
    let probe: MediaFingerprint
    try {
      // FR-106.8: the probe (unit-04 media worker in prod) is the ONLY fingerprint source.
      probe = await deps.probeFingerprint(file)
    } catch {
      // A failed probe means we cannot validate — asking the user for the
      // file again is the honest fallback (never a blind accept).
      return { kind: 'picker-needed', file: null }
    }
    // A MALFORMED probe result is as untrustworthy as a rejected probe — same
    // honest fallback: keep asking. The contract is Promise<RelinkOutcome>:
    // a defined outcome from the pinned vocabulary, never a TypeError.
    if (!isWellFormedFingerprint(probe)) return { kind: 'picker-needed', file: null }
    // A malformed STORED field can never CONFIRM equality — the affected
    // field counts as differing (honest coded `mismatch`, never a throw).
    const record = stored as Partial<MediaFingerprint> | null
    const differs: RelinkField[] = []
    const name = record?.name
    if (typeof name !== 'string' || probe.name !== name) differs.push('name')
    const size = record?.size
    if (typeof size !== 'number' || probe.size !== size) differs.push('size')
    const durationMs = record?.durationMs
    if (typeof durationMs !== 'number' || probe.durationMs !== durationMs) differs.push('durationMs')
    const storedHashes = record?.sampleHashes
    if (!isStringArray(storedHashes)) {
      differs.push('sampleHashes')
    } else {
      for (let i = 0; i < storedHashes.length; i++) {
        if (probe.sampleHashes[i] !== storedHashes[i]) {
          differs.push('sampleHashes')
          break
        }
      }
    }
    if (differs.length === 0) return { kind: 'silent', file }
    reportError('FINGERPRINT_MISMATCH')
    return { kind: 'mismatch', differs }
  }

  async function relinkMedia(projectId: string): Promise<RelinkOutcome> {
    const row = await getMediaHandle(projectId)
    // Nothing stored to relink against — honest vocabulary, never a throw.
    if (row === null) return { kind: 'no-handle' }
    const stored = row.fingerprint
    const handle = row.handle
    if (handle !== undefined) {
      let granted: PermissionState = 'denied'
      try {
        granted = (await (handle as FileSystemFileHandle & QueryPermissionCapable).queryPermission?.({ mode: 'read' })) ?? 'denied'
      } catch {
        granted = 'denied'
      }
      if (granted === 'granted') {
        try {
          const file = await handle.getFile()
          return await validateAgainstFingerprint(file, stored)
        } catch {
          /* stale handle → fall through to the picker path */
        }
      } else {
        reportError('HANDLE_PERMISSION_DENIED')
      }
    }
    let picked: File | null
    try {
      picked = await deps.openFilePicker()
    } catch {
      reportError('PICKER_UNAVAILABLE')
      return { kind: 'picker-needed', file: null }
    }
    if (picked === null) return { kind: 'picker-needed', file: null }
    // A PICKED file runs the SAME fingerprint contract (Firefox has no FSA —
    // validated → silent with the picked file; any difference → mismatch).
    return validateAgainstFingerprint(picked, stored)
  }

  // ── blob cache + storage (FR-106.7, CC-106.5) ─────────────────────────────

  let persistRequested = false
  let persisted = false

  async function cacheMediaBlob(projectId: string, blob: Blob): Promise<void> {
    await inTransaction(STORE_BLOBS, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_BLOBS)
      await requestResult(store.put({ projectId, blob, bytes: blob.size, lastOpened: clock.now() } satisfies BlobRow))
      // LRU eviction over blobCache ONLY — projects/mediaHandles are never
      // touched (the project JSON + peaks survive; re-link covers the blob).
      const rows = (await requestResult(store.getAll() as IDBRequest<unknown>)) as BlobRow[]
      let total = 0
      for (const row of rows) total += row.bytes
      const byAge = [...rows].sort((a, b) => a.lastOpened - b.lastOpened)
      for (const row of byAge) {
        if (total <= saveBlobLimitBytes) break
        store.delete(row.projectId)
        total -= row.bytes
      }
    })
  }

  function getMediaBlob(projectId: string): Promise<Blob | null> {
    return inTransaction(STORE_BLOBS, 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_BLOBS)
      const row = (await requestResult(store.get(projectId) as IDBRequest<unknown>)) as BlobRow | undefined
      if (row === undefined) return null
      await requestResult(store.put({ ...row, lastOpened: clock.now() }))
      return row.blob
    })
  }

  async function storageEstimate(): Promise<StorageEstimateView> {
    const estimate = await deps.estimateStorage()
    const rows = await getAllRows<BlobRow>(STORE_BLOBS)
    let blobCacheBytes = 0
    for (const row of rows) blobCacheBytes += row.bytes
    return { usage: estimate.usage, quota: estimate.quota, persisted, blobCacheBytes }
  }

  // ── surface ────────────────────────────────────────────────────────────────

  const service: PersistenceService = {
    open,
    attachEditor,
    setPanelStateSource: (fn) => {
      panelStateSource = fn
    },
    setPeaksSource: (fn) => {
      peaksSource = fn
    },
    saveNow,
    getSaveState: () => saveState,
    subscribeSaveState,
    listProjects,
    loadProject,
    openProject,
    createProjectRow,
    duplicateProject,
    deleteProject,
    renameProject,
    exportProjectFile,
    importProjectFile,
    storeMediaHandle,
    getMediaHandle,
    relinkMedia,
    cacheMediaBlob,
    getMediaBlob,
    storageEstimate,
  }
  return service
}
