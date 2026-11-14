// ADVERSARY (unit-106): counterexample suite for the FR-106.6 drag-in routing
// of `src/state/services/intake.ts` — the project-envelope vs caption-JSON
// discrimination, judged against the REAL persistence service (a caption file
// must never create a row; a refused project file must leave the stores
// empty). Kill-shots: caption-JSON arrays, truncated envelopes (no hang),
// schemaVersion-99 envelopes (honest IMPORT_INVALID refusal), canary file
// names through every rejection channel.
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createIntakeService, readProjectEnvelope } from '../../../src/state/services/intake'
import { createPersistenceService } from '@state/services/persistence'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'
import { cannedFingerprint, createFakePersistenceDeps } from '../editor/helpers/fake-persistence'
import type { CaptionFormat, CaptionImportResult, ImportCaptionsService } from '../../../src/state/services/intake'
import type { EnginePort, JobsStore } from '../../../src/state/jobs'
import type { ProjectStore } from '../../../src/state/project'
import type { MediaRequest } from '../../../src/engine/protocol'
import type { PersistenceService, Project } from '@state/services/persistence'

function baseProject(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: 'Intake adversary',
    schemaVersion: 1,
    asset: { id: 'ASSET_I', name: 'm.mp4', kind: 'audio', container: '', audioCodec: null, videoCodec: null, duration: 0, width: 0, height: 0, fps: 0, fingerprint: cannedFingerprint() },
    blocks: [],
    captionOrigin: 'none',
    translations: [],
    speakers: [],
    speakerSource: 'none',
    language: null,
    modelId: null,
    style: { fontFamily: 'Inter', fontWeight: 400, fontSizePct: 8, textTransform: 'none', color: '#e8eaed', highlightColor: '#4c8dff', outlineColor: '#0d0f12', outlineWidth: 2, backgroundOpacity: 0, position: 'bottom', marginVPct: 6, alignment: 'center', maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false },
    outputAspect: 'source',
    transcription: 'none',
    updatedAt: 1_730_000_000_000,
    ...overrides,
  }
}

function fakeEngine(): { port: EnginePort; posted: MediaRequest[] } {
  const posted: MediaRequest[] = []
  const port: EnginePort = {
    postMedia: (request) => posted.push(request),
    postAsr: () => undefined,
    postDiarize: () => undefined,
    onMediaEvent: () => () => undefined,
    onAsrEvent: () => () => undefined,
    dispose: () => undefined,
  }
  return { port, posted }
}

function fakeProjectStore(): ProjectStore & { created: number } {
  const store = {
    created: 0,
    getState: () => ({ project: null }),
    subscribe: () => () => undefined,
    createProject: () => {
      store.created += 1
    },
    hasBlocks: () => false,
    setProjectName: () => undefined,
  }
  return store
}

function fakeImportService(sniffed: CaptionFormat | null = 'zipscribe-json'): ImportCaptionsService {
  return {
    sniff: () => Promise.resolve(sniffed),
    importCaptions: () =>
      Promise.resolve({
        report: { format: 'zipscribe-json' as CaptionFormat, encoding: 'utf-8', cues: 0, blocks: 0, detectedLanguage: null, adjustments: [] },
        blocks: [],
      } satisfies CaptionImportResult),
  }
}

async function realImportHook(): Promise<{ hook: (json: string) => Promise<string>; service: PersistenceService; rows: () => Promise<string[]> }> {
  const bundle = createFakePersistenceDeps()
  const service = createPersistenceService(bundle.deps)
  await service.open()
  return {
    hook: (json) => service.importProjectFile(json),
    service,
    rows: async () => (await service.listProjects()).map((row) => row.id),
  }
}

let redaction: ReturnType<typeof createRedactionSpy>
beforeEach(() => {
  redaction = createRedactionSpy()
})
afterEach(() => {
  const verdict = redaction.settle()
  redaction.restore()
  expect(verdict.leaks, 'no canary content reached any console/error channel').toEqual([])
})

