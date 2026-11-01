// CC-05.12 coverage round (L3 via the worker-protocol seam): the specified-but-
// unexercised branches of `createAsrWorkerHost` — US-1.2.7 covers OOM *and*
// session-loss (only GPU_OOM was driven by worker-host.test.ts), non-downgrade
// errors must surface untouched (unit-05 US-1.2.7 + Technical Specification
// error-code list), the WORKER_RECYCLED notice must stay codes/numbers-only
// (FR-05.3 + FR-05.8/SECURITY-03), the US-05.1 pre-post validation + detected-
// language relay, protocol event relays (FR-05.5), and the cancel/dispose
// lifecycle corners (FR-05.6). Driven against a local `AsrWorkerLike` double
// speaking the real AsrRequest/AsrEvent unions — a boundary stand-in for the
// worker, never a mock of the host (conventions § Mocks and fakes).
//
// ASSUMPTIONS (unobservable through the public API, deliberately not asserted):
//  - `AsrRequest { t: 'unload' }` is in the protocol but the host never posts
//    it (the warm/recycle/dispose paths own teardown), so no "unload request"
//    branch is reachable here; `dispose()` is the public idle-teardown.
//  - The host never emits a `Notice` without `params` (both emit sites carry
//    params), so the params-less notice construction branch is untestable.
import { expect, test } from 'vitest'
import { CANARY_MARKER } from '../../../src/test-support/redaction'
import { createAsrWorkerHost, type AsrHostOptions, type AsrWorkerLike } from '@engine/asr/worker-host'
import type { AsrEvent, AsrRequest, EngineError, EngineErrorCode, RawSegment } from '@engine/protocol@05'

const T1_PLAN = { modelId: 'whisper-base-timestamped@608c49e6', device: 'webgpu' as const }
const T2_PLAN = { modelId: 'whisper-tiny-timestamped@5172442937', device: 'wasm' as const }

/** `job:done` stats per the frozen contract addition — codes and numbers only. */
interface DoneStats {
  language?: string
  guard?: { repeatedNgramDropped?: number; shortSpeechDropped?: number; maxTokensFlagged?: number }
}

interface WorkerSpec {
  /** loadModel reaction: ready (default), coded model:error, or a deferred handshake. */
  load?: 'ready' | 'error' | 'deferred'
  loadError?: EngineError
  /** Emit model:progress + model:confirm-required (unit-03 >100 MB gate event) before ready. */
  modelEvents?: boolean
  duration: number
  windowSec: number
  errorAfterBatches?: number
  errorCode?: EngineErrorCode
  doneStats?: DoneStats
  /** Emit a parallel bogus job's events mid-run — they must not leak into this run. */
  twinJobId?: string
  canarySegments?: boolean
}

class BranchWorker implements AsrWorkerLike {
  readonly sent: AsrRequest[] = []
  terminated = false
  private readonly listeners: ((event: AsrEvent) => void)[] = []
  private cancelled = false
  private pendingLoad: Extract<AsrRequest, { t: 'loadModel' }> | null = null

  private readonly spec: WorkerSpec

