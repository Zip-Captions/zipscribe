// asr.worker — the real unit-05 ASR worker (FR-05.2/05.3/05.5/05.6/05.9,
// US-05.1), replacing the unit-01 stub. Thin protocol glue: the VAD/ASR core
// is `src/engine/asr/{vad,chunker,transcriber}.ts` (L1-frozen), all SDK glue
// lives in `src/engine/asr/adapters/*` (engine-purity, FR-1.0.5).
//
// Request handling (src/engine/protocol.ts `AsrRequest`):
//   loadModel   → resolve the unit-03 registry row (ModelId may arrive as the
//                 registry key, or as the models-fetch cache directory name —
//                 the harness `tiers` plan uses e.g. 'whisper-tiny-timestamped'
//                 for registry key 'whisper-tiny_timestamped@51724429'),
//                 emit `model:confirm-required` for rows whose registry bytes
//                 exceed the unit-03 100 MB gate, stream `model:progress`
//                 from the transformers.js progress_callback, then
//                 `model:ready {device}` once whisper + Silero are warm.
//                 The confirm-required event is EMITTED AND LOADING PROCEEDS:
//                 the worker-host (slice B, frozen) relays it and has no
//                 confirmDownload path, and the protocol defines no
//                 gate-and-wait handshake on this channel — `confirmDownload`
//                 is accepted (and remembered) for a UI layer pre-confirming.
//   transcribe  → materialize the PcmSource, run Silero `runVad` →
//                 `vad:segments`, hand the segments to `transcribe` (core)
//                 with the whisper adapter as the engine session; the core
//                 streams `job:progress` + per-window `job:segments`
//                 (absolute seconds, sorted) and the worker emits `job:done`
//                 with numeric-only `stats` (guard counters + language code,
//                 SECURITY-03).
//   cancel      → cooperative abort flag checked before every engine call
//                 (the host settles cancellation itself in < 2 s — FR-05.6;
//                 the worker then discards in-flight and late results and
//                 emits nothing further for that job).
//   unload      → dispose both sessions (the worker stays alive for reload).
//
// `resumeFromSec` (host recycle/downgrade resume): VAD segments fully behind
// the resume point are dropped before window planning; the host's commit
// dedupe absorbs any boundary overlap (US-1.2.7).

import type { AsrEvent, AsrRequest, Device, EngineError, ModelId, PcmChunk, PcmSource, VadSegment } from '@engine/protocol'
import { transcribe, type EngineSession } from '@engine/asr/transcriber'
import { runVad, type VadScorer } from '@engine/asr/vad'
import { MODEL_REGISTRY, getModel } from '@engine/model/registry'
import { createWhisperEngine, type WhisperEngine, type WhisperLoadProgress } from '@engine/asr/adapters/transformers-whisper'
import { createSileroScorer } from '@engine/asr/adapters/silero-vad'

interface DedicatedWorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<AsrRequest>) => void): void
  postMessage(message: AsrEvent, options?: StructuredSerializeOptions): void
}

const scope = globalThis as unknown as DedicatedWorkerScope

/** Unit-03 > 100 MB confirm gate (mirrors manager.ts LARGE_DOWNLOAD_CONFIRM_BYTES —
 *  the manager module itself is main-thread selection code, out of worker scope). */
const CONFIRM_REQUIRED_BYTES = 100_000_000
/** Protocol PcmChunk batches (16 kHz mono f32, 1 s). */
const SAMPLE_RATE = 16_000
const CHUNK_SAMPLES = SAMPLE_RATE

/** Cooperative cancel signal — never escapes as an error (the host settles itself). */
const CANCELLED: Error = new Error('asr_worker_cancelled')

interface RunCancel {
  readonly jobId: string
  cancelled: boolean
}

let loaded: WhisperEngine | null = null
let loadedModel: { modelId: ModelId; device: Device } | null = null
let loading: { modelId: ModelId; device: Device } | null = null
let loadedScorer: VadScorer | null = null
const preConfirmed = new Set<ModelId>()
let activeCancel: RunCancel | null = null

function post(event: AsrEvent): void {
  scope.postMessage(event)
}

function coded(code: EngineError['code'], retryable: boolean, detail: string): EngineError {
  // detail: fixed codes only — never message/URL/transcript content (SECURITY-03).
  return { code, retryable, detail }
}

/** Resolve a ModelId against the registry: exact key, else the cache-directory
 *  spelling (lowercase, '-' ≡ '_', optional '@<rev>' suffix dropped). */
