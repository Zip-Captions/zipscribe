// unit-108 (L2, node): the stream-commit service — streamed `job:segments`
// become committed project blocks under the progress-frontier rule, flushed on
// `job:done`, held (never flushed) on `job:error`/cancel, never for align
// jobs. Over the FR-2.0.6 injectable EnginePort double (no worker, no
// network); the editor truth is the real `createEditorApp` over an injected
// zero-block project. SECURITY-03: assertions read ids/counts/codes only.
import { describe, expect, test } from 'vitest'
import { createJobsStore } from '../jobs'
import type { EnginePort, ModelCachePort } from '../jobs'
import { createTranscribeCommitService } from './transcribe-commit'
import type { TranscribeCommitService } from './transcribe-commit'
import { createEditorApp } from '../history'
import type { EditorApp } from '../history'
import type { AsrEvent, AsrRequest, DiarizeRequest, MediaRequest, ModelId, RawSegment } from '../../engine/protocol'
import type { Project } from '../../engine/model'
import type { RafDriver } from './playback/arbitrator'

const rafs: RafDriver = { request: () => 0, cancel: () => undefined, frame: () => undefined }
const MODEL: ModelId = 'whisper-base_timestamped@608c49e6'

function emptyProject(): Project {
  return {
    id: 'p108',
    name: 'unit108 seed',
    schemaVersion: 1,
    asset: {
      id: 'a108',
      name: 'a.mp4',
      kind: 'video',
      container: 'mp4',
      audioCodec: 'aac',
      videoCodec: 'avc1',
      duration: 120,
      width: 640,
      height: 360,
      fps: 30,
      fingerprint: { name: 'a.mp4', size: 1, durationMs: 120_000, sampleHashes: ['a', 'b', 'c'] },
    },
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
      fontSizePct: 4,
      textTransform: 'none',
      color: '#FFF',
      highlightColor: '#FFE45C',
      outlineColor: '#000',
      outlineWidth: 2,
      backgroundOpacity: 0,
      position: 'bottom',
      marginVPct: 8,
      alignment: 'center',
      maxLinesPerBlock: 2,
      highlightMode: 'karaoke',
      showSpeakerBar: false,
    },
    outputAspect: 'source',
    transcription: 'none',
    updatedAt: 0,
  }
}

function createEngineDouble(): {
  engine: EnginePort
  mediaRequests: MediaRequest[]
  asrRequests: AsrRequest[]
  diarizeRequests: DiarizeRequest[]
  emitAsr: (event: AsrEvent) => void
} {
  const mediaRequests: MediaRequest[] = []
  const asrRequests: AsrRequest[] = []
  const diarizeRequests: DiarizeRequest[] = []
  const asrListeners: ((event: AsrEvent) => void)[] = []
  const engine: EnginePort = {
    postMedia: (request) => {
      mediaRequests.push(request)
    },
    postAsr: (request) => {
      asrRequests.push(request)
    },
    postDiarize: (request) => {
      diarizeRequests.push(request)
    },
    onMediaEvent: () => () => undefined,
    onAsrEvent: (listener) => {
      asrListeners.push(listener)
      return () => {
        const index = asrListeners.indexOf(listener)
        if (index >= 0) asrListeners.splice(index, 1)
      }
    },
    dispose: () => {
      asrListeners.length = 0
    },
  }
  return {
    engine,
    mediaRequests,
    asrRequests,
    diarizeRequests,
    emitAsr: (event) => {
      for (const listener of [...asrListeners]) listener(event)
    },
  }
}

function createModelCache(): ModelCachePort {
  return { listCached: () => Promise.resolve([]) }
}

function segment(start: number, end: number, word: string): RawSegment {
  return { start, end, text: `${word} one`, words: [{ text: word, start, end: start + (end - start) / 2 }, { text: 'one', start: start + (end - start) / 2, end }] }
}

interface Harness {
  engine: ReturnType<typeof createEngineDouble>
  jobs: ReturnType<typeof createJobsStore>
  app: EditorApp
  commit: TranscribeCommitService
  blocks: () => Project['blocks']
  steps: () => number
  start: (mode?: 'replace' | 'align', diarize?: boolean) => string
  flush: () => Promise<void>
  dispose: () => void
}

