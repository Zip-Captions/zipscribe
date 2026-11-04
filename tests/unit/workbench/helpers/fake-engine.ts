// Unit-101 test doubles (conventions § Mocks and fakes). These are TEST-SIDE
// implementations of the frozen seams in `unit101-api-contract.d.ts` — they
// never reach production. `FakeEnginePort` mirrors the scripted-envelope
// design of `src/test-support/fake-workers.ts` `FakeWorkerSession` (reused
// lineage: record requests, replay scripted events per request tag) but is
// typed over the FULL MediaEvent/AsrEvent unions (FR-2.0.6 injectable fake
// engine). Only TYPE imports cross into `@state/*` — the ambient modules have
// no runtime.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFakeKvStore } from '../../../../src/test-support/fake-storage'
import { CANARY_MARKER } from '../../../../src/test-support/redaction'
import { REPO_ROOT } from '../../../helpers/repo'
import type { AsrEvent, AsrRequest, DiarizeRequest, MediaEvent, MediaRequest, ModelId, RawSegment } from '@engine/protocol@101'
import type { MediaAsset, CaptionBlock } from '@engine/model@101'
import type { CaptionFormat, ImportReport } from '@engine/captions@101'
import type { EnginePort, ModelCachePort } from '@state/jobs'
import type { SettingsStorage } from '@state/settings'
import type { CaptionImportResult, ImportCaptionsService } from '@state/services/intake'

