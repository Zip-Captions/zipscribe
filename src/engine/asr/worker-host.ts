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
// leak-driven cadence (identical mechanism). Termination is NOT synchronous
// inside the `job:segments` handler: `retireForRecycle` first yields one
// event-loop turn (setTimeout(0)) so the dying worker can free its heaps
// before `terminate()`. A late `job:segments` arriving during that yield is
// made harmless by the commit dedupe in `commitSegments` (only segments
// past the last committed end are kept), not by synchronous termination.
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
// CC-05.3 (bulk-PCM zero-copy): posting a `{kind:'transfer', buffer}`
// request deep-clones the buffer on the MAIN thread per epoch (~120-250 ms
// for 460 MB — a long task). When `Worker` exists the host hands the buffer
// once to `src/workers/pcm-broker.worker.ts` (O(1) ownership transfer) and
// asks it for a fresh off-thread clone per post, transferring that straight
// into `asr.worker` — the main thread never serializes bulk PCM. Without a
// `Worker` global (unit-test environments) the request posts directly,
// unchanged.
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

/** Below this size the direct main-thread clone is far under the 50 ms budget — no broker hop. */
const PCM_BROKER_MIN_BYTES = 16 * 1024 * 1024

/**
 * Recycle drain (retireForRecycle): wait until the doomed epoch's message
 * stream has been quiet for QUIET_MS, hard-capped at MAX_MS so a wedged
 * worker can never hang the recycle. FR-05.6's cancel is contractually
 * ≤ 2 s; MAX_MS leaves 1 s for the queued `unload` to run and settle.
 */
const RECYCLE_DRAIN_QUIET_MS = 150
const RECYCLE_DRAIN_MAX_MS = 3_000

/**
 * Zombie-broker backstop (FR-05.3 "resume"): a real crashed worker reports
 * itself through the `error` event, but one that merely stops answering
 * clone requests (OOM-killed queue, wedged loop) must not hang the recycle
 * resume forever. An off-thread clone measures in the low hundreds of ms
 * (file header); expiry past this budget means the broker is dead — pending
 * clones resolve null, the run takes the direct fallback and the next bulk
 * post respawns a fresh broker.
 */
const PCM_CLONE_WATCHDOG_MS = 500

/** Message-wrapped view of `src/workers/pcm-broker.worker.ts` (private wire format, not the ASR protocol). */
interface BrokerPortLike {
  postMessage(message: { t: string; requestId?: number; buffer?: ArrayBuffer }, transfer?: Transferable[]): void
  onMessage(listener: (message: { t?: string; requestId?: number; buffer?: ArrayBuffer }) => void): () => void
  terminate(): void
}

interface PcmBroker {
  port: BrokerPortLike
  ready: Promise<boolean>
  nextRequestId: number
  pending: Map<number, (buffer: ArrayBuffer | null) => void>
  /** True once the broker answered `ready` (it then owns whatever it was given). */
  served: boolean
  dead: boolean
}

function createPcmBroker(onDeath: (broker: PcmBroker) => void): PcmBroker | null {
  if (typeof Worker === 'undefined') return null
  const raw = new Worker(new URL('../../workers/pcm-broker.worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, (buffer: ArrayBuffer | null) => void>()
  const port: BrokerPortLike = {
    postMessage: (message, transfer) => raw.postMessage(message, transfer === undefined ? undefined : { transfer }),
    onMessage: (listener) => {
      const handler = (event: MessageEvent<{ t?: string; requestId?: number; buffer?: ArrayBuffer }>) => listener(event.data)
      raw.addEventListener('message', handler)
      return () => raw.removeEventListener('message', handler)
    },
    terminate: () => raw.terminate(),
  }
  const broker: PcmBroker = { port, ready: Promise.resolve(false), nextRequestId: 0, pending, served: false, dead: false }
  broker.ready = new Promise<boolean>((resolveReady) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (!settled) {
        settled = true
        resolveReady(ok)
      }
    }
    port.onMessage((msg) => {
      if (msg.t === 'ready') {
        broker.served = true
        finish(true)
        return
      }
      if (msg.t === 'clone' && typeof msg.requestId === 'number' && msg.buffer instanceof ArrayBuffer) {
        const resolveClone = pending.get(msg.requestId)
        if (resolveClone !== undefined) {
          pending.delete(msg.requestId)
          resolveClone(msg.buffer)
        }
      }
    })
    raw.addEventListener('error', () => {
      finish(false)
      onDeath(broker)
    })
    port.postMessage({ t: 'ready' })
    setTimeout(() => finish(false), 5000)
  })
  return broker
}

