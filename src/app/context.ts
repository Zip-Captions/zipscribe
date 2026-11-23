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
import { createChromeTranslationEngine } from '../engine/translate/chrome-translator'
import type { WorkerEnginePort } from '../state/services/engine-port'
import { createTranscribeCommitService } from '../state/services/transcribe-commit'
import type { TranscribeCommitService } from '../state/services/transcribe-commit'
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
import { createRouterMediaClock } from '../state/services/playback/router-clock'
import { createVisualizerRuntime } from './visualizer-runtime'
import type { VisualizerRuntime } from './visualizer-runtime'
import type { StageController } from './stage'
import { createBrowserRafDriver } from './browser-rafs'
import { createLocalStorageSettings, createPendingUnit07ImportService, createProductionModelCache, probeDeviceCapability } from './ports'
import { createZipscribeModelCache } from '../engine/model/adapters/browser-cache'
import type { ModelCache } from '../engine/model/cache'
import { hasLocalMediaLinked, markLocalMediaLinked } from './real-asr-lane'

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
  /** unit-107: clock router + stage graph + visualizer layer composition (FR-107.1/.4). */
  visualizer: VisualizerRuntime
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
  /** unit-202 FR-202.3: the media BYTES behind the current project (burn-in
   *  input). Memory map first, then the FR-106 blob cache; never re-fetched
   *  over the network. */
  getSourceBlob(projectId: string): Promise<Blob | null>
  /** unit-202 (ziptest bridge): register the export-input bytes for a
   *  project (memory + blob cache). */
  setSourceBlob(projectId: string, blob: Blob): Promise<void>
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
  /**
   * FR-108.1 (unit-108): the stream-commit service (progress-frontier commit
   * of streamed `job:segments` into project blocks). Wired once here; the
   * Transcript itself never commits (frozen FR-104.6).
   */
  transcribeCommit: TranscribeCommitService
  /**
   * FR-204.4 (unit-204): the verified model cache (unit-03 doctrine, browser
   * configuration shared with the ASR worker) — the ⋯ → Offline models panel
   * lists/ensures/removes through this instance.
   */
  modelCache: ModelCache
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

export interface AppContextOptions {
  /**
   * Strict `ziptest=1` (App.tsx's frozen bridge gate): the ASR/diarize worker
   * lanes stay inert (FR-108 [108-ADJ] — injection-driven e2e doctrine) and
   * the real-stream `mediaSource` dep is not wired (unit-101/102 frozen
   * mocked-worker flows stay deterministic). Production passes false.
   */
  ziptest?: boolean
}

export function createAppContext(options: AppContextOptions = {}): Promise<AppContext> {
  pending ??= buildAppContext(options)
  return pending
}