function resolveSpec(model: ModelId): (typeof MODEL_REGISTRY)[string] | undefined {
  const exact = getModel(model)
  if (exact !== undefined) return exact
  const normalize = (id: string): string => (id.split('@')[0] ?? id).toLowerCase().replace(/-/g, '_')
  const wanted = normalize(model)
  for (const spec of Object.values(MODEL_REGISTRY)) {
    if (normalize(spec.id) === wanted) return spec
  }
  return undefined
}

async function handleLoadModel(request: Extract<AsrRequest, { t: 'loadModel' }>): Promise<void> {
  const spec = resolveSpec(request.model)
  if (spec === undefined) {
    post({ t: 'model:error', model: request.model, error: coded('ENGINE_INTERNAL', false, 'unknown_model') })
    return
  }
  if (loaded !== null && loadedModel?.modelId === request.model && loadedModel.device === request.device) {
    post({ t: 'model:ready', model: request.model, device: request.device })
    return
  }
  const loadingTarget = { modelId: request.model, device: request.device }
  loading = loadingTarget
  let engine: WhisperEngine | null = null
  try {
    if (spec.approxBytes > CONFIRM_REQUIRED_BYTES && !preConfirmed.has(request.model)) {
      post({ t: 'model:confirm-required', model: request.model, bytes: spec.approxBytes })
    }
    engine = await createWhisperEngine(
      {
        repo: spec.repo,
        revision: spec.revision,
        dtypeRecipe: spec.dtypeRecipe ?? {},
        device: request.device,
        // models-fetch cache dir for the same-origin weights mirror
        // (.cache/models/<registry-id minus '@rev', '_' → '-').
        cacheDir: spec.id.split('@')[0]?.replace(/_/g, '-'),
      },
      (progress: WhisperLoadProgress) => {
        if (progress.status !== 'progress' || progress.received === undefined) return
        post({
          t: 'model:progress',
          model: request.model,
          phase: 'download',
          received: progress.received,
          ...(progress.total !== undefined ? { total: progress.total } : {}),
        })
      },
    )
    if (loading !== loadingTarget) {
      await engine.dispose()
      return
    }
    const scorer = await createSileroScorer(engine.createSileroSession)
    if (loading !== loadingTarget) {
      await engine.dispose()
      return
    }
    const previous = loaded
    loaded = engine
    loadedModel = { modelId: request.model, device: request.device }
    loadedScorer = scorer
    post({ t: 'model:ready', model: request.model, device: request.device })
    if (previous !== null) await previous.dispose()
  } catch {
    if (engine !== null) {
      try {
        await engine.dispose()
      } catch {
        // dispose failures after a failed load change nothing (codes-only errors upstream).
      }
    }
    post({ t: 'model:error', model: request.model, error: coded('ENGINE_INTERNAL', true, 'model_load_failed') })
  } finally {
    if (loading === loadingTarget) loading = null
  }
}

async function readPcmSource(pcm: PcmSource): Promise<Float32Array> {
  if (pcm.kind === 'transfer') return new Float32Array(pcm.buffer)
  // 'stream' (protocol: mandatory for long media): PcmChunks arrive on the
  // tee port; the sender closes it when the decode job completes.
  const chunks = await new Promise<PcmChunk[]>((resolve, reject) => {
    const collected: PcmChunk[] = []
    pcm.port.onmessage = (event: MessageEvent<PcmChunk>) => collected.push(event.data)
    pcm.port.onmessageerror = () => reject(new Error('pcm_stream_message_error'))
    pcm.port.addEventListener('close', () => resolve(collected))
    pcm.port.start()
  })
  chunks.sort((a, b) => a.startSec - b.startSec)
  const total = chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0)
  const merged = new Float32Array(total)
  let at = 0
  for (const chunk of chunks) {
    merged.set(chunk.samples, at)
    at += chunk.samples.length
  }
  return merged
}

function pcmChunks(samples: Float32Array): AsyncIterable<PcmChunk> {
  return (async function* generate(): AsyncGenerator<PcmChunk> {
    let startSec = 0
    for (let offset = 0; offset < samples.length; offset += CHUNK_SAMPLES) {
      // Yield to the event loop between batches (the reader pulls on demand;
      // an all-in-memory source must never starve the worker's message loop).
      await Promise.resolve()
      yield { startSec, samples: samples.subarray(offset, Math.min(samples.length, offset + CHUNK_SAMPLES)) }
      startSec += 1
    }
  })()
}