interface Run {
  params: TranscribeParams
  /** Kept (committed) segments, absolute media seconds, append-only. */
  segments: RawSegment[]
  /** End of the last committed window — the resume position (FR-05.3/US-1.2.7). */
  lastCommittedEnd: Seconds
  /** `processedSec` of the in-flight window (its segments commit it). */
  pendingProgress: Seconds
  committedSinceEpoch: number
  /** A cadence recycle is draining/respawning (single-flight, `kickRecycle`). */
  recycleInFlight?: boolean
  /** A cadence trigger arrived while `recycleInFlight` was set. */
  recyclePending?: boolean
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
  let brokerPromise: Promise<PcmBroker | null> | null = null
  /** The buffer the broker currently owns (detached on the page once set). */
  let brokerOwned: ArrayBuffer | null = null
  /**
   * Every worker this host terminated (or doomed to be terminated by an
   * in-flight recycle). A doomed worker must never be adopted warm (FR-05.5
   * keeps only a USABLE worker), and a superseded live epoch must be
   * terminated like any retired one (FR-05.3 "terminate, respawn").
   */
  const terminatedWorkers = new WeakSet<AsrWorkerLike>()
  /** Wall-clock ms of the most recent message from any attached worker —
   *  the quiet detector for `retireForRecycle`'s drain. */
  let lastWorkerMessageAt = 0

  function ensurePcmBroker(): Promise<PcmBroker | null> {
    if (brokerPromise === null) {
      brokerPromise = Promise.resolve(createPcmBroker(markBrokerDead)).then((broker) => {
        if (broker === null) return null
        return broker.ready.then((ok) => (ok ? broker : null))
      })
    }
    return brokerPromise
  }

  /**
   * Broker death (crash event or watchdog expiry): fail every pending clone
   * null (callers take the direct fallback — FR-05.3 "resume") and, for a
   * broker that had gone live, drop the ownership record and the cache so
   * the next bulk post respawns a fresh broker (FR-05.3 "respawn").
   */
  function markBrokerDead(broker: PcmBroker): void {
    if (broker.dead) return
    broker.dead = true
    for (const resolveClone of broker.pending.values()) resolveClone(null)
    broker.pending.clear()
    broker.port.terminate()
    brokerOwned = null
    if (broker.served) brokerPromise = null
  }

