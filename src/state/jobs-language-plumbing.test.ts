// CC-304.1 / CC-304.2 (L1, node): the production `project.language` plumbing
// at the jobs slice (unit-304, closes #51). Derived ONLY from the unit spec:
//
//   • FR-304.1 — the wiring is the injected editor-app seam: `createJobsStore`
//     receives the SAME `EditorApp` the transcribe-commit service uses, and
//     the language rides as JOB OUTPUT via `applyWithoutHistory` — never an
//     undoable command (M6/#66 ruling: job artifacts never enter the undo
//     chain; the undo-invariance legs below assert that, with a positive
//     command anchor so they can never pass vacuously).
//   • CC-304.1 — Start with an explicit Language sets `project.language`
//     immediately, before any `job:done`.
//   • CC-304.2 — Auto-detect stores the detected language from `job:done`
//     `stats.language`, jobId-filtered exactly as the existing `job:done`
//     handler (foreign/superseded jobIds ignored); an explicit selection is
//     never overwritten by a differing detection.
//
// RED by design (the implementation is the builder's next step): every test
// asserting NEW behaviour fails on a real value assertion — `project.language`
// stays `null` because nothing in production ever sets it (the #51 finding).
// The seam shape this suite pins for the builder is the optional
// `editorApp: EditorApp` member on `createJobsStore`'s deps (passed through a
// widened variable so this file type-checks at authoring time — the width is
// the contract the builder must honour; see the unit report).
//
// SECURITY-03: only language tags, ids and numbers cross assertions — the
// fake engine's `job:done` stats carry the frozen protocol's codes/numbers
// shape only.
import { describe, expect, test } from 'vitest'
import { createJobsStore } from './jobs'
import { createEditorApp } from './history'
import type { EditorApp } from './history'
import type { AsrEvent, AsrRequest, DiarizeRequest, MediaEvent, MediaRequest, ModelId } from '../engine/protocol'
import type { MediaAsset, Project } from '../engine/model'

const CACHED_MODEL: ModelId = 'whisper-base_timestamped@608c49e6'

const ASSET: MediaAsset = {
  id: 'ASSET_304',
  name: 'speech.mp4',
  kind: 'video',
  container: 'mp4',
  audioCodec: 'aac',
  videoCodec: 'avc1',
  duration: 10,
  width: 640,
  height: 360,
  fps: 30,
  sampleRate: 16_000,
  channels: 1,
  fingerprint: { name: 'speech.mp4', size: 4096, durationMs: 10_000, sampleHashes: ['a', 'b', 'c'] },
}

/** The engine double, shaped exactly like the jobs.test.ts harness. */
function createEngineDouble(): {
  engine: import('./jobs').EnginePort
  asrRequests: AsrRequest[]
  emitAsr: (event: AsrEvent) => void
} {
  const asrRequests: AsrRequest[] = []
  const mediaRequests: MediaRequest[] = []
  const diarizeRequests: DiarizeRequest[] = []
  const asrListeners: ((event: AsrEvent) => void)[] = []
  const mediaListeners: ((event: MediaEvent) => void)[] = []
  void mediaRequests
  void diarizeRequests
  return {
    engine: {
      postMedia: () => undefined,
      postAsr: (request) => {
        asrRequests.push(request)
      },
      postDiarize: () => undefined,
      onMediaEvent: (listener) => {
        mediaListeners.push(listener)
        return () => undefined
      },
      onAsrEvent: (listener) => {
        asrListeners.push(listener)
        return () => undefined
      },
      dispose: () => undefined,
    },
    asrRequests,
    emitAsr: (event) => {
      for (const listener of [...asrListeners]) listener(event)
    },
  }
}

function sampleProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj_304',
    name: 'Language plumbing project',
    schemaVersion: 1,
    asset: ASSET,
    blocks: [],
    captionOrigin: 'none',
    translations: [],
    speakers: [],
    speakerSource: 'none',
    language: null,
    modelId: null,
    style: {
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
    },
    outputAspect: 'source',
    transcription: 'none',
    updatedAt: 1_730_000_000_000,
    ...overrides,
  }
}

/** The rig: a real EditorApp (the job-output seam target) + the jobs store
 *  over the engine double. `editorApp` rides the deps through a widened
 *  variable — the FR-304.1 seam the builder must consume. */
function rig(project: Project = sampleProject()): { app: EditorApp; jobs: ReturnType<typeof createJobsStore>; emitAsr: (event: AsrEvent) => void; running: () => string | null } {
  const app = createEditorApp({
    clock: { now: () => 1_730_000_000_000 },
    rafs: { request: () => 0, cancel: () => undefined, frame: () => undefined },
    initialProject: project,
  })
  const { engine, emitAsr } = createEngineDouble()
  const deps = { engine, modelCache: { listCached: () => Promise.resolve([] as ModelId[]) }, editorApp: app }
  const jobs = createJobsStore(deps)
  return { app, jobs, emitAsr, running: () => jobs.getState().running?.jobId ?? null }
}

