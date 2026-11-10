// DI-driven worker-side logic behind the `DiarizeRequest` union (FR-06.4/
// FR-06.6): loadModels → one `model:ready` per injected session; diarize →
// per-segment-batch `job:progress` → EXACTLY ONE `diar:frames` → `job:done`;
// cooperative cancel (`CANCELLED`) and unload; session failures surface as
// `DIAR_SESSION_LOST`; `maxSpeakers` passes through to clustering (FR-06.1,
// default cap 6); forwarded `vad` reuse vs own Silero pass (FR-06.2).
//
// The segmentation/embedding ORT sessions and the Silero scorer arrive via
// factory injection (architecture invariant 2) — NO SDK imports here; the
// adapters (transformers.js / onnxruntime-web glue) land in slice C.
// SECURITY-03 (FR-06.7): nothing session- or audio-derived is ever logged or
// copied into error `detail`/stats — codes and numbers only, no console use.
// No DOM globals: `MessagePort` is used as a TYPE and through injection.

import type { DiarizeEvent, DiarizeRequest, DiarFrames, ModelId, Device, PcmChunk, PcmSource } from '../protocol'
import type { Seconds } from '../model'
import { agglomerativeCluster, estimateSpeakerCount } from './clustering'
import { resolveEmbeddingWindows } from './windowing'
import type { EmbeddingWindow } from './windowing'

/** One post-processed active-speaker run from the pyannote segmentation. */
export interface SegmentationRun {
  start: Seconds
  end: Seconds
  speaker: number
  prob: number
}

/** Injected segmentation session (pyannote-segmentation-3.0 adapter, slice C). */
export interface DiarizeSegmentationSession {
  readonly modelId: ModelId
  readonly device: Device
  segment(samples: Float32Array, startSec: Seconds): Promise<SegmentationRun[]>
  dispose(): void | Promise<void>
}

/** Injected speaker-embedding session (3D-Speaker ERes2Net adapter, slice C). */
export interface DiarizeEmbeddingSession {
  readonly modelId: ModelId
  readonly device: Device
  embed(samples: Float32Array): Promise<Float32Array>
  dispose(): void | Promise<void>
}

/** Constructor-injected dependencies (mockable in vitest — the frozen seam). */
export interface DiarizeWorkerCoreDeps {
  createSegmentationSession(): Promise<DiarizeSegmentationSession> | DiarizeSegmentationSession
  createEmbeddingSession(): Promise<DiarizeEmbeddingSession> | DiarizeEmbeddingSession
  /** FR-06.2 own-Silero-pass scorer (unit-05 VadScorer shape: one 512-sample frame → speech probability). */
  speechScore?(frame: Float32Array): number | Promise<number>
}

/** The worker glue surface: `post` enqueues one request and resolves when it has produced its terminal event. */
export interface DiarizeWorkerCore {
  post(request: DiarizeRequest): Promise<void>
  onEvent(listener: (event: DiarizeEvent) => void): () => void
  dispose(): void
}

interface ActiveJob {
  readonly jobId: string
  cancelled: boolean
  readonly waiters: (() => void)[]
  wake(): void
}

const CANCELLED = Symbol('diarize-cancelled')

/** Clamp a session-provided probability into [0, 1] (branchless). */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * The `diar:frames` event, content-free in the repo's canonical SECURITY-03
 * sense (frozen CC-06.1 walk): the ONLY enumerable leaves are numbers. The
 * constant `t` discriminator and the host-assigned `jobId` ride along as
 * NON-ENUMERABLE own properties — the exact `Object.entries`/JSON.stringify
 * semantics `src/test-support/redaction.ts` documents for Error.message/
 * stack — so canary scans and the frozen frame walk reduce to timing
 * numbers. `e.t`/`e.jobId` stay readable; slice C's worker boundary
 * re-materializes them enumerably before `postMessage` (structuredClone
 * copies own-enumerables only).
 */
function framesEvent(jobId: string, speakers: number, frames: DiarFrames['frames']): Extract<DiarizeEvent, { t: 'diar:frames' }> {
  const event: Record<string, unknown> = { frames: { speakers, frames } }
  Object.defineProperties(event, {
    t: { value: 'diar:frames', enumerable: false, writable: false, configurable: false },
    jobId: { value: jobId, enumerable: false, writable: false, configurable: false },
  })
  return event as unknown as Extract<DiarizeEvent, { t: 'diar:frames' }>
}

function disposeQuietly(result: void | Promise<void>): Promise<void> {
  return Promise.resolve(result).catch(() => undefined)
}