/** Canned probed asset (video) — the shell's Media tab / empty-state tests never decode anything. */
export const MEDIA_ASSET: MediaAsset = {
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

export const AUDIO_ASSET: MediaAsset = { ...MEDIA_ASSET, id: 'ASSET_test_audio_1', name: 'voice memo.m4a', kind: 'audio', container: 'm4a', videoCodec: null, width: 0, height: 0, fps: 0 }

/** The probe reply the fake media engine answers with (jobId back-filled per request). */
export function probedEvent(jobId: string, asset: MediaAsset = MEDIA_ASSET): MediaEvent {
  return { t: 'media:probed', jobId, asset }
}

/**
 * Scripted fake engine (FR-2.0.6). Requests are recorded per worker channel;
 * `respondToMedia`/`respondToAsr` attach per-request-tag replies (static or a
 * factory seeing the actual request, e.g. to echo its jobId). `emitMedia`/
 * `emitAsr` push events to listeners directly (streaming tests).
 */
export class FakeEnginePort implements EnginePort {
  readonly mediaRequests: MediaRequest[] = []
  readonly asrRequests: AsrRequest[] = []
  readonly diarizeRequests: DiarizeRequest[] = []
  private readonly mediaListeners: ((event: MediaEvent) => void)[] = []
  private readonly asrListeners: ((event: AsrEvent) => void)[] = []
  private readonly mediaResponders = new Map<string, (request: MediaRequest) => MediaEvent[]>()
  private readonly asrResponders = new Map<string, (request: AsrRequest) => AsrEvent[]>()

  respondToMedia(t: MediaRequest['t'], events: MediaEvent[] | ((request: MediaRequest) => MediaEvent[])): void {
    this.mediaResponders.set(t, typeof events === 'function' ? events : () => events)
  }

  respondToAsr(t: AsrRequest['t'], events: AsrEvent[] | ((request: AsrRequest) => AsrEvent[])): void {
    this.asrResponders.set(t, typeof events === 'function' ? events : () => events)
  }

  postMedia(request: MediaRequest): void {
    this.mediaRequests.push(request)
    for (const event of this.mediaResponders.get(request.t)?.(request) ?? []) this.emitMedia(event)
  }

  postAsr(request: AsrRequest): void {
    this.asrRequests.push(request)
    for (const event of this.asrResponders.get(request.t)?.(request) ?? []) this.emitAsr(event)
  }

  postDiarize(request: DiarizeRequest): void {
    this.diarizeRequests.push(request)
  }

  onMediaEvent(listener: (event: MediaEvent) => void): () => void {
    this.mediaListeners.push(listener)
    return () => {
      const index = this.mediaListeners.indexOf(listener)
      if (index >= 0) this.mediaListeners.splice(index, 1)
    }
  }

  onAsrEvent(listener: (event: AsrEvent) => void): () => void {
    this.asrListeners.push(listener)
    return () => {
      const index = this.asrListeners.indexOf(listener)
      if (index >= 0) this.asrListeners.splice(index, 1)
    }
  }

  emitMedia(event: MediaEvent): void {
    for (const listener of [...this.mediaListeners]) listener(event)
  }

  emitAsr(event: AsrEvent): void {
    for (const listener of [...this.asrListeners]) listener(event)
  }

  dispose(): void {
    this.mediaListeners.length = 0
    this.asrListeners.length = 0
  }
}

/** Fake engine wired so every `probe` answers `media:probed` with the canned asset (jobId echoed). */
export function createProbingEngine(asset: MediaAsset = MEDIA_ASSET): FakeEnginePort {
  const engine = new FakeEnginePort()
  engine.respondToMedia('probe', (request) => (request.t === 'probe' ? [probedEvent(request.jobId, asset)] : []))
  return engine
}

/** Async kv double for the unit-106 persistence seam, backed by the shared fake kv store. */
export function createFakeSettingsStorage(initial: Record<string, string> = {}): { storage: SettingsStorage; writes: { key: string; value: string }[] } {
  const kv = createFakeKvStore(initial)
  const writes: { key: string; value: string }[] = []
  const storage: SettingsStorage = {
    get: async (key) => kv.get(key) ?? null,
    set: async (key, value) => {
      kv.set(key, value)
      writes.push({ key, value })
    },
  }
  return { storage, writes }
}

export function createFakeModelCache(cached: readonly ModelId[] = []): ModelCachePort & { add(model: ModelId): void } {
  const set = new Set(cached)
  return {
    listCached: async () => [...set],
    add: (model) => {
      set.add(model)
    },
  }
}

/**
 * Canned `ImportReport` (numbers/codes only — SECURITY-03 safe to assert).
 * Real parsing lands with unit-07; the shell only renders this shape.
 */
export const CANNED_REPORT: ImportReport = {
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

/**
 * Canned imported blocks — the second block's text carries the SECURITY-03
 * canary marker: any suite rendering these through the UI must run with the
 * redaction spy (conventions § Principles 4).
 */
export const CANNED_BLOCKS: CaptionBlock[] = [
  {
    id: 'blk_import_1',
    start: 0.2,
    end: 2.4,
    text: 'hello world from the import seam',
    words: [
      { text: 'hello', start: 0.2, end: 0.9, timing: 'estimated' },
      { text: 'world', start: 1.0, end: 1.6, timing: 'estimated' },
      { text: 'from', start: 1.7, end: 1.9, timing: 'estimated' },
      { text: 'the', start: 1.95, end: 2.05, timing: 'estimated' },
      { text: 'import', start: 2.05, end: 2.25, timing: 'estimated' },
      { text: 'seam', start: 2.25, end: 2.4, timing: 'estimated' },
    ],
    speakerId: 'SPK_1',
  },
  {
    id: 'blk_import_2',
    start: 2.5,
    end: 4.8,
    text: `${CANARY_MARKER} tail block`,
    words: [
      { text: CANARY_MARKER, start: 2.5, end: 3.9, timing: 'estimated' },
      { text: 'tail', start: 4.0, end: 4.3, timing: 'estimated' },
      { text: 'block', start: 4.3, end: 4.8, timing: 'estimated' },
    ],
    speakerId: 'SPK_1',
  },
]

export const CANNED_IMPORT_RESULT: CaptionImportResult = { report: CANNED_REPORT, blocks: CANNED_BLOCKS }

/** Caption file content is OUR OWN inline string — caption PARSING is unit-07's job, never imported here. */
export const CAPTION_VTT_TEXT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.400\nhello world\n\n00:00:02.500 --> 00:00:04.800\ntail\n'

const CAPTION_EXTENSIONS: Record<string, CaptionFormat> = {
  vtt: 'vtt',
  srt: 'srt',
  sbv: 'sbv',
  ttml: 'ttml',
  xml: 'ttml',
  dfxp: 'ttml',
  ass: 'ass',
  ssa: 'ass',
  json: 'zipscribe-json',
}

/** Fake of the unit-07 `ImportCaptionsService` seam (tests never import engine/captions). */
export function createFakeImportService(result: CaptionImportResult = CANNED_IMPORT_RESULT): { service: ImportCaptionsService; importCalls: string[] } {
  const importCalls: string[] = []
  const service: ImportCaptionsService = {
    sniff: async (file) => {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
      return extension === 'json' && !file.name.endsWith('.zipscribe.json') ? null : CAPTION_EXTENSIONS[extension] ?? null
    },
    importCaptions: async (file) => {
      importCalls.push(file.name.split('.').pop()?.toLowerCase() ?? '')
      return result
    },
  }
  return { service, importCalls }
}

/** Real committed fixture bytes wrapped as a dropped File (CC-101.2 "fixture media from fixtures/"). */
export function makeMediaFile(name = 'speech-2min.mp4', type = 'video/mp4'): File {
  const bytes = readFileSync(join(REPO_ROOT, 'fixtures', name))
  return new File([new Uint8Array(bytes)], name, { type })
}

export function makeCaptionFile(name = 'vendor.vtt', text: string = CAPTION_VTT_TEXT): File {
  return new File([text], name, { type: 'text/vtt' })
}

export function makeWrongTypeFile(name = 'notes.txt'): File {
  return new File(['just notes'], name, { type: 'text/plain' })
}

/** `job:segments` batches for streaming tests (progressive transcription, design.md). */
export function makeSegments(count: number, textFor: (index: number) => string = (i) => `segment ${i}`): RawSegment[] {
  return Array.from({ length: count }, (_, index) => {
    const start = index * 2
    return { start, end: start + 1.5, text: textFor(index), words: [{ text: textFor(index), start, end: start + 1.5 }] }
  })
}