async function buildAppContext(options: AppContextOptions): Promise<AppContext> {
  const ziptest = options.ziptest === true
  // FR-108 [108-ADJ] nulls the scripted lanes; FR-204.2 EXTENDS: once a
  // project's media was relinked from the user's own local File (the
  // offline e2e / real-user offline story), the REAL asr worker must serve
  // the lane — offline-ready transcription is untestable through injection.
  const engine = createWorkerEnginePort({ nullAsrDiarizeWorkers: ziptest ? () => !hasLocalMediaLinked() : undefined })
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
  // unit-107 (FR-107.1): the arbitrator's single clock is the ROUTER — the
  // composition swaps element/deferred/decoded clocks per project; the
  // deferred element clock stays the video backing + the bridge's seek
  // diagnostics owner.
  let resumeOnPlay: () => void = () => undefined
  const router = createRouterMediaClock({ onActivePlay: () => resumeOnPlay() })
  let stageElement: HTMLMediaElement | null = null
  let visualizerRef: VisualizerRuntime | null = null
  // ONE rAF loop (frozen transport-bar pin): the visualizer pump piggybacks
  // on the arbitrator's driver — no second subscription.
  const baseRafs = createBrowserRafDriver()
  const rafs: RafDriver = {
    request: (cb): number =>
      baseRafs.request((timeMs) => {
        visualizerRef?.pumpFrame(timeMs)
        cb(timeMs)
      }),
    cancel: (id: number): void => {
      baseRafs.cancel(id)
    },
    frame: (dtMs: number): void => baseRafs.frame(dtMs),
  }
  // US-301.2 capability gate (boot-cached — API presence cannot change within
  // a session): `translation-add-track { origin: 'machine' }` is refused on
  // browsers without the built-in Translator. Manual/imported tracks stay
  // allowed everywhere (CC-I4.5).
  let translationAvailable: boolean | undefined
  // FR-302.1: ONE Chrome Translator engine instance backs both the capability
  // gate and the jobs-orchestrated runs (the store phase-wraps it internally).
  // Created eagerly but never touches the Translator API until first use.
  const translationEngine = createChromeTranslationEngine()
  const editorApp = createEditorApp({
    clock: { now: () => Date.now() },
    rafs,
    mediaClock: router,
    speakerEngine: DEFAULT_COMMAND_DEPS.speakerEngine,
    translationEngineAvailable: () => (translationAvailable ??= translationEngine.isAvailable().available),
  })
  const stage = createStageController({
    onAttachElement: (element) => {
      mediaClock.attach(element)
      stageElement = element
      const asset = editorApp.project.getState().project?.asset ?? null
      if (element === null) router.attachActive(null)
      else if (asset !== null && asset.kind === 'audio') visualizerRef?.onStageElement(element)
      else router.attachActive(mediaClock)
    },
  })
  const visualizer = createVisualizerRuntime({
    settings,
    stage,
    editorApp,
    router,
    devicePixelRatio: () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1),
    now: () => Date.now(),
    prefersReducedMotion: () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  })
  visualizerRef = visualizer

  // FR-204.4: the model cache the Offline models panel uses (ensure/remove/
  // list). It is the SAME browser configuration the ASR worker builds, so
  // "downloaded by transcription" and "shown as cached in the panel" are one
  // truth. jobs gets the ModelCachePort over a second instance (same store).
  const modelCache = createZipscribeModelCache()
  // FR-302.1: the jobs store also orchestrates translation runs — it owns the
  // per-language progress/cancel state and drives the unit-301 apply service
  // (machine track add + job-output application) over the SAME editorApp.
  const currentMediaFile = async (): Promise<File> => {
    const asset = editorApp.project.getState().project?.asset ?? null
    const name = asset?.name ?? 'media'
    const type = asset === null ? '' : `${asset.kind === 'audio' ? 'audio' : 'video'}/${asset.container}`
    // FR-204.2 (unit-204): a relinked/reopened project's bytes live in the
    // blob cache (IDB) — take them there FIRST so the decode stream works
    // with zero network (the offline leg must never reach the URL).
    const projectId = editorApp.project.getState().project?.id ?? null
    if (projectId !== null) {
      const cached = await getSourceBlob(projectId)
      if (cached !== null) return new File([cached], name, { type })
    }
    const url = stage.getMediaSource()
    if (url === null) throw new Error('NO_MEDIA_SOURCE')
    const fetchName = asset?.name ?? url.split('/').pop() ?? 'media'
    const response = await fetch(url)
    if (!response.ok) throw new Error('MEDIA_FETCH_FAILED')
    const blob = await response.blob()
    return new File([blob], fetchName, { type })
  }
  const jobs = createJobsStore({
    engine,
    modelCache: createProductionModelCache(),
    // FR-204.2 (unit-204): main-thread verified-cache warm on online real-
    // lane dispatches. The scripted lane (ziptest with no local media
    // linked) must stay byte-identical to the frozen 108 doctrine — no
    // fetch is ever attempted there.
    warmModelCache: (modelId) => {
      if (ziptest && !hasLocalMediaLinked()) return
      void modelCache.ensureOffline(modelId).catch(() => undefined)
    },
    translation: { editorApp, engine: translationEngine },
    ...(ziptest
      ? {
          // FR-204.2 (unit-204): the relinked-local-file flow runs the REAL
          // ASR worker (real-asr-lane predicate), which needs the real decode
          // stream like production. Gate at CALL time on the same flag the
          // lane decision uses: scripted-lane runs (no local media linked)
          // reject before any fetch/decode post, leaving the frozen 108
          // doctrine byte-identical (the null worker never reads a port).
          mediaSource: async (): Promise<File> => {
            if (!hasLocalMediaLinked()) throw new Error('SCRIPTED_LANE_NO_MEDIA')
            return currentMediaFile()
          },
        }
      : {
          // FR-108.2: the real stream — the stage's current media becomes a
          // File for the media worker's decode tee (unit-107
          // blobForCurrentSource precedent: fetch → named File, mediabunny
          // sniffs by EXTENSION; the name never enters any log — SECURITY-03).
          mediaSource: async (): Promise<File> => currentMediaFile(),
        }),
  })
  resumeOnPlay = () => {
    visualizer.resumeForGesture()
  }
  // Source swaps (open/reopen/relink) re-decide the clock path (FR-107.1).
  let lastMediaUrl = stage.getMediaSource()
  stage.subscribe(() => {
    const url = stage.getMediaSource()
    if (url === lastMediaUrl) return
    lastMediaUrl = url
    visualizer.reset()
    if (stageElement !== null) {
      const asset = editorApp.project.getState().project?.asset ?? null
      if (asset !== null && asset.kind === 'audio') visualizer.onStageElement(stageElement)
    }
  })

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

  const sourceBlobs = new Map<string, Blob>()

  async function getSourceBlob(projectId: string): Promise<Blob | null> {
    const mem = sourceBlobs.get(projectId)
    if (mem !== undefined) return mem
    try {
      const cached = await persistence.getMediaBlob(projectId)
      if (cached !== null) sourceBlobs.set(projectId, cached)
      return cached
    } catch {
      return null
    }
  }

  async function setSourceBlob(projectId: string, blob: Blob): Promise<void> {
    sourceBlobs.set(projectId, blob)
    await persistence.cacheMediaBlob(projectId, blob)
  }

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
      // FR-204.2: local-file media ⇒ real ASR lane (real-asr-lane.ts).
      markLocalMediaLinked()
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

  // FR-108.1 (unit-108): the ONE stream-commit bridge. It taps raw engine
  // events through the jobs store (fired before the slice folds them) and
  // subscribes for the start/cancel transitions — never a Transcript concern.
  const transcribeCommit = createTranscribeCommitService({ jobs, editorApp })

  engine.onMediaEvent((event) => {
    if (event.t !== 'media:probed') return
    // FR-204.2: only intake's posted probes own the stage; a decode's
    // `media:probed` (same shared channel) must never close the live source.
    if (!previewUrlByProbeJobId.has(event.jobId)) return
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
    visualizer,
    rafs,
    captionImport: createEngineCaptionImportPort(),
    setCaptionImportOverride(result: CaptionImportResult | null): void {
      importService = result === null ? createPendingUnit07ImportService() : overrideService(result)
    },
    persistence,
    persistenceDeps,
    exportService,
    getSourceBlob,
    setSourceBlob,
    transcribeCommit,
    modelCache,
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
