// App composition root (unit-101 wiring, extended by unit-102 slice C).
// Builds the single context the shell renders over — production `EnginePort`
// (workers), the zustand slices from the frozen seams, the intake service
// over the unit-07 caption seam, and the unit-102 editor app (command system
// + zundo history + SyncArbitrator over the DEFERRED element clock the stage
// attaches when a media source lands). The ziptest bridges (unit-101/102
// frozen contracts § Window __zipWorkbenchBridge / __zipEditorBridge) reach
// the SAME receivers through `getAppContext()`; the bridge modules themselves
// are lazily imported behind the strict `?ziptest=1` gate in App.tsx.
// SECURITY-03: no logging anywhere here — failures surface as codes only.

import { createJobsStore } from '../state/jobs'
import type { JobsStore } from '../state/jobs'
import type { ProjectStore } from '../state/project'
import { createSettingsStore } from '../state/settings'
import type { SettingsStore } from '../state/settings'
import { createIntakeService } from '../state/services/intake'
import { isProjectFileName, readProjectEnvelope } from '../state/services/intake'
import type { CaptionImportResult, ImportCaptionsService, IntakeService } from '../state/services/intake'
import { createEngineCaptionImportPort } from '../state/services/caption-import'
import type { CaptionImportPort } from '../state/services/caption-import'
import { createWorkerEnginePort } from '../state/services/engine-port'
import type { WorkerEnginePort } from '../state/services/engine-port'
import { createPersistenceService } from '../state/services/persistence'
import type { LoadedProject, PanelState, PersistenceDeps, PersistenceService, RelinkOutcome } from '../state/services/persistence'
import { createExportService } from '../state/services/export'
import type { ExportService } from '../state/services/export'
import { createExportWorkerPort } from '../state/services/export-worker-port'
import { newJobId } from '../state/ids'
import type { MediaFingerprint } from '../engine/model'
import { createEditorApp } from '../state/history'
import type { EditorApp } from '../state/history'
import { DEFAULT_COMMAND_DEPS } from '../state/commands'
import { createDeferredMediaClock } from '../state/services/playback/media-clock'
import type { DeferredMediaClock } from '../state/services/playback/media-clock'
import type { RafDriver } from '../state/services/playback/arbitrator'
import { createStageController } from './stage'
import type { StageController } from './stage'
import { createBrowserRafDriver } from './browser-rafs'
import { createLocalStorageSettings, createPendingUnit07ImportService, createProductionModelCache, probeDeviceCapability } from './ports'

export interface AppContext {
  engine: WorkerEnginePort
  jobs: JobsStore
  settings: SettingsStore
  /** The unit-102 editor app's frozen ProjectStore (the ONE project truth — intake, shell and bridge share it). */
  project: ProjectStore
  intake: IntakeService
  /** Slice C: command system + history + SyncArbitrator (element clock attached by the stage). */
  editorApp: EditorApp
  /** Slice C: stage media source + readiness (view plumbing, never the frozen editor slice). */
  stage: StageController
  /** Slice C: the stage element's clock (diagnostics: seekCount/clockTime via the bridge). */
  mediaClock: DeferredMediaClock
  /** Unit-103: the app's ONE rAF loop (the Timeline panel's repaint driver — the same driver the arbitrator runs on). */
  rafs: RafDriver
  /**
   * FR-104.9 (unit-104 slice D): the caption-import port the Workbench drop
   * intercept feeds to the import dialog (report before confirm). Optional on
   * the Workbench transport — frozen mounts without it keep the untouched
   * intake path.
   */
  captionImport: CaptionImportPort
  /** Ziptest bridge: replaces the caption import service; null restores the default. */
  setCaptionImportOverride(result: CaptionImportResult | null): void
  /**
   * FR-106.1 (unit-106 slice D): the production persistence service
   * (database `zipscribe`, the three pinned stores) — the status-bar
   * indicator, the ⌘S provider, the Media-tab ProjectList and the e2e
   * persistence bridge all flow through this one instance.
   */
  persistence: PersistenceService
  /**
   * The LIVE deps object of `persistence` — production code reads its
   * members at call time; the ziptest persistence bridge installs
   * replaceable probe/estimate/persist wrappers here (honest to tests
   * only — production paths never reassign it).
   */
  persistenceDeps: PersistenceDeps
  /**
   * FR-102.7 (unit-106 slice D provider): the export service over the
   * REAL export worker port (unit-102 shipped the seam + scripted fake;
   * the provider lands here). Thin — no UI consumes it yet (Intent 3).
   */
  exportService: ExportService
  /** FR-106.5: apply a loaded reopen context (editor load, history reset, panel restore, blob-cache attach). */
  applyLoadedProject(loaded: LoadedProject): void
  /** FR-106.4: post-open relink; a 'silent' outcome attaches the file (stage + blob cache). */
  relinkAfterOpen(projectId: string): Promise<RelinkOutcome>
  /** CC-106.4 keep-or-replace "replace": picker → probe → storeMediaHandle + cacheMediaBlob + attach. True when replaced. */
  replaceRelinkedMedia(projectId: string): Promise<boolean>
  /** FR-106.6 drag-in (intake hook): import a project envelope and open it; resolves with the fresh row id. */
  importAndOpenProjectFile(json: string): Promise<string>
  /** FR-106.6 (Workbench dialog-branch intercept): sniff a dropped file as a project envelope; true = opened. */
  detectAndOpenProjectFile(file: File): Promise<boolean>
  /** FR-106.5: the Workbench's active sidebar tab (panelState.activeTab source). */
  setActiveTab(tab: PanelState['activeTab']): void
}

