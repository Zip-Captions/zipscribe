// diarize.worker — the real unit-06 speaker-diarization worker (FR-06.1/06.2/
// 06.4/06.6), replacing the unit-01 no-op stub. Thin protocol glue over the
// frozen DI seam `src/engine/diarize/worker-core.ts`: the clustering/assign/
// windowing math and the request state machine are frozen slice A; this file
// injects the real ORT sessions + the Silero own-pass scorer and re-materializes
// events across the `postMessage` boundary.
//
// Request handling (`DiarizeRequest`, src/engine/protocol.ts verbatim):
//   loadModels → resolve the two unit-03 DIAR_MODEL_REGISTRY rows
//                 (`pyannote-segmentation-3-0@…`, `eres2net-base-3dspeaker@…`),
//                 stream `model:progress` from the pyannote download, hand both
//                 sessions to the core (which emits one `model:ready` each).
//   diarize    → the core materializes the PcmSource, runs the own Silero pass
//                 (FR-06.2, when `vad` is absent — the scorer arrives here),
//                 windows → segment() + embed() per window → agglomerative
//                 clustering → exactly one `diar:frames` → `job:done`.
//   cancel     → cooperative (core); unload → dispose both sessions.
//
// ORT instance discipline (FR-06.1/06.4): segmentation loads through
// transformers.js `AutoModelForAudioFrameClassification`; the bundled
// onnxruntime-web `InferenceSession` factory harvested from that session builds
// BOTH the ERes2Net session and the Silero session — a single ORT copy, three
// independent sessions (FR-06.4). `wasmPaths = '/wasm/'` + `numThreads = 1`
// come from configureOnnxRuntime (same as asr.boot / whisper adapter).
//
// SECURITY-03 (FR-06.7): only numbers/codes cross the boundary. The frozen
// core emits `diar:frames` with NON-enumerable `t`/`jobId`; this worker re-adds
// them enumerably before `postMessage` (structuredClone copies own-enumerables
// only — slice-A semantics preserved on the wire).

import type { DiarizeEvent, DiarizeRequest, ModelId } from '../engine/protocol'
import { createDiarizeWorkerCore, type DiarizeEmbeddingSession, type DiarizeSegmentationSession } from '../engine/diarize/worker-core'
import { getDiarModel } from '../engine/model/registry'
import { createPyAnnoteSegmentation } from '../engine/diarize/segmentation'
import { createERes2NetEmbeddings } from '../engine/diarize/embeddings'
import { createSileroScorer, type OrtSessionFactory } from '../engine/asr/adapters/silero-vad'
import type { VadScorer } from '../engine/asr/vad'

interface DedicatedWorkerScope {
  postMessage(message: DiarizeEvent, options?: StructuredSerializeOptions): void
  addEventListener(type: 'message', listener: (event: MessageEvent<DiarizeRequest>) => void): void
}

const scope = globalThis as unknown as DedicatedWorkerScope

const SEGMENTATION_ID = 'pyannote-segmentation-3-0@733a93b6'
const EMBEDDING_ID = 'eres2net-base-3dspeaker@e63c3752'

/** models-fetch cache dir for a registry id (`<id-minus-rev>`, '_' ≡ '-'). */
function cacheDirFor(id: string): string | undefined {
  return id.split('@')[0]?.replace(/_/g, '-')
}

/** Bundled-ORT factory harvested from the pyannote session (set on load). */
let bundledOrtFactory: OrtSessionFactory | null = null
/** Lazily-created own-pass Silero scorer (FR-06.2), built on first use. */
let sileroScorer: VadScorer | null = null
let sileroPromise: Promise<VadScorer> | null = null

function post(event: DiarizeEvent): void {
  scope.postMessage(event)
}

function postProgress(model: ModelId, received: number, total?: number): void {
  post({ t: 'model:progress', model, phase: 'download', received, ...(total === undefined ? {} : { total }) })
}

async function ownSpeechScore(frame: Float32Array): Promise<number> {
  if (sileroScorer !== null) return sileroScorer.scoreWindow(frame)
  if (bundledOrtFactory === null) throw new Error('diar_ort_not_loaded')
  sileroPromise ??= createSileroScorer(bundledOrtFactory)
  sileroScorer = await sileroPromise
  return sileroScorer.scoreWindow(frame)
}

async function buildSegmentation(): Promise<DiarizeSegmentationSession> {
  const spec = getDiarModel(SEGMENTATION_ID)
  if (spec === undefined) throw new Error('diar_registry_missing')
  const handle = await createPyAnnoteSegmentation({ repo: spec.repo, revision: spec.revision, cacheDir: cacheDirFor(spec.id) }, (received, total) => postProgress(SEGMENTATION_ID, received, total))
  bundledOrtFactory = handle.createOrtSession
  return handle.session
}

async function buildEmbedding(): Promise<DiarizeEmbeddingSession> {
  const spec = getDiarModel(EMBEDDING_ID)
  const factory = bundledOrtFactory
  if (spec === undefined || factory === null) throw new Error('diar_registry_missing')
  const file = spec.files.find((f) => f.path.endsWith('.onnx'))?.path ?? ''
  return createERes2NetEmbeddings({ repo: spec.repo, revision: spec.revision, file, cacheDir: cacheDirFor(spec.id) }, factory)
}

const core = createDiarizeWorkerCore({
  createSegmentationSession: buildSegmentation,
  createEmbeddingSession: buildEmbedding,
  speechScore: ownSpeechScore,
})

core.onEvent((event) => {
  // Re-materialize enumerably: the frozen core's `diar:frames` carries
  // non-enumerable t/jobId (SECURITY-03 wire form); every other event is
  // already a plain literal.
  const wire = { ...event, t: event.t, jobId: (event as { jobId?: string }).jobId } as DiarizeEvent
  post(wire)
})

scope.addEventListener('message', (event: MessageEvent<DiarizeRequest>) => {
  void core.post(event.data)
})
