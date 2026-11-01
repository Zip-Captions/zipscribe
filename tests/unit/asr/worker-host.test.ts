// CC-05.8 / CC-05.9 / CC-05.10 (L3 contract via the worker-protocol seam) +
// FR-05.3/FR-05.5/FR-05.6: `createAsrWorkerHost` driven against a scripted
// worker double that speaks the REAL `AsrRequest`/`AsrEvent` unions from
// protocol.ts (same envelope as src/test-support/fake-workers.ts, extended
// with per-window sequencing the shared skeleton does not script — the
// double stays a boundary stand-in for the worker, never a mock of the host).
//
// Test hooks (frozen contract, see unit05-api-contract.d.ts + ASSUMPTIONS):
//  - `recycleEveryNWindows` forces the FR-05.3 recycle cadence (CC-05.9).
//  - A scripted mid-run `job:error { code:'GPU_OOM' }` drives the single
//    auto-downgrade (CC-05.8); no host-side fault-injection option is needed.
import { expect, test } from 'vitest'
import { createAsrWorkerHost, type AsrWorkerLike } from '@engine/asr/worker-host'
import { blockize } from '@engine/asr/blockize'
import type { AsrEvent, AsrRequest, EngineErrorCode, RawSegment } from '@engine/protocol@05'

const NO_FLAGS = { confidence: false, punctuation: false, languageDetect: false }
const T1_PLAN = { modelId: 'whisper-base-timestamped@608c49e6', device: 'webgpu' as const }
const T2_PLAN = { modelId: 'whisper-tiny-timestamped@5172442937', device: 'wasm' as const }

interface WorkerPlan {
  duration: number
  windowSec: number
  /** Emit `job:error { code }` after this many completed batches, then stop. */
  errorAfterBatches?: number
  errorCode?: EngineErrorCode
}

class ScriptedAsrWorker implements AsrWorkerLike {
  readonly sent: AsrRequest[] = []
  terminated = false
  cancelled = false
  private readonly listeners: ((event: AsrEvent) => void)[] = []
  private inFlightJobId: string | null = null

  private readonly plan: WorkerPlan

  constructor(plan: WorkerPlan) {
    this.plan = plan
  }