let pending: Promise<AppContext> | null = null
let active: AppContext | null = null

function overrideService(result: CaptionImportResult): ImportCaptionsService {
  return {
    sniff: () => Promise.resolve(result.report.format),
    importCaptions: () => Promise.resolve(result),
  }
}

/**
 * FR-106.4 picker dep (unit-106 slice D): Chromium File System Access with
 * the Firefox fallback (a one-shot single `<input type=file>` — Gecko has
 * no FSA; the SAME fingerprint contract validates whatever comes back).
 * A cancelled FSA picker THROWS (AbortError → the service reports
 * PICKER_UNAVAILABLE + 'picker-needed'); an input cancel resolves null.
 * SECURITY-03: no file names cross any channel — the File object is all.
 */
async function openProductionFilePicker(): Promise<File | null> {
  interface OpenFilePickerCapable {
    showOpenFilePicker?: (options?: { multiple?: boolean; excludeAcceptAllOption?: boolean }) => Promise<FileSystemFileHandle[]>
  }
  const picker = (globalThis as unknown as OpenFilePickerCapable).showOpenFilePicker
  if (typeof picker === 'function') {
    const handles = await picker({ multiple: false, excludeAcceptAllOption: false })
    const handle = handles[0]
    if (handle === undefined) return null
    return handle.getFile()
  }
  if (typeof globalThis.document === 'undefined') return null
  return new Promise<File | null>((resolve, reject) => {
    const input = globalThis.document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'
    const settle = (file: File | null): void => {
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => settle(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => settle(null), { once: true })
    globalThis.document.body.appendChild(input)
    try {
      input.click()
    } catch (error) {
      input.remove()
      reject(error instanceof Error ? error : new Error('PICKER_UNAVAILABLE'))
    }
  })
}

export function createAppContext(): Promise<AppContext> {
  pending ??= buildAppContext()
  return pending
}

async function buildAppContext(): Promise<AppContext> {
  const engine = createWorkerEnginePort()
  const jobs = createJobsStore({ engine, modelCache: createProductionModelCache() })
  const settings = await createSettingsStore({ storage: createLocalStorageSettings() })

  // Slice C editor core: ONE project truth (the 101-frozen ProjectStore the
  // command system composes), the SyncArbitrator over the deferred element
  // clock (the stage attaches the `<video>` when a source lands), a
  // wall-clock for the merge-window, and the browser rAF driver (the app's
  // ONE rAF loop).
  // @104 EXTENDS: the PRODUCTION speaker engine is the merged unit-06
  // `src/engine/diarize/assign.ts` pure fns behind `DEFAULT_COMMAND_DEPS`
  // (CONTRACT.md § speaker-* family re-point + § unit-104 EXTENDS — including
  // the US-1.3.3 merge/split pair). `NOT_IMPLEMENTED_SPEAKER_ENGINE` stays the
  // dispatch-without-engine seam default inside `createEditorApp`.
  const mediaClock = createDeferredMediaClock()
  const rafs = createBrowserRafDriver()
  const editorApp = createEditorApp({
    clock: { now: () => Date.now() },
    rafs,
    mediaClock,
    speakerEngine: DEFAULT_COMMAND_DEPS.speakerEngine,
  })
  const stage = createStageController({ onAttachElement: (element) => mediaClock.attach(element) })

  // ── unit-106 slice D: persistence (FR-106.1/FR-106.7/FR-106.8) ───────────
  // Production deps: the real IndexedDB factory, wall clock, real timers,
  // `navigator.storage` estimate/persist (feature-guarded — an absent
  // Storage API reads as an honest `false`, never a claim), the media-worker
  // probe through the engine port (FR-106.8: hashes are NEVER computed on
  // the main thread), and showOpenFilePicker with the Firefox input fallback.
  // SECURITY-03: codes live in the service (`saveState.errorCode`, which the
  // status-bar indicator already reads); this hook exists only for ziptest
  // diagnostics — zero console, zero content.
  const persistenceDeps: PersistenceDeps = {
    indexedDB: globalThis.indexedDB,
    clock: { now: () => Date.now() },
    timers: {
      setTimeout: (cb, ms) => window.setTimeout(cb, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    },
    estimateStorage: async () => {
      const estimate = (await globalThis.navigator?.storage?.estimate?.()) ?? null
      return { usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0 }
    },
    requestPersist: async () => {
      if (typeof globalThis.navigator?.storage?.persist !== 'function') return false
      return globalThis.navigator.storage.persist()
    },
    probeFingerprint: (file) => engine.probeFingerprint(file),
    openFilePicker: openProductionFilePicker,
    document: typeof globalThis.document === 'undefined' ? undefined : globalThis.document,
    onError: () => undefined,
  }
  const persistence = createPersistenceService(persistenceDeps)

  // FR-106.5 reopen context. The tab is reported up by the Workbench
  // (onTabChange); the playhead/selection come from the editor slice. The
  // persisted-UI-state EXCLUSION LIST (playing/rate/loop/searchOpen/live
  // mirror) is the persistence.ts docblock — nothing excluded is ever read
  // into this snapshot.
  let activeTab: PanelState['activeTab'] = 'subtitles'
  persistence.setPanelStateSource(() => {
    const snapshot = settings.getState()
    const editor = editorApp.editor.getState()
    return {
      activeTab,
      collapsed: { ...snapshot.collapsed },
      panelSizes: { sidebar: snapshot.panels.sidebarPx, timeline: snapshot.panels.timelinePx },
      theme: snapshot.theme,
      transcribe: { language: snapshot.transcribe.language, modelId: snapshot.transcribe.modelId, diarize: snapshot.transcribe.diarize },
      lastPlayhead: editor.playhead,
      selection: editor.selection,
    }
  })
  // PEAKS-HONESTY (slice D): PeaksData is not plumbed into any state slice
  // yet — unit-103 renders `waveform: []` (frozen slice-C surface) and the
  // jobs slice ignores `peaks:chunk`. The row's peaks column stays null
  // rather than lying; wiring it is a unit-107+ follow-up.
  persistence.setPeaksSource(() => null)
  persistence.attachEditor(editorApp)
  // FR-106.2: open eagerly so the visibilitychange→hidden flusher is live
  // from boot. A failed open (private mode, no IDB) is the service's coded
  // DB_OPEN_FAILED — never a boot failure, never a console line.
  void persistence.open().catch(() => undefined)

  function attachObjectUrl(blobOrFile: Blob): void {
    try {
      stage.setMediaSource(URL.createObjectURL(blobOrFile))
    } catch {
      // Preview stays closed (coded stage-notice path); persistence unaffected.
    }
  }

  function applyLoadedProject(loaded: LoadedProject): void {
    // FR-106.5: the loaded row IS the project (identity + updatedAt ride);
    // history never crosses a project boundary (open = fresh session);
    // the reopen context lands in the UI-only editor slice (FR-102.2 —
    // no history step); a cached blob restores the media without re-upload.
    editorApp.project.loadProject?.(loaded.project)
    editorApp.history.clear()
    if (loaded.panelState !== null) {
      editorApp.editor.setPlayhead(loaded.panelState.lastPlayhead)
      if (loaded.panelState.selection !== null) editorApp.editor.setSelection(loaded.panelState.selection)
    }
    void persistence
      .getMediaBlob(loaded.project.id)
      .then((blob) => {
        if (blob !== null) attachObjectUrl(blob)
      })
      .catch(() => undefined)
  }

  async function relinkAfterOpen(projectId: string): Promise<RelinkOutcome> {
    const outcome = await persistence.relinkMedia(projectId)
    if (outcome.kind === 'silent') {
      attachObjectUrl(outcome.file)
      void persistence.cacheMediaBlob(projectId, outcome.file).catch(() => undefined)
    }
    return outcome
  }

  async function replaceRelinkedMedia(projectId: string): Promise<boolean> {
    // CC-106.4 keep-or-replace "replace": the USER decision overwrites the
    // stored fingerprint (the never-overwrite rule binds the automatic
    // relink, not explicit replace). The new fingerprint is probed by the
    // media worker (FR-106.8) — a cancelled picker or failed probe leaves
    // the decision point open (honest ask, never a blind swap).
    let file: File | null
    try {
      file = await persistenceDeps.openFilePicker()
    } catch {
      return false
    }
    if (file === null) return false
    let fingerprint: MediaFingerprint
    try {
      fingerprint = await persistenceDeps.probeFingerprint(file)
    } catch {
      return false
    }
    try {
      await persistence.storeMediaHandle(projectId, null, fingerprint)
      attachObjectUrl(file)
      void persistence.cacheMediaBlob(projectId, file).catch(() => undefined)
      return true
    } catch {
      return false
    }
  }

  async function importAndOpenProjectFile(json: string): Promise<string> {
    // FR-106.6: parseProject (inside the service) is the strict gatekeeper —
    // a CODE-only ProjectParseError rejects to the caller (intake degrades
    // it to the IMPORT_INVALID reason; SECURITY-03 keeps content out).
    const id = await persistence.importProjectFile(json)
    const loaded = await persistence.openProject(id)
    if (loaded !== null) applyLoadedProject(loaded)
    return id
  }

  async function detectAndOpenProjectFile(file: File): Promise<boolean> {
    if (!isProjectFileName(file.name)) return false
    const envelope = await readProjectEnvelope(file)
    if (envelope === null) return false
    await importAndOpenProjectFile(envelope)
    return true
  }

  // Preview source for real drops: the probed File becomes a blob: URL
  // (SECURITY-03-safe object identity, never a file name) bound to its probe
  // jobId, published to the stage when the `media:probed` reply lands.
  const previewUrlByProbeJobId = new Map<string, string>()

  // Swappable seam: the default is the unit-07 placeholder until the bridge
  // (or a future unit) installs a real caption importer.
  let importService: ImportCaptionsService = createPendingUnit07ImportService()
  const intake = createIntakeService({
    engine,
    jobs,
    project: editorApp.project,
    importService: {
      sniff: (file) => importService.sniff(file),
      importCaptions: (file) => importService.importCaptions(file),
    },
    onMediaProbe: (file, jobId) => {
      try {
        previewUrlByProbeJobId.set(jobId, URL.createObjectURL(file))
      } catch {
        // Preview stays closed (coded stage notice path); intake/probe unaffected.
      }
    },
    // FR-106.6 (slice D): a dropped `.zipscribe.json` project envelope
    // imports through the persistence service and OPENS (the Workbench
    // dialog branch intercepts caption-named files on the open-project
    // side; this hook covers the intake side). Non-envelopes never reach
    // it — the caption path stays byte-identical.
    importProjectFile: importAndOpenProjectFile,
  })

  // FR-102.7 (slice D provider): the export service over the REAL export
  // worker port. Thin on purpose — Intent 3 consumes it; unit-106 ships
  // the production wiring (unit-102's scripted fake stays the test double).
  const exportService = createExportService({ engine: createExportWorkerPort(), newJobId })

  engine.onMediaEvent((event) => {
    if (event.t !== 'media:probed') return
    const url = previewUrlByProbeJobId.get(event.jobId) ?? null
    previewUrlByProbeJobId.delete(event.jobId)
    stage.setMediaSource(url)
  })

  void probeDeviceCapability()
    .then((capability) => {
      jobs.setCapability(capability)
    })
    .catch(() => {
      // A failed probe leaves the shell in its "capability pending" state;
      // the tier chip and T4 screen simply never render (codes-only failure,
      // nothing to report from the browser console per SECURITY-03).
    })

  const context: AppContext = {
    engine,
    jobs,
    settings,
    project: editorApp.project,
    intake,
    editorApp,
    stage,
    mediaClock,
    rafs,
    captionImport: createEngineCaptionImportPort(),
    setCaptionImportOverride(result: CaptionImportResult | null): void {
      importService = result === null ? createPendingUnit07ImportService() : overrideService(result)
    },
    persistence,
    persistenceDeps,
    exportService,
    applyLoadedProject,
    relinkAfterOpen,
    replaceRelinkedMedia,
    importAndOpenProjectFile,
    detectAndOpenProjectFile,
    setActiveTab(tab: PanelState['activeTab']): void {
      activeTab = tab
    },
  }
  active = context
  return context
}

/** The created context; throws only if the bridge loads before the app booted. */
export function getAppContext(): AppContext {
  if (active === null) throw new Error('app context not created')
  return active
}
