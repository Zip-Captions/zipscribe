// Silero VAD scorer adapter (FR-05.1 / CC-05.4 production seam).
//
// Wraps the pinned `onnx-community/silero-vad` ONNX (`onnx/model.onnx`,
// revision e71cae966052b992a7eca6b17738916ce0eca4ec — the `silero-vad` row of
// `models/ci-registry.json`, fetched to `.cache/models/silero-vad/` by
// `pnpm models:fetch`) behind the pure `VadScorer` DI seam in
// `src/engine/asr/vad.ts`. IO names/dims were verified against the pinned
// file with the same ORT (input `input` [1,576] f32 = the official 64-sample
// context + the 512-sample scoring window, `state` [2,1,128] f32, `sr` int64
// scalar → output `output` [1,1], `stateN` [2,1,128]): the LSTM state carries
// across `scoreWindow` calls, reset per stream instance, and so does the
// trailing-context window (official v5 JS contract,
// https://github.com/snakers4/silero-vad/blob/master/utils/javascript/silero.js
// — feeding [1,512] without the context is accepted by the graph but
// collapses the probabilities on real speech: measured mean 0.16 vs 0.84 on
// speech-10min, which truncated the VAD to its first ~4 s).
//
// ORT instance discipline (AGENTS.md § Off the main thread): the session is
// created through the `InferenceSession` factory re-exported from the
// whisper adapter — the SAME bundled onnxruntime-web instance
// (@huggingface/transformers ~3.8.1 keeps it as an external import; a direct
// `import 'onnxruntime-web'` here would resolve to a second ORT copy, which
// the unit-05 brief forbids).
//
// Model bytes are fetched same-origin from the models-fetch cache mirror
// first (the harness/dev server serves the repo root, where `.cache/models`
// lives); a miss falls back to the pinned HF `resolve/<revision>` URL (the
// settings.yml model-hosts allowlist) so a production build without a
// pre-seeded cache mirror still loads. SECURITY-03: no content ever
// enters a thrown message — load failures surface as coded errors upstream.

import { Tensor } from '@huggingface/transformers'
import type { VadScorer } from '@engine/asr/vad'
import { VAD_SAMPLE_RATE, VAD_WINDOW_SAMPLES } from '@engine/asr/vad'

/** Minimal structural view of a bundled-ORT session (only `run` is used). */
export interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>
}

/** `(modelBytes, sessionOptions) => session` — bound to the bundled ORT. */
export type OrtSessionFactory = (modelBytes: Uint8Array, sessionOptions?: Record<string, unknown>) => Promise<OrtSessionLike>

/** Same-origin models-fetch mirror (`.cache/models/silero-vad/onnx/model.onnx`). */
const SILERO_SAME_ORIGIN_URL = '/.cache/models/silero-vad/onnx/model.onnx'
/** Pinned fallback (models/ci-registry.json `silero-vad` row — never `main`, FR-03.6). */
const SILERO_HF_URL = 'https://huggingface.co/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx'

const STATE_ROWS = 2
const STATE_BATCH = 1
const STATE_DIM = 128
/** Official v5 contract: the 64 trailing samples of the previous window are
 *  prepended to the scored 512-sample frame (the conv layer's receptive field). */
const CONTEXT_SAMPLES = 64

/** The exported `Tensor` is the transformers.js wrapper over the bundled
 *  ORT tensor (`utils/tensor.js` stores the runtime tensor as `ort_tensor`);
 *  `session.run` feeds must be the runtime instances themselves. */
function ortFeedValue(tensor: Tensor): unknown {
  return (tensor as unknown as { ort_tensor: unknown }).ort_tensor
}

async function fetchSileroBytes(): Promise<Uint8Array> {
  const attempts: string[] = [SILERO_SAME_ORIGIN_URL, SILERO_HF_URL]
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
  // Fixed code only — no URL/query content (SECURITY-03).
  throw new Error(`silero_load_failed:${lastStatus}`)
}

/**
 * Create the stateful scorer for ONE VAD pass. `createSession` is the
 * bundled-ORT factory (from the whisper pipeline's model sessions).
 */
export async function createSileroScorer(createSession: OrtSessionFactory): Promise<VadScorer> {
  const bytes = await fetchSileroBytes()
  const session = await createSession(bytes, { executionProviders: ['wasm'] })
  let state = new Float32Array(STATE_ROWS * STATE_BATCH * STATE_DIM)
  const context = new Float32Array(CONTEXT_SAMPLES)
  const input = new Float32Array(CONTEXT_SAMPLES + VAD_WINDOW_SAMPLES)
  input.set(context, 0)
  return {
    async scoreWindow(frame: Float32Array): Promise<number> {
      if (frame.length !== VAD_WINDOW_SAMPLES) throw new Error('silero_frame_length')
      // context (64) + window (512); the trailing 64 samples of THIS frame
      // become the next call's context (the official wrapper keeps them on
      // the JS side — they are raw audio, not model state).
      input.set(frame, CONTEXT_SAMPLES)
      const outputs = await session.run({
        input: ortFeedValue(new Tensor('float32', input, [1, input.length])),
        state: ortFeedValue(new Tensor('float32', state, [STATE_ROWS, STATE_BATCH, STATE_DIM])),
        sr: ortFeedValue(new Tensor('int64', BigInt64Array.from([BigInt(VAD_SAMPLE_RATE)]), [])),
      })
      const next = outputs['stateN'] ?? outputs['state']
      const prob = outputs['output']?.data?.[0]
      if (next === undefined || prob === undefined) throw new Error('silero_output_missing')
      context.set(frame.subarray(frame.length - CONTEXT_SAMPLES))
      // Copy: the session may recycle its output buffers on the next run.
      state = new Float32Array(next.data.length)
      for (let i = 0; i < next.data.length; i++) state[i] = next.data[i] as number
      return Number.isFinite(prob) ? Math.min(1, Math.max(0, prob)) : 0
    },
  }
}