async function handleTranscribe(request: Extract<AsrRequest, { t: 'transcribe' }>): Promise<void> {
  const engine = loaded
  const scorer = loadedScorer
  if (engine === null || scorer === null || loadedModel === null) {
    post({ t: 'job:error', jobId: request.jobId, error: coded('MODEL_UNLOADED', true, 'loadModel_first') })
    return
  }
  const runCancel: RunCancel = { jobId: request.jobId, cancelled: false }
  activeCancel = runCancel
  const { modelId, device } = loadedModel

  const session: EngineSession = {
    async transcribeWindow(windowStart, windowEnd, audio, options) {
      if (runCancel.cancelled) throw CANCELLED
      return engine.transcribeWindow(windowStart, windowEnd, audio, options)
    },
    // The probe only runs when the language is actually unknown (an explicit
    // `language` forces the engine call — US-05.1).
    detectLanguage: request.language === null ? async (audio) => (await engine.detectLanguage?.(audio)) ?? 'und' : undefined,
  }

  try {
    const samples = await readPcmSource(request.pcm)
    if (runCancel.cancelled) return
    const vadSegments = await runVad(pcmChunks(samples), scorer, { sampleRate: request.sampleRate })
    if (runCancel.cancelled) return
    post({ t: 'vad:segments', jobId: request.jobId, segments: vadSegments })

    const resumeFromSec = request.resumeFromSec
    const planningSegments: VadSegment[] = resumeFromSec === undefined ? vadSegments : vadSegments.filter((segment) => segment.end > resumeFromSec)

    const outcome = await transcribe(
      pcmChunks(samples),
      {
        modelId,
        device,
        language: request.language,
        engineFlags: { confidence: false, punctuation: false, languageDetect: request.language === null },
      },
      { vad: planningSegments, createSession: () => session },
      (event) => {
        // The core emits its placeholder job id; the worker re-tags. Its
        // `job:done` is suppressed here — the worker emits the protocol one
        // (guard key remap + language code) once the outcome is known.
        if (runCancel.cancelled || event.t === 'job:done') return
        post(event.t === 'job:progress' || event.t === 'job:segments' || event.t === 'job:error' ? { ...event, jobId: request.jobId } : event)
      },
    )

    if (runCancel.cancelled) return
    if (outcome.validation === 'LANGUAGE_REQUIRED') {
      post({ t: 'job:error', jobId: request.jobId, error: coded('ENGINE_INTERNAL', false, 'language_required') })
      return
    }
    if (!outcome.ok) return // the core's `job:error` was relayed in onEvent
    post({
      t: 'job:done',
      jobId: request.jobId,
      stats: {
        guard: {
          repeatedNgramDropped: outcome.guardStats.repeatedNgramDropped,
          shortSpeechDropped: outcome.guardStats.shortWindowDropped,
          maxTokensFlagged: outcome.guardStats.maxTokensDropped,
        },
        ...(outcome.detectedLanguage !== null
          ? { language: outcome.detectedLanguage }
          : request.language !== null
            ? { language: request.language }
            : {}),
      },
    })
  } catch (error) {
    if (error === CANCELLED || runCancel.cancelled) return
    post({ t: 'job:error', jobId: request.jobId, error: coded('ENGINE_INTERNAL', true, 'transcribe_failed') })
  } finally {
    if (activeCancel === runCancel) activeCancel = null
  }
}

scope.addEventListener('message', (event: MessageEvent<AsrRequest>) => {
  const request = event.data
  switch (request.t) {
    case 'loadModel':
      void handleLoadModel(request)
      return
    case 'confirmDownload':
      preConfirmed.add(request.model)
      return
    case 'transcribe':
      void handleTranscribe(request)
      return
    case 'cancel':
      if (activeCancel !== null && activeCancel.jobId === request.jobId) {
        activeCancel.cancelled = true
        // Host-side settle is immediate (worker-host.ts); this loop stops at
        // the next engine-call boundary and emits nothing more (FR-05.6).
      }
      return
    case 'unload': {
      activeCancel = null
      const doomed = loaded
      loaded = null
      loadedModel = null
      loadedScorer = null
      if (doomed !== null) {
        void Promise.resolve(doomed.dispose?.()).catch(() => undefined)
      }
      return
    }
  }
})
