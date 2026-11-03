// Shared mount for the unit-101 L2 suites: wires every frozen seam with its
// test double (fake engine, fake settings storage, fake model cache, fake
// unit-07 import service, fake clock for the minimal project store) and
// renders the shell under test. Tests interact only through the public
// seams (stores, drop events, DOM) — never private internals.
import { render } from '@testing-library/react'
import type { ModelId } from '@engine/protocol@101'
import type { MediaAsset } from '@engine/model@101'
import { Workbench } from '@ui/shell/Workbench'
import { createJobsStore } from '@state/jobs'
import { createSettingsStore } from '@state/settings'
import { createProjectStore } from '@state/project'
import { createIntakeService } from '@state/services/intake'
import type { ImportCaptionsService } from '@state/services/intake'
import { createFakeClock } from '../../../../src/test-support/fake-clock'
import { createFakeImportService, createFakeModelCache, createFakeSettingsStorage, createProbingEngine, MEDIA_ASSET } from './fake-engine'
import type { FakeEnginePort } from './fake-engine'
import type { CaptionImportResult } from '@state/services/intake'

export interface MountOptions {
  /** Seed a project (drops straight into the workbench instead of the empty state). */
  project?: { asset?: MediaAsset; captionImport?: CaptionImportResult }
  cachedModels?: readonly ModelId[]
  importService?: ImportCaptionsService
  storageInitial?: Record<string, string>
}

export interface MountedShell {
  engine: FakeEnginePort
  jobs: ReturnType<typeof createJobsStore>
  settings: Awaited<ReturnType<typeof createSettingsStore>>
  project: ReturnType<typeof createProjectStore>
  intake: ReturnType<typeof createIntakeService>
  importService: ImportCaptionsService
  writes: { key: string; value: string }[]
}

export async function mountWorkbench(options: MountOptions = {}): Promise<MountedShell> {
  const engine = createProbingEngine(options.project?.asset ?? MEDIA_ASSET)
  const modelCache = createFakeModelCache(options.cachedModels ?? [])
  const jobs = createJobsStore({ engine, modelCache })
  const { storage, writes } = createFakeSettingsStorage(options.storageInitial)
  const settings = await createSettingsStore({ storage })
  const project = createProjectStore({ clock: createFakeClock(1_730_000_000_000) })
  const { service } = createFakeImportService()
  const importService = options.importService ?? service
  const intake = createIntakeService({ engine, jobs, project, importService })
  if (options.project) project.createProject(options.project.asset ?? MEDIA_ASSET, options.project.captionImport)
  render(<Workbench jobs={jobs} settings={settings} project={project} intake={intake} />)
  return { engine, jobs, settings, project, intake, importService, writes }
}
