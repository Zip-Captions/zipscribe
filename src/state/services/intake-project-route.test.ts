// L1 contract for the unit-106 slice D EXTENDS of the intake service
// (FR-106.6 drag-in): the project-envelope classification helpers and the
// handleFiles project route. Builder-owned colocated suite (engine-port /
// export-worker-port lineage) — the frozen CC-101.2 intake suite and the
// workbench suites never pass the `importProjectFile` hook, so the new
// branches are pinned HERE.
// SECURITY-03: rejections are reason CODES; nothing here can carry content.
import { describe, expect, test } from 'vitest'
import { createIntakeService, isProjectFileName, readProjectEnvelope } from './intake'
import type { CaptionFormat, CaptionImportResult, ImportCaptionsService } from './intake'
import type { MediaEvent, MediaRequest } from '../../engine/protocol'
import type { EnginePort, JobsStore } from '../jobs'
import type { ProjectStore } from '../project'

const ENVELOPE = JSON.stringify({ id: 'p1', name: 'cut', schemaVersion: 1, asset: { id: 'a', name: 'm.mp4', kind: 'video', container: 'mp4', audioCodec: null, videoCodec: null, duration: 2, width: 1, height: 1, fps: 1, fingerprint: { name: 'm.mp4', size: 1, durationMs: 2000, sampleHashes: ['h', 'h', 'h'] } }, blocks: [], captionOrigin: 'none', translations: [], speakers: [], speakerSource: 'none', language: null, modelId: null, style: null, outputAspect: 'source', transcription: 'none', updatedAt: 0 })
const CAPTION_JSON = JSON.stringify({ blocks: [{ start: 0, end: 1, text: 'hi', words: [] }] })

