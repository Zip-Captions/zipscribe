// CC-101.2 (L1, node): the intake service behind the drop zone — every dropped
// file is classified (media → probe, caption → import seam, wrong type →
// rejected with a reason CODE), media+captions in one drop attach the imported
// track to the `media:probed` reply, and the sample-clip action goes through
// the same pipeline against SAMPLE_CLIP_URL (never /fixtures/). Frozen L2
// counterpart: tests/unit/workbench/drop-zone.test.tsx.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createIntakeService, SAMPLE_CLIP_URL } from './intake'
import type { ImportCaptionsService, ImportReport, CaptionImportResult } from './intake'
import { createJobsStore } from '../jobs'
import { createProjectStore } from '../project'
import type { EnginePort, ModelCachePort } from '../jobs'
import type { AsrEvent, MediaEvent, MediaRequest } from '../../engine/protocol'
import type { MediaAsset } from '../../engine/model'

const ASSET: MediaAsset = {
  id: 'ASSET_test_video_1',
  name: 'speech-2min.mp4',
  kind: 'video',
  container: 'mp4',
  audioCodec: 'aac',
  videoCodec: 'avc1',
  duration: 121.44,
  width: 1280,
  height: 720,
  fps: 25,
  fingerprint: { name: 'speech-2min.mp4', size: 2_000_000, durationMs: 121_440, sampleHashes: ['h1', 'h2', 'h3'] },
}

const REPORT: ImportReport = {
  format: 'vtt',
  encoding: 'utf-8',
  cues: 42,
  blocks: 40,
  detectedLanguage: 'en',
  adjustments: [
    { code: 'OVERLAP_CLAMPED', count: 3 },
    { code: 'EMPTY_CUE_DROPPED', count: 2 },
  ],
}

const CANNED_IMPORT: CaptionImportResult = {
  report: REPORT,
  blocks: [
    {
      id: 'blk_import_1',
      start: 0.2,
      end: 2.4,
      text: 'hello world',
      words: [
        { text: 'hello', start: 0.2, end: 1.2, timing: 'estimated' },
        { text: 'world', start: 1.3, end: 2.4, timing: 'estimated' },
      ],
      speakerId: 'SPK_1',
    },
    {
      id: 'blk_import_2',
      start: 2.5,
      end: 4.8,
      text: 'tail block',
      words: [
        { text: 'tail', start: 2.5, end: 3.4, timing: 'estimated' },
        { text: 'block', start: 3.5, end: 4.8, timing: 'estimated' },
      ],
      speakerId: 'SPK_1',
    },
  ],
}

function createEngineDouble(): { engine: EnginePort; mediaRequests: MediaRequest[] } {
  const mediaRequests: MediaRequest[] = []
  const mediaListeners: ((event: MediaEvent) => void)[] = []
  const engine: EnginePort = {
    postMedia: (request) => {
      mediaRequests.push(request)
      // The probe fake answers synchronously, like tests/unit/workbench/helpers/fake-engine.
      if (request.t === 'probe') {
        const event: MediaEvent = { t: 'media:probed', jobId: request.jobId, asset: ASSET }
        for (const listener of [...mediaListeners]) listener(event)
      }
    },
    postAsr: () => undefined,
    postDiarize: () => undefined,
    onMediaEvent: (listener) => {
      mediaListeners.push(listener)
      return () => {
        const index = mediaListeners.indexOf(listener)
        if (index >= 0) mediaListeners.splice(index, 1)
      }
    },
    onAsrEvent: (_listener: (event: AsrEvent) => void) => () => undefined,
    dispose: () => {
      mediaListeners.length = 0
    },
  }
  return { engine, mediaRequests }
}

function createImportDouble(): { service: ImportCaptionsService; importCalls: string[] } {
  const importCalls: string[] = []
  const service: ImportCaptionsService = {
    // Content sniff + extension (contract § ImportCaptionsService.sniff).
    sniff: (file) => file.text().then((text) => (file.name.toLowerCase().endsWith('.vtt') && text.startsWith('WEBVTT') ? 'vtt' : null)),
    importCaptions: (file) => {
      importCalls.push(file.name.split('.').pop()?.toLowerCase() ?? '')
      return Promise.resolve(CANNED_IMPORT)
    },
  }
  return { service, importCalls }
}

function createWiring() {
  const { engine, mediaRequests } = createEngineDouble()
  const modelCache: ModelCachePort = { listCached: () => Promise.resolve([]) }
  const jobs = createJobsStore({ engine, modelCache })
  const project = createProjectStore({ clock: { now: () => 1_730_000_000_000 } })
  const { service, importCalls } = createImportDouble()
  const intake = createIntakeService({ engine, jobs, project, importService: service })
  return { engine, mediaRequests, project, intake, importCalls }
}

