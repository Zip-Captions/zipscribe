// CC-05.12 coverage provider (src-adjacent, unit-04 `decode-internals`
// precedent): the corners the frozen `tests/unit/asr` suites structurally
// cannot reach because no `Worker` global exists in the node test
// environment — the whole PCM-broker path (CC-05.3, `createPcmBroker`,
// `requestPcmClone`, broker fallback) plus recycle-yield races and
// `job:done` stats relay. The broker double speaks the REAL
// `src/workers/pcm-broker.worker.ts` wire format; the worker double speaks
// the protocol unions. Boundary doubles, never a mock of the host.
import { afterEach, expect, test, vi } from 'vitest'
import { createAsrWorkerHost, type AsrWorkerLike } from '@engine/asr/worker-host'
import type { AsrEvent, AsrRequest, RawSegment } from '@engine/protocol'

const NO_FLAGS = { confidence: false, punctuation: false, languageDetect: false }
const T1_PLAN = { modelId: 'whisper-base-timestamped@608c49e6', device: 'webgpu' as const }
const T2_PLAN = { modelId: 'whisper-tiny-timestamped@5172442937', device: 'wasm' as const }

// Above the host's PCM_BROKER_MIN_BYTES so the broker path is taken.
const BULK_BYTES = 16 * 1024 * 1024 + 8

interface BrokerRequest {
  t: string
  buffer?: ArrayBuffer
  requestId?: number
}

class FakeBrokerWorker {
  readonly requests: BrokerRequest[] = []
  terminated = false
  private held: ArrayBuffer | null = null
  private readonly listeners = new Map<string, ((event: { data: unknown }) => void)[]>()

  private readonly mode: 'ok' | 'error' | 'silent'

  constructor(mode: 'ok' | 'error' | 'silent' = 'ok') {
    this.mode = mode
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    const list = this.listeners.get(type) ?? []
    const at = list.indexOf(listener)
    if (at >= 0) list.splice(at, 1)
  }

  postMessage(message: BrokerRequest): void {
    this.requests.push(message)
    if (message.t === 'ready') {
      if (this.mode === 'ok') this.dispatch('message', { t: 'ready' })
      if (this.mode === 'error') this.dispatch('error', undefined)
      return
    }
    if (message.t === 'own') {
      if (message.buffer instanceof ArrayBuffer) this.held = message.buffer
      return
    }
    if (message.t === 'clone' && typeof message.requestId === 'number') {
      if (this.held === null) {
        this.dispatch('message', { t: 'clone', requestId: message.requestId, buffer: new ArrayBuffer(0) })
        return
      }
      const copy = this.held.slice(0)
      this.dispatch('message', { t: 'clone', requestId: message.requestId, buffer: copy })
    }
  }

  terminate(): void {
    this.terminated = true
  }

  cloneRequestIds(): number[] {
    return this.requests.filter((r) => r.t === 'clone').map((r) => r.requestId as number)
  }

  ownCount(): number {
    return this.requests.filter((r) => r.t === 'own').length
  }

  private dispatch(type: string, data: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ data })
  }
}

class MiniAsrWorker implements AsrWorkerLike {
  readonly sent: AsrRequest[] = []
  terminated = false
  cancelled = false
  private readonly listeners: ((event: AsrEvent) => void)[] = []

  private readonly spec: { duration: number; windowSec: number; doneStats?: { language?: string }; onUnload?: () => void }

  constructor(spec: { duration: number; windowSec: number; doneStats?: { language?: string }; onUnload?: () => void }) {
    this.spec = spec
  }

  postMessage(message: AsrRequest): void {
    this.sent.push(message)
    if (message.t === 'unload') this.spec.onUnload?.()
    void this.handle(message)
  }

  onMessage(listener: (event: AsrEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const at = this.listeners.indexOf(listener)
      if (at >= 0) this.listeners.splice(at, 1)
    }
  }

  terminate(): void {
    this.terminated = true
    this.cancelled = true
  }

