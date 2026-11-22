// Adversary suite (unit-05 review): the real `src/workers/asr.worker.ts`
// glue behind vi-mocked SDK adapters. FR-05.5 (protocol.ts): "`transcribe`
// accepts both `PcmSource` kinds" — a `{kind:'transfer', buffer}` and a
// `{kind:'stream', port}` carrying the SAME media (the stream deliberately
// out of order, to exercise readPcmSource's sort) must produce identical
// `vad:segments`, identical per-window engine calls (audio included), and an
// identical event stream. Model load / VAD / engine all arrive through the
// DI seams; no SDK or network is touched.
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AsrEvent, AsrRequest, PcmChunk, PcmSource, RawSegment } from '@engine/protocol'

const SAMPLE_RATE = 16_000
const SECONDS = 3
const TOTAL_SAMPLES = SECONDS * SAMPLE_RATE

interface EngineCall {
  start: number
  end: number
  options: Record<string, unknown>
  audio: number[]
}

const h = vi.hoisted(() => ({ calls: [] as EngineCall[], segments: null as null | (() => RawSegment[]), presenceDelayMs: undefined as number | undefined, presenceFail: false, presenceReady: true }))

const DEFAULT_SEGMENTS = (): RawSegment[] => [{ start: 0.05, end: 0.85, text: 'hello', words: [{ text: 'hello', start: 0.05, end: 0.85, timing: 'asr' as const }] }]

vi.mock('@engine/asr/adapters/transformers-whisper', () => ({
  createWhisperEngine: () => ({
    transcribeWindow(start: number, end: number, audio: Float32Array, options: Record<string, unknown>): Promise<{ segments: RawSegment[] }> {
      h.calls.push({ start, end, options, audio: Array.from(audio) })
      return Promise.resolve({ segments: (h.segments ?? DEFAULT_SEGMENTS)() })
    },
    createSileroSession: () => Promise.resolve({}),
    dispose: () => Promise.resolve(),
  }),
}))

vi.mock('@engine/asr/adapters/silero-vad', () => ({
  createSileroScorer: () => Promise.resolve({ scoreWindow: () => 0.9 }),
  SILERO_SAME_ORIGIN_URL: '/.cache/models/silero-vad/onnx.onnx',
  SILERO_HF_URL: 'https://huggingface.co/onnx-community/silero-vad/resolve/0000000000000000000000000000000000000000/onnx.onnx',
}))

// FR-204.2 (unit-204): the worker's model-cache preflight is an external
// collaborator of the same class as the SDK adapters above — "no SDK or
// network is touched" extends to it. Offline-ready presence (the load
// proceeds straight to the DI'd engine) and an inert cache mirror the warm
// production state these equivalence tests are about; the cache's own
// verification doctrine is unit-03's suite, not this one.
vi.mock('@engine/model/adapters/browser-cache', () => ({
  createZipscribeModelCache: () => ({
    ensureOffline: () => Promise.resolve(),
    listCached: () => Promise.resolve([]),
    removeCached: () => Promise.resolve(),
    matchCached: () => Promise.resolve(undefined),
    putCached: () => Promise.resolve(),
    deleteCached: () => Promise.resolve(),
    storageEstimate: () => Promise.resolve({ usage: 0, quota: 0 }),
  }),
  modelSpecPresence: () =>
    h.presenceFail
      ? Promise.reject(new Error('presence_unavailable'))
      : h.presenceDelayMs !== undefined
        ? new Promise<boolean>((resolve) => setTimeout(() => resolve(true), h.presenceDelayMs))
        : Promise.resolve(h.presenceReady),
}))

class FakePort {
  private readonly closeListeners: (() => void)[] = []
  private readonly chunks: readonly PcmChunk[]
  onmessage: ((event: { data: PcmChunk }) => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor(chunks: readonly PcmChunk[]) {
    this.chunks = chunks
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'close') this.closeListeners.push(listener)
  }