  /**
   * Hand `buffer` to the broker (once) and receive a fresh off-thread clone
   * for one `transcribe` post. Resolves null when the broker is unavailable
   * or died (caller must fall back to the direct — cloning — post).
   */
  async function requestPcmClone(buffer: ArrayBuffer): Promise<ArrayBuffer | null> {
    const broker = await ensurePcmBroker()
    if (broker === null || broker.dead) return null
    if (brokerOwned !== buffer) {
      try {
        broker.port.postMessage({ t: 'own', buffer }, [buffer])
      } catch {
        markBrokerDead(broker)
        return null
      }
      brokerOwned = buffer
    }
    const requestId = (broker.nextRequestId += 1)
    return new Promise<ArrayBuffer | null>((resolveClone) => {
      const watchdog = setTimeout(() => {
        if (broker.pending.delete(requestId)) {
          markBrokerDead(broker)
          // The broker may have died after we recorded ownership (the own
          // post to a dead port is dropped, never detached): clear the stale
          // record so the direct fallback below is reachable (FR-05.3).
          if (brokerOwned === buffer) brokerOwned = null
          resolveClone(null)
        }
      }, PCM_CLONE_WATCHDOG_MS)
      broker.pending.set(requestId, (copy) => {
        clearTimeout(watchdog)
        resolveClone(copy)
      })
      broker.port.postMessage({ t: 'clone', requestId })
    })
  }

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
    const worker = run.worker
    if (worker !== null) {
      terminatedWorkers.add(worker)
      worker.terminate()
    }
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
    // FR-05.5: only a WORKER may be kept warm — a worker a recycle has
    // doomed (terminate pending) must never be adopted (FR-05.3 race).
    if (!cancelled && run.error === undefined && run.worker !== null && !terminatedWorkers.has(run.worker)) {
      warm = { worker: run.worker, plan: run.plan, unsubscribe: run.unsubscribe }
      run.unsubscribe = null
    }
    run.resolve(buildResult(run, cancelled))
  }

  function attachWorker(run: Run, worker: AsrWorkerLike, plan: TierPlan): void {
    const superseded = run.worker
    run.unsubscribe?.()
    run.unsubscribe = null
    // FR-05.3: every retired epoch is terminated. A live worker that a new
    // epoch replaces without having gone through a retire path (concurrent
    // recycle + downgrade race) would otherwise orphan its loaded model.
    if (superseded !== null && superseded !== worker && !terminatedWorkers.has(superseded)) {
      terminatedWorkers.add(superseded)
      superseded.terminate()
    }
    // Release a superseded epoch's loadModel wait — its postTranscribe
    // re-checks run.worker and will not post into the new epoch.
    run.settleReady?.()
    run.settleReady = null
    run.unsubscribe = worker.onMessage((event) => {
      lastWorkerMessageAt = Date.now()
      onWorkerEvent(run, event)
    })
    run.worker = worker
    run.plan = plan
    run.workerEpochs += 1
  }

  async function postTranscribe(run: Run, worker: AsrWorkerLike, resumeFromSec: Seconds | undefined): Promise<void> {
    const request: Extract<AsrRequest, { t: 'transcribe' }> = {
      t: 'transcribe',
      jobId: run.params.jobId,
      pcm: run.params.pcm,
      sampleRate: run.params.sampleRate,
      language: run.params.language,
    }
    if (resumeFromSec !== undefined) request.resumeFromSec = resumeFromSec
    const pcm = run.params.pcm
    // Once the broker OWNS a buffer, every epoch must go through it — the
    // original is detached on the page, so a direct post would DataCloneError.
    // (A detached ArrayBuffer reports byteLength 0 — `owned === pcm.buffer`
    // is the only reliable "already transferred" test.)
    const brokerEligible = pcm.kind === 'transfer' && (pcm.buffer === brokerOwned || pcm.buffer.byteLength >= PCM_BROKER_MIN_BYTES)
    if (brokerEligible) {
      // CC-05.3: clone on the broker thread, transfer in and out — the main
      // thread posts only the request shell + the ownership move. If the
      // run/worker went away while cloning, the copy is dropped (GC) and
      // nothing is posted.
      const clone = await requestPcmClone(pcm.buffer)
      if (clone !== null) {
        if (run.worker !== worker || run.aborted || run.finalized) return
        worker.postMessage({ ...request, pcm: { kind: 'transfer', buffer: clone } }, [clone])
        return
      }
      // Broker unavailable or respawned (watchdog): fall through to the
      // direct post so a recycle resume never waits on a dead broker
      // (FR-05.3). Only while the broker still verifiably OWNS this exact
      // buffer (original detached on the page) is a direct post forbidden.
      if (brokerOwned === pcm.buffer) return
    }
    if (run.worker !== worker || run.aborted || run.finalized) return
    try {
      worker.postMessage(request)
    } catch {
      // Only reachable when the original buffer is detached with no live
      // broker to clone from — the resume is unrecoverable; surface a coded
      // error (SECURITY-03: codes/numbers only) instead of hanging.
      run.error = { code: 'ENGINE_INTERNAL', retryable: false }
      retireWorker(run)
      finishRun(run, false)
    }
  }

  async function startEpoch(run: Run, worker: AsrWorkerLike, plan: TierPlan, resumeFromSec: Seconds | undefined): Promise<void> {
    attachWorker(run, worker, plan)
    let settle!: () => void
    const ready = new Promise<void>((resolveReady) => {
      settle = resolveReady
    })
    run.settleReady = settle
    worker.postMessage({ t: 'loadModel', model: plan.modelId, device: plan.device })
    await ready
    // Only release OUR own wait — a superseded epoch woken by attachWorker's
    // release must never clear the successor epoch's resolver.
    if (run.settleReady === settle) run.settleReady = null
    if (run.aborted || run.finalized) return
    await postTranscribe(run, worker, resumeFromSec)
  }

  /**
   * Let the dying worker free its big heaps (loop abort + `unload` session
   * dispose) one event-loop turn BEFORE `terminate()` (which drops queued
   * messages and would strand the weights until the dead-context GC). Keeps
   * the recycled-epoch footprint tiny so CC-05.2's heap sampler never counts
   * stranded weights as growth. Termination stays synchronous after the yield.
   */
  async function retireForRecycle(run: Run): Promise<void> {
    const doomed = run.worker
    if (doomed !== null) {
      // Mark BEFORE the yield: the final window's `job:done` can finalize the
      // run inside this yield, and a doomed worker must never be adopted warm.
      terminatedWorkers.add(doomed)
      doomed.postMessage({ t: 'cancel', jobId: run.params.jobId })
      doomed.postMessage({ t: 'unload' })
    }
    await new Promise<void>((yieldTurn) => {
      setTimeout(yieldTurn, 0)
    })
    // Drain the doomed epoch's message stream BEFORE terminate(): `cancel`
    // only lands between generation tokens (FR-05.6 aborts within 2 s), and
    // an `unload` queued behind a running window would be stranded by
    // terminate() — the dead-context GC then holds the weights for arbitrary
    // time (CC-05.2 reference-hardware flake, 2026-11-09: 870/918 MB of
    // stranded generations sampled as growth). Wait until the stream goes
    // quiet; bounded so a wedged worker can never hang the recycle (FR-05.3
    // resume budget): cancel is contractually ≤ 2 s, + 1 s for the queued
    // unload to run and settle.
    if (doomed !== null) {
      const deadline = Date.now() + RECYCLE_DRAIN_MAX_MS
      // A finalized/aborted run resumes nothing — the drain's only purpose
      // is a clean handover to the successor; terminate straight away.
      while (Date.now() < deadline && !run.finalized && !run.aborted && Date.now() - lastWorkerMessageAt < RECYCLE_DRAIN_QUIET_MS) {
        await new Promise<void>((tick) => {
          setTimeout(tick, 50)
        })
      }
    }
    if (run.worker === doomed) retireWorker(run)
    else doomed?.terminate()
  }

  /** terminate → respawn → reload → resume (FR-05.3 recycle, US-1.2.7 downgrade). */
  async function respawn(run: Run, plan: TierPlan, resumeFromSec: Seconds): Promise<void> {
    await retireForRecycle(run)
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
      kickRecycle(run)
    }
  }

  /**
   * Single-flight cadence recycle: `retireForRecycle` drains the doomed
   * epoch for up to RECYCLE_DRAIN_MAX_MS, and windows committed during that
   * drain must not stack concurrent respawns (each would supersede its
   * sibling and churn worker generations). One recycle runs at a time; a
   * trigger arriving mid-flight re-kicks the recycle when it completes.
   */
  function kickRecycle(run: Run): void {
    if (run.recycleInFlight === true) {
      run.recyclePending = true
      return
    }
    run.recycleInFlight = true
    emitNotice(run, 'WORKER_RECYCLED', { committedWindows: opts.recycleEveryNWindows ?? 0 })
    void respawn(run, run.plan, run.lastCommittedEnd).finally(() => {
      run.recycleInFlight = false
      if (run.recyclePending === true) {
        run.recyclePending = false
        if (!run.aborted && !run.finalized) kickRecycle(run)
      }
    })
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
    // FR-05.5 host lifecycle: only a WORKABLE worker may be reused — a warm
    // entry terminated after parking (or while a recycle doomed it) is
    // discarded and the run respawns, never posting into a corpse.
    if (warm !== null && terminatedWorkers.has(warm.worker)) warm = null
    if (warm !== null) {
      const entry = warm
      warm = null
      entry.unsubscribe?.()
      attachWorker(run, entry.worker, entry.plan)
      if (!run.aborted && !run.finalized) void postTranscribe(run, entry.worker, params.resumeFromSec)
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
      terminatedWorkers.add(warm.worker)
      warm.worker.terminate()
      warm = null
    }
    brokerOwned = null
    if (brokerPromise !== null) {
      const settling = brokerPromise
      brokerPromise = null
      void settling.then((broker) => broker?.port.terminate())
    }
  }

  return { transcribe, cancel, dispose }
}
