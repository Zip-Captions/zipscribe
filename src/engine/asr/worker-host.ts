// Main-thread worker host for `asr.worker` (FR-05.3 / FR-05.5 / FR-05.6 /
// US-1.2.7 / US-05.1) — the `createAsrWorkerHost` ambient-contract
// implementation (tests/unit/asr/unit05-api-contract.d.ts).
//
// Lifecycle: one run at a time against one live worker (kept warm between
// runs, FR-05.5). A fresh epoch spawns through the injected `createWorker`
// DI only (the real Worker glue is `src/workers/asr.worker.ts`, slice C),
// registers `onMessage` BEFORE `loadModel` (the handshake must not be
// racy), waits for `model:ready`, then posts the protocol `transcribe`
// request with both `PcmSource` kinds passed through unchanged.
//
// Commit bookkeeping: `job:progress` records the in-flight window's end,
// `job:segments` commits it (dedupe: only segments past the last committed
// end are kept, so a resume that re-reads a boundary never duplicates a
// block, US-1.2.7). The committed end drives every resume.
//
// Recycling (FR-05.3): terminate → respawn → reload the (cached) model →
// resume with `resumeFromSec` = end of the last committed window, `WORKER_
// RECYCLED` notice; `recycleEveryNWindows` is the CC-05.9 test hook for the
// leak-driven cadence (identical mechanism). Termination happens
// synchronously inside the `job:segments` handler, so the recycled worker
// cannot commit another window.
//
// Degradation (US-1.2.7): a `GPU_OOM`/`SESSION_LOST` `job:error` triggers
// exactly ONE auto-downgrade T1→T2 (worker from the `tiers` plan), `TIER_
// DOWNGRADE` notice emitted once, resume from the last committed window, no
// duplicate blocks; a second such error surfaces the coded error. The
// suppressed downgrade error is not relayed; the surfaced one is.
//
// Cancellation (FR-05.6): `cancel(jobId)` settles immediately (< 2 s) —
// protocol `cancel` to the worker, teardown, abort flag; in-flight and late
// window results are discarded, committed partials kept.
//
// US-05.1: `language === null` without `engineFlags.languageDetect` returns
// the typed `LANGUAGE_REQUIRED` validation BEFORE anything is posted to the
// worker. Detected language relays from `job:done` stats (codes only).
//
// SECURITY-03: host-generated notices/errors carry codes and numbers only;
// transcript text is data, relayed through `segments`, never into detail
// strings. No DOM/SDK globals: the worker arrives through DI
// (`AsrWorkerLike`).

import type { Seconds } from '../model'
import type { AsrEvent, AsrRequest, Device, EngineErrorCode, ModelId, Notice, NoticeCode, PcmSource, RawSegment, Tier } from '../protocol'
import type { EngineFlags } from './transcriber'

/** Worker double seam (the real Worker is message-wrapped; the shared fakes use the same envelope). */
export interface AsrWorkerLike {
  postMessage(message: AsrRequest, transfer?: Transferable[]): void
  onMessage(listener: (event: AsrEvent) => void): () => void
  terminate(): void
}

export interface TierPlan {
  modelId: ModelId
  device: Device
}

export interface AsrHostOptions {
  createWorker: () => AsrWorkerLike
  /** Degradation plan (architecture § Degradation tiers). T2 is the mandatory downgrade target. */
  tiers: { T1?: TierPlan; T2: TierPlan }
  initialTier?: Tier
  /**
   * TEST HOOK (CC-05.9): recycle (terminate + respawn + reload + resume)
   * after every N committed windows. Production uses the leak-driven
   * sampling cadence instead; the mechanism is identical (FR-05.3).
   */
  recycleEveryNWindows?: number
  onEvent?: (event: AsrEvent) => void
}

export interface TranscribeParams {
  jobId: string
  pcm: PcmSource
  sampleRate: 16000
  language: string | null
  resumeFromSec?: Seconds
  /** Registry flags for the selected model (US-05.1 LANGUAGE_REQUIRED validation). */
  engineFlags: EngineFlags
}

export interface AsrRunResult {
  /** Set when the host refused BEFORE posting anything to the worker (US-05.1). */
  validation?: 'LANGUAGE_REQUIRED'
  /** Kept segments — partials are kept on cancel (FR-05.6); late in-flight batches are discarded. */
  segments: RawSegment[]
  cancelled: boolean
  /** True when a single auto-downgrade (T1→T2) occurred this run (US-1.2.7). */
  downgraded: boolean
  /** Number of worker instances spawned (recycle + downgrade observable). */
  workerEpochs: number
  /** Detected language when `language` was null (relayed from the worker; feeds the job:done project update). */
  detectedLanguage?: string | null
  error?: { code: EngineErrorCode; retryable: boolean }
}

export interface AsrWorkerHost {
  transcribe(params: TranscribeParams): Promise<AsrRunResult>
  /** FR-05.6: aborts within 2 s; in-flight window results are discarded, emitted partials kept. */
  cancel(jobId: string): Promise<void>
  dispose(): void
}