function harness(options: { mediaSource?: () => Promise<File> } = {}): Harness {
  const double = createEngineDouble()
  const jobs = createJobsStore({ engine: double.engine, modelCache: createModelCache(), ...(options.mediaSource === undefined ? {} : { mediaSource: options.mediaSource }) })
  const app = createEditorApp({ clock: { now: () => 1_730_000_000_000 }, rafs, initialProject: emptyProject() })
  const commit = createTranscribeCommitService({ jobs, editorApp: app })
  return {
    engine: double,
    jobs,
    app,
    commit,
    blocks: () => (app.project.getState().project as Project).blocks,
  steps: () => app.history.undoCount() - 1,
    start: (mode = 'replace', diarize = false) => {
      jobs.startTranscribe({ language: 'en', modelId: MODEL, diarize, mode })
      const jobId = jobs.getState().running?.jobId
      if (jobId === null || jobId === undefined) throw new Error('job never started')
      return jobId
    },
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
    dispose: () => {
      commit.dispose()
      app.dispose()
    },
  }
}

describe('CC-108.2: progress-frontier commit — no progress means no commit (frozen FR-104.6 frontier)', () => {
  test('CC-108.2: streamed segments without any job:progress commit NOTHING (zero blocks, zero undo steps)', () => {
    const h = harness()
    try {
      const jobId = h.start()
      h.engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(10, 11, 'ahead')] })
      expect(h.blocks()).toHaveLength(0)
      expect(h.steps(), 'zero history steps without commits').toBe(0)
    } finally {
      h.dispose()
    }
  })

  test('CC-108.2: only segments with end <= processedSec commit; later ones wait for the frontier; words carry timing asr; first batch replaces the track and registers SPK_1', () => {
    const h = harness()
    try {
      const jobId = h.start()
      h.engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(0.4, 2.6, 'first'), segment(3, 5, 'second')] })
      h.engine.emitAsr({ t: 'job:progress', jobId, processedSec: 2.6, totalSec: 120 })
      const afterFirst = h.blocks()
      expect(afterFirst.map((b) => b.start), 'only the frontier segment committed').toEqual([0.4])
      expect(afterFirst[0]!.words.every((w) => w.timing === 'asr'), 'committed words are asr-timed').toBe(true)
      expect(afterFirst[0]!.speakerId).toBe('SPK_1')
      expect((h.app.project.getState().project as Project).speakers.map((s) => s.id)).toContain('SPK_1')
      h.engine.emitAsr({ t: 'job:progress', jobId, processedSec: 5.0, totalSec: 120 })
      expect(h.blocks().map((b) => b.start)).toEqual([0.4, 3])
      expect(h.steps(), 'one undo step per batch').toBe(2)
    } finally {
      h.dispose()
    }
  })

  test('CC-108.2: a replace job commits over an existing imported track by REPLACING it (first batch replace:true)', () => {
    const h = harness()
    try {
      const seeded = h.app.dispatch('captions-import', {
        blocks: [{ id: 'blk_seed', start: 0, end: 1, text: 'stale vendor', words: [{ text: 'stale', start: 0, end: 0.5 }, { text: 'vendor', start: 0.5, end: 1 }], speakerId: 'SPK_9' }],
        speakers: [{ id: 'SPK_9', label: 'Vendor', color: '#fff' }],
        replace: true,
      })
      expect(seeded).toBeNull()
      const jobId = h.start()
      h.engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(0, 2, 'fresh')] })
      h.engine.emitAsr({ t: 'job:progress', jobId, processedSec: 2, totalSec: 120 })
      expect(h.blocks().map((b) => b.id), 'the imported source track was replaced').not.toContain('blk_seed')
      expect(h.blocks()).toHaveLength(1)
    } finally {
      h.dispose()
    }
  })
})

describe('CC-108.3: job:done flushes every remaining accumulated segment', () => {
  test('CC-108.3: segments never reached by the frontier commit on done — blocks equal the accumulated segments', () => {
    const h = harness()
    try {
      const jobId = h.start()
      h.engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(0.4, 2.6, 'first'), segment(3, 5, 'second')] })
      h.engine.emitAsr({ t: 'job:progress', jobId, processedSec: 2.6, totalSec: 120 })
      h.engine.emitAsr({ t: 'job:done', jobId })
      expect(h.blocks().map((b) => [b.start, b.end])).toEqual([
        [0.4, 2.6],
        [3, 5],
      ])
      expect(h.jobs.getState().running).toBeNull()
    } finally {
      h.dispose()
    }
  })
})

