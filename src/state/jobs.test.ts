// CC-101.3 / CC-101.4 / FR-2.0.6 (L1, node): the jobs slice over an
// injected EnginePort double — capability + tierNotice state (tier chip
// source, US-2.0.3), popover model options (registry × cache), the exact
// startTranscribe request sequence (loadModel device by tier, transcribe at
// 16 kHz with the language verbatim, one diarize request on the SAME jobId
// when enabled, align vs replace), engine-event folding (progress, streaming
// segments, done/error) and cancel. The L2 half is the frozen
// tests/unit/workbench/transcribe-popover.test.tsx.
import { describe, expect, test, vi } from 'vitest'
import { createJobsStore } from './jobs'
import type { EnginePort, ModelCachePort } from './jobs'
import type { AsrEvent, AsrRequest, DiarizeRequest, MediaEvent, MediaRequest, ModelId } from '../engine/protocol'

const CACHED_MODEL: ModelId = 'whisper-base_timestamped@608c49e6'
const UNCACHED_MODEL: ModelId = 'whisper-small_timestamped@65caa70f'

function createEngineDouble(): {
  engine: EnginePort
  mediaRequests: MediaRequest[]
  asrRequests: AsrRequest[]
  diarizeRequests: DiarizeRequest[]
  emitAsr: (event: AsrEvent) => void
  emitMedia: (event: MediaEvent) => void
} {
  const mediaRequests: MediaRequest[] = []
  const asrRequests: AsrRequest[] = []
  const diarizeRequests: DiarizeRequest[] = []
  const mediaListeners: ((event: MediaEvent) => void)[] = []
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
    onMediaEvent: (listener) => {
      mediaListeners.push(listener)
      return () => {
        const index = mediaListeners.indexOf(listener)
        if (index >= 0) mediaListeners.splice(index, 1)
      }
    },
    onAsrEvent: (listener) => {
      asrListeners.push(listener)
      return () => {
        const index = asrListeners.indexOf(listener)
        if (index >= 0) asrListeners.splice(index, 1)
      }
    },
    dispose: () => {
      mediaListeners.length = 0
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
    emitMedia: (event) => {
      for (const listener of [...mediaListeners]) listener(event)
    },
  }
}

function createModelCache(cached: readonly ModelId[] = []): ModelCachePort {
  return { listCached: () => Promise.resolve([...cached]) }
}

function ofTag<T extends { t: string }>(requests: readonly T[], tag: string): T[] {
  return requests.filter((request) => request.t === tag)
}

describe('CC-101.4: capability seam — tier chip + notice state (US-2.0.3)', () => {
  test('CC-101.4: setCapability stores the snapshot and setTierNotice sets/clears the tooltip source', () => {
    const { engine } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache() })
    expect(jobs.getState().capability).toBeNull()
    jobs.setCapability({ tier: 'T4', reasons: ['NO_WASM_SIMD'] })
    expect(jobs.getState().capability).toEqual({ tier: 'T4', reasons: ['NO_WASM_SIMD'] })
    const notice = { code: 'TIER_DOWNGRADE' as const, params: { from: 'T1', to: 'T2' } }
    jobs.setTierNotice(notice)
    expect(jobs.getState().tierNotice).toEqual(notice)
    jobs.setTierNotice(null)
    expect(jobs.getState().tierNotice).toBeNull()
  })

  test('FR-2.0.6: `notice` events from either worker channel accumulate', () => {
    const { engine, emitAsr, emitMedia } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache() })
    emitAsr({ t: 'notice', notice: { code: 'TIER_DOWNGRADE' } })
    emitMedia({ t: 'notice', notice: { code: 'WORKER_RECYCLED' } })
    expect(jobs.getState().notices.map((notice) => notice.code)).toEqual(['TIER_DOWNGRADE', 'WORKER_RECYCLED'])
  })
})

describe('CC-101.3: startTranscribe dispatches the exact job payload (US-2.0.4)', () => {
  test('CC-101.3: T1 → webgpu; loadModel then transcribe at 16 kHz with the language verbatim; diarize OFF posts none', () => {
    const { engine, asrRequests, diarizeRequests } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache() })
    jobs.setCapability({ tier: 'T1', reasons: [] })
    jobs.startTranscribe({ language: 'en', modelId: UNCACHED_MODEL, diarize: false, mode: 'replace' })

    const loaded = ofTag(asrRequests, 'loadModel')[0]
    expect(loaded?.t).toBe('loadModel')
    if (loaded?.t === 'loadModel') {
      expect(loaded.model).toBe(UNCACHED_MODEL)
      expect(loaded.device, 'T1 → webgpu').toBe('webgpu')
    }
    const transcribed = ofTag(asrRequests, 'transcribe')[0]
    expect(transcribed?.t).toBe('transcribe')
    if (transcribed?.t === 'transcribe') {
      expect(transcribed.language).toBe('en')
      expect(transcribed.sampleRate).toBe(16000)
      expect(typeof transcribed.jobId).toBe('string')
    }
    expect(jobs.getState().running?.kind).toBe('transcribe')
    expect(diarizeRequests.length).toBe(0)
  })

  test('CC-101.3: T2 → wasm; diarize ON posts exactly one diarize request on the SAME jobId', () => {
    const { engine, asrRequests, diarizeRequests } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache() })
    jobs.setCapability({ tier: 'T2', reasons: [] })
    jobs.startTranscribe({ language: null, modelId: CACHED_MODEL, diarize: true, mode: 'replace' })

    const loaded = ofTag(asrRequests, 'loadModel')[0]
    if (loaded?.t === 'loadModel') expect(loaded.device, 'non-T1 → wasm').toBe('wasm')
    const transcribed = ofTag(asrRequests, 'transcribe')[0]
    expect(transcribed?.t).toBe('transcribe')
    if (transcribed?.t === 'transcribe') {
      expect(transcribed.language, 'auto-detect passes null verbatim').toBeNull()
      const diarized = diarizeRequests[0]
      expect(diarized?.t).toBe('diarize')
      if (diarized?.t === 'diarize') {
        expect(diarized.jobId, 'same job, one pcm tee').toBe(transcribed.jobId)
        expect(diarized.sampleRate).toBe(16000)
      }
      expect(diarizeRequests.length).toBe(1)
    }
  })

  test('CC-101.3: align keeps the imported track — running.kind is align and ASR still runs', () => {
    const { engine, asrRequests } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache() })
    jobs.startTranscribe({ language: 'fr', modelId: CACHED_MODEL, diarize: false, mode: 'align' })
    expect(jobs.getState().running?.kind).toBe('align')
    expect(ofTag(asrRequests, 'transcribe').length).toBe(1)
  })

  test('FR-2.0.6: cancel posts cancellations on every channel and clears the running job', () => {
    const { engine, asrRequests, mediaRequests, diarizeRequests } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache() })
    jobs.startTranscribe({ language: null, modelId: CACHED_MODEL, diarize: true, mode: 'replace' })
    const jobId = jobs.getState().running?.jobId
    expect(typeof jobId).toBe('string')
    jobs.cancel()
    expect(jobs.getState().running).toBeNull()
    expect(ofTag(asrRequests, 'cancel').some((request) => request.t === 'cancel' && request.jobId === jobId)).toBe(true)
    expect(diarizeRequests.some((request) => request.t === 'cancel' && request.jobId === jobId)).toBe(true)
    expect(mediaRequests.some((request) => request.t === 'cancel' && request.jobId === jobId)).toBe(true)
    jobs.cancel()
    expect(ofTag(asrRequests, 'cancel').length, 'cancel with no running job is a no-op').toBe(1)
  })
})

