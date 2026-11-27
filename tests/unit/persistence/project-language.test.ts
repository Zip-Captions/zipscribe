// CC-304.3 (L1, node + fake-indexeddb): `project.language` rides project
// persistence (unit-304, #51). The value is recorded through the SAME
// production seam the language plumbing uses — the injected editor-app on
// `createJobsStore` (FR-304.1) driven by a Start-time explicit Language —
// then the persistence service serializes to IndexedDB and a SECOND service
// over the same database restores it. Asserting round-trip on a language
// produced by the plumbing (not a hand-seeded project) is what keeps this
// honest: without the plumbing there is no language to restore, so the suite
// is RED at the save step today (nothing dirties the row — `not-dirty`).
//
// Placement follows the established tests-tree doctrine for persistence
// suites (tests/unit/persistence/persistence.test.ts header): the fake-IDB
// rig lives in tests/unit/editor/helpers/fake-persistence.ts.
//
// SECURITY-03: only the language tag and row counts cross assertions.
import { describe, expect, test } from 'vitest'
import { createEditorApp } from '@state/history'
import { createJobsStore } from '@state/jobs'
import { createPersistenceService } from '@state/services/persistence'
import type { ModelId } from '@engine/protocol'
import type { MediaAsset, Project } from '@engine/model'
import { createFakePersistenceDeps } from '../editor/helpers/fake-persistence'

const MODEL: ModelId = 'whisper-base_timestamped@608c49e6'

const ASSET: MediaAsset = {
  id: 'ASSET_304_P',
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

function sampleProject(): Project {
  return {
    id: 'proj_304_roundtrip',
    name: 'Language round-trip',
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
  }
}

function inertEngine(): import('@state/jobs').EnginePort {
  return {
    postMedia: () => undefined,
    postAsr: () => undefined,
    postDiarize: () => undefined,
    onMediaEvent: () => () => undefined,
    onAsrEvent: () => () => undefined,
    dispose: () => undefined,
  }
}

describe('CC-304.3: project.language survives the persistence round-trip', () => {
  test('CC-304.3: language recorded by the Start-time plumbing → serialize → IndexedDB → restore carries the same value', async () => {
    const bundle = createFakePersistenceDeps()
    const service = createPersistenceService(bundle.deps)
    await service.open()

    const app = createEditorApp({
      clock: { now: () => 1_730_000_000_000 },
      rafs: { request: () => 0, cancel: () => undefined, frame: () => undefined },
      initialProject: sampleProject(),
    })
    service.attachEditor(app)

    const deps = { engine: inertEngine(), modelCache: { listCached: () => Promise.resolve([] as ModelId[]) }, editorApp: app }
    const jobs = createJobsStore(deps)
    jobs.startTranscribe({ language: 'es', modelId: MODEL, diarize: false, mode: 'replace' })

    // The plumbing must dirty the row: a clean save here means no language
    // ever reached the project (the #51 false-signal, asserted at the seam).
    const outcome = await service.saveNow('manual')
    expect(outcome, 'the recorded language is pending work — the manual flush must write the row').toBe('saved')

    const rows = await service.listProjects()
    expect(rows.length, 'exactly one project row persisted').toBe(1)
    const rowId = rows[0]?.id
    expect(typeof rowId, 'the row has an id').toBe('string')

    // Restore through a SECOND service over the same database (raw twin,
    // bypassing the put interceptor — the persistence.test.ts survivor
    // pattern): the language rides serialize → IDB → parse.
    const survivor = createPersistenceService({ ...bundle.deps, indexedDB: bundle.instrument.raw })
    await survivor.open()
    const loaded = await survivor.openProject(rowId ?? '')
    expect(loaded, 'the row restores').not.toBeNull()
    expect(loaded?.project.language, 'CC-304.3: the language survived the persistence round-trip').toBe('es')
  })
})