  start(): void {
    setTimeout(() => {
      for (const chunk of this.chunks) this.onmessage?.({ data: chunk })
      for (const listener of this.closeListeners) listener()
    }, 0)
  }
}

function samples(): Float32Array {
  const data = new Float32Array(TOTAL_SAMPLES)
  for (let i = 0; i < TOTAL_SAMPLES; i++) data[i] = Math.sin(i / 97) * 0.5
  return data
}

function chunksOutOfOrder(data: Float32Array): PcmChunk[] {
  const per = (s: number): PcmChunk => ({ startSec: s, samples: data.subarray(s * SAMPLE_RATE, (s + 1) * SAMPLE_RATE) })
  return [per(2), per(0), per(1)] // shuffled delivery: readPcmSource must sort by startSec
}

async function runWorker(pcm: { kind: 'transfer'; buffer: ArrayBuffer } | { kind: 'stream'; port: FakePort }, engineSegments?: () => RawSegment[]): Promise<{ events: AsrEvent[]; calls: EngineCall[] }> {
  h.calls.length = 0
  h.segments = engineSegments ?? null
  const events: AsrEvent[] = []
  const scope: { handler: ((event: { data: AsrRequest }) => void) | null } = { handler: null }
  vi.stubGlobal('addEventListener', (type: string, listener: (event: { data: AsrRequest }) => void) => {
    if (type === 'message') scope.handler = listener
  })
  vi.stubGlobal('postMessage', (event: AsrEvent) => events.push(event))
  vi.resetModules()
  await import('../../workers/asr.worker')
  const dispatch = (request: AsrRequest): void => {
    scope.handler?.({ data: request })
  }

  dispatch({ t: 'loadModel', model: 'cactus-whistle@b358ddad', device: 'wasm' })
  await settle(() => events.some((e) => e.t === 'model:ready'))
  dispatch({ t: 'transcribe', jobId: 'j1', pcm: pcm as unknown as PcmSource, sampleRate: SAMPLE_RATE, language: 'en' })
  await settle(() => events.some((e) => e.t === 'job:done'))
  return { events, calls: [...h.calls] }
}

