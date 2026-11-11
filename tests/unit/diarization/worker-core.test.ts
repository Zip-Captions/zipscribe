// CC-06.5 CC-06.1 (L1): the worker-side logic behind the `DiarizeRequest`
// union (src/engine/protocol.ts verbatim) — loadModels → model:ready;
// diarize → segment-batch job:progress + diar:frames + job:done; cooperative
// cancel; unload; DIAR_SESSION_LOST; maxSpeakers passthrough (FR-06.1);
// frames content-free (FR-06.7 / SECURITY-03 — canary + redaction spy).
// Sessions arrive through constructor/factory DI (architecture invariant 2) —
// the scriptable segmentation/embedding fakes below are the ONLY doubles:
// the clustering/assign math under the frames is the real unit-06 code
// (also unmerged → the dynamic-import RED, sanctioned unit-05 precedent;
// frozen shapes in ./unit06-api-contract.d.ts).
//
// Gates-child run: skipped under ZIPSCRIBE_CHILD=1 (gates.test.ts:31 precedent).
import { MessageChannel } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CANARY_MARKER, containsCanary, createRedactionSpy, scanError, type RedactionSpy } from '../../../src/test-support/redaction'
import { isChildRun } from '../../helpers/repo'
import type { DiarizeEvent, DiarizeRequest, PcmChunk, VadSegment } from '@engine/protocol@06'
import type { DiarizeEmbeddingSession, DiarizeSegmentationSession, DiarizeWorkerCore, SegmentationRun } from '@engine/diarize/worker-core'

const gated = isChildRun() ? describe.skip : describe

const SR = 16_000
const FRAME_SEC = 512 / SR

type CoreModule = typeof import('@engine/diarize/worker-core')

async function loadCore(): Promise<CoreModule> {
  return (await import('@engine/diarize/worker-core')) as CoreModule
}

interface FakeOptions {
  /** segment() rejects with this error (DIAR_SESSION_LOST path). */
  segmentError?: Error
  /** embed() rejects with this error. */
  embedError?: Error
  /** segment() never resolves from the nth call on (cooperative-cancel probe). */
  hangFromCall?: number
}

interface Fakes {
  seg: DiarizeSegmentationSession & { segmentCalls: number[]; segDisposals: number }
  emb: DiarizeEmbeddingSession & { embedCalls: number[]; embDisposals: number }
}

function makeFakes(opts: FakeOptions = {}): Fakes {
  const seg = {
    modelId: 'pyannote-segmentation-3-0@fixture',
    device: 'wasm' as const,
    segmentCalls: [] as number[],
    segDisposals: 0,
    segment(samples: Float32Array, startSec: number): Promise<SegmentationRun[]> {
      seg.segmentCalls.push(startSec)
      if (opts.segmentError) return Promise.reject(opts.segmentError)
      if (opts.hangFromCall !== undefined && seg.segmentCalls.length >= opts.hangFromCall) {
        return new Promise<SegmentationRun[]>(() => {
          /* never settles — cooperative cancel must not hang on it */
        })
      }
      return Promise.resolve([{ start: startSec, end: startSec + samples.length / SR, speaker: 0, prob: 0.9 }])
    },
    dispose(): void {
      seg.segDisposals += 1
    },
  }
  const emb = {
    modelId: 'eres2net-base-3dspeaker@fixture',
    device: 'wasm' as const,
    embedCalls: [] as number[],
    embDisposals: 0,
    embed(samples: Float32Array): Promise<Float32Array> {
      emb.embedCalls.push(samples.length)
      if (opts.embedError) return Promise.reject(opts.embedError)
      // Segment-tag trick: pcm builders stamp segment index into samples[0];
      // distinct tags → well-separated unit embeddings → k clusters (real
      // clustering module decides; the core must pass maxSpeakers through).
      const tag = Math.max(0, Math.round((samples[0] ?? 0) * 10) - 1)
      const v = new Float32Array(8)
      v[tag % 8] = 1
      return Promise.resolve(v)
    },
    dispose(): void {
      emb.embDisposals += 1
    },
  }
  return { seg, emb }
}