/** Error codes that trigger the single auto-downgrade (US-1.2.7). */
const DOWNGRADE_CODES: readonly EngineErrorCode[] = ['GPU_OOM', 'SESSION_LOST']

interface Run {
  params: TranscribeParams
  /** Kept (committed) segments, absolute media seconds, append-only. */
  segments: RawSegment[]
  /** End of the last committed window — the resume position (FR-05.3/US-1.2.7). */
  lastCommittedEnd: Seconds
  /** `processedSec` of the in-flight window (its segments commit it). */
  pendingProgress: Seconds
  committedSinceEpoch: number
  workerEpochs: number
  tier: Tier
  plan: TierPlan
  downgraded: boolean
  aborted: boolean
  finalized: boolean
  detectedLanguage: string | null
  error?: { code: EngineErrorCode; retryable: boolean }
  worker: AsrWorkerLike | null
  unsubscribe: (() => void) | null
  settleReady: (() => void) | null
  resolve: (result: AsrRunResult) => void
  promise: Promise<AsrRunResult>
}

interface WarmWorker {
  worker: AsrWorkerLike
  plan: TierPlan
  unsubscribe: (() => void) | null
}

export function createAsrWorkerHost(opts: AsrHostOptions): AsrWorkerHost {
  let activeRun: Run | null = null
  let warm: WarmWorker | null = null

  function relay(event: AsrEvent): void {
    opts.onEvent?.(event)
  }

  function emitNotice(run: Run, code: NoticeCode, params?: Record<string, string | number>): void {
    const notice: Notice = params === undefined ? { code } : { code, params }
    relay({ t: 'notice', jobId: run.params.jobId, notice })
  }

  function planFor(tier: Tier): TierPlan {
    return tier === 'T1' ? (opts.tiers.T1 ?? opts.tiers.T2) : opts.tiers.T2
  }

  function buildResult(run: Run, cancelled: boolean): AsrRunResult {
    const result: AsrRunResult = {
      segments: run.segments,
      cancelled,
      downgraded: run.downgraded,
      workerEpochs: run.workerEpochs,
      detectedLanguage: run.detectedLanguage,
    }
    if (run.error !== undefined) result.error = run.error
    return result
  }

  function retireWorker(run: Run): void {
    run.unsubscribe?.()
    run.unsubscribe = null
    run.worker?.terminate()
    run.worker = null
  }

  function finishRun(run: Run, cancelled: boolean): void {
    if (run.finalized) return
    run.finalized = true
    if (activeRun === run) activeRun = null
    // Unwind a pending loadModel wait (cancel/error mid-handshake) — the
    // aborted/finalized guard after the await stops any further posting.
    run.settleReady?.()
    run.settleReady = null
    if (!cancelled && run.error === undefined && run.worker !== null) {
      warm = { worker: run.worker, plan: run.plan, unsubscribe: run.unsubscribe }
      run.unsubscribe = null
    }
    run.resolve(buildResult(run, cancelled))
  }

  function attachWorker(run: Run, worker: AsrWorkerLike, plan: TierPlan): void {
    run.unsubscribe?.()
    run.unsubscribe = worker.onMessage((event) => onWorkerEvent(run, event))
    run.worker = worker
    run.plan = plan
    run.workerEpochs += 1
  }

  function postTranscribe(run: Run, resumeFromSec: Seconds | undefined): void {
    if (run.worker === null) return
    const request: Extract<AsrRequest, { t: 'transcribe' }> = {
      t: 'transcribe',
      jobId: run.params.jobId,
      pcm: run.params.pcm,
      sampleRate: run.params.sampleRate,
      language: run.params.language,
    }
    if (resumeFromSec !== undefined) request.resumeFromSec = resumeFromSec
    run.worker.postMessage(request)
  }

  async function startEpoch(run: Run, worker: AsrWorkerLike, plan: TierPlan, resumeFromSec: Seconds | undefined): Promise<void> {
    attachWorker(run, worker, plan)
    const ready = new Promise<void>((resolveReady) => {
      run.settleReady = resolveReady
    })
    worker.postMessage({ t: 'loadModel', model: plan.modelId, device: plan.device })
    await ready
    run.settleReady = null
    if (run.aborted || run.finalized) return
    postTranscribe(run, resumeFromSec)
  }

  /** terminate → respawn → reload → resume (FR-05.3 recycle, US-1.2.7 downgrade). */
  async function respawn(run: Run, plan: TierPlan, resumeFromSec: Seconds): Promise<void> {
    retireWorker(run)
    if (run.aborted || run.finalized) return
    const worker = opts.createWorker()
    await startEpoch(run, worker, plan, resumeFromSec)
  }

  function commitSegments(run: Run, segments: readonly RawSegment[]): void {
    const from = run.lastCommittedEnd
    let maxEnd = from
    for (const segment of segments) {
      if (segment.end > maxEnd) maxEnd = segment.end
    }
    // The paired `job:progress` carries the window end (segment ends can
    // trail the padded window edge); the committed end is the resume point,
    // so a boundary re-read on resume adds no duplicate (end <= from drops).
    run.lastCommittedEnd = Math.max(maxEnd, run.pendingProgress)
    for (const segment of segments) {
      if (segment.end > from) run.segments.push(segment)
    }
    run.committedSinceEpoch += 1
    const cadence = opts.recycleEveryNWindows
    if (cadence !== undefined && cadence > 0 && run.committedSinceEpoch >= cadence) {
      run.committedSinceEpoch = 0
      emitNotice(run, 'WORKER_RECYCLED', { committedWindows: cadence })
      // Synchronous inside the worker's emit: the terminate lands before the
      // worker's loop can commit another window.
      void respawn(run, run.plan, run.lastCommittedEnd)
    }
  }

  function onWorkerEvent(run: Run, event: AsrEvent): void {
    // Cancelled/late events are discarded wholesale (FR-05.6).
    if (run.aborted || run.finalized) return
    switch (event.t) {
      case 'model:ready': {
        relay(event)
        run.settleReady?.()
        run.settleReady = null
        return
      }
      case 'model:progress':
      case 'model:confirm-required': {
        relay(event)
        return
      }
      case 'model:error': {
        relay(event)
        run.error = { code: event.error.code, retryable: event.error.retryable }
        finishRun(run, false)
        retireWorker(run)
        return
      }
      case 'notice': {
        relay(event)
        return
      }
      case 'vad:segments': {
        if (event.jobId !== run.params.jobId) return
        relay(event)
        return
      }
      case 'job:progress': {
        if (event.jobId !== run.params.jobId) return
        run.pendingProgress = Math.max(run.pendingProgress, event.processedSec)
        relay(event)
        return
      }
      case 'job:segments': {
        if (event.jobId !== run.params.jobId) return
        commitSegments(run, event.segments)
        relay(event)
        return
      }
      case 'job:done': {
        if (event.jobId !== run.params.jobId) return
        if (event.stats?.language !== undefined) run.detectedLanguage = event.stats.language
        relay(event)
        finishRun(run, false)
        return
      }
      case 'job:error': {
        if (event.jobId !== run.params.jobId) return
        const code = event.error.code
        if (!run.downgraded && run.plan !== opts.tiers.T2 && DOWNGRADE_CODES.includes(code)) {
          const from = run.tier
          run.downgraded = true
          run.tier = 'T2'
          emitNotice(run, 'TIER_DOWNGRADE', { from, to: 'T2' })
          void respawn(run, opts.tiers.T2, run.lastCommittedEnd)
          return
        }
        relay(event)
        run.error = { code, retryable: event.error.retryable }
        finishRun(run, false)
        retireWorker(run)
        return
      }
    }
  }

  async function transcribe(params: TranscribeParams): Promise<AsrRunResult> {
    // US-05.1: refusal BEFORE any worker boundary — no spawn, no message.
    if (params.language === null && !params.engineFlags.languageDetect) {
      return { validation: 'LANGUAGE_REQUIRED', segments: [], cancelled: false, downgraded: false, workerEpochs: 0, detectedLanguage: null }
    }
    let resolve!: (result: AsrRunResult) => void
    const promise = new Promise<AsrRunResult>((res) => {
      resolve = res
    })
    const tier = opts.initialTier ?? 'T1'
    const run: Run = {
      params,
      segments: [],
      lastCommittedEnd: 0,
      pendingProgress: 0,
      committedSinceEpoch: 0,
      workerEpochs: 0,
      tier,
      plan: planFor(tier),
      downgraded: false,
      aborted: false,
      finalized: false,
      detectedLanguage: null,
      worker: null,
      unsubscribe: null,
      settleReady: null,
      resolve,
      promise,
    }
    activeRun = run
    if (warm !== null) {
      const entry = warm
      warm = null
      entry.unsubscribe?.()
      attachWorker(run, entry.worker, entry.plan)
      if (!run.aborted && !run.finalized) postTranscribe(run, params.resumeFromSec)
    } else {
      // Synchronous through `createWorker` + `loadModel` post so a cancel
      // issued immediately after this call still finds a live worker.
      const worker = opts.createWorker()
      await startEpoch(run, worker, run.plan, params.resumeFromSec)
    }
    return run.promise
  }

  function cancel(jobId: string): Promise<void> {
    const run = activeRun
    if (run === null || run.params.jobId !== jobId || run.finalized) return Promise.resolve()
    run.aborted = true
    if (run.worker !== null) {
      run.worker.postMessage({ t: 'cancel', jobId })
      retireWorker(run)
    }
    warm = null
    finishRun(run, true)
    return Promise.resolve()
  }

  function dispose(): void {
    const run = activeRun
    if (run !== null) void cancel(run.params.jobId)
    if (warm !== null) {
      warm.unsubscribe?.()
      warm.worker.terminate()
      warm = null
    }
  }

  return { transcribe, cancel, dispose }
}
