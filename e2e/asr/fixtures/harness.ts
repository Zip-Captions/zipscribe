// CC-05.2/CC-05.3/CC-05.5 (L4/L5) browser harness for the unit-05 ASR
// suite — test-author-owned (pattern: e2e/media/fixtures/harness.ts).
//
// The specs drive the REAL pipeline in a real Chromium page: the unit-04
// media worker decodes the fixture (production `handleMediaRequest` path),
// the unit-05 `createAsrWorkerHost` drives the real `src/workers/asr.worker.ts`
// over the protocol.ts unions, and the produced segments go through the real
// `blockize`. NOTHING of the thing under test is stubbed — the only network
// interception is the Playwright route in helpers/asr.ts (models from the
// local cache, nothing else).
//
// The engine modules are loaded via DYNAMIC import so the page always boots
// (ready=true) and the specs fail on the RUN with the module-resolution error
// surfaced — a readable RED, never a blank page.
//
// SECURITY-03: only numbers, codes, counts and the hypothesis text (for the
// spec-side WER score, unit-02 harness pattern — never persisted, never
// logged) cross the page boundary.
import type { AsrEvent, MediaEvent, MediaRequest, PcmChunk, RawSegment } from '@engine/protocol@05'
import type { AsrWorkerLike } from '@engine/asr/worker-host'

interface LongTaskRecord {
  duration: number
  startTime: number
  name: string
}

export interface AsrRunOptions {
  fixture: string
  modelId: string
  device: 'wasm' | 'webgpu'
  language: string | null
  tier: 'T1' | 'T2'
  recycleEveryNWindows?: number
}

export interface AsrRunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  cancelled: boolean
  downgraded: boolean
  workerEpochs: number
  detectedLanguage: string | null
  segmentCount: number
  wordCount: number
  blocks: { start: number; end: number; text: string }[]
  hypothesis: string
  eventSummary: { t: string; code?: string; notice?: string }[]
  runWallMs: number
}

interface HarnessGlobal {
  runTranscription(options: AsrRunOptions): Promise<AsrRunSummary>
  decodeFixture(fixture: string): Promise<{ seconds: number; bytes: number }>
  startLongTaskWatch(): void
  stopLongTaskWatch(): LongTaskRecord[]
}

const longTasks: LongTaskRecord[] = []
let longTaskObserver: PerformanceObserver | undefined

function startLongTaskWatch(): void {
  longTasks.length = 0
  longTaskObserver?.disconnect()
  longTaskObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const attribution = (entry as PerformanceEntry & { attribution?: { name?: string }[] }).attribution
      longTasks.push({ duration: entry.duration, startTime: entry.startTime, name: attribution?.[0]?.name ?? 'unknown' })
    }
  })
  longTaskObserver.observe({ entryTypes: ['longtask'] })
}

function stopLongTaskWatch(): LongTaskRecord[] {
  longTaskObserver?.disconnect()
  longTaskObserver = undefined
  return [...longTasks]
}

async function fetchFixture(fixture: string): Promise<File> {
  const response = await fetch(`/${fixture}`)
  if (!response.ok) throw new Error(`fixture fetch failed for ${fixture}: ${response.status}`)
  const blob = await response.blob()
  return new File([blob], fixture.split('/').pop() ?? 'fixture', { type: blob.type })
}

/** Decode via the REAL unit-04 media worker (`t:'decode'` tee protocol). */
async function decodeToTransfer(file: File): Promise<{ buffer: ArrayBuffer; seconds: number }> {
  const channel = new MessageChannel()
  const mediaWorker = new Worker('/src/workers/media.worker.ts', { type: 'module' })
  try {
    const chunks: PcmChunk[] = []
    const settled = new Promise<void>((resolve, reject) => {
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data as PcmChunk
        if (data && typeof data.startSec === 'number' && data.samples instanceof Float32Array) chunks.push(data)
      }
      mediaWorker.onmessage = (event: MessageEvent<MediaEvent>) => {
        const ev = event.data
        if (ev.t === 'job:done') resolve()
        else if (ev.t === 'job:error') reject(new Error(`media decode failed: ${ev.error.code}`))
      }
      mediaWorker.onerror = (error) => reject(new Error(`media worker error: ${error.message}`))
    })
    mediaWorker.postMessage({ t: 'decode', jobId: `asr-harness-decode-${Date.now()}`, file, ports: [channel.port2] } as MediaRequest, [channel.port2])
    await settled
    chunks.sort((a, b) => a.startSec - b.startSec)
    const total = chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0)
    const buffer = new ArrayBuffer(total * 4)
    const view = new Float32Array(buffer)
    let at = 0
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      view.set(chunk.samples, at)
      at += chunk.samples.length
      // Yield between fills: the copy loop itself must never become a
      // > 50 ms main-thread long task (the harness is not engine code, but a
      // self-inflicted long task would poison the CC-05.3 observation).
      if (i % 256 === 255) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { buffer, seconds: total / 16_000 }
  } finally {
    mediaWorker.terminate()
    channel.port1.close()
  }
}