describe('CC-108.4: job:error and cancel hold what was committed and never flush', () => {
  test('CC-108.4: error mid-job keeps committed blocks, commits nothing further, adds no undo step', () => {
    const h = harness()
    try {
      const jobId = h.start()
      h.engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(0.4, 2.6, 'kept'), segment(3, 5, 'never')] })
      h.engine.emitAsr({ t: 'job:progress', jobId, processedSec: 2.6, totalSec: 120 })
      const committed = h.blocks()
      expect(committed).toHaveLength(1)
      const stepsBefore = h.steps()
      h.engine.emitAsr({ t: 'job:error', jobId, error: { code: 'ENGINE_INTERNAL', retryable: false } })
      expect(h.blocks().map((b) => b.id), 'the committed block survived the error').toEqual(committed.map((b) => b.id))
      h.engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(6, 7, 'stray')] })
      h.engine.emitAsr({ t: 'job:done', jobId })
      expect(h.blocks(), 'post-error segments and a stray done never commit').toHaveLength(1)
      expect(h.steps(), 'error and stray events add no history step').toBe(stepsBefore)
    } finally {
      h.dispose()
    }
  })

  test('CC-108.4: cancel holds the committed blocks; late worker events after cancel never commit', () => {
    const h = harness()
    try {
      const jobId = h.start()
      h.engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(0.4, 2.6, 'kept')] })
      h.engine.emitAsr({ t: 'job:progress', jobId, processedSec: 2.6, totalSec: 120 })
      const stepsBefore = h.steps()
      h.jobs.cancel()
      h.engine.emitAsr({ t: 'job:done', jobId })
      expect(h.blocks()).toHaveLength(1)
      expect(h.steps()).toBe(stepsBefore)
    } finally {
      h.dispose()
    }
  })
})

describe('CC-108.5: align jobs never commit through the service', () => {
  test('CC-108.5: a kind-align job streams and completes without adding a single block', () => {
    const h = harness()
    try {
      h.app.dispatch('captions-import', {
        blocks: [{ id: 'blk_a', start: 0, end: 2, text: 'keep me', words: [{ text: 'keep', start: 0, end: 1 }, { text: 'me', start: 1, end: 2 }], speakerId: 'SPK_1' }],
        speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#4c8dff' }],
        replace: true,
      })
      const jobId = h.start('align')
      h.engine.emitAsr({ t: 'job:progress', jobId, processedSec: 60, totalSec: 120 })
      h.engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(0, 2, 'keep')] })
      h.engine.emitAsr({ t: 'job:done', jobId })
      expect(h.blocks().map((b) => b.id), 'align never appends streamed segments').toEqual(['blk_a'])
    } finally {
      h.dispose()
    }
  })
})

describe('CC-108.1: real stream plumbing — decode tee + stream PcmSource when a mediaSource is wired', () => {
  test('CC-108.1: startTranscribe posts transcribe with {kind:stream,port} and a decode with the ports tee; cancel also cancels the decode job', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.mp4', { type: 'video/mp4' })
    const h = harness({ mediaSource: () => Promise.resolve(file) })
    try {
      const jobId = h.start('replace', true)
      const requested = h.engine.asrRequests.find((r) => r.t === 'transcribe')
      expect(requested, 'transcribe posted with a stream source').toBeDefined()
      if (requested === undefined || requested.t !== 'transcribe') throw new Error('not a transcribe request')
      expect(requested.pcm.kind).toBe('stream')
      expect(requested.pcm.kind === 'stream' && requested.pcm.port !== undefined, 'the ASR lane rides the tee port').toBe(true)
      await h.flush()
      const decode = h.engine.mediaRequests.find((r) => r.t === 'decode')
      expect(decode, 'decode posted after the blob resolved').toBeDefined()
      expect(decode!.t === 'decode' && decode!.file).toBe(file)
      expect(decode!.t === 'decode' && decode!.jobId, 'decode rides its OWN jobId').not.toBe(jobId)
      expect(decode!.t === 'decode' && decode!.ports, 'tee: asr + diarize ports').toHaveLength(2)
      h.jobs.cancel()
      const decodeJobId = (h.engine.mediaRequests.find((r) => r.t === 'decode') as { jobId: string }).jobId
      expect(h.engine.mediaRequests.some((r) => r.t === 'cancel' && r.jobId === decodeJobId), 'the decode job is cancelled too').toBe(true)
    } finally {
      h.dispose()
    }
  })

  test('CC-108.1: without the mediaSource dep the frozen placeholder sequence is byte-identical (no decode post)', () => {
    const h = harness()
    try {
      h.start()
      expect(h.engine.mediaRequests.filter((r) => r.t === 'decode')).toHaveLength(0)
      const transcribe = h.engine.asrRequests.find((r) => r.t === 'transcribe')
      expect(transcribe!.t === 'transcribe' && transcribe!.pcm.kind).toBe('transfer')
    } finally {
      h.dispose()
    }
  })
})