  postMessage(message: AsrRequest): void {
    this.sent.push(message)
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

  /** CC-05.10: simulate the in-flight window completing AFTER cancel — its results must be discarded. */
  emitLateBatch(segments: RawSegment[]): void {
    if (!this.inFlightJobId) throw new Error('no job to complete')
    this.emit({ t: 'job:segments', jobId: this.inFlightJobId, segments })
  }

  request(kind: string): AsrRequest | undefined {
    return this.sent.find((m) => m.t === kind)
  }

  private emit(event: AsrEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  private async handle(request: AsrRequest): Promise<void> {
    if (request.t === 'loadModel') {
      this.emit({ t: 'model:ready', model: request.model, device: request.device })
      return
    }
    if (request.t !== 'transcribe') return
    const { jobId } = request
    this.inFlightJobId = jobId
    let cursor = request.resumeFromSec ?? 0
    let batches = 0
    while (cursor < this.plan.duration && !this.cancelled && !this.terminated) {
      const end = Math.min(cursor + this.plan.windowSec, this.plan.duration)
      this.emit({ t: 'job:progress', jobId, processedSec: end, totalSec: this.plan.duration })
      this.emit({ t: 'job:segments', jobId, segments: deterministicSegments(cursor, end) })
      batches++
      cursor = end
      if (this.plan.errorAfterBatches && batches >= this.plan.errorAfterBatches && this.plan.errorCode) {
        this.emit({ t: 'job:error', jobId, error: { code: this.plan.errorCode, retryable: true } })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1)) // yield so the host sees each committed window
    }
    if (!this.cancelled && !this.terminated) this.emit({ t: 'job:done', jobId })
  }
}

/** Worker output is absolute media seconds (protocol): a pure function of the window range. */
function deterministicSegments(start: number, end: number): RawSegment[] {
  const out: RawSegment[] = []
  for (let second = Math.floor(start); second < Math.ceil(end); second++) {
    const segStart = Math.max(start, second)
    const segEnd = Math.min(end, second + 0.9)
    if (segEnd <= segStart) continue
    out.push({ start: segStart, end: segEnd, text: `tok ${second}`, words: [{ text: `tok${second}`, start: segStart, end: segEnd, timing: 'asr' }] })
  }
  return out
}

interface Harness {
  workers: ScriptedAsrWorker[]
  events: AsrEvent[]
  host: ReturnType<typeof createAsrWorkerHost>
}

function harness(planFor: (epoch: number) => WorkerPlan, options: { initialTier?: 'T1' | 'T2'; recycleEveryNWindows?: number } = {}): Harness {
  const workers: ScriptedAsrWorker[] = []
  const events: AsrEvent[] = []
  const host = createAsrWorkerHost({
    createWorker: () => {
      const worker = new ScriptedAsrWorker(planFor(workers.length))
      workers.push(worker)
      return worker
    },
    tiers: { T1: T1_PLAN, T2: T2_PLAN },
    initialTier: options.initialTier ?? 'T1',
    recycleEveryNWindows: options.recycleEveryNWindows,
    onEvent: (event) => events.push(event),
  })
  return { workers, events, host }
}

function transcribeParams(jobId = 'job-1') {
  return { jobId, pcm: { kind: 'transfer' as const, buffer: new ArrayBuffer(16_000 * 4 * 30) }, sampleRate: 16_000 as const, language: 'en', engineFlags: NO_FLAGS }
}

function segmentsFrom(result: { segments: RawSegment[] }): RawSegment[] {
  return result.segments
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out: ${message}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('CC-05.8 / US-1.2.7: mid-run forced GPU_OOM auto-downgrades ONCE to T2, resumes from the last committed window, emits TIER_DOWNGRADE, no duplicate blocks', async () => {
  const h = harness((epoch) =>
    epoch === 0
      ? { duration: 30, windowSec: 10, errorAfterBatches: 1, errorCode: 'GPU_OOM' } // dies after committing [0,10)
      : { duration: 30, windowSec: 10 }, // T2 finishes the job
  )
  const result = await h.host.transcribe(transcribeParams())

  expect(result.downgraded, 'pipeline auto-downgraded to T2').toBe(true)
  expect(h.workers.length, 'exactly one auto-downgrade → two worker epochs').toBe(2)
  const downgrades = h.events.filter((e) => e.t === 'notice' && e.notice.code === 'TIER_DOWNGRADE')
  expect(downgrades, 'exactly one TIER_DOWNGRADE notice').toHaveLength(1)
  const t2 = h.workers[1]!
  expect(t2.terminated, 'T2 worker survives to completion').toBe(false)
  const reload = t2.sent[0]
  expect(reload, 'respawn reloads the model before resuming').toMatchObject({ t: 'loadModel', model: T2_PLAN.modelId, device: 'wasm' })
  const resume = t2.request('transcribe')
  expect(resume, 'T2 worker receives the transcribe request').toBeDefined()
  expect((resume as { resumeFromSec?: number }).resumeFromSec, 'resume = end of the last committed window (10)').toBe(10)
  // No duplicates: strictly increasing starts (double-committed [0,10) would break this).
  const starts = segmentsFrom(result).map((s) => s.start)
  for (let i = 1; i < starts.length; i++) expect(starts[i]!, `duplicate/out-of-order segment at index ${i}`).toBeGreaterThan(starts[i - 1]!)
  expect(starts[0], 'first window kept').toBe(0)
  expect(starts[starts.length - 1], 'run completed through 30 s').toBeCloseTo(29, 0)
  expect(h.events.some((e) => e.t === 'job:done'), 'job completes').toBe(true)
})

test('CC-05.8 / US-1.2.7: a GPU_OOM on the T2 worker too → still only ONE downgrade, error surfaces', async () => {
  const h = harness(() => ({ duration: 30, windowSec: 10, errorAfterBatches: 1, errorCode: 'GPU_OOM' }))
  const result = await h.host.transcribe(transcribeParams('job-oom2'))
  expect(h.workers.length, 'downgrade happens once, then the error surfaces').toBe(2)
  expect(h.events.filter((e) => e.t === 'notice' && e.notice.code === 'TIER_DOWNGRADE')).toHaveLength(1)
  const jobError = h.events.find((e) => e.t === 'job:error')
  const surfaced = jobError && jobError.t === 'job:error' ? jobError.error.code : result.error?.code
  expect(surfaced, 'job:error surfaces after the failed downgrade').toBe('GPU_OOM')
})

test('CC-05.9 / FR-05.3: forced worker recycle every 3 windows — resumed output equals the uninterrupted run, block for block', async () => {
  const recycled = harness(() => ({ duration: 25, windowSec: 5 }), { initialTier: 'T2', recycleEveryNWindows: 3 })
  const withRecycle = await recycled.host.transcribe(transcribeParams('job-recycle'))

  expect(recycled.workers.length, 'recycle after 3 of 5 windows → respawn').toBeGreaterThanOrEqual(2)
  expect(recycled.workers[0]!.terminated, 'recycled worker is terminated').toBe(true)
  const second = recycled.workers[1]!
  expect(second.sent[0], 'respawn reloads the (cached) model first').toMatchObject({ t: 'loadModel' })
  expect((second.request('transcribe') as { resumeFromSec?: number } | undefined)?.resumeFromSec, 'resumeFromSec = end of last committed window (15)').toBe(15)
  expect(recycled.events.some((e) => e.t === 'notice' && e.notice.code === 'WORKER_RECYCLED'), 'WORKER_RECYCLED notice emitted (FR-05.3)').toBe(true)

  const uninterrupted = harness(() => ({ duration: 25, windowSec: 5 }), { initialTier: 'T2' })
  const withoutRecycle = await uninterrupted.host.transcribe(transcribeParams('job-clean'))

  expect(segmentsFrom(withRecycle), 'recycled run equals the uninterrupted run').toEqual(segmentsFrom(withoutRecycle))
  // Block-for-block equality through the public blockizer (CC-05.9 wording).
  const toBlocks = (result: { segments: RawSegment[] }) =>
    blockize(result.segments.flatMap((segment) => segment.words)).map((block) => ({ start: block.start, end: block.end, text: block.text }))
  expect(toBlocks(withRecycle), 'blocks identical across recycle').toEqual(toBlocks(withoutRecycle))
})

test('FR-05.5: host accepts both PcmSource kinds', async () => {
  const portChannel = new MessageChannel()
  const h = harness(() => ({ duration: 10, windowSec: 5 }), { initialTier: 'T2' })
  const streamRun = await h.host.transcribe({ ...transcribeParams('job-stream'), pcm: { kind: 'stream', port: portChannel.port1 } })
  const transferRun = await h.host.transcribe(transcribeParams('job-transfer'))
  const worker = h.workers[0]!
  const requests = worker.sent.filter((m): m is Extract<AsrRequest, { t: 'transcribe' }> => m.t === 'transcribe')
  expect(requests.length).toBeGreaterThanOrEqual(2)
  expect(requests.map((r) => (r.pcm as { kind: string }).kind).sort()).toEqual(['stream', 'transfer'])
  expect(streamRun.segments.length, 'stream source produces segments').toBeGreaterThan(0)
  expect(transferRun.segments.length, 'transfer source produces segments').toBeGreaterThan(0)
  portChannel.port1.close()
  portChannel.port2.close()
})

test('CC-05.10 / FR-05.6: cancel ≤ 2 s keeps partial blocks, tears the worker down cleanly, discards the in-flight window', async () => {
  const h = harness(() => ({ duration: 600, windowSec: 5 }), { initialTier: 'T2' })
  const running = h.host.transcribe(transcribeParams('job-cancel'))
  await waitFor(() => h.events.some((e) => e.t === 'job:segments'), 'at least one committed window before cancel')

  const cancelledAt = Date.now()
  await h.host.cancel('job-cancel')
  const elapsed = Date.now() - cancelledAt
  expect(elapsed, 'cancel settles within 2 s (FR-05.6)').toBeLessThan(2_000)

  const result = await running
  expect(result.cancelled, 'run reported as cancelled').toBe(true)
  const kept = segmentsFrom(result)
  expect(kept.length, 'partial blocks already emitted are kept').toBeGreaterThan(0)

  const worker = h.workers[0]!
  expect(worker.request('cancel'), 'worker received the protocol cancel').toBeDefined()
  expect(worker.terminated, 'worker torn down cleanly').toBe(true)

  // The in-flight window finishes late — its results are discarded.
  const beforeLate = kept.length
  worker.emitLateBatch(deterministicSegments(595, 600))
  expect(segmentsFrom(result), 'late in-flight window results are discarded').toHaveLength(beforeLate)
})

test('CC-05.10: cancel before any window keeps an empty (but clean) run', async () => {
  const h = harness(() => ({ duration: 600, windowSec: 30 }), { initialTier: 'T2' })
  const running = h.host.transcribe(transcribeParams('job-early-cancel'))
  await h.host.cancel('job-early-cancel')
  const result = await running
  expect(result.cancelled).toBe(true)
  expect(segmentsFrom(result), 'nothing was committed → nothing kept, no error').toHaveLength(0)
  expect(h.workers[0]!.terminated, 'still torn down cleanly').toBe(true)
})