function pcmWith(segments: VadSegment[]): ArrayBuffer {
  const total = Math.ceil(Math.max(...segments.map((s) => s.end)) * SR)
  const view = new Float32Array(total)
  segments.forEach((s, i) => {
    const a = Math.floor(s.start * SR)
    const b = Math.min(total, Math.ceil(s.end * SR))
    view[a] = (i + 1) / 10
    for (let k = a + 1; k < b; k++) view[k] = 0.05
  })
  return view.buffer
}

function segs(count: number, width = 1): VadSegment[] {
  return Array.from({ length: count }, (_, i) => ({ start: i * width, end: i * width + width }))
}

interface Harness {
  core: DiarizeWorkerCore
  events: DiarizeEvent[]
  fakes: Fakes
}

async function harness(opts: FakeOptions = {}, withSpeechScore = false): Promise<Harness> {
  const mod = await loadCore()
  const fakes = makeFakes(opts)
  const events: DiarizeEvent[] = []
  const core = mod.createDiarizeWorkerCore({
    createSegmentationSession: () => fakes.seg,
    createEmbeddingSession: () => fakes.emb,
    ...(withSpeechScore ? { speechScore: (frame: Float32Array) => (frame.length > 0 ? 1 : 0) } : {}),
  })
  core.onEvent((event) => events.push(event))
  return { core, events, fakes }
}

function terminal(events: DiarizeEvent[]): DiarizeEvent | undefined {
  return [...events].reverse().find((e) => e.t === 'job:done' || e.t === 'job:error')
}

function frameEvents(events: DiarizeEvent[]): Extract<DiarizeEvent, { t: 'diar:frames' }>[] {
  return events.filter((e): e is Extract<DiarizeEvent, { t: 'diar:frames' }> => e.t === 'diar:frames')
}

function request(overrides: Partial<Extract<DiarizeRequest, { t: 'diarize' }>> & { jobId?: string } = {}): Extract<DiarizeRequest, { t: 'diarize' }> {
  return { t: 'diarize', jobId: overrides.jobId ?? 'job-diar-1', pcm: { kind: 'transfer', buffer: new ArrayBuffer(0) }, sampleRate: 16_000, ...overrides }
}

function gatedSuite(name: string, body: () => void): void {
  gated(name, () => {
    let localSpy: RedactionSpy | undefined
    beforeEach(() => {
      if (!isChildRun()) localSpy = createRedactionSpy()
    })
    afterEach(() => {
      const verdict = localSpy?.settle()
      localSpy?.restore()
      expect(verdict?.clean ?? true, 'the core never writes console output (SECURITY-03)').toBe(true)
    })
    body()
  })
}

