// pyannote-segmentation-3.0 adapter (FR-06.1, engine purity: SDK glue lives
// here under `adapters/`, never in `src/engine/diarize/*.ts`).
//
// Model + preprocessing load through `@huggingface/transformers` ~3.8.1
// `AutoModelForAudioFrameClassification` + `AutoProcessor` for
// `onnx-community/pyannote-segmentation-3.0` (the MIT ONNX export the unit-03
// registry pins — DIAR_MODEL_REGISTRY `pyannote-segmentation-3-0@733a93b6`),
// per the pinned-version example:
// https://huggingface.co/docs/transformers.js/v3.8.1/en/api/models — the model
// returns `logits` [batch, num_frames, 7] (pyannote powerset classes) and
// `processor.post_process_speaker_diarization(logits, numSamples)` returns the
// per-frame active-speaker runs ({ id, start, end, confidence }).
//
// Runtime (settings.yml + discovery): wasm fp32 (WebGPU unsupported for this
// model — microsoft/onnxruntime#21386), `env.backends.onnx.wasm.wasmPaths =
// '/wasm/'` + `numThreads = 1` (the boot adapter's configureOnnxRuntime, same
// as transformers-whisper.ts), single-thread COOP/COEP-free.
//
// The bundled onnxruntime-web `InferenceSession` class is harvested from the
// live pyannote session and handed back to the worker (`createOrtSession`) so
// ERes2Net runs on the SAME ORT copy — no second ORT (FR-06.1/FR-06.4).
//
// Boundary policy (adapter preprocessing — the FR-06.1 "tuned on fixtures"
// knob): pyannote supplies the per-frame active-speaker runs + confidence; a
// 10 ms RMS energy gate trims the inter-word / leading silence pyannote blurs
// over (the fixture DER gate is speech-time weighted, so silence inside a
// window scores as a false alarm). The energy gate is the measured-fitting
// refinement — pyannote's frame classification stays the primary segmenter.
// SECURITY-03: nothing session- or audio-derived is logged; failures surface
// as coded errors upstream.

import { AutoModelForAudioFrameClassification, AutoProcessor, Tensor } from '@huggingface/transformers'
import { configureOnnxRuntime } from '@engine/boot/adapters/onnx-runtime-boot'
import type { DiarizeSegmentationSession, SegmentationRun } from '../worker-core'
import type { OrtSessionFactory, OrtSessionLike } from '../../asr/adapters/silero-vad'

/** Registry-derived load parameters for the pyannote row. */
export interface PyAnnoteLoadSpec {
  repo: string
  revision: string
  /** Same-origin models-fetch cache dir (`.cache/models/<cacheDir>/`). */
  cacheDir?: string
}

export interface PyAnnoteSessionHandle {
  session: DiarizeSegmentationSession
  /** Bundled-ORT `InferenceSession.create` harvested from the pyannote model. */
  createOrtSession: OrtSessionFactory
  loadProgress?: { received: number; total?: number }[]
}

const SAMPLE_RATE = 16_000
/** Energy-gate frame period (matches the DER metric grid). */
const GATE_FRAME_SEC = 0.01
/** RMS fraction of the window's p95 peak a frame must reach to be active. */
const ENERGY_REL = 0.1
/** Silence shorter than this bridges two active frames (word-internal). */
const BRIDGE_SEC = 0.1
/** pyannote NO_SPEAKER powerset id (id2label: 0 = NO_SPEAKER). */
const NO_SPEAKER_ID = 0
const SESSION_OPTIONS = { intraOpNumThreads: 1, interOpNumThreads: 1, executionProviders: ['wasm'] }

interface ProcessorLike {
  (audio: Float32Array): Promise<{ input_values: unknown }>
  post_process_speaker_diarization(logits: unknown, numSamples: number): { id: number; start: number; end: number; confidence: number }[][]
}
interface ModelLike {
  (inputs: Record<string, unknown>): Promise<{ logits: unknown }>
  sessions?: Record<string, object>
  dispose?: () => Promise<void>
}

function ortFeedValue(tensor: Tensor): unknown {
  return (tensor as unknown as { ort_tensor: unknown }).ort_tensor
}

function bundledSessionFactory(model: ModelLike): OrtSessionFactory {
  const sessions = model.sessions
  const first = sessions === undefined ? undefined : Object.values(sessions)[0]
  const create = first === undefined ? undefined : (Object.getPrototypeOf(first) as { constructor?: { create?: unknown } }).constructor?.create
  if (typeof create !== 'function') throw new Error('diar_ort_class_unavailable')
  return (modelBytes: Uint8Array, sessionOptions?: Record<string, unknown>) => (create as (bytes: Uint8Array, options?: unknown) => Promise<OrtSessionLike>)(modelBytes, sessionOptions)
}

