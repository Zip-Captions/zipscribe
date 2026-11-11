// ERes2Net speaker-embedding adapter (FR-06.1/FR-06.4, engine purity: SDK glue
// under `adapters/`).
//
// Runs the 3D-Speaker ERes2Net-base ONNX (39.5 MB, `onemira/eres2net-base-3dspeaker-onnx`
// — the unit-03 DIAR_MODEL_REGISTRY `eres2net-base-3dspeaker@e63c3752` row,
// byte-tied to the k2-fsa sherpa-onnx release) through the onnxruntime-web
// `InferenceSession` instance transformers.js ALREADY bundles (the factory
// harvested from the pyannote session — no second ORT copy, FR-06.1/06.4).
//
// Graph contract verified against the cached ONNX metadata_props (not guessed):
//   input  `x`         float32 [N, T, 80]   (Kaldi 80-dim log-Mel fbank)
//   output `embedding` float32 [N, 512]
//   metadata: feature_normalize_type=global-mean, sample_rate=16000,
//             output_dim=512 → the fbank is mean-normalised (see fbank.ts).
//
// Weights are fetched same-origin from the SHA-256-verified models-fetch mirror
// (`.cache/models/eres2net-base-3dspeaker/…`, served by the harness/vite server)
// with a pinned-HF-resolve fallback. SECURITY-03: no audio/embedding-derived
// string ever enters a thrown message or a log — coded failures only.

import { Tensor } from '@huggingface/transformers'
import type { DiarizeEmbeddingSession } from '../worker-core'
import type { OrtSessionFactory } from '../../asr/adapters/silero-vad'
import { computeFbank } from './fbank'

export interface ERes2NetLoadSpec {
  repo: string
  revision: string
  /** ONNX file path within the repo / cache dir. */
  file: string
  /** models-fetch cache dir (`.cache/models/<cacheDir>/<file>`). */
  cacheDir?: string
}

const SAMPLE_RATE = 16_000
const INPUT_NAME = 'x'
const OUTPUT_NAME = 'embedding'
const SESSION_OPTIONS = { executionProviders: ['wasm'], intraOpNumThreads: 1, interOpNumThreads: 1 }

function ortFeedValue(tensor: Tensor): unknown {
  return (tensor as unknown as { ort_tensor: unknown }).ort_tensor
}

async function fetchModelBytes(spec: ERes2NetLoadSpec): Promise<Uint8Array> {
  const attempts: string[] = []
  if (spec.cacheDir !== undefined) attempts.push(`/.cache/models/${spec.cacheDir}/${spec.file}`)
  attempts.push(`https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${spec.file}`)
  let lastStatus = 'fetch_failed'
  for (const url of attempts) {
    try {
      const response = await fetch(url)
      if (response.ok) return new Uint8Array(await response.arrayBuffer())
      lastStatus = `status_${response.status}`
    } catch {
      lastStatus = 'fetch_threw'
    }
  }
  throw new Error(`eres2net_load_failed:${lastStatus}`)
}

/**
 * Create the ERes2Net embedding session on the bundled ORT instance.
 * @param createOrtSession bundled `InferenceSession.create` (from the pyannote adapter)
 */
export async function createERes2NetEmbeddings(spec: ERes2NetLoadSpec, createOrtSession: OrtSessionFactory): Promise<DiarizeEmbeddingSession> {
  const bytes = await fetchModelBytes(spec)
  const session = await createOrtSession(bytes, SESSION_OPTIONS)
  return {
    modelId: 'eres2net-base-3dspeaker@e63c3752',
    device: 'wasm',
    async embed(samples: Float32Array): Promise<Float32Array> {
      const { feats, frames } = computeFbank(samples, SAMPLE_RATE)
      const outputs = await session.run({ [INPUT_NAME]: ortFeedValue(new Tensor('float32', feats, [1, frames, 80])) })
      const embedding = outputs[OUTPUT_NAME] ?? Object.values(outputs)[0]
      if (embedding === undefined) throw new Error('eres2net_output_missing')
      const out = new Float32Array(embedding.data.length)
      for (let i = 0; i < embedding.data.length; i++) out[i] = embedding.data[i] as number
      return out
    },
    async dispose(): Promise<void> {
      const release = (session as unknown as { release?: () => Promise<void> | void }).release
      await release?.call(session)
    },
  }
}
