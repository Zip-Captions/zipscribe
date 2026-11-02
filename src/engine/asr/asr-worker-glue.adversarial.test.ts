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

const h = vi.hoisted(() => ({ calls: [] as EngineCall[] }))

vi.mock('@engine/asr/adapters/transformers-whisper', () => ({
  createWhisperEngine: () => ({
    transcribeWindow(start: number, end: number, audio: Float32Array, options: Record<string, unknown>): Promise<{ segments: RawSegment[] }> {
      h.calls.push({ start, end, options, audio: Array.from(audio) })
      return Promise.resolve({ segments: [{ start: 0.05, end: 0.85, text: 'hello', words: [{ text: 'hello', start: 0.05, end: 0.85, timing: 'asr' as const }] }] })
    },
    createSileroSession: () => Promise.resolve({}),
    dispose: () => Promise.resolve(),
  }),
}))

vi.mock('@engine/asr/adapters/silero-vad', () => ({
  createSileroScorer: () => Promise.resolve({ scoreWindow: () => 0.9 }),
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

async function runWorker(pcm: { kind: 'transfer'; buffer: ArrayBuffer } | { kind: 'stream'; port: FakePort }): Promise<{ events: AsrEvent[]; calls: EngineCall[] }> {
  h.calls.length = 0
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
      expect(stats.language).toBe('en')
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
})

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