describe('FR-2.0.6: engine events fold into the jobs slice (mocked worker)', () => {
  test('FR-2.0.6: job:progress → progress; job:segments accumulate sorted by start', () => {
    const { engine, emitAsr } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache() })
    emitAsr({ t: 'job:progress', jobId: 'job-a', processedSec: 60, totalSec: 120 })
    expect(jobs.getState().progress).toEqual({ processedSec: 60, totalSec: 120 })

    emitAsr({ t: 'job:segments', jobId: 'job-a', segments: [{ start: 4, end: 5, text: 'b', words: [] }] })
    emitAsr({
      t: 'job:segments',
      jobId: 'job-a',
      segments: [
        { start: 0, end: 1, text: 'a', words: [] },
        { start: 2, end: 3, text: 'c', words: [] },
      ],
    })
    expect(jobs.getState().segments.map((segment) => segment.start)).toEqual([0, 2, 4])
  })

  test('FR-2.0.6: job:done clears only the matching running job; job:error records and clears', () => {
    const { engine, emitAsr } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache() })
    jobs.startTranscribe({ language: null, modelId: CACHED_MODEL, diarize: false, mode: 'replace' })
    const jobId = jobs.getState().running?.jobId as string

    emitAsr({ t: 'job:done', jobId: 'other-job' })
    expect(jobs.getState().running, 'a foreign jobId must not clear the running job').not.toBeNull()
    emitAsr({ t: 'job:done', jobId })
    expect(jobs.getState().running).toBeNull()

    jobs.startTranscribe({ language: null, modelId: CACHED_MODEL, diarize: false, mode: 'replace' })
    const second = jobs.getState().running?.jobId as string
    emitAsr({ t: 'job:error', jobId: second, error: { code: 'GPU_OOM', retryable: true } })
    expect(jobs.getState().error).toEqual({ code: 'GPU_OOM', retryable: true })
    expect(jobs.getState().running).toBeNull()
  })

  test('FR-2.0.6: a new start resets progress/segments/error from the previous run', () => {
    const { engine, emitAsr } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache() })
    emitAsr({ t: 'job:progress', jobId: 'job-a', processedSec: 1, totalSec: 2 })
    emitAsr({ t: 'job:segments', jobId: 'job-a', segments: [{ start: 0, end: 1, text: 'stale', words: [] }] })
    emitAsr({ t: 'job:error', jobId: 'job-a', error: { code: 'NETWORK', retryable: true } })
    jobs.startTranscribe({ language: null, modelId: CACHED_MODEL, diarize: false, mode: 'replace' })
    const state = jobs.getState()
    expect(state.progress).toBeNull()
    expect(state.segments).toEqual([])
    expect(state.error).toBeNull()
  })
})

describe('CC-101.3: popover model options derive from the registry × cache (US-2.0.4)', () => {
  test('CC-101.3: modelOptions list registry models with size labels, language tags and cache-derived offlineReady', async () => {
    const { engine } = createEngineDouble()
    const jobs = createJobsStore({ engine, modelCache: createModelCache([CACHED_MODEL]) })
    await vi.waitFor(() => expect(jobs.getState().modelOptions.length, 'async cache hydrate lands options').toBeGreaterThan(0))
    const options = jobs.getState().modelOptions
    const cached = options.find((option) => option.id === CACHED_MODEL)
    const uncached = options.find((option) => option.id === UNCACHED_MODEL)
    expect(cached, 'registry model listed').toBeTruthy()
    expect(uncached, 'registry model listed').toBeTruthy()
    expect(cached?.offlineReady, 'cached → offline-ready badge source').toBe(true)
    expect(uncached?.offlineReady).toBe(false)
    expect(cached?.sizeLabel, 'human size label from registry approxBytes').toMatch(/\d+(\.\d+)? (B|MB|GB)/)
    expect(Array.isArray(cached?.languages)).toBe(true)
  })
})
