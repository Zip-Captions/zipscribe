// Adversary suite (unit-05 review): hostile/stateful interleavings against the
// main-thread worker host (FR-05.3 recycle mechanism, FR-05.5/FR-05.6
// cancellation, US-1.2.7 downgrade). The worker double is faithful to
// `src/workers/asr.worker.ts` semantics: cancel/unload messages are DEFERRED
// to event-loop boundaries (a real worker cannot see them mid-task), and the
// final `job:done` is posted in the same task as the last window's
// `job:segments` — before queued cancel messages are processed. Expectations
// are derived from the unit spec (FR-05.3/05.5/05.6, US-1.2.7, CC-05.9/05.10).
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createAsrWorkerHost, type AsrWorkerLike } from '@engine/asr/worker-host'
import type { AsrEvent, AsrRequest, RawSegment } from '@engine/protocol'

const NO_FLAGS = { confidence: false, punctuation: false, languageDetect: false }
const T1_PLAN = { modelId: 'whisper-base-timestamped@608c49e6', device: 'webgpu' as const }
const T2_PLAN = { modelId: 'whisper-tiny-timestamped@5172442937', device: 'wasm' as const }
const BULK_BYTES = 16 * 1024 * 1024 + 8

interface WorkerSpec {
  duration: number
  windowSec: number
  /** > 0 → `model:ready` arrives asynchronously (real model load yields). */
  loadModelDelayMs?: number
  /** Emit ONE coded GPU_OOM when the host's recycle `cancel` lands (teardown-time OOM). */
  emitErrorOnCancel?: boolean
  /** Emit foreign-job events when the host posts recycle `cancel` (poison attempt mid-recycle). */
  foreignEventsOnCancel?: boolean
}

class FaithfulWorker implements AsrWorkerLike {
  readonly sent: AsrRequest[] = []
  readonly postsAfterTerminate: AsrRequest[] = []
  terminated = false
  cancelled = false
  private readonly listeners: ((event: AsrEvent) => void)[] = []
  private readonly inbox: AsrRequest[] = []
  private errorFired = false

  private readonly spec: WorkerSpec

  constructor(spec: WorkerSpec) {
    this.spec = spec
  }

  postMessage(message: AsrRequest): void {
    if (this.terminated) {
      this.postsAfterTerminate.push(message)
      return
    }
    this.sent.push(message)
    if (message.t === 'loadModel') {
      const ready: AsrEvent = { t: 'model:ready', model: message.model, device: message.device }
      if ((this.spec.loadModelDelayMs ?? 0) > 0) setTimeout(() => this.emit(ready), this.spec.loadModelDelayMs)
      else this.emit(ready)
      return
    }
    if (message.t === 'transcribe') {
      void this.loop(message)
      return
    }
    // cancel/unload are QUEUED — a real worker processes messages only on
    // event-loop boundaries, never synchronously inside the current task.
    this.inbox.push(message)
    if (message.t === 'cancel') {
      // Teardown-time surfacing: a WebGPU OOM (or a foreign job's error) can
      // arrive asynchronously while the host is mid-recycle — after the
      // cancel post, before the terminate lands.
      if (this.spec.emitErrorOnCancel && !this.errorFired) {
        this.errorFired = true
        setTimeout(() => this.emit({ t: 'job:error', jobId: message.jobId, error: { code: 'GPU_OOM', retryable: true, detail: 'webgpu_oom' } }), 0)
      }
      if (this.spec.foreignEventsOnCancel) {
        setTimeout(() => {
          this.emit({ t: 'job:error', jobId: 'twin', error: { code: 'GPU_OOM', retryable: true, detail: 'webgpu_oom' } })
          this.emit({ t: 'job:segments', jobId: 'twin', segments: [{ start: 900, end: 900.5, text: 'x', words: [] }] })
        }, 0)
      }
    }
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
  }