function wrapWorker(worker: Worker): AsrWorkerLike {
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer ? { transfer } : undefined),
    onMessage: (listener) => {
      const handler = (event: MessageEvent<AsrEvent>) => listener(event.data)
      worker.addEventListener('message', handler)
      return () => worker.removeEventListener('message', handler)
    },
    terminate: () => worker.terminate(),
  }
}

const WHISPER_TINY_ENGINE_FLAGS = { confidence: false, punctuation: false, languageDetect: true }

async function runTranscription(options: AsrRunOptions): Promise<AsrRunSummary> {
  // Runtime-computed specifiers so vite does NOT statically pre-transform
  // (and 500 on) the not-yet-existing modules — the page stays live and the
  // import failure surfaces as the run rejection, which is the readable RED.
  // Once the builder writes `src/engine/asr/*`, these URLs resolve through
  // the same vite pipeline as the rest of `src/`.
  const workerHostUrl = new URL('../../../src/engine/asr/worker-host.ts', import.meta.url).href
  const blockizeUrl = new URL('../../../src/engine/asr/blockize.ts', import.meta.url).href
  const { createAsrWorkerHost } = (await import(/* @vite-ignore */ workerHostUrl)) as typeof import('@engine/asr/worker-host')
  const { blockize } = (await import(/* @vite-ignore */ blockizeUrl)) as typeof import('@engine/asr/blockize')

  const started = Date.now()
  const file = await fetchFixture(options.fixture)
  const { buffer } = await decodeToTransfer(file)

  const events: AsrEvent[] = []
  const host = createAsrWorkerHost({
    createWorker: () => wrapWorker(new Worker('/src/workers/asr.worker.ts', { type: 'module' })),
    tiers: { T1: { modelId: options.modelId, device: options.device }, T2: { modelId: options.modelId, device: 'wasm' } },
    initialTier: options.tier,
    recycleEveryNWindows: options.recycleEveryNWindows,
    onEvent: (event) => events.push(event),
  })
  const jobId = `asr-${Math.random().toString(36).slice(2)}`
  const result = await host.transcribe({
    jobId,
    pcm: { kind: 'transfer', buffer },
    sampleRate: 16_000,
    language: options.language,
    engineFlags: WHISPER_TINY_ENGINE_FLAGS,
  })
  host.dispose()

  const segments: RawSegment[] = result.segments
  const words = segments.flatMap((segment) => segment.words)
  const blocks = blockize(words).map((block) => ({ start: block.start, end: block.end, text: block.text }))
  return {
    ok: !result.error && !result.cancelled,
    ...(result.error ? { error: result.error } : {}),
    cancelled: result.cancelled,
    downgraded: result.downgraded,
    workerEpochs: result.workerEpochs,
    detectedLanguage: result.detectedLanguage ?? null,
    segmentCount: segments.length,
    wordCount: words.length,
    blocks,
    hypothesis: words.map((word) => word.text).join(' '),
    eventSummary: events.map((event) => ({
      t: event.t,
      ...(event.t === 'job:error' ? { code: event.error.code } : {}),
      ...(event.t === 'notice' ? { notice: event.notice.code } : {}),
    })),
    runWallMs: Date.now() - started,
  }
}

async function decodeFixture(fixture: string): Promise<{ seconds: number; bytes: number }> {
  const file = await fetchFixture(fixture)
  const { buffer, seconds } = await decodeToTransfer(file)
  return { seconds, bytes: buffer.byteLength }
}

const harness: HarnessGlobal = { runTranscription, decodeFixture, startLongTaskWatch, stopLongTaskWatch }
;(globalThis as unknown as Record<string, unknown>).__zipscribeAsrHarness = harness
;(globalThis as unknown as Record<string, unknown>).__zipscribeAsrHarnessReady = true