gatedSuite('CC-06.6: FR-06.6 worker-core — load / unload lifecycle', () => {
  test('CC-06.5 CC-06.1: loadModels emits model:ready once per injected session', async () => {
    const { core, events, fakes } = await harness()
    await core.post({ t: 'loadModels' })
    const ready = events.filter((e) => e.t === 'model:ready')
    expect(ready, 'one model:ready per session (segmentation + embeddings)').toHaveLength(2)
    const ids = new Set(ready.map((e) => (e.t === 'model:ready' ? e.model : '')))
    expect(ids.has(fakes.seg.modelId) && ids.has(fakes.emb.modelId), 'session modelIds are echoed').toBe(true)
    for (const e of ready) {
      if (e.t === 'model:ready') expect(e.device, 'sessions report their own device (adapters supply wasm for segmentation)').toMatch(/^(webgpu|wasm)$/)
    }
  })

  test('CC-06.5: diarize before loadModels is a MODEL_UNLOADED job:error; unload disposes and re-arms it', async () => {
    const { core, events, fakes } = await harness()
    await core.post(request({ jobId: 'job-early', pcm: { kind: 'transfer', buffer: pcmWith(segs(1)) }, vad: segs(1) }))
    const early = terminal(events)
    expect(early?.t, 'no session → coded terminal failure').toBe('job:error')
    expect((early as Extract<DiarizeEvent, { t: 'job:error' }>).error.code).toBe('MODEL_UNLOADED')

    await core.post({ t: 'loadModels' })
    await core.post({ t: 'unload' })
    expect(fakes.seg.segDisposals, 'unload disposes the segmentation session').toBeGreaterThanOrEqual(1)
    expect(fakes.emb.embDisposals, 'unload disposes the embedding session').toBeGreaterThanOrEqual(1)
    events.length = 0
    await core.post(request({ jobId: 'job-after-unload', pcm: { kind: 'transfer', buffer: pcmWith(segs(1)) }, vad: segs(1) }))
    expect((terminal(events) as Extract<DiarizeEvent, { t: 'job:error' }>).error.code, 'after unload the taxonomy says MODEL_UNLOADED').toBe('MODEL_UNLOADED')
  })
})