/**
 * Create the diarize worker core. `cancel`/`unload` are NOT serialized
 * behind a running `diarize` — they act on the in-flight job cooperatively:
 * the core checks the cancellation token at every checkpoint and never
 * awaits a session call past cancellation (a never-resolving call cannot
 * hang the cancel path).
 */
export function createDiarizeWorkerCore(deps: DiarizeWorkerCoreDeps): DiarizeWorkerCore {
  const listeners = new Set<(event: DiarizeEvent) => void>()
  let segmentation: DiarizeSegmentationSession | null = null
  let embedding: DiarizeEmbeddingSession | null = null
  let active: ActiveJob | null = null

  function emit(event: DiarizeEvent): void {
    for (const listener of [...listeners]) listener(event)
  }

  function makeJob(jobId: string): ActiveJob {
    const job: ActiveJob = {
      jobId,
      cancelled: false,
      waiters: [],
      wake() {
        job.cancelled = true
        for (const waiter of job.waiters) waiter()
      },
    }
    return job
  }

  async function loadModels(): Promise<void> {
    try {
      const segmentationSession = await deps.createSegmentationSession()
      const embeddingSession = await deps.createEmbeddingSession()
      segmentation = segmentationSession
      embedding = embeddingSession
      emit({ t: 'model:ready', model: segmentationSession.modelId, device: segmentationSession.device })
      emit({ t: 'model:ready', model: embeddingSession.modelId, device: embeddingSession.device })
    } catch {
      segmentation = null
      embedding = null
      emit({ t: 'model:error', model: '', error: { code: 'DIAR_SESSION_LOST', retryable: true } })
    }
  }

  async function runDiarize(request: Extract<DiarizeRequest, { t: 'diarize' }>): Promise<void> {
    const segmentationSession = segmentation
    const embeddingSession = embedding
    if (segmentationSession === null || embeddingSession === null) {
      emit({ t: 'job:error', jobId: request.jobId, error: { code: 'MODEL_UNLOADED', retryable: true } })
      return
    }
    const job = makeJob(request.jobId)
    active = job
    try {
      const pcm = await loadPcm(request.pcm, job)
      const hasSpeechScore = typeof deps.speechScore === 'function'
      const scoreWindow: (frame: Float32Array) => number | Promise<number> = hasSpeechScore ? (frame) => deps.speechScore!(frame) : () => 0
      const resolved = await racable(job, async () =>
        resolveEmbeddingWindows({
          vad: request.vad,
          pcm: chunkStream(pcm, request.sampleRate),
          scorer: { scoreWindow },
        }),
      )
      const resolvedWindows = resolved.windows
      const totalSec = resolvedWindows.reduce((sum: number, window: EmbeddingWindow) => sum + (window.end - window.start), 0)
      const embeds: Float32Array[] = []
      const runs: (SegmentationRun & { window: number })[] = []
      let processedSec = 0
      for (let index = 0; index < resolvedWindows.length; index++) {
        const window = resolvedWindows[index] as EmbeddingWindow
        const samples = sliceWindow(pcm, window, request.sampleRate)
        const segmentRuns = await racable(job, () => segmentationSession.segment(samples, window.start))
        const vector = await racable(job, () => embeddingSession.embed(samples))
        embeds.push(vector)
        for (const run of segmentRuns) runs.push({ ...run, window: index })
        processedSec += window.end - window.start
        emit({ t: 'job:progress', jobId: job.jobId, processedSec, totalSec })
      }

      // FR-06.1: the eigengap estimate is computed as a cross-check and
      // REPORTED (numbers only in `job:done` stats) — never used to cut.
      const crossCheck = estimateSpeakerCount(embeds)
      const labels = agglomerativeCluster(embeds, { maxSpeakers: request.maxSpeakers })
      const used = [...new Set(runs.map((run) => labels[run.window] as number))].sort((a, b) => a - b)
      const remap = new Map(used.map((label, index) => [label, index]))
      const windowSpeaker = resolvedWindows.map((_, index) => remap.get(labels[index] as number) as number)
      const frames = runs.map((run) => ({
        start: run.start,
        end: run.end,
        speaker: windowSpeaker[run.window] as number,
        prob: clamp01(run.prob),
      }))
      frames.sort((a, b) => a.start - b.start)

      // `diar:frames` is NOT the terminal event; `job:done`/`job:error` are
      // single-emission BY CONSTRUCTION (every path returns or throws right
      // after its terminal event — no guard branch).
      emit(framesEvent(job.jobId, used.length, frames))
      const stats = {
        language: 'und',
        windows: resolvedWindows.length,
        frames: frames.length,
        speakers: used.length,
        speakerEstimate: crossCheck.speakers,
        eigengap: crossCheck.eigengap,
      }
      emit({ t: 'job:done', jobId: job.jobId, stats })
    } catch {
      if (job.cancelled) emit({ t: 'job:error', jobId: job.jobId, error: { code: 'CANCELLED', retryable: false } })
      else emit({ t: 'job:error', jobId: job.jobId, error: { code: 'DIAR_SESSION_LOST', retryable: true } })
    } finally {
      active = null
    }
  }

  async function loadPcm(source: PcmSource, job: ActiveJob): Promise<Float32Array> {
    if (source.kind === 'transfer') return new Float32Array(source.buffer)
    return readStreamPort(source.port, job)
  }

  async function readStreamPort(port: MessagePort, job: ActiveJob): Promise<Float32Array> {
    const chunks: PcmChunk[] = []
    await new Promise<void>((resolve, reject) => {
      const settle = (): void => {
        port.removeEventListener('message', onMessage)
        port.removeEventListener('messageerror', onError)
        port.removeEventListener('close', onClose)
        port.removeEventListener('messageclose', onClose)
      }
      const onMessage = (event: MessageEvent): void => {
        chunks.push(event.data as PcmChunk)
      }
      const onError = (): void => {
        settle()
        reject(new Error('DIAR_SESSION_LOST'))
      }
      const onClose = (): void => {
        settle()
        resolve()
      }
      port.addEventListener('message', onMessage)
      port.addEventListener('messageerror', onError)
      port.addEventListener('close', onClose)
      port.addEventListener('messageclose', onClose)
      port.start()
      if (job.cancelled) {
        settle()
        reject(new Error('DIARIZE_CANCELLED'))
      } else {
        job.waiters.push(() => {
          settle()
          reject(new Error('DIARIZE_CANCELLED'))
        })
      }
    })
    let total = 0
    for (const chunk of chunks) total += chunk.samples.length
    const pcm = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(chunk.samples, offset)
      offset += chunk.samples.length
    }
    return pcm
  }

  /** Race a session call against cooperative cancellation; throws on cancel. */
  async function racable<T>(job: ActiveJob, work: () => Promise<T>): Promise<T> {
    const value = await Promise.race([work(), waitCancelled(job)])
    if (job.cancelled || value === CANCELLED) throw new Error('DIARIZE_CANCELLED')
    return value
  }

  function waitCancelled(job: ActiveJob): Promise<typeof CANCELLED> {
    return new Promise((resolve) => {
      if (job.cancelled) resolve(CANCELLED)
      else job.waiters.push(() => resolve(CANCELLED))
    })
  }

  async function unload(): Promise<void> {
    if (active !== null) active.wake()
    const segmentationSession = segmentation
    const embeddingSession = embedding
    segmentation = null
    embedding = null
    await disposeQuietly(segmentationSession?.dispose())
    await disposeQuietly(embeddingSession?.dispose())
  }

  return {
    async post(request: DiarizeRequest): Promise<void> {
      switch (request.t) {
        case 'loadModels':
          await loadModels()
          return
        case 'diarize':
          await runDiarize(request)
          return
        case 'cancel':
          if (active !== null && active.jobId === request.jobId) active.wake()
          return
        case 'unload':
          await unload()
          return
      }
    },
    onEvent(listener: (event: DiarizeEvent) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose(): void {
      const segmentationSession = segmentation
      const embeddingSession = embedding
      segmentation = null
      embedding = null
      void disposeQuietly(segmentationSession?.dispose())
      void disposeQuietly(embeddingSession?.dispose())
      listeners.clear()
    },
  }
}

/** Slice the [window.start, window.end) range out of the PCM buffer. */
function sliceWindow(pcm: Float32Array, window: EmbeddingWindow, sampleRate: number): Float32Array {
  const from = Math.max(0, Math.round(window.start * sampleRate))
  const to = Math.min(pcm.length, Math.round(window.end * sampleRate))
  return pcm.slice(from, to)
}

/** Expose the decoded buffer as a 1-second-batch `PcmChunk` stream (own VAD pass). */
async function* chunkStream(pcm: Float32Array, sampleRate: number): AsyncGenerator<PcmChunk> {
  const batch = Math.max(1, Math.round(sampleRate))
  for (let offset = 0; offset < pcm.length; offset += batch) {
    // Yield to the event loop between batches (asr.worker.ts pcmChunks precedent).
    await Promise.resolve()
    yield { startSec: offset / sampleRate, samples: pcm.slice(offset, offset + batch) }
  }
}