describe('AUDIT-106 intake routing (FR-106.6): envelope vs caption, honest refusals', () => {
  test('AUDIT-106.25: a caption-JSON ARRAY named .zipscribe.json never opens a project — the hook is never consulted, zero rows created', async () => {
    const { hook, rows } = await realImportHook()
    let hookCalls = 0
    const engine = fakeEngine()
    const projectStore = fakeProjectStore()
    const intake = createIntakeService({
      engine: engine.port,
      jobs: { getState: () => ({}), subscribe: () => () => undefined } as unknown as JobsStore,
      project: projectStore,
      importService: fakeImportService(),
      importProjectFile: (json) => {
        hookCalls += 1
        return hook(json)
      },
    })
    const captionArray = JSON.stringify([{ start: 0, end: 1, text: `${CANARY_MARKER} hello` }])
    const outcome = await intake.handleFiles([new File([captionArray], 'subs.zipscribe.json', { type: 'application/json' })])
    expect(hookCalls, 'an array is not a project envelope').toBe(0)
    expect(projectStore.created, 'no project opened').toBe(0)
    expect(await rows(), 'the projects store stays empty').toEqual([])
    expect(outcome.mediaPosted).toBe(0)
  })

  test('AUDIT-106.26: a valid-JSON envelope whose body fails parseProject (asset: {}) → IMPORT_INVALID reason CODE, zero rows, no hang', async () => {
    const { hook, rows } = await realImportHook()
    const engine = fakeEngine()
    const intake = createIntakeService({
      engine: engine.port,
      jobs: { getState: () => ({}), subscribe: () => () => undefined } as unknown as JobsStore,
      project: fakeProjectStore(),
      importService: fakeImportService(),
      importProjectFile: hook,
    })
    const notAProject = JSON.stringify({ id: 'p', name: 'x', schemaVersion: 1, asset: {}, blocks: [] })
    const outcome = await intake.handleFiles([new File([notAProject], 'half.zipscribe.json'), new File(['bytes'], 'speech-2min.mp4', { type: 'video/mp4' })])
    expect(outcome.rejected, 'the refusal is the pinned reason CODE').toEqual([{ reason: 'IMPORT_INVALID' }])
    expect(outcome.mediaPosted, 'the sibling media probe survives a bad project file (IN.2 discipline)').toBe(1)
    expect(await rows(), 'nothing half-imported landed').toEqual([])
  })

  test('AUDIT-106.27: a FUTURE schemaVersion:99 envelope is honestly refused — IMPORT_INVALID, zero rows (FR-106.3 never accepts unknown schemas)', async () => {
    const { hook, service, rows } = await realImportHook()
    const engine = fakeEngine()
    const intake = createIntakeService({
      engine: engine.port,
      jobs: { getState: () => ({}), subscribe: () => () => undefined } as unknown as JobsStore,
      project: fakeProjectStore(),
      importService: fakeImportService(),
      importProjectFile: hook,
    })
    const future = JSON.stringify(baseProject('proj_future_drag', { schemaVersion: 99 as Project['schemaVersion'] }))
    const outcome = await intake.handleFiles([new File([future], 'tomorrow.zipscribe.json')])
    expect(outcome.rejected).toEqual([{ reason: 'IMPORT_INVALID' }])
    expect(await rows(), 'no row was written for a refused future schema').toEqual([])
    expect(service.getSaveState().state, 'the refusal left no save-state residue').toBe('idle')
  })

  test('AUDIT-106.28: a TRUNCATED envelope (JSON cut mid-body) is not a project — falls to the caption path, never hangs', async () => {
    const truncated = `{"id":"p","name":"x","schemaVersion":1,"asset":{"id":"a","name":"m.mp4","ki`
    await expect(readProjectEnvelope(new File([truncated], 'cut.zipscribe.json'))).resolves.toBeNull()
    const { hook } = await realImportHook()
    let hookCalls = 0
    const engine = fakeEngine()
    const intake = createIntakeService({
      engine: engine.port,
      jobs: { getState: () => ({}), subscribe: () => () => undefined } as unknown as JobsStore,
      project: fakeProjectStore(),
      importService: fakeImportService(),
      importProjectFile: (json) => {
        hookCalls += 1
        return hook(json)
      },
    })
    const outcome = await intake.handleFiles([new File([truncated], 'cut.zipscribe.json')])
    expect(hookCalls, 'unparseable JSON is never fed to the project importer').toBe(0)
    expect(outcome.importedCaptions, 'it lands on the untouched caption path').toHaveLength(1)
  })

  test('AUDIT-106.29: a CANARY file name through the rejection channels yields CODES only — no name crosses', async () => {
    const engine = fakeEngine()
    const intake = createIntakeService({
      engine: engine.port,
      jobs: { getState: () => ({}), subscribe: () => () => undefined } as unknown as JobsStore,
      project: fakeProjectStore(),
      importService: fakeImportService(null),
    })
    const outcome = await intake.handleFiles([
      new File(['x'], `${CANARY_MARKER}.zipscribe.json`),
      new File(['x'], `${CANARY_MARKER}.xyz`),
    ])
    expect(outcome.rejected.map((entry) => entry.reason), 'both rejections are pinned reason CODES').toEqual(['UNSUPPORTED_CAPTION', 'UNSUPPORTED_TYPE'])
    expect(JSON.stringify(outcome), 'the outcome object carries no name, no content').not.toContain(CANARY_MARKER)
  })
})
