// tools/eval/pages/asr-runner.ts — engine A (transformers.js) worker logic,
// shared by the pinned 3.8.1 worker and the 4.x leak-study worker (the only
// difference is which runtime module is injected).
//
// Pinned-version API verified against the installed 3.8.1 typings (the
// authoritative 3.8.1 source tag) and the versioned docs
// https://huggingface.co/docs/transformers.js/v3.8.1/en/api/env (docs-mcp
// indexes transformers.js main/4.x — AGENTS.md versioned-docs rule):
//   pipeline(task, model, { device, dtype, progress_callback })
//   dtype per-module recipe { encoder_model: 'fp32', decoder_model_merged: 'q4' }
//   (discovery.md § Whisper on WebGPU — the pinned recipe named by US-02.3)
//   call options { return_timestamps: 'word', language?, chunk_length_s? }
//   pipeline.dispose(): Promise<void>
// `language` omitted = auto-detect (AutomaticSpeechRecognitionSpecificParams
// .language defaults to null). The standard ASR output carries
// { text, chunks: [{ timestamp: [s, e], text }] } — no per-word probability
// field, which is what the `confidence` capability probe verifies at runtime
// (discovery.md open question).
export interface AsrChunk {
  text: string
  timestamp: [number, number]
}

export interface AsrRunOutput {
  text: string
  chunks: AsrChunk[]
  /** Whether the raw output objects carried any score/probability field. */
  hasScores: boolean
}

export interface InjectedRuntime {
  pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<AsrPipeline>
  env: {
    useBrowserCache: boolean
    allowRemoteModels: boolean
    allowLocalModels: boolean
    backends: { onnx: { wasm?: Record<string, unknown> } }
  }
}

export interface AsrPipeline {
  (audio: Float32Array | { audio: Float32Array; sampling_rate: number }, options?: Record<string, unknown>): Promise<AsrRawOutput | AsrRawOutput[]>
  dispose(): Promise<void>
}

interface AsrRawOutput {
  text?: string
  chunks?: AsrChunk[]
  [key: string]: unknown
}

export interface EngineAState {
  pipeline: AsrPipeline | null
  runtime: InjectedRuntime | null
  loadMs: number
}

export function configureRuntime(runtime: InjectedRuntime, wasmPaths: string): void {
  // FR-02.2: numThreads = 1 everywhere (settings.yml testing.onnx_threads);
  // unit-01 boot contract (src/engine/boot/adapters/onnx-runtime-boot.ts)
  // sets the same values for the app — mirrored here with a harness-specific
  // wasmPaths when studying the 4.x copy.
  const wasm = (runtime.env.backends.onnx.wasm ??= {})
  wasm.wasmPaths = wasmPaths
  wasm.numThreads = 1
  // ORT's proxy worker cannot nest inside this module worker (sessions load
  // but never execute — the run() await hangs). Inline execution instead;
  // numThreads:1 keeps it single-threaded per settings.yml testing.onnx_threads.
  wasm.proxy = false
  runtime.env.useBrowserCache = false
  // FR-02.1/US-02.2: models are served by the preview server (self origin)
  // from the SHA-256-verified cache mirror — remote model fetch is disabled
  // so an accidental network fallback would surface as a load error (and an
  // audit log entry), never silently.
  runtime.env.allowRemoteModels = false
  runtime.env.allowLocalModels = true
  ;(runtime.env as unknown as { localModelPath: string }).localModelPath = '/hf-cache/'
}

export async function loadAsr(runtime: InjectedRuntime, repo: string, device: 'webgpu' | 'wasm', wasmPaths: string): Promise<AsrPipeline> {
  configureRuntime(runtime, wasmPaths)
  const dtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' }
  const created = await runtime.pipeline('automatic-speech-recognition', repo, {
    device,
    dtype,
    // session-level thread cap is the env flag above; keep the explicit
    // session option too so wasm runs match settings.yml numThreads=1.
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
  })
  return created
}

function toRunOutput(raw: AsrRawOutput | AsrRawOutput[]): AsrRunOutput {
  const first = Array.isArray(raw) ? raw[0] : raw
  const text = first?.text ?? ''
  const chunks = Array.isArray(first?.chunks) ? first.chunks : []
  const hasScores =
    (Array.isArray(raw) ? raw : [raw]).some((entry) => Object.keys(entry ?? {}).some((key) => /score|prob|logit/i.test(key))) ||
    chunks.some((chunk) => Object.keys(chunk ?? {}).some((key) => /score|prob|logit/i.test(key)))
  return { text, chunks, hasScores }
}

/** One measured transcription of the full clip (word timestamps). */
export async function runAsr(pipeline: AsrPipeline, samples: Float32Array, _sampleRate: number, language: string | undefined, ts: string = 'word'): Promise<AsrRunOutput> {
  const options: Record<string, unknown> = { return_timestamps: ts === 'none' ? false : ts === 'segment' ? true : 'word' }
  if (language) options.language = language
  // v3.8.1 WhisperASRProcessor takes the Float32Array directly (16 kHz —
  // matching the pipeline's feature extractor default sampling_rate).
  const raw = await pipeline(samples, options)
  return toRunOutput(raw)
}

export interface WindowProgress {
  index: number
  wallMs: number
  /** Transcript length only — SECURITY-03, text never leaves the page. */
  textLength: number
  output: AsrRunOutput
}

/**
 * US-02.3 leak protocol: `windowCount` consecutive `windowSeconds`-long
 * windows as SEPARATE pipeline calls on one loaded pipeline, pausing for an
 * `ack()` between windows so the harness can sample GPU-process memory
 * after every window (protocol per issue #1739: sample the GPU process
 * footprint between calls; https://github.com/huggingface/transformers.js/issues/1739).
 */
export async function runAsrWindows(
  pipeline: AsrPipeline,
  samples: Float32Array,
  sampleRate: number,
  windowSeconds: number,
  windowCount: number,
  ack: (progress: WindowProgress) => Promise<void>,
): Promise<WindowProgress[]> {
  const progress: WindowProgress[] = []
  const windowSamples = Math.floor(windowSeconds * sampleRate)
  for (let index = 0; index < windowCount; index += 1) {
    const start = index * windowSamples
    if (start >= samples.length) break
    const window = samples.subarray(start, Math.min(samples.length, start + windowSamples))
    const began = performance.now()
    const output = await runAsr(pipeline, new Float32Array(window), sampleRate, 'en')
    const entry: WindowProgress = { index, wallMs: performance.now() - began, textLength: output.text.length, output }
    progress.push(entry)
    await ack(entry)
  }
  return progress
}