  constructor(spec: WorkerSpec) {
    this.spec = spec
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

  /** Release a deferred loadModel handshake (cancel-mid-handshake scenario). */
  emitReady(): void {
    if (this.pendingLoad === null) return
    const { model, device } = this.pendingLoad
    this.pendingLoad = null
    this.emit({ t: 'model:ready', model, device })
  }

  hasRequest(kind: AsrRequest['t']): boolean {
    return this.sent.some((m) => m.t === kind)
  }

  private emit(event: AsrEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  /** Deterministic per-window output — absolute media seconds, no randomness. */
  private windowSegments(start: number, end: number): RawSegment[] {
    const out: RawSegment[] = []
    for (let second = Math.floor(start); second < Math.ceil(end); second++) {
      const segStart = Math.max(start, second)
      const segEnd = Math.min(end, second + 0.9)
      if (segEnd <= segStart) continue
      const text = this.spec.canarySegments ? `${CANARY_MARKER} ${second}` : `tok ${second}`
      out.push({ start: segStart, end: segEnd, text, words: [{ text, start: segStart, end: segEnd, timing: 'asr' }] })
    }
    return out
  }

  private async handle(request: AsrRequest): Promise<void> {
    if (request.t === 'loadModel') {
      if (this.spec.load === 'error') {
        this.emit({ t: 'model:error', model: request.model, error: this.spec.loadError ?? { code: 'MODEL_UNLOADED', retryable: false } })
        return
      }
      if (this.spec.load === 'deferred') {
        this.pendingLoad = { t: 'loadModel', model: request.model, device: request.device }
        return
      }
      if (this.spec.modelEvents) {
        this.emit({ t: 'model:progress', model: request.model, phase: 'compile', received: 4096, total: 8192 })
        this.emit({ t: 'model:confirm-required', model: request.model, bytes: 120_000_000 })
      }
      this.emit({ t: 'model:ready', model: request.model, device: request.device })
      return
    }
    if (request.t !== 'transcribe') return
    const { jobId } = request

    // FR-05.1: the worker streams its VAD segmentation; FR-05.5: coded notices
    // ride the protocol. Both must relay for THIS job.
    this.emit({ t: 'vad:segments', jobId, segments: [{ start: 0, end: 0.5 }] })
    this.emit({ t: 'notice', jobId, notice: { code: 'PREVIEW_UNSUPPORTED', params: { sampleRateHz: 16_000 } } })
    if (this.spec.twinJobId !== undefined) {
      // A different job's events sharing the worker boundary: must not enter this run.
      this.emit({ t: 'vad:segments', jobId: this.spec.twinJobId, segments: [{ start: 900, end: 901 }] })
      this.emit({ t: 'job:segments', jobId: this.spec.twinJobId, segments: [{ start: 900, end: 900.9, text: 'foreign', words: [{ text: 'foreign', start: 900, end: 900.9, timing: 'asr' }] }] })
      this.emit({ t: 'job:progress', jobId: this.spec.twinJobId, processedSec: 900, totalSec: 999 })
    }

    let cursor = request.resumeFromSec ?? 0
    let batches = 0
    while (cursor < this.spec.duration && !this.cancelled && !this.terminated) {
      const end = Math.min(cursor + this.spec.windowSec, this.spec.duration)
      this.emit({ t: 'job:progress', jobId, processedSec: end, totalSec: this.spec.duration })
      this.emit({ t: 'job:segments', jobId, segments: this.windowSegments(cursor, end) })
      batches += 1
      cursor = end
      if (this.spec.errorAfterBatches !== undefined && batches >= this.spec.errorAfterBatches && this.spec.errorCode !== undefined) {
        this.emit({ t: 'job:error', jobId, error: { code: this.spec.errorCode, retryable: true } })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1)) // yield so the host sees each committed window
    }
    if (!this.cancelled && !this.terminated) {
      this.emit(this.spec.doneStats !== undefined ? { t: 'job:done', jobId, stats: this.spec.doneStats } : { t: 'job:done', jobId })
    }
  }
}

interface Harness {
  workers: BranchWorker[]
  events: AsrEvent[]
  host: ReturnType<typeof createAsrWorkerHost>
}

function harness(planFor: (epoch: number) => WorkerSpec, options: { initialTier?: 'T1' | 'T2'; recycleEveryNWindows?: number; withOnEvent?: boolean; tiers?: AsrHostOptions['tiers'] } = {}): Harness {
  const workers: BranchWorker[] = []
  const events: AsrEvent[] = []
  const host = createAsrWorkerHost({
    createWorker: () => {
      const worker = new BranchWorker(planFor(workers.length))
      workers.push(worker)
      return worker
    },
    tiers: options.tiers ?? { T1: T1_PLAN, T2: T2_PLAN },
    ...(options.initialTier !== undefined ? { initialTier: options.initialTier } : {}),
    ...(options.recycleEveryNWindows !== undefined ? { recycleEveryNWindows: options.recycleEveryNWindows } : {}),
    // withOnEvent:false omits the optional listener entirely (relay must cope).
    ...(options.withOnEvent === false ? {} : { onEvent: (event: AsrEvent) => events.push(event) }),
  })
  return { workers, events, host }
}

function transcribeParams(jobId: string, language: string | null = 'en', languageDetect = false) {
  return { jobId, pcm: { kind: 'transfer' as const, buffer: new ArrayBuffer(16_000 * 4 * 30) }, sampleRate: 16_000 as const, language, engineFlags: { confidence: false, punctuation: false, languageDetect } }
}

function notices(events: readonly AsrEvent[], code: string): AsrEvent[] {
  return events.filter((e) => e.t === 'notice' && e.notice.code === code)
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out: ${message}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

// --- US-1.2.7: the downgrade class is {GPU_OOM, SESSION_LOST} -----------------

test('US-1.2.7 / CC-05.8: mid-run SESSION_LOST downgrades exactly once — same single T1→T2 downgrade, TIER_DOWNGRADE notice, resume from the last committed window ("WebGPU OOM/session-loss error mid-run → the pipeline auto-downgrades to T2 once")', async () => {
  const h = harness((epoch) => (epoch === 0 ? { duration: 30, windowSec: 10, errorAfterBatches: 1, errorCode: 'SESSION_LOST' } : { duration: 30, windowSec: 10 }))
  const result = await h.host.transcribe(transcribeParams('job-session'))

  expect(result.downgraded, 'session-loss is in the downgrade class, like GPU_OOM').toBe(true)
  expect(h.workers.length, 'exactly one auto-downgrade → two worker epochs').toBe(2)
  expect(notices(h.events, 'TIER_DOWNGRADE'), 'exactly one TIER_DOWNGRADE notice').toHaveLength(1)
  const t2 = h.workers[1]!
  expect(t2.sent[0], 'respawn reloads the (cached) T2 model first (FR-05.3)').toMatchObject({ t: 'loadModel', model: T2_PLAN.modelId, device: 'wasm' })
  const resume = t2.sent.find((m) => m.t === 'transcribe')
  expect((resume as { resumeFromSec?: number } | undefined)?.resumeFromSec, 'resumes from the last committed window end (10)').toBe(10)
  expect(result.error, 'the single downgrade absorbs the error — nothing surfaces').toBeUndefined()
  const starts = result.segments.map((s) => s.start)
  for (let i = 1; i < starts.length; i++) expect(starts[i]!, `no duplicate blocks across the downgrade (index ${i})`).toBeGreaterThan(starts[i - 1]!)
  expect(starts[0], 'first window kept').toBe(0)
  expect(h.events.some((e) => e.t === 'job:done'), 'run completes after resume').toBe(true)
})

test('US-1.2.7 / CC-05.12: a job:error that is NEITHER OOM nor session-loss surfaces as job:error with no downgrade; codes/numbers only (SECURITY-03)', async () => {
  // DECODE_STALL is in the unit-05 Technical Specification error-code list but
  // outside the US-1.2.7 downgrade class.
  const h = harness(() => ({ duration: 30, windowSec: 10, errorAfterBatches: 2, errorCode: 'DECODE_STALL', canarySegments: true }))
  const result = await h.host.transcribe(transcribeParams('job-stall'))

  expect(result.downgraded, 'non-OOM/session-loss errors never downgrade').toBe(false)
  expect(h.workers.length, 'no respawn on a non-downgrade error').toBe(1)
  expect(notices(h.events, 'TIER_DOWNGRADE'), 'no TIER_DOWNGRADE for a non-downgrade error').toHaveLength(0)
  const relayed = h.events.find((e): e is Extract<AsrEvent, { t: 'job:error' }> => e.t === 'job:error')
  expect(relayed?.error.code, 'the error surfaces as a relayed job:error').toBe('DECODE_STALL')
  expect(result.error, 'run result carries the coded error (frozen AsrRunResult shape)').toEqual({ code: 'DECODE_STALL', retryable: true })
  expect(h.workers[0]!.terminated, 'worker torn down on the surfaced error').toBe(true)

  // FR-05.8 / SECURITY-03: canary transcript rode the segments channel; it must
  // appear in NO error or notice.
  expect(result.segments.some((s) => s.text.includes(CANARY_MARKER)), 'canary transited the transcript data channel').toBe(true)
  expect(JSON.stringify(result.error), 'error result is codes-only').not.toContain(CANARY_MARKER)
  for (const e of h.events) {
    if (e.t === 'job:error' || e.t === 'notice') expect(JSON.stringify(e), `${e.t} stays content-free`).not.toContain(CANARY_MARKER)
  }
})

// --- FR-05.3 WORKER_RECYCLED notice payload -----------------------------------

test('CC-05.9 / FR-05.3 / FR-05.8: WORKER_RECYCLED notice params are numbers only — no content, ever ("Emits WORKER_RECYCLED notice"; SECURITY-03 codes/numbers only)', async () => {
  const h = harness(() => ({ duration: 10, windowSec: 5, canarySegments: true }), { initialTier: 'T2', recycleEveryNWindows: 2 })
  const result = await h.host.transcribe(transcribeParams('job-recycle-numbers'))

  const recycled = notices(h.events, 'WORKER_RECYCLED')
  expect(recycled.length, 'recycle cadence emits the FR-05.3 notice').toBeGreaterThanOrEqual(1)
  for (const e of recycled) {
    const noticeParams = e.t === 'notice' ? e.notice.params : undefined
    expect(noticeParams, 'recycle notice carries params').toBeDefined()
    for (const value of Object.values(noticeParams!)) {
      expect(typeof value, 'WORKER_RECYCLED params are numbers only').toBe('number')
      expect(Number.isFinite(value as number), 'no NaN/Infinity in notice params').toBe(true)
    }
    expect(JSON.stringify(e.notice), 'recycle notice stays content-free while transcript text flows (SECURITY-03)').not.toContain(CANARY_MARKER)
  }
  expect(result.segments.some((s) => s.text.includes(CANARY_MARKER)), 'canary transited as data (non-vacuous canary)').toBe(true)
  expect(result.error, 'the recycled run completes cleanly').toBeUndefined()
})

// --- US-05.1 pre-post validation + detected-language relay ---------------------

test('US-05.1: language:null without engineFlags.languageDetect returns LANGUAGE_REQUIRED before anything is posted to the worker ("the engine facade rejects the request before posting to the worker")', async () => {
  const h = harness(() => ({ duration: 10, windowSec: 5 }))
  const result = await h.host.transcribe(transcribeParams('job-lang', null, false))

  expect(result.validation, 'typed validation result so the UI can ask for a language').toBe('LANGUAGE_REQUIRED')
  expect(h.workers.length, 'refused BEFORE any worker spawn').toBe(0)
  expect(h.events, 'nothing was posted, so nothing was relayed').toHaveLength(0)
  expect(result.segments).toEqual([])
  expect(result.workerEpochs).toBe(0)
  expect(result.cancelled).toBe(false)
  expect(result.downgraded).toBe(false)
})

test('US-05.1 / FR-05.5: language:null with languageDetect:true runs (language passes through as null) and the detected language relays from job:done stats; model:progress / model:confirm-required relay too', async () => {
  const h = harness(() => ({ duration: 10, windowSec: 5, modelEvents: true, doneStats: { language: 'fr', guard: { repeatedNgramDropped: 0, shortSpeechDropped: 0, maxTokensFlagged: 0 } } }))
  const result = await h.host.transcribe(transcribeParams('job-detect', null, true))

  expect(result.error).toBeUndefined()
  expect(result.detectedLanguage, '"it auto-detects and the detected language is reported in job:done"').toBe('fr')
  const request = h.workers[0]!.sent.find((m) => m.t === 'transcribe')
  expect((request as { language?: string | null } | undefined)?.language, 'null language passes through unchanged — the engine detects').toBe(null)
  expect(h.events.some((e) => e.t === 'model:progress'), 'model:progress relays per the worker protocol').toBe(true)
  expect(h.events.some((e) => e.t === 'model:confirm-required'), 'the unit-03 >100 MB confirm gate event relays').toBe(true)
  const done = h.events.find((e): e is Extract<AsrEvent, { t: 'job:done' }> => e.t === 'job:done')
  expect(done?.stats?.language, 'job:done carries the detected language code').toBe('fr')
})

// --- FR-05.5 protocol relays / error surfaces -----------------------------------

test('FR-05.5 / Technical Specification (MODEL_UNLOADED): a coded model:error during loadModel surfaces; no transcribe is ever posted', async () => {
  const h = harness(() => ({ load: 'error', loadError: { code: 'MODEL_UNLOADED', retryable: false }, duration: 10, windowSec: 5 }))
  const result = await h.host.transcribe(transcribeParams('job-model-error'))

  expect(result.error, 'the coded loadModel failure surfaces').toEqual({ code: 'MODEL_UNLOADED', retryable: false })
  expect(h.events.some((e) => e.t === 'model:error' && e.error.code === 'MODEL_UNLOADED'), 'model:error relays per the protocol').toBe(true)
  expect(h.workers[0]!.hasRequest('transcribe'), 'a failed load never proceeds to transcribe').toBe(false)
  expect(h.workers[0]!.terminated, 'failed-load worker torn down cleanly').toBe(true)
  expect(result.downgraded, 'MODEL_UNLOADED is not a downgrade trigger').toBe(false)
})

test('FR-05.1 / FR-05.5 (protocol jobId discrimination): the run relays its own vad:segments and worker notices; a foreign job\'s events never enter the run or the kept segments', async () => {
  const h = harness(() => ({ duration: 10, windowSec: 5, twinJobId: 'other-job-9' }))
  const result = await h.host.transcribe(transcribeParams('job-isolation'))

  expect(h.events.some((e) => e.t === 'vad:segments' && e.jobId === 'job-isolation'), 'own vad:segments relay (FR-05.1: "Emits vad:segments")').toBe(true)
  expect(h.events.some((e) => e.t === 'notice' && e.notice.code === 'PREVIEW_UNSUPPORTED'), 'worker-origin coded notices relay per the protocol').toBe(true)
  for (const e of h.events) {
    if ('jobId' in e && e.jobId !== undefined) expect(e.jobId, 'no foreign-job event enters this run').toBe('job-isolation')
  }
  expect(result.segments.every((s) => s.start < 100), 'foreign job segments are never committed to this run').toBe(true)
  expect(result.error).toBeUndefined()
})

// --- FR-05.6 cancel lifecycle corners ---------------------------------------------

test('CC-05.10 / FR-05.6: cancel during the loadModel handshake settles ≤ 2 s; the worker never receives a transcribe request, and a late model:ready cannot resurrect the run', async () => {
  const h = harness(() => ({ load: 'deferred', duration: 30, windowSec: 10 }))
  const running = h.host.transcribe(transcribeParams('job-handshake'))
  await waitFor(() => h.workers[0]?.hasRequest('loadModel') === true, 'loadModel posted')

  const startedAt = Date.now()
  await h.host.cancel('job-handshake')
  expect(Date.now() - startedAt, 'cancel settles within 2 s (FR-05.6)').toBeLessThan(2_000)

  const result = await running
  expect(result.cancelled, 'abort during the handshake settles the run as cancelled').toBe(true)
  const worker = h.workers[0]!
  expect(worker.hasRequest('loadModel'), 'the handshake was in flight').toBe(true)
  expect(worker.hasRequest('transcribe'), 'the abort flag is checked after the handshake — no post').toBe(false)
  expect(worker.terminated, 'torn down cleanly').toBe(true)

  worker.emitReady() // late handshake completion must not un-cancel or post anything
  const after = await running
  expect(after.cancelled, 'late model:ready is discarded (FR-05.6: results of an aborted run are discarded)').toBe(true)
  expect(worker.hasRequest('transcribe'), 'still no transcribe post').toBe(false)
})

test('CC-05.10 / FR-05.6: cancel is addressed by jobId — a foreign id cancels nothing, an unknown id on an idle host is a no-op, and cancel is delivered exactly once', async () => {
  const idle = harness(() => ({ duration: 10, windowSec: 5 }))
  await idle.host.cancel('never-started')
  const idleRun = await idle.host.transcribe(transcribeParams('job-after-idle-cancel'))
  expect(idleRun.error).toBeUndefined()
  expect(idleRun.segments.length, 'an idle-host cancel blocks nothing').toBeGreaterThan(0)

  const h = harness(() => ({ duration: 600, windowSec: 5 }))
  const running = h.host.transcribe(transcribeParams('job-addressed'))
  await waitFor(() => h.events.some((e) => e.t === 'job:segments'), 'first window committed')

  const beforeForeign = h.events.length
  await h.host.cancel('not-my-job')
  await waitFor(() => h.events.length > beforeForeign, 'a foreign jobId cancel leaves the run committing')

  await h.host.cancel('job-addressed')
  const result = await running
  expect(result.cancelled).toBe(true)
  expect(result.segments.length, 'committed partials are kept (FR-05.6)').toBeGreaterThan(0)

  await h.host.cancel('job-addressed') // after finalization: no-op
  expect(h.workers[0]!.sent.filter((m) => m.t === 'cancel'), 'protocol cancel delivered exactly once').toHaveLength(1)
})

// --- host lifecycle: options fallbacks + dispose ------------------------------------

test('FR-05.5 (host options): a host without an onEvent listener completes runs; with no T1 configured the plan falls back to the mandatory T2 target', async () => {
  const h = harness(() => ({ duration: 10, windowSec: 5 }), { withOnEvent: false, tiers: { T2: T2_PLAN } })
  const result = await h.host.transcribe(transcribeParams('job-t2-only'))

  expect(result.error).toBeUndefined()
  expect(result.segments.length, 'runs work without a listener').toBeGreaterThan(0)
  expect(result.downgraded, 'a config fallback is not a downgrade').toBe(false)
  expect(h.workers[0]!.sent[0], 'T1 absent → the plan is the mandatory T2 (architecture § Degradation tiers)').toMatchObject({ t: 'loadModel', model: T2_PLAN.modelId, device: 'wasm' })
})

test('FR-05.3 lifecycle: dispose() tears the warm (idle) worker down and settles an active run as cancelled; on a pristine host it is a no-op', async () => {
  const h = harness(() => ({ duration: 10, windowSec: 5 }), { initialTier: 'T2' })
  const done = await h.host.transcribe(transcribeParams('job-dispose-warm'))
  expect(done.error).toBeUndefined()
  expect(h.workers[0]!.terminated, 'a completed run parks its worker warm, not terminated (FR-05.5)').toBe(false)
  h.host.dispose()
  expect(h.workers[0]!.terminated, 'dispose tears the idle warm worker down').toBe(true)

  const h2 = harness(() => ({ duration: 600, windowSec: 5 }), { initialTier: 'T2' })
  const running = h2.host.transcribe(transcribeParams('job-dispose-active'))
  await waitFor(() => h2.events.some((e) => e.t === 'job:segments'), 'run in progress')
  h2.host.dispose()
  const result = await running
  expect(result.cancelled, 'dispose during a run settles it (FR-05.6 semantics; no promise left pending)').toBe(true)
  expect(h2.workers[0]!.terminated).toBe(true)

  const fresh = harness(() => ({ duration: 10, windowSec: 5 }))
  fresh.host.dispose()
  expect(fresh.workers, 'dispose on a pristine host spawns nothing').toHaveLength(0)
})