gatedSuite('CC-06.1 CC-06.6: FR-06.6 worker-core — diarize job event sequence', () => {
  test('CC-06.1: progress batches → exactly one diar:frames → job:done, frames structurally valid', async () => {
    const { core, events } = await harness()
    await core.post({ t: 'loadModels' })
    events.length = 0
    await core.post(request({ pcm: { kind: 'transfer', buffer: pcmWith(segs(3)) }, vad: segs(3) }))
    const progress = events.filter((e) => e.t === 'job:progress')
    expect(progress.length, 'job:progress per segment batch (FR-06.6)').toBeGreaterThanOrEqual(1)
    let last = -1
    for (const e of progress) {
      if (e.t !== 'job:progress') continue
      expect(e.processedSec, 'processedSec monotonic').toBeGreaterThanOrEqual(last)
      last = e.processedSec
      expect(e.processedSec, 'processedSec ≤ totalSec').toBeLessThanOrEqual(e.totalSec)
      expect(e.totalSec, 'totalSec spans the forwarded vad (3 s)').toBeGreaterThanOrEqual(2.9)
    }
    const frames = frameEvents(events)
    expect(frames, 'exactly one diar:frames').toHaveLength(1)
    const done = terminal(events)
    expect(done?.t, 'job:done is the terminal event').toBe('job:done')
    expect(events.indexOf(frames[0]!), 'frames precede the terminal event').toBeLessThan(events.indexOf(done!))
    const payload = frames[0]!.frames.frames
    expect(payload.length, 'three tagged segments produce frames').toBeGreaterThan(0)
    for (const f of payload) {
      expect(f.start, 'start < end').toBeLessThan(f.end)
      expect(Number.isInteger(f.speaker), `speaker ${f.speaker} is an integer cluster id`).toBe(true)
      expect(f.speaker).toBeGreaterThanOrEqual(0)
      expect(f.speaker).toBeLessThan(frames[0]!.frames.speakers)
      expect(f.prob, 'prob in [0,1]').toBeGreaterThanOrEqual(0)
      expect(f.prob).toBeLessThanOrEqual(1)
    }
    expect(payload.map((f) => f.start), 'frames sorted by start').toEqual([...payload.map((f) => f.start)].sort((a, b) => a - b))
  })

  test('CC-06.1: job:done stats are numeric-only and content-free (SECURITY-03, FR-06.7)', async () => {
    const { core, events } = await harness()
    await core.post({ t: 'loadModels' })
    events.length = 0
    await core.post(request({ pcm: { kind: 'transfer', buffer: pcmWith(segs(2)) }, vad: segs(2) }))
    const done = terminal(events)
    expect(done?.t).toBe('job:done')
    if (done?.t === 'job:done' && done.stats !== undefined) {
      expect(containsCanary(done.stats), 'stats never carry content').toBe(false)
      for (const value of Object.values(done.stats)) {
        expect(['number', 'string', 'object'], 'stats leaves are codes/numbers').toContain(typeof value)
      }
    }
    const frames = frameEvents(events)[0]!
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, `${path}.${k}`)
        return
      }
      expect(typeof value, `frames are content-free (FR-06.7): ${path} is a ${typeof value}`).toBe('number')
    }
    walk(frames, 'diar:frames')
  })

  test('CC-06.1 CC-06.2: maxSpeakers passes through to clustering; default cap is 6 (FR-06.1)', async () => {
    const capped = await harness()
    await capped.core.post({ t: 'loadModels' })
    capped.events.length = 0
    await capped.core.post(request({ pcm: { kind: 'transfer', buffer: pcmWith(segs(5)) }, vad: segs(5), maxSpeakers: 2 }))
    const cappedFrames = frameEvents(capped.events)[0]
    expect(cappedFrames, 'capped run still completes').toBeDefined()
    expect(cappedFrames!.frames.speakers, 'speakers capped by request.maxSpeakers').toBeLessThanOrEqual(2)

    const uncapped = await harness()
    await uncapped.core.post({ t: 'loadModels' })
    uncapped.events.length = 0
    await uncapped.core.post(request({ pcm: { kind: 'transfer', buffer: pcmWith(segs(8)) }, vad: segs(8) }))
    const many = frameEvents(uncapped.events)[0]
    expect(many, '8 well-separated segments diarize').toBeDefined()
    expect(many!.frames.speakers, 'default maxSpeakers cap of 6 holds (FR-06.1)').toBeLessThanOrEqual(6)
  })

  test('CC-06.1: diarize without a vad field runs the own Silero pass (FR-06.2)', async () => {
    const { core, events } = await harness({}, true)
    await core.post({ t: 'loadModels' })
    events.length = 0
    await core.post(request({ pcm: { kind: 'transfer', buffer: pcmWith(segs(2)) } }))
    expect(terminal(events)?.t, 'own-pass run completes').toBe('job:done')
    expect(frameEvents(events).length).toBe(1)
  })

  test('CC-06.1: no speech → diar:frames {speakers:0, frames:[]} + job:done', async () => {
    const { core, events } = await harness()
    await core.post({ t: 'loadModels' })
    events.length = 0
    await core.post(request({ pcm: { kind: 'transfer', buffer: new Float32Array(SR).buffer }, vad: [] }))
    const frames = frameEvents(events)
    expect(frames).toHaveLength(1)
    expect(frames[0]!.frames.frames).toEqual([])
    expect(frames[0]!.frames.speakers).toBe(0)
    expect(terminal(events)?.t).toBe('job:done')
  })
})

