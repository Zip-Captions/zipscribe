// transformers.js Whisper engine-session adapter (FR-05.2 / FR-05.5 production seam).
//
// Implements the `EngineSession` DI seam of `src/engine/asr/transcriber.ts`
// on `@huggingface/transformers` ~3.8.1 `pipeline('automatic-speech-recognition')`,
// using the unit-02 spike-approved recipe (tools/eval/pages/asr-runner.ts,
// docs/spikes/model-eval-report.md): per-module dtypes
// `{ encoder_model: 'fp32', decoder_model_merged: 'q4' }`, `device` from the
// loadModel request, and the greedy fixed call options
// `{ return_timestamps: 'word', language, task: 'transcribe' }`. The
// long-form recipe `chunk_length_s: 30, stride_length_s: 5` is the BINDING
// unit-02 finding (3.8.1's WhisperFeatureExtractor silently truncates
// > 30 s audio without internal chunking — src/pipelines.js `chunk_length_s`
// windowing); the transcriber core attaches it to windows > 28 s.
//
// Pinned-version behaviour verified against the VERSIONED docs (docs-mcp
// indexes 4.x main — AGENTS.md versioned-docs rule):
//   https://huggingface.co/docs/transformers.js/v3.8.1/en/api/pipelines/automatic-speech-recognition
//   https://huggingface.co/docs/transformers.js/v3.8.1/en/api/env
//   (word chunks: output `{ text, chunks: [{ timestamp: [start, end], text }] }`
//    — no probability field, matching the registry `confidence: false` row,
//    so `WordToken.probability` is never fabricated.)
// Model URLs/revisions are the unit-03 registry's (FR-03.6: `resolve/<40-hex
// revision>`, never `main`); `pipeline` forwards `revision` to every
// from_pretrained (src/pipelines.js `pipeline()` → `loadItems`).
//
// ORT runtime: configured via the app's boot adapter (`wasmPaths = '/wasm/'`
// self-hosted per FR-1.0.9 + `numThreads = 1` per settings.yml
// testing.onnx_threads); `proxy = false` is transformers.js's own worker
// default (backends/onnx.js).

import { env, pipeline, type DataType, type PretrainedModelOptions } from '@huggingface/transformers'
import { configureOnnxRuntime } from '@engine/boot/adapters/onnx-runtime-boot'
import type { EngineSession, WindowCallOptions, WindowOutput } from '@engine/asr/transcriber'
import type { Device } from '@engine/protocol'
import type { OrtSessionFactory, OrtSessionLike } from './silero-vad'

/** Registry-derived load parameters for one whisper row. */
export interface WhisperLoadSpec {
  repo: string
  revision: string
  dtypeRecipe: Record<string, string>
  device: Device
  /**
   * `models:fetch` cache directory (`.cache/models/<cacheDir>/`) — when set,
   * large `*.onnx` downloads are served same-origin from the SHA-256-verified
   * local mirror instead of the HF resolve URL.
   */
  cacheDir?: string
}

export interface WhisperLoadProgress {
  status: string
  file?: string
  received?: number
  total?: number
}

/** Raw word chunk as emitted by the 3.8.1 ASR pipeline (`return_timestamps: 'word'`). */
interface AsrChunk {
  text?: string
  timestamp?: [number | null, number | null]
}
interface AsrRawOutput {
  text?: string
  chunks?: AsrChunk[]
}
type AsrCall = (audio: Float32Array, options: Record<string, unknown>) => Promise<AsrRawOutput | AsrRawOutput[]>
interface WhisperPipelineLike {
  model?: {
    sessions?: Record<string, object>
    generate?: (params: Record<string, unknown>) => Promise<unknown>
  }
  tokenizer?: { decode: (tokens: number[]) => string }
  processor?: ((audio: Float32Array) => Promise<Record<string, unknown>>) | null
  dispose: () => Promise<void>
}

const SAMPLE_RATE = 16_000
/** Session thread cap mirroring settings.yml testing.onnx_threads (spike recipe kept both knobs). */
const SESSION_OPTIONS: NonNullable<PretrainedModelOptions['session_options']> = { intraOpNumThreads: 1, interOpNumThreads: 1 }
/** Conservative runaway proxy for FR-05.9 trigger 3 (real speech is ≤ ~6 words/s;
 *  the budget is not exposed by the 3.8.1 pipeline, so only an impossible rate flags). */
const MAX_TOKENS_WORDS_PER_SEC = 25
const MAX_TOKENS_MIN_WORDS = 50
/** Whisper token count the probe reads for a leading `<|xx|>` language token. */
const LANGUAGE_PROBE_TOKENS = 6

/**
 * Reach the bundled onnxruntime-web `InferenceSession` class through a live
 * session of the loaded model (`model.sessions` in
 * src/models.js `PreTrainedModel`) — the only way to get it from the public
 * package surface: the exports map exposes only the entry point (no deep
 * `backends/onnx.js` import) and a direct `import 'onnxruntime-web'` would
 * resolve to a SECOND ORT copy (forbidden by the unit-05 brief).
 */