  emit(event: AsrEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  private processInbox(): void {
    for (const message of this.inbox.splice(0)) {
      if (message.t === 'cancel') {
        this.cancelled = true
        if (this.spec.emitErrorOnCancel && !this.errorFired) {
          this.errorFired = true
          this.emit({ t: 'job:error', jobId: message.jobId, error: { code: 'GPU_OOM', retryable: true, detail: 'webgpu_oom' } })
        }
        if (this.spec.foreignEventsOnCancel) {
          this.emit({ t: 'job:error', jobId: 'twin', error: { code: 'GPU_OOM', retryable: true, detail: 'webgpu_oom' } })
          this.emit({ t: 'job:segments', jobId: 'twin', segments: [{ start: 900, end: 900.5, text: 'x', words: [] }] })
        }
      }
    }
  }

  private async loop(request: Extract<AsrRequest, { t: 'transcribe' }>): Promise<void> {
    let cursor = request.resumeFromSec ?? 0
    while (cursor < this.spec.duration && !this.cancelled && !this.terminated) {
      const end = Math.min(cursor + this.spec.windowSec, this.spec.duration)
      this.emit({ t: 'job:progress', jobId: request.jobId, processedSec: end, totalSec: this.spec.duration })
      this.emit({ t: 'job:segments', jobId: request.jobId, segments: windowSegments(cursor, end) })
      cursor = end
      if (cursor >= this.spec.duration) {
        // Same task as the final segments: queued cancel/unload NOT yet
        // processed — the real worker posts its protocol job:done here
        // (src/workers/asr.worker.ts posts done after the core returns).
        this.emit({ t: 'job:done', jobId: request.jobId })
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1))
      this.processInbox()
    }
  }
}

function windowSegments(start: number, end: number): RawSegment[] {
  return [{ start, end: Math.min(end, start + 0.9), text: 'tok', words: [{ text: 'tok', start, end: Math.min(end, start + 0.9), timing: 'asr' }] }]
}

function transferParams(buffer: ArrayBuffer) {
  return { jobId: 'j1', pcm: { kind: 'transfer' as const, buffer }, sampleRate: 16000 as const, language: 'en', engineFlags: NO_FLAGS }
}

function harness(spec: WorkerSpec, options: { recycleEveryNWindows?: number } = {}) {
  const workers: FaithfulWorker[] = []
  const notices: AsrEvent[] = []
  const host = createAsrWorkerHost({
    createWorker: () => {
      const worker = new FaithfulWorker(spec)
      workers.push(worker)
      return worker
    },
    tiers: { T1: T1_PLAN, T2: T2_PLAN },
    ...(options.recycleEveryNWindows !== undefined ? { recycleEveryNWindows: options.recycleEveryNWindows } : {}),
    onEvent: (event) => {
      if (event.t === 'notice') notices.push(event)
    },
  })
  return { workers, host, notices }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'TIMEOUT'> {
  return Promise.race([promise, new Promise<'TIMEOUT'>((resolve) => setTimeout(() => resolve('TIMEOUT'), ms))])
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adversary: recycle racing job:done on the LAST window (FR-05.3 mechanism, FR-05.5 warm lifecycle)', () => {
  test('no respawn after done, and the host must not hand a TERMINATED worker to the next run', async () => {
    // cadence fires on the final window commit; retireForRecycle yields
    // (setTimeout) while the worker's job:done — same task as the final
    // segments — finalizes the run first. The terminate still lands.
    const { workers, host } = harness({ duration: 2, windowSec: 1 }, { recycleEveryNWindows: 2 })
    const result = await host.transcribe(transferParams(new ArrayBuffer(4096)))
    expect(result.cancelled).toBe(false)
    expect(result.segments).toHaveLength(2)

    // (1) no respawn after done — the recycle must NOT spawn a new epoch.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(workers).toHaveLength(1) // respawn bailed after the finalize check
    expect(workers[0]!.terminated).toBe(true) // the doomed worker WAS terminated

    // (2) FR-05.5 host lifecycle: the kept-warm worker must be usable. The
    // host terminated the warm worker while finalizing the racy recycle →
    // the next run would post into a dead worker and never settle.
    const run2 = host.transcribe(transferParams(new ArrayBuffer(4096)))
    const raced = await withTimeout(run2, 750)
    expect(raced, 'the host kept a TERMINATED worker as warm: the next run never posts to a live worker').not.toBe('TIMEOUT')
    expect(workers[0]!.postsAfterTerminate, 'transcribe must never be posted to a terminated worker').toEqual([])
    host.dispose()
  })
})