gatedSuite('CC-06.6: FR-06.6 worker-core — cancel, failure taxonomy, stream source', () => {
  test('CC-06.5: cooperative cancel ends the job with a CANCELLED terminal and stops issuing session calls', async () => {
    const { core, events, fakes } = await harness({ hangFromCall: 1 })
    await core.post({ t: 'loadModels' })
    events.length = 0
    const running = core.post(request({ pcm: { kind: 'transfer', buffer: pcmWith(segs(6)) }, vad: segs(6) }))
    await vi.waitFor(() => expect(fakes.seg.segmentCalls.length).toBeGreaterThanOrEqual(1), { timeout: 5_000 })
    const callsAtCancel = fakes.seg.segmentCalls.length
    await core.post({ t: 'cancel', jobId: 'job-diar-1' })
    await running
    const last = events.at(-1)
    expect(last?.t, 'cancel produces exactly one terminal event at the end').toBe('job:error')
    if (last?.t === 'job:error') expect(last.error.code, 'the taxonomy code for cancel').toBe('CANCELLED')
    expect(fakes.seg.segmentCalls.length, 'no session calls after cancellation').toBeLessThanOrEqual(callsAtCancel + 1)
    expect(events.filter((e) => e.t === 'diar:frames'), 'no frames arrive once cancelled mid-job').toEqual([])
  })

  test('CC-06.1 CC-06.5: session failure surfaces DIAR_SESSION_LOST — code-only, never the session string (SECURITY-03)', async () => {
    const leakSpy = isChildRun() ? undefined : createRedactionSpy()
    try {
      const { core, events } = await harness({ segmentError: new Error(`${CANARY_MARKER} segmentation session exploded`) })
      await core.post({ t: 'loadModels' })
      events.length = 0
      await core.post(request({ pcm: { kind: 'transfer', buffer: pcmWith(segs(2)) }, vad: segs(2) }))
      const done = terminal(events)
      expect(done?.t).toBe('job:error')
      if (done?.t === 'job:error') {
        expect(done.error.code, 'taxonomy: DIAR_SESSION_LOST (FR-06.6)').toBe('DIAR_SESSION_LOST')
        expect(typeof done.error.retryable, 'EngineError.retryable is boolean').toBe('boolean')
        expect(containsCanary(done.error), 'EngineError (incl. detail) is content-free — SECURITY-03').toBe(false)
        expect(scanError(done.error), 'no leak in message/detail').toEqual([])
      }
      const verdict = leakSpy?.settle()
      expect(verdict?.clean ?? true, 'the core never console.* session content').toBe(true)
    } finally {
      leakSpy?.restore()
    }
  })

  test('CC-06.1: stream PcmSource consumes PcmChunk messages from the tee port (FR-06.4)', async () => {
    const { core, events } = await harness()
    await core.post({ t: 'loadModels' })
    events.length = 0
    const channel = new MessageChannel()
    const port = channel.port1 as unknown as MessagePort
    const running = core.post(request({ pcm: { kind: 'stream', port }, vad: segs(2) }))
    const pcm = new Float32Array(pcmWith(segs(2)))
    for (let s = 0; s < 2; s++) {
      const chunk: PcmChunk = { startSec: s, samples: pcm.slice(s * SR, (s + 1) * SR) }
      channel.port2.postMessage(chunk)
    }
    channel.port2.close()
    await running
    expect(terminal(events)?.t, 'the stream job completes').toBe('job:done')
    expect(frameEvents(events).length, 'frames came from the streamed pcm').toBe(1)
    channel.port1.close()
  })

  test('CC-06.6: the tee sentinel {t:job:done} drains the stream without close/messageclose (FR-06.4)', async () => {
    // Chromium never fires 'close'/'messageclose' on the worker-side tee port
    // (see PcmChunkStream, src/engine/audio/decode.ts) — the production media
    // worker posts every MediaEvent, including the terminal {t:'job:done'},
    // to every tee port, so the sentinel alone must drain the stream.
    // port2.close() is NEVER called here: only the sentinel path can settle
    // this job (removing the sentinel branch leaves it hanging → red).
    const { core, events } = await harness()
    await core.post({ t: 'loadModels' })
    events.length = 0
    const channel = new MessageChannel()
    const port = channel.port1 as unknown as MessagePort
    const running = core.post(request({ pcm: { kind: 'stream', port }, vad: segs(2) }))
    const pcm = new Float32Array(pcmWith(segs(2)))
    for (let s = 0; s < 2; s++) {
      const chunk: PcmChunk = { startSec: s, samples: pcm.slice(s * SR, (s + 1) * SR) }
      channel.port2.postMessage(chunk)
    }
    channel.port2.postMessage({ t: 'job:done' })
    await running
    expect(terminal(events)?.t, 'the sentinel settles the job — no close needed').toBe('job:done')
    expect(frameEvents(events).length, 'exactly one diar:frames precedes the terminal').toBe(1)
    channel.port2.close()
    channel.port1.close()
  })
})