async function settle(done: () => boolean): Promise<void> {
  for (let i = 0; i < 2000 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 1))
  if (!done()) throw new Error('worker did not settle')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adversary: FR-05.5 "transcribe accepts both PcmSource kinds" — equivalence', () => {
  test('transfer and stream (out of order) produce identical vad:segments, engine calls and events', async () => {
    const data = samples()
    const transferBuffer = new ArrayBuffer(data.byteLength)
    new Float32Array(transferBuffer).set(data)
    const transfer = await runWorker({ kind: 'transfer', buffer: transferBuffer })
    const stream = await runWorker({ kind: 'stream', port: new FakePort(chunksOutOfOrder(data)) })

    expect(transfer.events.length).toBeGreaterThan(0)
    expect(transfer.events).toEqual(stream.events) // vad:segments, job:progress, job:segments, job:done all equal

    // Engine saw the same windows with the SAME merged audio (stream merge +
    // sort produced bit-identical PCM to the transfer buffer) and the fixed
    // greedy option set (FR-05.2/05.7).
    expect(stream.calls).toEqual(transfer.calls)
    expect(stream.calls).toHaveLength(1)
    expect(stream.calls[0]!.options).toMatchObject({ return_timestamps: 'word', language: 'en', task: 'transcribe' })

    // job:done carries numeric-only guard stats + language code (SECURITY-03).
    const done = stream.events.find((e) => e.t === 'job:done')
    expect(done).toBeDefined()
    if (done !== undefined && done.t === 'job:done') {
      const stats = (done as unknown as { stats: { guard: Record<string, number>; language?: string } }).stats
      expect(Object.values(stats.guard).every((v) => typeof v === 'number')).toBe(true)
      // Review round 1, finding 3: the relay key NAMES are part of the
      // protocol (GuardStats, protocol.ts) — the worker remaps the core's
      // shortWindowDropped/maxTokensDropped onto these exact keys, so the
      // set itself is pinned, not just "all values numeric" (a dropped key
      // previously stayed green — kill-check finding).
      expect(Object.keys(stats.guard).sort()).toEqual(['maxTokensFlagged', 'repeatedNgramDropped', 'shortSpeechDropped'])
      expect(stats.language).toBe('en')
    }
  })

  test('FR-05.9 guard relay end-to-end: a window tripping the repeated-ngram guard reaches job:done with the exact protocol key set and its segments are dropped', async () => {
    // Review round 1, finding 3: drive one guard trigger THROUGH the real
    // worker glue so the key names AND the remap (core GuardStats
    // shortWindowDropped/maxTokensDropped → protocol shortSpeechDropped/
    // maxTokensFlagged) are exercised, not just their presence. Four
    // consecutive copies of one word trip FR-05.9 trigger 1
    // (hasRepeatedNgram, transcriber.ts); the 3 s of VAD speech keeps the
    // short-speech guard (≥ 0.5 s) and maxTokens (absent) at zero.
    const data = samples()
    const transferBuffer = new ArrayBuffer(data.byteLength)
    new Float32Array(transferBuffer).set(data)
    const repeated = (): RawSegment[] => [
      {
        start: 0.05,
        end: 2.4,
        text: 'blah blah blah blah',
        words: [0, 1, 2, 3].map((i) => ({ text: 'blah', start: 0.05 + i * 0.5, end: 0.4 + i * 0.5, timing: 'asr' as const })),
      },
    ]
    const { events } = await runWorker({ kind: 'transfer', buffer: transferBuffer }, repeated)
    expect(events.some((e) => e.t === 'job:segments')).toBe(false) // guarded window dropped
    const done = events.find((e) => e.t === 'job:done')
    expect(done).toBeDefined()
    if (done !== undefined && done.t === 'job:done') {
      expect(done.stats?.guard).toEqual({ repeatedNgramDropped: 1, shortSpeechDropped: 0, maxTokensFlagged: 0 })
    }
  })

  test('transcribe before loadModel surfaces the coded MODEL_UNLOADED error (protocol Technical Specification)', async () => {
    const { events } = await runWorkerWithUnloaded()
    const err = events.find((e) => e.t === 'job:error')
    expect(err).toBeDefined()
    if (err !== undefined && err.t === 'job:error') {
      expect(err.error.code).toBe('MODEL_UNLOADED')
      expect(typeof err.error.detail).toBe('string')
    }
  })

  test('FR-204.2 (unit-204): transcribe posted back-to-back with loadModel is QUEUED through the in-flight load and runs on ready — no MODEL_UNLOADED on the real lane', async () => {
    // The jobs contract (jobs.ts Technical Specification) posts loadModel →
    // transcribe without waiting for model:ready. With the load suspended at
    // the (mocked) cache presence check, the transcribe MUST be parked and
    // replayed once the model is ready — never rejected as unloaded.
    h.presenceDelayMs = 40
    try {
      const { events } = await runWorkerBackToBack((e) => e.some((x) => x.t === 'job:done'))
      const readyAt = events.findIndex((e) => e.t === 'model:ready')
      const doneAt = events.findIndex((e) => e.t === 'job:done')
      expect(readyAt).toBeGreaterThanOrEqual(0)
      expect(doneAt).toBeGreaterThan(readyAt)
      expect(events.some((e) => e.t === 'job:error' && e.error.code === 'MODEL_UNLOADED')).toBe(false)
    } finally {
      h.presenceDelayMs = undefined
    }
  })

  test('FR-204.2 (unit-204): a load failure fails the queued transcribe with the load’s coded error (never a hang)', async () => {
    h.presenceFail = true
    try {
      const { events } = await runWorkerBackToBack((e) => e.some((x) => x.t === 'job:error'))
      expect(events.some((e) => e.t === 'model:error' && e.error.code === 'ENGINE_INTERNAL')).toBe(true)
      const err = events.find((e) => e.t === 'job:error')
      expect(err).toBeDefined()
      if (err !== undefined && err.t === 'job:error') expect(err.error.code).toBe('ENGINE_INTERNAL')
    } finally {
      h.presenceFail = false
    }
  })
  test('FR-204.2 (unit-204): the confirm gate arms only before a REAL download — a cached >100 MB model loads without confirm-required', async () => {
    const { events } = await runLoadOnly('whisper-small_timestamped@65caa70f', (evts) => evts.some((e) => e.t === 'model:ready' || e.t === 'model:error'))
    expect(events.some((e) => e.t === 'model:confirm-required')).toBe(false)
    expect(events.some((e) => e.t === 'model:ready')).toBe(true)
  })

  test('FR-204.2 (unit-204): an uncached >100 MB model arms the confirm gate before downloading', async () => {
    h.presenceReady = false
    try {
      const { events } = await runLoadOnly('whisper-small_timestamped@65caa70f', (evts) => evts.some((e) => e.t === 'model:confirm-required' || e.t === 'model:ready' || e.t === 'model:error'))
      expect(events.some((e) => e.t === 'model:confirm-required')).toBe(true)
    } finally {
      h.presenceReady = true
    }
  })
})