describe('adversary: GPU_OOM surfacing while a recycle is in flight (FR-05.3 "terminate, respawn", leak containment)', () => {
  test('downgrade mid-recycle must not orphan a live (loaded) worker — every retired epoch is terminated', async () => {
    // Timeline: cadence recycle posts cancel+unload; the doomed worker then
    // surfaces GPU_OOM (teardown-time OOM is exactly what US-1.2.7 covers) →
    // single downgrade + a second recycle. With an asynchronous model load the
    // first respawned worker is left attached-then-detached and NEVER
    // terminated while the second respawn completes the run.
    const { workers, host, notices } = harness({ duration: 4, windowSec: 1, loadModelDelayMs: 5, emitErrorOnCancel: true }, { recycleEveryNWindows: 3 })
    const result = await host.transcribe(transferParams(new ArrayBuffer(4096)))

    expect(result.error, 'the run completes via the downgrade, it does not error out').toBeUndefined()
    expect(result.downgraded).toBe(true)
    expect(notices.filter((n) => n.t === 'notice' && n.notice.code === 'TIER_DOWNGRADE')).toHaveLength(1) // "auto-downgrades to T2 ONCE"
    expect(notices.filter((n) => n.t === 'notice' && n.notice.code === 'WORKER_RECYCLED')).toHaveLength(1)
    // Block-for-block sane: windows 0..4 committed exactly once each.
    expect(result.segments.map((s) => s.start)).toEqual([0, 1, 2, 3])

    // FR-05.3: recycling is terminate → respawn. A worker that was spawned
    // and then superseded must be terminated — at most ONE worker may stay
    // alive (the warm one). An un-terminated live worker holding a loaded
    // model is precisely the leak the unit exists to contain (FR-05.3,
    // CC-05.1 memory gate).
    const live = workers.filter((w) => !w.terminated)
    expect(live.length, `every retired epoch must be terminated (FR-05.3); live workers: ${live.length} of ${workers.length}`).toBeLessThanOrEqual(1)
    host.dispose()
  })
})

describe('adversary: PCM broker dying between slice posts (CC-05.3 off-main-thread path)', () => {
  test('broker crash AFTER owning the buffer must still post the recycle resume (FR-05.3 respawn→reload→resume)', async () => {
    interface BrokerRequest {
      t: string
      buffer?: ArrayBuffer
      requestId?: number
    }
    let cloneServed = 0
    const brokers: { requests: BrokerRequest[]; terminated: boolean }[] = []
    vi.stubGlobal(
      'Worker',
      class {
        readonly requests: BrokerRequest[] = []
        terminated = false
        private held: ArrayBuffer | null = null
        private readonly listeners = new Map<string, ((event: { data: unknown }) => void)[]>()

        constructor() {
          brokers.push(this)
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
            this.dispatch('message', { t: 'ready' })
            return
          }
          if (message.t === 'own') {
            if (message.buffer instanceof ArrayBuffer) this.held = message.buffer
            return
          }
          if (message.t === 'clone' && typeof message.requestId === 'number') {
            if (cloneServed >= 1) return // broker CRASHES after serving the first clone
            cloneServed += 1
            const copy = (this.held ?? new ArrayBuffer(0)).slice(0)
            this.dispatch('message', { t: 'clone', requestId: message.requestId, buffer: copy })
          }
        }

        terminate(): void {
          this.terminated = true
        }

        private dispatch(type: string, data: unknown): void {
          for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ data })
        }
      },
    )

    const { workers, host } = harness({ duration: 2, windowSec: 1 }, { recycleEveryNWindows: 1 })
    const original = new ArrayBuffer(BULK_BYTES)
    const raced = await withTimeout(host.transcribe(transferParams(original)), 750)

    // FR-05.3: the recycle must respawn, reload and RESUME. If the host
    // silently waits forever for a clone from a dead broker, the run never
    // posts transcribe to the respawned worker.
    expect(raced, 'postTranscribe hung on a dead broker after owning the buffer (worker-host.ts:325 fallback is unreachable)').not.toBe('TIMEOUT')
    expect(workers).toHaveLength(2)
    expect(
      workers[1]!.sent.some((m) => m.t === 'transcribe'),
      'the respawned epoch must receive the resume transcribe post',
    ).toBe(true)
    host.dispose()
  })
})

describe('adversary: cancellation protocol edges (FR-05.6)', () => {
  test('two cancel() calls settle once — exactly one protocol cancel reaches the worker', async () => {
    const { workers, host } = harness({ duration: 60, windowSec: 1 })
    const run = host.transcribe(transferParams(new ArrayBuffer(4096)))
    await new Promise((resolve) => setTimeout(resolve, 5)) // ~4 windows in — definitely mid-run
    await Promise.all([host.cancel('j1'), host.cancel('j1')])
    const result = await run
    expect(result.cancelled).toBe(true)
    expect(workers[0]!.sent.filter((m) => m.t === 'cancel')).toHaveLength(1)
  })

  test('cancel after job:done is a no-op — no cancel is posted, result stays stable', async () => {
    const { workers, host } = harness({ duration: 1, windowSec: 1 })
    const first = await host.transcribe(transferParams(new ArrayBuffer(4096)))
    expect(first.cancelled).toBe(false)
    await host.cancel('j1')
    expect(first.cancelled, 'a settled run is not re-cancelled').toBe(false)
    const cancels = workers[0]!.postsAfterTerminate.length + workers[0]!.sent.filter((m) => m.t === 'cancel').length
    expect(cancels, 'FR-05.6: cancel only applies to an active run').toBe(0)
    host.dispose()
  })
})