function fakeEngine(): { port: EnginePort; posted: MediaRequest[] } {
  const posted: MediaRequest[] = []
  const port: EnginePort = {
    postMedia: (request) => posted.push(request),
    postAsr: () => undefined,
    postDiarize: () => undefined,
    onMediaEvent: (_listener: (event: MediaEvent) => void) => () => undefined,
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

function fakeImportService(sniffed: CaptionFormat | null = null): ImportCaptionsService & { importCalls: number } {
  const service = {
    importCalls: 0,
    sniff: () => Promise.resolve(sniffed),
    importCaptions: () => {
      service.importCalls += 1
      return Promise.resolve({ report: { format: 'srt', encoding: 'utf-8', cues: 0, blocks: 0, detectedLanguage: null, adjustments: [] }, blocks: [] } satisfies CaptionImportResult)
    },
  }
  return service
}

function service(deps: Partial<Parameters<typeof createIntakeService>[0]> = {}) {
  const engine = fakeEngine()
  const intake = createIntakeService({
    engine: engine.port,
    jobs: { getState: () => ({}), subscribe: () => () => undefined } as unknown as JobsStore,
    project: fakeProjectStore(),
    importService: fakeImportService(),
    ...deps,
  })
  return { intake, engine }
}

describe('isProjectFileName (FR-106.6)', () => {
  test('matches only the .zipscribe.json suffix (case-insensitive)', () => {
    expect(isProjectFileName('my.Cut.Zipscribe.JSON')).toBe(true)
    expect(isProjectFileName('.zipscribe.json')).toBe(true)
    expect(isProjectFileName('zipscribe.json')).toBe(false)
    expect(isProjectFileName('captions.json')).toBe(false)
    expect(isProjectFileName('video.zipscribe.json.bak')).toBe(false)
    expect(isProjectFileName('mp4')).toBe(false)
  })
})

describe('readProjectEnvelope (FR-106.6 content sniff)', () => {
  test('a JSON object with numeric schemaVersion + object asset returns the text verbatim', async () => {
    const file = new File([ENVELOPE], 'p.zipscribe.json', { type: 'application/json' })
    await expect(readProjectEnvelope(file)).resolves.toBe(ENVELOPE)
  })

  test('caption zipscribe-json (no schemaVersion/asset), arrays, scalars, malformed JSON and unreadable files are NOT envelopes', async () => {
    await expect(readProjectEnvelope(new File([CAPTION_JSON], 'c.zipscribe.json'))).resolves.toBeNull()
    await expect(readProjectEnvelope(new File(['[1,2]'], 'a.zipscribe.json'))).resolves.toBeNull()
    await expect(readProjectEnvelope(new File(['42'], 'n.zipscribe.json'))).resolves.toBeNull()
    await expect(readProjectEnvelope(new File(['{"not":"zipscribe"}'], 'd.json'))).resolves.toBeNull()
    await expect(readProjectEnvelope(new File(['{oops'], 'b.zipscribe.json'))).resolves.toBeNull()
    const broken = { text: () => Promise.reject(new Error('read failed')), name: 'x.zipscribe.json', size: 4, type: '' } as unknown as File
    await expect(readProjectEnvelope(broken)).resolves.toBeNull()
  })

  test('an oversized file is not sniffed (project files are media-less JSON)', async () => {
    const big = { size: 5 * 1024 * 1024, text: () => Promise.resolve(ENVELOPE) } as unknown as File
    await expect(readProjectEnvelope(big)).resolves.toBeNull()
  })
})

describe('handleFiles project route (FR-106.6)', () => {
  test('an envelope drop goes to the hook — neither media nor caption, no rejected entries', async () => {
    const imported: string[] = []
    const { intake, engine } = service({ importProjectFile: (json) => Promise.resolve(imported.push(json)).then(() => 'proj_x') })
    const outcome = await intake.handleFiles([new File([ENVELOPE], 'cut.zipscribe.json', { type: 'application/json' })])
    expect(imported).toEqual([ENVELOPE])
    expect(outcome).toEqual({ mediaPosted: 0, importedCaptions: [], rejected: [] })
    expect(engine.posted, 'no probe was posted for a project file').toEqual([])
  })

  test('a rejecting hook degrades to the IMPORT_INVALID reason CODE (IN.1 discipline, sibling media still probes)', async () => {
    const { intake, engine } = service({ importProjectFile: () => Promise.reject(new Error('IMPORT_INVALID')) })
    const media = new File(['bytes'], 'speech-2min.mp4', { type: 'video/mp4' })
    const outcome = await intake.handleFiles([new File([ENVELOPE], 'broken-body.zipscribe.json'), media])
    expect(outcome.rejected).toEqual([{ reason: 'IMPORT_INVALID' }])
    expect(outcome.mediaPosted, 'a failing project import never takes the drop down').toBe(1)
    expect(engine.posted[0]?.t).toBe('probe')
  })

  test('no hook (the frozen 101 contract) → the caption path is byte-identical', async () => {
    const importService = fakeImportService(null)
    const { intake } = service({ importService })
    const outcome = await intake.handleFiles([new File([ENVELOPE], 'cut.zipscribe.json')])
    expect(outcome.importedCaptions).toEqual([])
    expect(outcome.rejected, 'sniff null → the frozen UNSUPPORTED_CAPTION reason').toEqual([{ reason: 'UNSUPPORTED_CAPTION' }])
    expect(importService.importCalls).toBe(0)
  })

  test('a caption-shaped zipscribe-json stays on the caption path even WITH the hook', async () => {
    let hookCalls = 0
    const importService = fakeImportService('zipscribe-json')
    const { intake } = service({ importService, importProjectFile: () => (hookCalls += 1, Promise.resolve('p')) })
    const outcome = await intake.handleFiles([new File([CAPTION_JSON], 'captions.zipscribe.json')])
    expect(hookCalls, 'the envelope sniff rejected the caption shape — the hook never saw it').toBe(0)
    expect(outcome.importedCaptions).toHaveLength(1)
    expect(outcome.rejected).toEqual([])
  })
})
