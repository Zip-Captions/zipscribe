// CC-06.1/CC-06.2/CC-06.5 (L4) browser harness for the unit-06 diarization
// suite — test-author-owned (pattern: e2e/asr/fixtures/harness.ts, which is
// never import-edited). The specs drive the REAL pipeline: the unit-04 media
// worker decodes the fixture (production `t:'decode'` tee protocol — the tee
// CC-06.5 leans on is the production one), the real `src/workers/diarize.worker.ts`
// answers the protocol.ts `DiarizeRequest` verbatim, and ASR runs through the
// shipped unit-05 `createAsrWorkerHost`. NOTHING under test is stubbed; the
// only network interception is the Playwright route in helpers/diarization.ts.
//
// RED (unit-06 not merged): `diarize.worker.ts` is the unit-01 no-op stub — it
// answers `diarize`/`cancel` with `job:done` and never emits `model:ready` or
// `diar:frames`, so `runDiarize` rejects at the model-ready gate (readable
// RED; the page still boots, engine modules load via runtime-computed dynamic
// imports).
//
// SECURITY-03: only numbers, codes, counts and lengths cross the page
// boundary — never transcript, caption or ground-truth text (specs keep the
// ground-truth file on the node side and score in-memory).
import type { DiarFrames, DiarizeEvent, DiarizeRequest, MediaEvent, MediaRequest, PcmChunk, RawSegment } from '@engine/protocol@06'

const RUN_TIMEOUT_MS = 10 * 60_000
const MODEL_READY_TIMEOUT_MS = 120_000
const WHISPER_TINY_ENGINE_FLAGS = { confidence: false, punctuation: false, languageDetect: true }

export interface DiarFrameSummary {
  start: number
  end: number
  speaker: number
  prob: number
}

export interface DiarRunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  frames: DiarFrameSummary[]
  speakers: number
  eventSummary: { t: string; code?: string; device?: string }[]
  runWallMs: number
}

export interface AsrWordSummary {
  start: number
  end: number
  /** Length only — the text itself must never cross the page boundary (SECURITY-03). */
  textLen: number
}

export interface AsrRunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  cancelled: boolean
  words: AsrWordSummary[]
  eventSummary: { t: string; code?: string }[]
}

interface HarnessGlobal {
  runDiarize(options: { fixture: string; maxSpeakers?: number }): Promise<DiarRunSummary>
  runAsr(options: { fixture: string }): Promise<AsrRunSummary>
  /** ASR and diarize in sequence (the CC-06.5 reference). */
  runSequential(options: { fixture: string }): Promise<{ diar: DiarRunSummary; asr: AsrRunSummary }>
  /** One media decode tee-ing identical chunks to the ASR buffer and the
   *  diarize stream port concurrently (the production CC-06.4 consumption). */
  runConcurrent(options: { fixture: string }): Promise<{ diar: DiarRunSummary; asr: AsrRunSummary }>
}

async function fetchFixture(fixture: string): Promise<File> {
  const response = await fetch(`/${fixture}`)
  if (!response.ok) throw new Error(`fixture fetch failed for ${fixture}: ${response.status}`)
  const blob = await response.blob()
  return new File([blob], fixture.split('/').pop() ?? 'fixture', { type: blob.type })
}

function concatChunks(chunks: PcmChunk[]): ArrayBuffer {
  const total = chunks.reduce((sum, c) => sum + c.samples.length, 0)
  const view = new Float32Array(new ArrayBuffer(total * 4))
  let at = 0
  for (const c of [...chunks].sort((a, b) => a.startSec - b.startSec)) {
    view.set(c.samples, at)
    at += c.samples.length
  }
  return view.buffer
}

/** Decode via the real media worker, tee-ing PcmChunks to every given port. */
function decodeWithPorts(file: File, ports: MessagePort[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const mediaWorker = new Worker('/src/workers/media.worker.ts', { type: 'module' })
    const settle = (fn: () => void) => {
      mediaWorker.terminate()
      fn()
    }
    mediaWorker.onmessage = (event: MessageEvent<MediaEvent>) => {
      const ev = event.data
      if (ev.t === 'job:done') settle(resolve)
      else if (ev.t === 'job:error') settle(() => reject(new Error(`media decode failed: ${ev.error.code}`)))
    }
    mediaWorker.onerror = (error) => settle(() => reject(new Error(`media worker error: ${error.message}`)))
    mediaWorker.postMessage({ t: 'decode', jobId: `diar-harness-decode-${Date.now()}`, file, ports } as MediaRequest, ports)
  })
}