describe('adversary: hostile worker streams (FR-05.5 dedupe discipline, jobId discrimination)', () => {
  test('duplicate RawSegments re-sent across a stride seam are absorbed (no duplicate blocks)', async () => {
    class SeamWorker implements AsrWorkerLike {
      terminated = false
      private readonly listeners: ((event: AsrEvent) => void)[] = []

      postMessage(message: AsrRequest): void {
        if (message.t === 'loadModel') this.emit({ t: 'model:ready', model: message.model, device: message.device })
        if (message.t === 'transcribe') {
          this.emit({ t: 'job:progress', jobId: message.jobId, processedSec: 1, totalSec: 1 })
          const seg = windowSegments(0, 1)[0]!
          this.emit({ t: 'job:segments', jobId: message.jobId, segments: [seg] })
          this.emit({ t: 'job:segments', jobId: message.jobId, segments: [{ ...seg }] }) // stride-seam re-send
          this.emit({ t: 'job:done', jobId: message.jobId })
        }
      }

      onMessage(listener: (event: AsrEvent) => void): () => void {
        this.listeners.push(listener)
        return () => {}
      }

      terminate(): void {
        this.terminated = true
      }

      private emit(event: AsrEvent): void {
        for (const listener of [...this.listeners]) listener(event)
      }
    }
    const host = createAsrWorkerHost({ createWorker: () => new SeamWorker(), tiers: { T1: T1_PLAN, T2: T2_PLAN } })
    const result = await host.transcribe(transferParams(new ArrayBuffer(4096)))
    expect(result.segments).toHaveLength(1) // the seam duplicate is dropped
  })

  test('an out-of-order (late) batch is handled per the host dedupe contract — no duplicates, run intact', async () => {
    class LateBatchWorker implements AsrWorkerLike {
      terminated = false
      private readonly listeners: ((event: AsrEvent) => void)[] = []

      postMessage(message: AsrRequest): void {
        if (message.t === 'loadModel') this.emit({ t: 'model:ready', model: message.model, device: message.device })
        if (message.t === 'transcribe') {
          this.emit({ t: 'job:progress', jobId: message.jobId, processedSec: 11, totalSec: 11 })
          this.emit({ t: 'job:segments', jobId: message.jobId, segments: windowSegments(10, 11) })
          this.emit({ t: 'job:segments', jobId: message.jobId, segments: windowSegments(5, 6) }) // LATE (violates FR-05.5 "sorted" streaming)
          this.emit({ t: 'job:done', jobId: message.jobId })
        }
      }

      onMessage(listener: (event: AsrEvent) => void): () => void {
        this.listeners.push(listener)
        return () => {}
      }

      terminate(): void {
        this.terminated = true
      }

      private emit(event: AsrEvent): void {
        for (const listener of [...this.listeners]) listener(event)
      }
    }
    const host = createAsrWorkerHost({ createWorker: () => new LateBatchWorker(), tiers: { T1: T1_PLAN, T2: T2_PLAN } })
    const result = await host.transcribe(transferParams(new ArrayBuffer(4096)))
    // The documented host rule (worker-host.ts "only segments past the last
    // committed end are kept"): a protocol-violating late batch is absorbed
    // without corrupting the run (no duplicates, no error).
    expect(result.error).toBeUndefined()
    expect(result.cancelled).toBe(false)
    expect(result.segments.map((s) => s.start)).toEqual([10])
  })

  test('a foreign-jobId GPU_OOM arriving mid-recycle must not downgrade or corrupt the run (US-1.2.7 discrimination)', async () => {
    const { workers, host, notices } = harness({ duration: 3, windowSec: 1, foreignEventsOnCancel: true }, { recycleEveryNWindows: 1 })
    const result = await host.transcribe(transferParams(new ArrayBuffer(4096)))
    expect(result.downgraded, "a foreign job:error is not this run's OOM").toBe(false)
    expect(result.error, "the foreign error must not surface as this run's error").toBeUndefined()
    expect(notices.filter((n) => n.t === 'notice' && n.notice.code === 'TIER_DOWNGRADE')).toHaveLength(0)
    expect(result.segments.map((s) => s.start)).toEqual([0, 1, 2]) // every window committed once, across the recycle
    expect(workers.length).toBeGreaterThanOrEqual(3) // recycles did happen (cadence 1)
    host.dispose()
  })
})