describe('CC-304.1: Start with an explicit Language sets project.language at Start', () => {
  test('CC-304.1: an explicit Language selection sets project.language at Start — before any job:done event', () => {
    const { app, jobs, running } = rig()
    expect(app.project.getState().project?.language, 'fresh project carries no language (US-304.1 Given)').toBeNull()

    jobs.startTranscribe({ language: 'es', modelId: CACHED_MODEL, diarize: false, mode: 'replace' })

    expect(running(), 'the transcribe job is still running — no done event was emitted').not.toBeNull()
    expect(app.project.getState().project?.language, 'the explicit choice is recorded at Start time (US-304.1 then-clause, job-output seam)').toBe('es')
  })

  test('CC-304.1: the language set rides the job-output seam — NO undo step is created (M6 ruling); a user command still creates one (positive anchor)', () => {
    const { app, jobs } = rig()
    const undoBefore = app.history.undoCount()

    jobs.startTranscribe({ language: 'fr', modelId: CACHED_MODEL, diarize: false, mode: 'replace' })

    expect(app.project.getState().project?.language, 'explicit choice recorded at Start').toBe('fr')
    expect(app.history.undoCount(), 'job output never enters the undo chain (M6/#66 ruling — applyWithoutHistory, not a command)').toBe(undoBefore)
    // Positive anchor: the undo machinery is live — a genuine user command
    // DOES step. Without it the "no undo step" assertion could pass
    // vacuously on broken history tracking.
    expect(app.dispatch('project-rename', { name: 'language-plumbing anchor rename' }), 'rename accepted').toBeNull()
    expect(app.history.undoCount(), 'a user command creates exactly one undo step').toBe(undoBefore + 1)
  })
})

describe('CC-304.2: Auto-detect stores job:done stats.language — jobId-filtered; explicit choice wins', () => {
  test('CC-304.2: Auto-detect job completion stores the detected language from job:done stats.language, as job output (no undo step)', () => {
    const { app, jobs, emitAsr } = rig()
    const undoBefore = app.history.undoCount()

    jobs.startTranscribe({ language: null, modelId: CACHED_MODEL, diarize: false, mode: 'replace' })
    const jobId = jobs.getState().running?.jobId
    expect(typeof jobId, 'the job started').toBe('string')
    expect(app.project.getState().project?.language, 'Auto-detect Start sets nothing yet (the engine has not spoken)').toBeNull()

    emitAsr({ t: 'job:progress', jobId: jobId ?? '', processedSec: 60, totalSec: 120 })
    emitAsr({ t: 'job:done', jobId: jobId ?? '', stats: { guard: { shortSpeechDropped: 1 }, language: 'en' } })

    expect(jobs.getState().running, 'the done event cleared the running job').toBeNull()
    expect(app.project.getState().project?.language, 'the detected language is stored with no further user action (US-304.1 auto-detect story)').toBe('en')
    expect(app.history.undoCount(), 'detection storage is job output — never an undo step').toBe(undoBefore)
  })

  test('CC-304.2: job:done correlation — foreign and superseded jobIds never store a language; the running job’s stats do; stats-less done invents none', () => {
    const { app, jobs, emitAsr } = rig()

    jobs.startTranscribe({ language: null, modelId: CACHED_MODEL, diarize: false, mode: 'replace' })
    const first = jobs.getState().running?.jobId as string
    expect(typeof first).toBe('string')

    // A foreign jobId (stale worker flush) must not touch the language —
    // the same jobId discipline the existing job:done handler enforces.
    emitAsr({ t: 'job:done', jobId: 'job_not_mine', stats: { language: 'de' } })
    expect(app.project.getState().project?.language, 'a foreign jobId never stores a language').toBeNull()
    expect(jobs.getState().running, 'nor does it clear the running job').not.toBeNull()

    // Displace with a second Auto-detect job; the superseded job's late done
    // (running is now the second job) is ignored exactly like a foreign id.
    jobs.startTranscribe({ language: null, modelId: CACHED_MODEL, diarize: false, mode: 'replace' })
    const second = jobs.getState().running?.jobId as string
    expect(second, 'the second start replaced the first').not.toBe(first)
    emitAsr({ t: 'job:done', jobId: first, stats: { language: 'de' } })
    expect(app.project.getState().project?.language, 'a superseded job’s late done never stores a language').toBeNull()

    // The running job's own done WITHOUT stats.language must not invent one.
    emitAsr({ t: 'job:done', jobId: second })
    expect(app.project.getState().project?.language, 'no stats.language → no language claim').toBeNull()

    // …and a fresh Auto-detect run's detection does land.
    jobs.startTranscribe({ language: null, modelId: CACHED_MODEL, diarize: false, mode: 'replace' })
    const third = jobs.getState().running?.jobId as string
    emitAsr({ t: 'job:done', jobId: third, stats: { language: 'fr' } })
    expect(app.project.getState().project?.language, 'the running job’s detection stores cleanly').toBe('fr')
  })

  test('CC-304.2: an explicit selection is never overwritten by a differing detection', () => {
    const { app, jobs, emitAsr } = rig()

    jobs.startTranscribe({ language: 'fr', modelId: CACHED_MODEL, diarize: false, mode: 'replace' })
    const jobId = jobs.getState().running?.jobId as string
    expect(app.project.getState().project?.language, 'the explicit choice was recorded at Start').toBe('fr')

    // The engine reports a DIFFERENT language (US-304.1 story 3: chose fr,
    // engine detects en) — the explicit selection wins, verbatim.
    emitAsr({ t: 'job:done', jobId, stats: { language: 'en' } })

    expect(jobs.getState().running, 'the job still completed').toBeNull()
    expect(app.project.getState().project?.language, 'explicit selection is never overwritten by detection').toBe('fr')
  })
})