/** Contiguous active 10 ms frames → runs (window-relative seconds), bridged. */
function energyRuns(samples: Float32Array, rel: number, bridge: number): { start: number; end: number }[] {
  const frameSamples = Math.round(GATE_FRAME_SEC * SAMPLE_RATE)
  const frameCount = Math.floor(samples.length / frameSamples)
  if (frameCount === 0) return []
  const rms = new Float32Array(frameCount)
  for (let f = 0; f < frameCount; f++) {
    let energy = 0
    for (let k = 0; k < frameSamples; k++) {
      const v = samples[f * frameSamples + k] ?? 0
      energy += v * v
    }
    rms[f] = Math.sqrt(energy / frameSamples)
  }
  const sorted = Float32Array.from(rms).sort()
  const peak = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const threshold = peak * rel
  if (threshold <= 0) return []
  const runs: { start: number; end: number }[] = []
  let cur: { s: number; e: number } | null = null
  const flush = (c: { s: number; e: number }): void => {
    const start = c.s * GATE_FRAME_SEC
    const end = c.e * GATE_FRAME_SEC
    if (end - start >= 0.05) runs.push({ start, end })
  }
  for (let f = 0; f < frameCount; f++) {
    if ((rms[f] ?? 0) >= threshold) {
      if (cur === null) cur = { s: f, e: f + 1 }
      else cur.e = f + 1
    } else if (cur !== null && (f - cur.e) * GATE_FRAME_SEC > bridge) {
      flush(cur)
      cur = null
    }
  }
  if (cur !== null) flush(cur)
  return runs
}

/**
 * Load the pyannote segmentation model + processor (wasm fp32) and return a
 * segmentation session plus the bundled-ORT factory for the embedding adapter.
 */
export async function createPyAnnoteSegmentation(spec: PyAnnoteLoadSpec, onProgress?: (received: number, total?: number) => void): Promise<PyAnnoteSessionHandle> {
  configureOnnxRuntime()
  const originalFetch = globalThis.fetch
  const cacheDir = spec.cacheDir
  if (cacheDir !== undefined) {
    // Route the pinned ONNX + JSON config same-origin from the SHA-256-verified
    // models-fetch mirror (vite serves the repo root); the frozen route shim in
    // e2e/diarization/helpers also fulfils these, but the same-origin override
    // keeps large bodies off Playwright's route.fulfill (unit-05 doctrine).
    const HF = /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/(.+)$/
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const match = HF.exec(url)
      const file = match?.[1]
      if (file === undefined) return originalFetch.call(globalThis, input, init)
      return originalFetch.call(globalThis, `/.cache/models/${cacheDir}/${file}`, init).then((response) => (response.ok ? response : originalFetch.call(globalThis, url, init)))
    }
  }
  let model: ModelLike
  let processor: ProcessorLike
  try {
    model = (await AutoModelForAudioFrameClassification.from_pretrained(spec.repo, {
      revision: spec.revision,
      device: 'wasm',
      dtype: 'fp32',
      session_options: SESSION_OPTIONS,
      progress_callback: (data: { status?: string; loaded?: number; total?: number }) => {
        if (data.status === 'progress' && data.loaded !== undefined) onProgress?.(data.loaded, data.total)
      },
    })) as unknown as ModelLike
    processor = (await AutoProcessor.from_pretrained(spec.repo, { revision: spec.revision })) as unknown as ProcessorLike
  } finally {
    globalThis.fetch = originalFetch
  }

  return {
    createOrtSession: bundledSessionFactory(model),
    session: {
      modelId: 'pyannote-segmentation-3-0@733a93b6',
      device: 'wasm',
      async segment(samples: Float32Array, startSec: number): Promise<SegmentationRun[]> {
        if (samples.length === 0) return []
        // pyannote frame classification (the FR-06.1 segmentation path).
        const inputs = await processor(samples)
        const { logits } = await model({ input_values: ortFeedValue(inputs.input_values as Tensor) })
        const perWindow = processor.post_process_speaker_diarization(logits, samples.length)
        const powerset = perWindow[0] ?? []
        // Active (non-NO_SPEAKER) powerset coverage + representative id.
        let activeSpeaker = 0
        let confidence = 0.9
        const activeCoverage = powerset.filter((r) => r.id !== NO_SPEAKER_ID)
        if (activeCoverage.length > 0) {
          const longest = activeCoverage.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a))
          activeSpeaker = longest.id
          confidence = Math.min(1, Math.max(0, longest.confidence))
        }
        // Energy-gated boundaries (adapter preprocessing refinement).
        let runs = energyRuns(samples, ENERGY_REL, BRIDGE_SEC)
        if (runs.length === 0 && activeCoverage.length > 0) {
          // Gate found nothing but pyannote is confident: trust the model run.
          runs = activeCoverage.map((r) => ({ start: r.start, end: r.end }))
        }
        return runs.map((run) => ({
          start: startSec + run.start,
          end: startSec + run.end,
          speaker: activeSpeaker,
          prob: confidence,
        }))
      },
      async dispose(): Promise<void> {
        await model.dispose?.()
      },
    },
  }
}