function mediaFile(name = 'speech-2min.mp4'): File {
  return new File([new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])], name, { type: 'video/mp4' })
}

function captionFile(name = 'vendor.vtt'): File {
  return new File(['WEBVTT\n\n00:00:00.000 --> 00:00:02.400\nhello world\n'], name, { type: 'text/vtt' })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CC-101.2: intake classification and the probe pipeline', () => {
  test('CC-101.2: a dropped media file posts a probe and the probe reply creates the project (captionOrigin none)', async () => {
    const { mediaRequests, project, intake } = createWiring()
    const outcome = await intake.handleFiles([mediaFile()])
    expect(outcome.mediaPosted).toBe(1)
    expect(
      mediaRequests.some((request) => request.t === 'probe' && request.file.name === 'speech-2min.mp4'),
      'the dropped file reaches the media worker as a probe',
    ).toBe(true)
    expect(project.getState().project?.asset.id).toBe(ASSET.id)
    expect(project.getState().project?.captionOrigin).toBe('none')
    expect(outcome.rejected).toEqual([])
  })

  test('CC-101.2: media + caption in one drop creates the imported source track through the unit-07 seam', async () => {
    const { project, intake, importCalls } = createWiring()
    const outcome = await intake.handleFiles([mediaFile(), captionFile()])
    expect(importCalls).toEqual(['vtt'])
    expect(outcome.importedCaptions.length).toBe(1)
    expect(outcome.importedCaptions[0]?.report.cues, 'the import report flows to the UI for display').toBe(42)
    const created = project.getState().project
    expect(created?.blocks.length).toBe(CANNED_IMPORT.blocks.length)
    expect(created?.captionOrigin).toBe('imported')
    expect(created?.transcription).toBe('none')
  })

  test('CC-101.2: wrong types are rejected with a reason CODE and never reach the media worker', async () => {
    const { mediaRequests, project, intake } = createWiring()
    const outcome = await intake.handleFiles([new File(['just notes'], 'notes.txt', { type: 'text/plain' })])
    expect(outcome.rejected).toEqual([{ reason: 'UNSUPPORTED_TYPE' }])
    expect(mediaRequests.length, 'a rejected file never reaches the media worker').toBe(0)
    expect(project.getState().project, 'no silent project creation').toBeNull()
  })

  test('CC-101.2: a caption-extension file the sniff rejects reports UNSUPPORTED_CAPTION (no silent drops)', async () => {
    const { intake } = createWiring()
    const outcome = await intake.handleFiles([new File(['not a caption'], 'garbage.vtt', { type: 'text/vtt' })])
    expect(outcome.rejected).toEqual([{ reason: 'UNSUPPORTED_CAPTION' }])
  })

  test('CC-101.2: captions alone import without a probe, and their queue does not leak into a later drop', async () => {
    const { mediaRequests, project, intake } = createWiring()
    const captionOnly = await intake.handleFiles([captionFile()])
    expect(captionOnly.importedCaptions.length).toBe(1)
    expect(mediaRequests.length, 'captions alone post no media probe').toBe(0)
    expect(project.getState().project).toBeNull()

    await intake.handleFiles([mediaFile()])
    expect(project.getState().project?.captionOrigin, 'the later media-only drop is clean').toBe('none')
  })

  test('CC-101.2: loadSample fetches SAMPLE_CLIP_URL (never /fixtures/) and runs the same intake', async () => {
    const sampleBytes = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const fetchSpy = vi.fn((_input: URL | RequestInfo) => Promise.resolve(new Response(sampleBytes, { status: 200 })))
    vi.stubGlobal('fetch', fetchSpy)
    const { mediaRequests, project, intake } = createWiring()

    await intake.loadSample()
    const urls = fetchSpy.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''))
    expect(
      urls.some((url) => url.includes(SAMPLE_CLIP_URL)),
      `the sample comes from the app-served ${SAMPLE_CLIP_URL}`,
    ).toBe(true)
    expect(
      urls.some((url) => url.includes('/fixtures/')),
      'fixtures/ is never served',
    ).toBe(false)
    expect(
      mediaRequests.some((request) => request.t === 'probe' && request.file.name === 'speech-2min.mp4'),
      'the fetched sample runs through the same intake as a drop',
    ).toBe(true)
    expect(project.getState().project).not.toBeNull()
  })
})