async function runLoadOnly(model: string, settled: (events: AsrEvent[]) => boolean): Promise<{ events: AsrEvent[] }> {
  const events: AsrEvent[] = []
  const scope: { handler: ((event: { data: AsrRequest }) => void) | null } = { handler: null }
  vi.stubGlobal('addEventListener', (type: string, listener: (event: { data: AsrRequest }) => void) => {
    if (type === 'message') scope.handler = listener
  })
  vi.stubGlobal('postMessage', (event: AsrEvent) => events.push(event))
  vi.resetModules()
  await import('../../workers/asr.worker')
  scope.handler?.({ data: { t: 'loadModel', model, device: 'wasm' } })
  await settle(() => settled(events))
  return { events }
}

async function runWorkerBackToBack(done: (events: AsrEvent[]) => boolean): Promise<{ events: AsrEvent[] }> {
  h.calls.length = 0
  h.segments = null
  const events: AsrEvent[] = []
  const scope: { handler: ((event: { data: AsrRequest }) => void) | null } = { handler: null }
  vi.stubGlobal('addEventListener', (type: string, listener: (event: { data: AsrRequest }) => void) => {
    if (type === 'message') scope.handler = listener
  })
  vi.stubGlobal('postMessage', (event: AsrEvent) => events.push(event))
  vi.resetModules()
  await import('../../workers/asr.worker')
  // ONE turn, jobs.ts order: loadModel immediately followed by transcribe.
  scope.handler?.({ data: { t: 'loadModel', model: 'cactus-whistle@b358ddad', device: 'wasm' } })
  scope.handler?.({ data: { t: 'transcribe', jobId: 'j1', pcm: { kind: 'transfer', buffer: new ArrayBuffer(1024) }, sampleRate: SAMPLE_RATE, language: 'en' } })
  await settle(() => done(events))
  return { events }
}

async function runWorkerWithUnloaded(): Promise<{ events: AsrEvent[] }> {
  const events: AsrEvent[] = []
  const scope: { handler: ((event: { data: AsrRequest }) => void) | null } = { handler: null }
  vi.stubGlobal('addEventListener', (type: string, listener: (event: { data: AsrRequest }) => void) => {
    if (type === 'message') scope.handler = listener
  })
  vi.stubGlobal('postMessage', (event: AsrEvent) => events.push(event))
  vi.resetModules()
  await import('../../workers/asr.worker')
  scope.handler?.({ data: { t: 'transcribe', jobId: 'j1', pcm: { kind: 'transfer', buffer: new ArrayBuffer(1024) }, sampleRate: SAMPLE_RATE, language: 'en' } })
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { events }
}