async function decodeToBuffer(file: File): Promise<ArrayBuffer> {
  const channel = new MessageChannel()
  const chunks: PcmChunk[] = []
  channel.port1.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as PcmChunk
    if (data && typeof data.startSec === 'number' && data.samples instanceof Float32Array) chunks.push(data)
  }
  await decodeWithPorts(file, [channel.port2])
  channel.port1.close()
  return concatChunks(chunks)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

async function runDiarizeOn(pcm: Extract<DiarizeRequest, { t: 'diarize' }>['pcm'], maxSpeakers: number | undefined, fixtureTag: string): Promise<DiarRunSummary> {
  const started = Date.now()
  const worker = new Worker('/src/workers/diarize.worker.ts', { type: 'module' })
  const events: DiarizeEvent[] = []
  let frames: DiarFrames = { speakers: 0, frames: [] }
  let terminal: Extract<DiarizeEvent, { t: 'job:done' } | { t: 'job:error' }> | undefined
  const workerError = new Promise<never>((_, reject) => {
    worker.onerror = (error) => reject(new Error(`diarize worker error: ${error.message}`))
  })
  const listener = (event: MessageEvent<DiarizeEvent>) => {
    const ev = event.data
    events.push(ev)
    if (ev.t === 'diar:frames') frames = { speakers: ev.frames.speakers, frames: ev.frames.frames.map((f) => ({ start: f.start, end: f.end, speaker: f.speaker, prob: f.prob })) }
  }
  worker.addEventListener('message', listener)
  try {
    worker.postMessage({ t: 'loadModels' } satisfies DiarizeRequest)
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const check = (): void => {
          if (events.filter((e) => e.t === 'model:ready').length >= 2) resolve()
          const modelError = events.find((e): e is Extract<DiarizeEvent, { t: 'model:error' }> => e.t === 'model:error')
          if (modelError !== undefined) {
            reject(new Error(`model:error ${modelError.error.code}`))
            return
          }
          const jobError = events.find((e): e is Extract<DiarizeEvent, { t: 'job:error' }> => e.t === 'job:error')
          if (jobError !== undefined) reject(new Error(`job:error before models ready (${jobError.error.code})`))
        }
        const interval = setInterval(() => {
          try {
            check()
          } catch (error) {
            clearInterval(interval)
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        }, 25)
        setTimeout(() => {
          clearInterval(interval)
          reject(new Error(`no model:ready pair from diarize.worker within ${MODEL_READY_TIMEOUT_MS} ms (is the protocol stub still in place?)`))
        }, MODEL_READY_TIMEOUT_MS)
      }),
      MODEL_READY_TIMEOUT_MS + 5_000,
      'model:ready',
    )
    const jobId = `diar-${fixtureTag}-${Math.random().toString(36).slice(2)}`
    worker.postMessage({ t: 'diarize', jobId, pcm, sampleRate: 16_000, ...(maxSpeakers === undefined ? {} : { maxSpeakers }) } satisfies DiarizeRequest)
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const poll = setInterval(() => {
          const t = events.find((e): e is Extract<DiarizeEvent, { t: 'job:done' } | { t: 'job:error' }> => e.t === 'job:done' || e.t === 'job:error')
          if (t !== undefined) {
            clearInterval(poll)
            terminal = t
            if (t.t === 'job:error') reject(new Error(`job:error ${t.error.code}`))
            else resolve()
          }
        }, 25)
      }),
      RUN_TIMEOUT_MS,
      'diarize job',
    )
  } finally {
    worker.removeEventListener('message', listener)
    worker.terminate()
  }
  return {
    ok: terminal?.t === 'job:done',
    ...(terminal?.t === 'job:error' ? { error: { code: terminal.error.code, retryable: terminal.error.retryable } } : {}),
    frames: frames.frames,
    speakers: frames.speakers,
    eventSummary: events.map((e) => ({ t: e.t, ...(e.t === 'job:error' ? { code: e.error.code } : {}), ...(e.t === 'model:ready' ? { device: e.device } : {}) })),
    runWallMs: Date.now() - started,
  }
}

