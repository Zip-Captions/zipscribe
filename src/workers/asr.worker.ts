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
// `resumeFromSec` (host recycle/downgrade resume): the window plan is always
// computed over the FULL VAD list and whole windows behind the resume point
// are skipped (TranscribeOptions.resumeFromSec — re-packing from filtered
// segments shifts the boundary window's padding and is not transcript-preserving);
// the host's commit dedupe absorbs any boundary overlap (US-1.2.7).

import type { AsrEvent, AsrRequest, Device, EngineError, ModelId, PcmChunk, PcmSource } from '@engine/protocol'
import { transcribe, type EngineSession } from '@engine/asr/transcriber'
import { runVad, type VadScorer } from '@engine/asr/vad'
import { MODEL_REGISTRY, getModel, modelFileUrl } from '@engine/model/registry'
import { createWhisperEngine, type WhisperEngine, type WhisperLoadProgress } from '@engine/asr/adapters/transformers-whisper'
import { createSileroScorer, SILERO_SAME_ORIGIN_URL, SILERO_HF_URL } from '@engine/asr/adapters/silero-vad'
import { createZipscribeModelCache, modelSpecPresence } from '@engine/model/adapters/browser-cache'

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
// FR-204.2 (unit-204): the jobs contract posts `loadModel` then `transcribe`
// back-to-back (jobs.ts Technical Specification). The real (non-scripted)
// lane must therefore absorb a `transcribe` that arrives mid-load: it is
// queued here and started when the model becomes ready — or failed with the
// load's coded error when the load fails (never a hang).
interface PendingTranscribe {
  request: Extract<AsrRequest, { t: 'transcribe' }>
  // Collection starts AT QUEUE TIME: the decode tee delivers its chunks and
  // closes the port while the model is still downloading — a consumer that
  // only starts listening at flush time would miss the `close` event.
  samples: Promise<Float32Array>
}
const pendingTranscribes = new Map<string, PendingTranscribe>()

function drainPendingTranscribes(): PendingTranscribe[] {
  const queued = [...pendingTranscribes.values()]
  pendingTranscribes.clear()
  return queued
}

function failPendingTranscribes(code: EngineError['code'], detail: string): void {
  for (const pending of drainPendingTranscribes()) {
    pending.samples.catch(() => undefined)
    post({ t: 'job:error', jobId: pending.request.jobId, error: coded(code, true, detail) })
  }
}

/** FR-204.2: the ONE verified model cache (unit-03 verification doctrine via
 *  `createZipscribeModelCache`, canonical same-origin keys per FR-204.2).
 *  Downloads happen through it (fetch + SHA-256 on write, re-hash on read),
 *  so a model used once is offline-ready; loads consult it FIRST. */
const modelCache = createZipscribeModelCache()

const workerNavigator = (globalThis as unknown as { navigator?: { onLine?: boolean } }).navigator

function isOnline(): boolean {
  return workerNavigator?.onLine !== false
}

/** Silero bytes from the verified cache (presence-only read — the pinned
 *  fallback URL is the logical key; there is no registry row to hash
 *  against here, same trust model as runtimeWasm). */
async function cachedSileroBytes(): Promise<Uint8Array | undefined> {
  try {
    return await modelCache.matchCached(SILERO_HF_URL, '')
  } catch {
    return undefined
  }
}

/** Online: cache bytes, else the same-origin mirror (fetched into the cache
 *  for offline reuse), else undefined (the adapter's own mirror→HF chain
 *  still gets a chance inside `createSileroScorer`). */
async function cachedOrMirrorSileroBytes(): Promise<Uint8Array | undefined> {
  const cached = await cachedSileroBytes()
  if (cached !== undefined) return cached
  try {
    const response = await fetch(SILERO_SAME_ORIGIN_URL)
    if (!response.ok) return undefined
    const bytes = new Uint8Array(await response.arrayBuffer())
    await modelCache.putCached(SILERO_HF_URL, bytes)
    return bytes
  } catch {
    return undefined
  }
}

/** FR-204.2 cache-first read for one registry row: every pinned
 *  `resolve/<revision>` URL is answered from the verified cache (SHA-256
 *  re-check on read — a corrupt entry simply falls through to the normal
 *  routing). Non-row URLs return undefined. */
function verifiedFetchFor(spec: (typeof MODEL_REGISTRY)[string]): (url: string) => Promise<Response | undefined> {
  return async (url: string) => {
    const file = spec.files.find((entry) => modelFileUrl(spec, entry) === url)
    if (file === undefined) return undefined
    try {
      const bytes = await modelCache.matchCached(url, file.sha256)
      return bytes === undefined ? undefined : new Response(bytes)
    } catch {
      // CACHE_CORRUPT (entry already evicted by matchCached): re-download
      // through the ordinary mirror/HF routing.
      return undefined
    }
  }
}

function post(event: AsrEvent): void {
  scope.postMessage(event)
}