function bundledSessionFactory(pipelineHandle: WhisperPipelineLike): OrtSessionFactory {
  const sessions = pipelineHandle.model?.sessions
  const first = sessions === undefined ? undefined : Object.values(sessions)[0]
  const create = first === undefined ? undefined : (Object.getPrototypeOf(first) as { constructor?: { create?: unknown } }).constructor?.create
  if (typeof create !== 'function') throw new Error('whisper_ort_class_unavailable')
  return (modelBytes: Uint8Array, sessionOptions?: Record<string, unknown>) =>
    (create as (bytes: Uint8Array, options?: unknown) => Promise<OrtSessionLike>)(modelBytes, sessionOptions)
}

/** Map one word chunk to a word token (window-relative seconds); null when malformed. */
function toWord(chunk: AsrChunk): { text: string; start: number; end: number } | null {
  const text = (chunk.text ?? '').trim()
  const start = chunk.timestamp?.[0] ?? null
  const end = chunk.timestamp?.[1] ?? null
  if (text === '' || start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { text, start, end }
}

/** Warm engine session + the bundled-ORT session factory (for Silero). */
export type WhisperEngine = Omit<EngineSession, 'dispose'> & { createSileroSession: OrtSessionFactory; dispose(): Promise<void> }

/**
 * Build the warm engine session. Creation order matters: the whisper
 * pipeline first (its sessions hand us the bundled ORT class), then the
 * caller creates the Silero scorer via `createSileroSession`.
 */
export async function createWhisperEngine(spec: WhisperLoadSpec, onProgress: (progress: WhisperLoadProgress) => void): Promise<WhisperEngine> {
  configureOnnxRuntime()
  // Large-weights fetch routing (unit-05 slice C, observed constraint):
  // Playwright's `route.fulfill` cannot carry a ~86 MB body — Chromium's
  // browser process dies on the intercepted response (verified: 40 MB
  // survives, 86 MB kills the browser; microsoft/playwright large-body
  // fulfill limitation). The frozen e2e network policy
  // (e2e/asr/helpers/asr.ts) fulfills every huggingface resolve URL from
  // `.cache/models/<dir>`, so the adapter fetches the ONNX weights
  // same-origin from that SAME verified cache mirror (vite serves the repo
  // root), falling back to the pinned HF resolve URL on a miss (production
  // builds have no /.cache — normal remote load per the settings.yml
  // allowlist). Small files (config/tokenizer JSONs, ≤ a few MB) keep the
  // HF resolve path so the request audit still sees the modelHost traffic.
  const originalFetch = globalThis.fetch
  const cacheDir = spec.cacheDir
  const HF_ONNX = /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/(.+\.onnx)$/
  if (cacheDir !== undefined) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const match = HF_ONNX.exec(url)
      const file = match?.[1]
      if (file === undefined) return originalFetch.call(globalThis, input, init)
      return originalFetch.call(globalThis, `/.cache/models/${cacheDir}/${file}`, init).then((response) =>
        response.ok ? response : originalFetch.call(globalThis, url, init),
      )
    })
  }

  // Spike-approved runtime configuration (tools/eval/pages/asr-runner.ts
  // `configureRuntime`, FR-02.1/US-02.2): the models are served by the
  // harness/dev server from the SHA-256-verified local cache — the
  // transformers.js browser (Cache API) layer is disabled so the pinned
  // bytes cross exactly once per load and an accidental network fallback
  // surfaces as a coded load error, never silently.
  env.useBrowserCache = false

  // ORT runtime files: point the wasm loader at blob: URLs with correct MIME
  // types (unit-05 slice C, observed constraint). The self-hosted `/wasm/`
  // mirror (FR-1.0.9) is fetched here and re-exposed as blobs because a
  // same-origin layer that answers `/.mjs` with `application/wasm` (the
  // frozen e2e route policy serves every `/wasm/**` that way) makes the
  // browser reject the glue's module `import()` — ORT then never resolves
  // `InferenceSession.create`. Blob URLs load identically in production,
  // where the preview server would have served the right MIME anyway.
  // https://onnxruntime.ai/docs/api/js/interfaces/Env.WebAssemblyEnv.Interface.html (wasmPaths { mjs, wasm })
  // Device-matched runtime pair: ORT picks the jsep (WebGPU-capable) build for
  // webgpu sessions and the plain build for CPU-wasm sessions — forcing the
  // jsep bytes on a CPU session yields garbage logits (observed: whisper emits
  // "[Music]" for speech). Mirror ORT's own selection with blob MIME fixes.
  const suffix = spec.device === 'webgpu' ? 'ort-wasm-simd-threaded.jsep' : 'ort-wasm-simd-threaded'
  try {
    const [glue, wasmBinary] = await Promise.all([fetch(`/wasm/${suffix}.mjs`), fetch(`/wasm/${suffix}.wasm`)])
    if (glue.ok && wasmBinary.ok) {
      const [glueText, wasmBytes] = await Promise.all([glue.text(), wasmBinary.arrayBuffer()])
      const glueUrl = URL.createObjectURL(new Blob([glueText], { type: 'text/javascript' }))
      const wasmUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }))
      const onnx = (env as unknown as { backends: { onnx: { wasm?: Record<string, unknown> } } }).backends.onnx
      const wasm = (onnx.wasm ??= {})
      wasm.wasmPaths = { mjs: glueUrl, wasm: wasmUrl }
    }
  } catch {
    // fall through: keep the '/wasm/' directory config from configureOnnxRuntime
  }
  const options: PretrainedModelOptions = {
    device: spec.device,
    revision: spec.revision,
    dtype: spec.dtypeRecipe as Record<string, DataType>,
    session_options: SESSION_OPTIONS,
    progress_callback: (data: { status?: string; file?: string; loaded?: number; total?: number }) => {
      onProgress({ status: String(data.status ?? ''), file: data.file, received: data.loaded, total: data.total })
    },
  }
  let created: unknown
  try {
    created = await pipeline('automatic-speech-recognition', spec.repo, options)
  } finally {
    if (cacheDir !== undefined) globalThis.fetch = originalFetch
  }
  const handle = created as WhisperPipelineLike
  const call = handle as unknown as AsrCall
  const createSileroSession = bundledSessionFactory(handle)

  return {
    createSileroSession,

    async transcribeWindow(_windowStart: number, _windowEnd: number, audio: Float32Array, options: WindowCallOptions): Promise<WindowOutput> {
      const callOptions: Record<string, unknown> = {
        return_timestamps: options.return_timestamps,
        language: options.language,
        task: options.task,
      }
      if (options.chunk_length_s !== undefined) callOptions['chunk_length_s'] = options.chunk_length_s
      if (options.stride_length_s !== undefined) callOptions['stride_length_s'] = options.stride_length_s
      const raw = await call(audio, callOptions)
      const first = Array.isArray(raw) ? raw[0] : raw
      const text = first?.text ?? ''
      const words = (first?.chunks ?? [])
        .map(toWord)
        .filter((w): w is { text: string; start: number; end: number } => w !== null)
        .sort((a, b) => a.start - b.start)
      const audioSec = audio.length / SAMPLE_RATE
      const segments =
        text.trim() === '' && words.length === 0
          ? []
          : [
              {
                start: 0,
                end: words.length > 0 ? Math.min(audioSec, Math.max(...words.map((w) => w.end))) : audioSec,
                text,
                // registry `confidence: false` — the 3.8.1 word chunks carry
                // no scores, so `probability` stays absent (never fabricated).
                words,
              },
            ]
      const maxTokensHit = audioSec > 0 && words.length >= MAX_TOKENS_MIN_WORDS && words.length / audioSec > MAX_TOKENS_WORDS_PER_SEC
      return { segments, ...(maxTokensHit ? { maxTokensHit: true } : {}) }
    },

    async detectLanguage(audio: Float32Array): Promise<string> {
      // Auto-detect probe: greedy-generate a few tokens WITHOUT forcing
      // language/task (the 3.8.1 pipeline's default-call behaviour — versioned
      // docs ASR example `await transcriber(url)`) and read the leading
      // `<|xx|>` language token off the raw sequence, the same decode trick
      // 3.8.1's own `_decode_asr` uses (src/tokenizers.js).
      try {
        const processor = handle.processor
        const model = handle.model
        const tokenizer = handle.tokenizer
        if (processor === null || processor === undefined || model?.generate === undefined || tokenizer === undefined) return 'und'
        const features = await processor(audio)
        const generated = (await model.generate({ inputs: features['input_features'], max_new_tokens: LANGUAGE_PROBE_TOKENS })) as
          | { sequences?: { tolist?: () => unknown } }
          | undefined
        const rowsRaw = generated?.sequences?.tolist?.()
        if (!Array.isArray(rowsRaw)) return 'und'
        const rowRaw = (rowsRaw as unknown[])[0]
        if (!Array.isArray(rowRaw)) return 'und'
        const row = rowRaw as unknown[]
        for (const entry of row.slice(0, LANGUAGE_PROBE_TOKENS)) {
          const id = Number(entry)
          if (!Number.isFinite(id)) continue
          const match = /^<\|([a-z]{2,3})\|>$/.exec(tokenizer.decode([id]))
          if (match?.[1] !== undefined) return match[1]
        }
      } catch {
        // undetermined (BCP-47), never a guess; details are codes-free anyway.
      }
      return 'und'
    },

    async dispose(): Promise<void> {
      await handle.dispose()
    },
  }
}