  emit(event: AsrEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  transcribeRequest(): Extract<AsrRequest, { t: 'transcribe' }> {
    const found = this.sent.find((m) => m.t === 'transcribe')
    if (found === undefined) throw new Error('no transcribe posted')
    return found
  }

  private async handle(request: AsrRequest): Promise<void> {
    if (request.t === 'loadModel') {
      this.emit({ t: 'model:ready', model: request.model, device: request.device })
      return
    }
    if (request.t !== 'transcribe') return
    let cursor = request.resumeFromSec ?? 0
    while (cursor < this.spec.duration && !this.cancelled && !this.terminated) {
      const end = Math.min(cursor + this.spec.windowSec, this.spec.duration)
      this.emit({ t: 'job:progress', jobId: request.jobId, processedSec: end, totalSec: this.spec.duration })
      this.emit({ t: 'job:segments', jobId: request.jobId, segments: windowSegments(cursor, end) })
      cursor = end
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    if (!this.cancelled && !this.terminated) {
      this.emit(this.spec.doneStats !== undefined ? { t: 'job:done', jobId: request.jobId, stats: this.spec.doneStats } : { t: 'job:done', jobId: request.jobId })
    }
  }
}

function windowSegments(start: number, end: number): RawSegment[] {
  return [{ start, end: Math.min(end, start + 0.9), text: 'tok', words: [{ text: 'tok', start, end: Math.min(end, start + 0.9), timing: 'asr' }] }]
}

interface HarnessOptions {
  recycleEveryNWindows?: number
  doneStats?: { language?: string }
  onUnload?: () => void
}

function harness(spec: { duration: number; windowSec: number }, options: HarnessOptions = {}) {
  const workers: MiniAsrWorker[] = []
  const host = createAsrWorkerHost({
    createWorker: () => {
      const worker = new MiniAsrWorker({ ...spec, ...(options.doneStats !== undefined ? { doneStats: options.doneStats } : {}), ...(options.onUnload !== undefined ? { onUnload: options.onUnload } : {}) })
      workers.push(worker)
      return worker
    },
    tiers: { T1: T1_PLAN, T2: T2_PLAN },
    ...(options.recycleEveryNWindows !== undefined ? { recycleEveryNWindows: options.recycleEveryNWindows } : {}),
  })
  return { workers, host }
}

function transferParams(buffer: ArrayBuffer) {
  return { jobId: 'j1', pcm: { kind: 'transfer' as const, buffer }, sampleRate: 16000 as const, language: 'en', engineFlags: NO_FLAGS }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('CC-05.3: bulk transfer PCM is cloned ON the broker thread, never posted directly', async () => {
  const brokers: FakeBrokerWorker[] = []
  vi.stubGlobal('Worker', class {
    private readonly inner: FakeBrokerWorker
    constructor() {
      this.inner = new FakeBrokerWorker('ok')
      brokers.push(this.inner)
    }

    postMessage(message: BrokerRequest, transfer?: unknown): void {
      void transfer
      this.inner.postMessage(message)
    }

    addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
      this.inner.addEventListener(type, listener)
    }

    removeEventListener(type: string, listener: (event: { data: unknown }) => void): void {
      this.inner.removeEventListener(type, listener)
    }

    terminate(): void {
      this.inner.terminate()
    }
  })
  const { workers, host } = harness({ duration: 1, windowSec: 1 }, { recycleEveryNWindows: 1 })
  const original = new ArrayBuffer(BULK_BYTES)
  const result = await host.transcribe(transferParams(original))

  expect(result.cancelled).toBe(false)
  expect(result.workerEpochs).toBe(2)
  expect(workers).toHaveLength(2)
  expect(brokers).toHaveLength(1) // one broker reused across epochs (ensurePcmBroker cache)

  const broker = brokers[0]!
  expect(broker.ownCount()).toBe(1) // the original is handed over ONCE
  expect(broker.cloneRequestIds()).toEqual([1, 2]) // a fresh clone per epoch

  for (const worker of workers) {
    const posted = worker.transcribeRequest()
    expect(posted.pcm.kind).toBe('transfer')
    if (posted.pcm.kind === 'transfer') {
      expect(posted.pcm.buffer).not.toBe(original) // never the page-owned original
      expect(posted.pcm.buffer.byteLength).toBe(BULK_BYTES)
    }
  }
  const firstClone = workers[0]!.transcribeRequest().pcm
  const secondClone = workers[1]!.transcribeRequest().pcm
  if (firstClone.kind === 'transfer' && secondClone.kind === 'transfer') {
    expect(firstClone.buffer).not.toBe(secondClone.buffer) // distinct clone per epoch
  }

  host.dispose()
  await new Promise((resolve) => setTimeout(resolve, 0)) // dispose terminates the broker port on the broker-promise resolution
  expect(broker.terminated).toBe(true)
})

test('CC-05.3: broker error falls back to the direct post with the original buffer', async () => {
  const brokers: FakeBrokerWorker[] = []
  vi.stubGlobal('Worker', class {
    private readonly inner: FakeBrokerWorker
    constructor() {
      this.inner = new FakeBrokerWorker('error')
      brokers.push(this.inner)
    }

    postMessage(message: BrokerRequest): void {
      this.inner.postMessage(message)
    }

    addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
      this.inner.addEventListener(type, listener)
    }

    removeEventListener(type: string, listener: (event: { data: unknown }) => void): void {
      this.inner.removeEventListener(type, listener)
    }

    terminate(): void {
      this.inner.terminate()
    }
  })
  const { workers, host } = harness({ duration: 1, windowSec: 1 })
  const original = new ArrayBuffer(BULK_BYTES)
  const result = await host.transcribe(transferParams(original))

  expect(result.cancelled).toBe(false)
  expect(workers).toHaveLength(1)
  expect(workers[0]!.transcribeRequest().pcm).toEqual({ kind: 'transfer', buffer: original }) // direct fallback post
  host.dispose()
})

test('FR-05.3/US-1.2.7: cancel during the recycle yield terminates only the doomed worker and skips the respawn', async () => {
  let hostRef: ReturnType<typeof createAsrWorkerHost> | null = null
  const { workers, host } = harness({ duration: 3, windowSec: 1 }, {
    recycleEveryNWindows: 1,
    // retireForRecycle posts cancel+unload synchronously, THEN yields;
    // cancelling from the unload hook lands exactly inside that yield.
    onUnload: () => {
      void hostRef?.cancel('j1')
    },
  })
  hostRef = host
  const buffer = new ArrayBuffer(4096)
  const result = await host.transcribe(transferParams(buffer))

  expect(result.cancelled).toBe(true)
  expect(result.workerEpochs).toBe(1) // the respawn never attached a new epoch
  expect(workers).toHaveLength(1)
  expect(workers[0]!.terminated).toBe(true) // the doomed worker was still terminated
})

test('FR-05.5: foreign-job events on the shared boundary never enter this run', async () => {
  const workers: MiniAsrWorker[] = []
  const host = createAsrWorkerHost({
    createWorker: () => {
      const worker = new MiniAsrWorker({ duration: 1, windowSec: 1 })
      workers.push(worker)
      return worker
    },
    tiers: { T1: T1_PLAN, T2: T2_PLAN },
  })
  const buffer = new ArrayBuffer(4096)
  const run = host.transcribe({ ...transferParams(buffer), engineFlags: { ...NO_FLAGS, languageDetect: true } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  // The run is in-flight on workers[0]; poison its stream with twin events.
  workers[0]!.emit({ t: 'vad:segments', jobId: 'twin', segments: [{ start: 900, end: 901 }] })
  workers[0]!.emit({ t: 'job:progress', jobId: 'twin', processedSec: 950, totalSec: 1000 })
  workers[0]!.emit({ t: 'job:segments', jobId: 'twin', segments: [{ start: 950, end: 950.5, text: 'x', words: [] }] })
  workers[0]!.emit({ t: 'job:error', jobId: 'twin', error: { code: 'ENGINE_INTERNAL', retryable: false } })
  const result = await run
  expect(result.error).toBeUndefined() // the twin job:error was ignored
  expect(result.segments.every((s) => s.start < 900)).toBe(true) // twin segments never committed
})

test('US-05.1: detected language relays from job:done stats', async () => {
  const { host } = harness({ duration: 1, windowSec: 1 }, { doneStats: { language: 'fr' } })
  const buffer = new ArrayBuffer(4096)
  const result = await host.transcribe({ ...transferParams(buffer), language: null, engineFlags: { ...NO_FLAGS, languageDetect: true } })
  expect(result.validation).toBeUndefined()
  expect(result.detectedLanguage).toBe('fr')
})