// Transferred ports arrive on `event.ports`; the `event.data` copy is a
// neutered placeholder (FR-108.2 stream doctrine, unit-204).
function restoreStreamPort(request: AsrRequest, transferred: readonly MessagePort[] | undefined): AsrRequest {
  if (transferred === undefined || transferred.length === 0) return request
  if (request.t === 'transcribe' && request.pcm.kind === 'stream') {
    return { ...request, pcm: { ...request.pcm, port: transferred[0] as MessagePort } }
  }
  return request
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
    // FR-204.2 offline contract: presence is answered by the verified cache
    // (unit-03 doctrine, same-origin keys). Offline + not offline-ready →
    // coded fast-fail BEFORE any fetch attempt (the domain App lifecycle:
    // "never a hang"); the main-thread preflight already covers the app
    // path — this guard also protects direct/scripted lanes. Cache WARMING
    // (download-on-first-use) happens on the MAIN thread (jobs.ts
    // warmModelCache) — an online worker load stays the develop streaming
    // profile (CC-05.2 memory gate).
    const online = isOnline()
    const presence = await modelSpecPresence(spec)
    // The > 100 MB confirm gate is a DOWNSTREAM cost question — ask only
    // when a fresh download is actually about to start (unit-204: a cached
    // model must never re-arm the gate; a pending gate with nothing pending
    // suppresses the popover forever).
    if (online && !presence && spec.approxBytes > CONFIRM_REQUIRED_BYTES && !preConfirmed.has(request.model)) {
      post({ t: 'model:confirm-required', model: request.model, bytes: spec.approxBytes })
    }
    if (!online && !presence) {
      post({ t: 'model:error', model: request.model, error: coded('NETWORK', true, 'offline_model_missing') })
      failPendingTranscribes('NETWORK', 'offline_model_missing')
      return
    }
    // CC-05.2 (memory gate): an ONLINE load must never materialize model
    // bytes on the worker JS heap (fetch→arrayBuffer→hash→put, then a full
    // Uint8Array→Response per file) — it runs develop's streaming profile
    // through the adapter's own mirror/cache chain. The verified cache stays
    // the OFFLINE read path (presence-gated above) and is populated by the
    // main-thread panel/manager ensure paths.
    const sileroBytes = online ? await cachedOrMirrorSileroBytes() : await cachedSileroBytes()
    engine = await createWhisperEngine(
      {
        repo: spec.repo,
        revision: spec.revision,
        dtypeRecipe: spec.dtypeRecipe ?? {},
        device: request.device,
        // models-fetch cache dir for the same-origin weights mirror
        // (.cache/models/<registry-id minus '@rev', '_' → '-').
        cacheDir: spec.id.split('@')[0]?.replace(/_/g, '-'),
        verifiedFetch: verifiedFetchFor(spec),
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
    const scorer = await createSileroScorer(engine.createSileroSession, sileroBytes)
    if (loading !== loadingTarget) {
      await engine.dispose()
      return
    }
    const previous = loaded
    loaded = engine
    loadedModel = { modelId: request.model, device: request.device }
    loadedScorer = scorer
    post({ t: 'model:ready', model: request.model, device: request.device })
    for (const pending of drainPendingTranscribes()) void handleTranscribe(pending.request, pending.samples)
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
    failPendingTranscribes('ENGINE_INTERNAL', 'model_load_failed')
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
    // FR-108.2 (unit-204): the tee port carries the whole MediaEvent stream;
    // accept only sample chunks and resolve on the `job:done`/`end`
    // terminator — the same doctrine as the engine's PcmChunkStream
    // (decode.ts). The `close` event stays as a fallback (Chromium does not
    // reliably dispatch it across dedicated workers).
    pcm.port.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { t?: unknown; startSec?: unknown; samples?: unknown } | null
      if (data === null || typeof data !== 'object') return
      if (data.t === 'end' || data.t === 'job:done' || data.t === 'job:error') {
        resolve(collected)
        return
      }
      if (data.t === undefined && typeof data.startSec === 'number' && data.samples instanceof Float32Array) {
        collected.push({ startSec: data.startSec, samples: data.samples })
      }
    }
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

async function handleTranscribe(request: Extract<AsrRequest, { t: 'transcribe' }>, prefetched?: Promise<Float32Array>): Promise<void> {
  const engine = loaded
  const scorer = loadedScorer
  if (engine === null || scorer === null || loadedModel === null) {
    if (loading !== null) {
      // A load is in flight for this model (jobs posts loadModel→transcribe
      // back-to-back): start collecting PCM now, run on `model:ready` /
      // fail on `model:error`.
      pendingTranscribes.set(request.jobId, { request, samples: readPcmSource(request.pcm) })
      return
    }
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
    const samples = await (prefetched ?? readPcmSource(request.pcm))
    if (runCancel.cancelled) return
    const vadSegments = await runVad(pcmChunks(samples), scorer, { sampleRate: request.sampleRate })
    if (runCancel.cancelled) return
    post({ t: 'vad:segments', jobId: request.jobId, segments: vadSegments })

    const outcome = await transcribe(
      pcmChunks(samples),
      {
        modelId,
        device,
        language: request.language,
        engineFlags: { confidence: false, punctuation: false, languageDetect: request.language === null },
      },
      // Resume skips whole committed windows (the plan itself is computed
      // over the FULL VAD list — TranscribeOptions.resumeFromSec); the host's
      // commit dedupe absorbs any boundary overlap (US-1.2.7).
      { vad: vadSegments, createSession: () => session, ...(request.resumeFromSec === undefined ? {} : { resumeFromSec: request.resumeFromSec }) },
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
        ...(outcome.detectedLanguage !== null ? { language: outcome.detectedLanguage } : request.language !== null ? { language: request.language } : {}),
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
  const request = restoreStreamPort(event.data, event.ports)
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
    case 'cancel': {
      pendingTranscribes.get(request.jobId)?.samples.catch(() => undefined)
      pendingTranscribes.delete(request.jobId)
      if (activeCancel !== null && activeCancel.jobId === request.jobId) {
        activeCancel.cancelled = true
        // Host-side settle is immediate (worker-host.ts); this loop stops at
        // the next engine-call boundary and emits nothing more (FR-05.6).
      }
      return
    }
    case 'unload': {
      activeCancel = null
      failPendingTranscribes('MODEL_UNLOADED', 'unload')
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
