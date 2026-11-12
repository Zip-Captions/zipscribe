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
import type { CaptionImportResult, ImportCaptionsService, IntakeService } from '../state/services/intake'
import { createWorkerEnginePort } from '../state/services/engine-port'
import type { WorkerEnginePort } from '../state/services/engine-port'
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
  /** Ziptest bridge: replaces the caption import service; null restores the default. */
  setCaptionImportOverride(result: CaptionImportResult | null): void
}

let pending: Promise<AppContext> | null = null
let active: AppContext | null = null

function overrideService(result: CaptionImportResult): ImportCaptionsService {
  return {
    sniff: () => Promise.resolve(result.report.format),
    importCaptions: () => Promise.resolve(result),
  }
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
  })

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
    setCaptionImportOverride(result: CaptionImportResult | null): void {
      importService = result === null ? createPendingUnit07ImportService() : overrideService(result)
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
