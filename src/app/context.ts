// App composition root (unit-101 wiring). Builds the single context the shell
// renders over — production `EnginePort` (workers), the zustand slices from
// the frozen seams, and the intake service over the unit-07 caption seam.
// The ziptest bridge (unit-101 frozen contract § Window __zipWorkbenchBridge)
// reaches the SAME receivers through `getAppContext()`; the bridge module
// itself is lazily imported behind the strict `?ziptest=1` gate in App.tsx.
// SECURITY-03: no logging anywhere here — failures surface as codes only.

import { createJobsStore } from '../state/jobs'
import type { JobsStore } from '../state/jobs'
import { createProjectStore } from '../state/project'
import type { ProjectStore } from '../state/project'
import { createSettingsStore } from '../state/settings'
import type { SettingsStore } from '../state/settings'
import { createIntakeService } from '../state/services/intake'
import type { CaptionImportResult, ImportCaptionsService, IntakeService } from '../state/services/intake'
import { createWorkerEnginePort } from '../state/services/engine-port'
import type { WorkerEnginePort } from '../state/services/engine-port'
import { createLocalStorageSettings, createPendingUnit07ImportService, createProductionModelCache, probeDeviceCapability } from './ports'

export interface AppContext {
  engine: WorkerEnginePort
  jobs: JobsStore
  settings: SettingsStore
  project: ProjectStore
  intake: IntakeService
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
  const project = createProjectStore({ clock: { now: () => Date.now() } })

  // Swappable seam: the default is the unit-07 placeholder until the bridge
  // (or a future unit) installs a real caption importer.
  let importService: ImportCaptionsService = createPendingUnit07ImportService()
  const intake = createIntakeService({
    engine,
    jobs,
    project,
    importService: {
      sniff: (file) => importService.sniff(file),
      importCaptions: (file) => importService.importCaptions(file),
    },
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
    project,
    intake,
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