async function runDiarize(options: { fixture: string; maxSpeakers?: number }): Promise<DiarRunSummary> {
  const file = await fetchFixture(options.fixture)
  const buffer = await decodeToBuffer(file)
  return runDiarizeOn({ kind: 'transfer', buffer }, options.maxSpeakers, 'solo')
}

async function runAsrOnBuffer(buffer: ArrayBuffer): Promise<AsrRunSummary> {
  const workerHostUrl = new URL('../../../src/engine/asr/worker-host.ts', import.meta.url).href
  const { createAsrWorkerHost } = (await import(/* @vite-ignore */ workerHostUrl)) as typeof import('@engine/asr/worker-host')
  const events: { t: string; error?: { code: string } }[] = []
  const host = createAsrWorkerHost({
    createWorker: () => {
      const worker = new Worker('/src/workers/asr.worker.ts', { type: 'module' })
      return {
        postMessage: (message: unknown, transfer?: Transferable[]) => worker.postMessage(message, transfer ? { transfer } : undefined),
        onMessage: (listener: (event: unknown) => void) => {
          const handler = (event: MessageEvent) => listener(event.data)
          worker.addEventListener('message', handler)
          return () => worker.removeEventListener('message', handler)
        },
        terminate: () => worker.terminate(),
      }
    },
    tiers: { T1: { modelId: 'whisper-tiny-timestamped', device: 'wasm' }, T2: { modelId: 'whisper-tiny-timestamped', device: 'wasm' } },
    initialTier: 'T2',
    onEvent: (event) => events.push(event as unknown as { t: string; error?: { code: string } }),
  })
  const result = await withTimeout(
    host.transcribe({ jobId: `asr-${Math.random().toString(36).slice(2)}`, pcm: { kind: 'transfer', buffer: buffer.slice(0) }, sampleRate: 16_000, language: 'en', engineFlags: WHISPER_TINY_ENGINE_FLAGS }),
    RUN_TIMEOUT_MS,
    'asr job',
  )
  host.dispose()
  const segments: RawSegment[] = result.segments
  return {
    ok: !result.error && !result.cancelled,
    ...(result.error ? { error: result.error } : {}),
    cancelled: result.cancelled,
    words: segments.flatMap((s) => s.words).map((w) => ({ start: w.start, end: w.end, textLen: w.text.length })),
    eventSummary: events.map((e) => ({ t: e.t, ...(e.error !== undefined ? { code: e.error.code } : {}) })),
  }
}

async function runAsr(options: { fixture: string }): Promise<AsrRunSummary> {
  const file = await fetchFixture(options.fixture)
  const buffer = await decodeToBuffer(file)
  return runAsrOnBuffer(buffer)
}

async function runSequential(options: { fixture: string }): Promise<{ diar: DiarRunSummary; asr: AsrRunSummary }> {
  const file = await fetchFixture(options.fixture)
  const buffer = await decodeToBuffer(file)
  const diar = await runDiarizeOn({ kind: 'transfer', buffer: buffer.slice(0) }, undefined, 'seq')
  const asr = await runAsrOnBuffer(buffer)
  return { diar, asr }
}

async function runConcurrent(options: { fixture: string }): Promise<{ diar: DiarRunSummary; asr: AsrRunSummary }> {
  const file = await fetchFixture(options.fixture)
  const asrChannel = new MessageChannel()
  const diarChannel = new MessageChannel()
  const chunks: PcmChunk[] = []
  asrChannel.port1.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as PcmChunk
    if (data && typeof data.startSec === 'number' && data.samples instanceof Float32Array) chunks.push(data)
  }
  const decoded = decodeWithPorts(file, [asrChannel.port2, diarChannel.port2])
  try {
    // Diarize consumes the live stream while the decode is still feeding it;
    // ASR starts the moment the decode completes — genuinely concurrent.
    const diarPromise = runDiarizeOn({ kind: 'stream', port: diarChannel.port1 as unknown as MessagePort }, undefined, 'tee')
    await decoded
    const buffer = concatChunks(chunks)
    const [diar, asr] = await Promise.all([diarPromise, runAsrOnBuffer(buffer)])
    return { diar, asr }
  } finally {
    asrChannel.port1.close()
    diarChannel.port1.close()
  }
}

const harness: HarnessGlobal = { runDiarize, runAsr, runSequential, runConcurrent }
;(globalThis as unknown as Record<string, unknown>).__zipscribeDiarHarness = harness
;(globalThis as unknown as Record<string, unknown>).__zipscribeDiarHarnessReady = true
