// FR-1.0.9 — runtime wasm self-hosting, boot-time configuration.
//
// transformers.js defaults to loading the onnxruntime-web wasm from a CDN;
// that breaks offline use, the privacy request audit, and CSP — so the build
// copies the pinned ORT files into `public/wasm/` (scripts/copy-wasm.ts) and
// this module points the runtime at them with a single thread (production does
// not send COOP/COEP, so SharedArrayBuffer-backed threads are unavailable).
// Pinned-version behaviour verified against the versioned docs:
// https://huggingface.co/docs/transformers.js/v3.8.1/en/tutorials/webgpu_fallback
import { env } from '@huggingface/transformers'
import type { EngineError } from '../../protocol'

export const ORT_WASM_FILE = 'ort-wasm-simd-threaded.jsep.wasm'
export const WASM_PATHS = '/wasm/'

export interface OnnxWasmFlags {
  wasmPaths?: unknown
  numThreads?: unknown
}

export interface OnnxWasmTarget {
  backends: { onnx: { wasm?: OnnxWasmFlags } }
}

export function configureOnnxRuntime(target: OnnxWasmTarget = env): void {
  const wasm = (target.backends.onnx.wasm ??= {})
  wasm.wasmPaths = '/wasm/'
  wasm.numThreads = 1
}

/** ORT builds wasm URLs as `new URL(file, wasmPaths)` — mirror that so the
 *  warm-up requests exactly the URL ORT itself will later use. */
export function resolveWasmUrl(origin: string, wasmPaths: string = WASM_PATHS, fileName: string = ORT_WASM_FILE): string {
  return new URL(fileName, new URL(wasmPaths, origin).href).href
}

export interface WarmOptions {
  origin: string
  fetchImpl: typeof fetch
}

/** Seed the HTTP/service-worker cache for /wasm/* at boot so first inference
 *  (and offline use, invariant 9) does not depend on a cold CDN-less miss.
 *  Never logs content — failures surface as coded EngineErrors only. */
export async function warmRuntimeWasm(options: WarmOptions): Promise<EngineError | null> {
  const url = resolveWasmUrl(options.origin)
  try {
    const response = await options.fetchImpl(url, { cache: 'force-cache' })
    if (!response.ok) return { code: 'NETWORK', retryable: true, detail: `wasm:warm-up:status:${response.status}` }
    return null
  } catch {
    return { code: 'NETWORK', retryable: true, detail: 'wasm:warm-up:fetch-failed' }
  }
}

export function bootRuntime(options: Partial<WarmOptions> = {}): void {
  configureOnnxRuntime()
  const origin = options.origin ?? (typeof location === 'undefined' ? 'http://localhost' : location.origin)
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  void warmRuntimeWasm({ origin, fetchImpl }).catch(() => {
    // A failed warm-up must never break the shell; ORT resolves /wasm/* again
    // lazily on first session creation.
  })
}

// Device-matched ORT wasm build: the jsep (WebGPU-capable) build is correct for
// webgpu sessions but yields garbage logits on a CPU-wasm session, so a wasm
// fp32 session (pyannote/ERes2Net/Silero — WebGPU-unsupported, discovery) must
// load the PLAIN threaded build. Mirror ORT's own selection.
// https://onnxruntime.ai/docs/api/js/interfaces/Env.WebAssemblyEnv.Interface.html
function wasmFileStem(device: 'webgpu' | 'wasm'): string {
  return device === 'webgpu' ? 'ort-wasm-simd-threaded.jsep' : 'ort-wasm-simd-threaded'
}

/**
 * Re-expose the self-hosted `/wasm/` ORT pair (FR-1.0.9) as correctly-typed
 * blob URLs and point the runtime at them, so the ORT wasm backend's dynamic
 * `import()` of the `.mjs` glue succeeds. The preview/harness route policy
 * answers every `/wasm/**` — including the `.mjs` glue — as `application/wasm`,
 * which the browser refuses to `import()` as a module ("Failed to fetch
 * dynamically imported module"), so ORT never resolves `InferenceSession.create`
 * when left on the bare `'/wasm/'` wasmPaths. Blob URLs load identically in
 * production (the preview server would have served the right MIME anyway).
 * Mirrors the unit-05 ASR adapter bootstrap; shared so every bundled-ORT
 * engine (ASR + diarization) uses one implementation.
 */
export async function prepareOrtWasmBlobs(device: 'webgpu' | 'wasm' = 'wasm'): Promise<void> {
  const stem = wasmFileStem(device)
  const [glue, wasmBinary] = await Promise.all([fetch(`/wasm/${stem}.mjs`), fetch(`/wasm/${stem}.wasm`)])
  if (!glue.ok || !wasmBinary.ok) return
  const [glueText, wasmBytes] = await Promise.all([glue.text(), wasmBinary.arrayBuffer()])
  const glueUrl = URL.createObjectURL(new Blob([glueText], { type: 'text/javascript' }))
  const wasmUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }))
  // `env.backends.onnx.wasm` is a read-only/`unknown`-typed member on the
  // transformers types; reach it through a mutable view (same access the ASR
  // adapter uses) so the blob-pair assignment is typed.
  const onnx = (env as unknown as { backends: { onnx: { wasm?: Record<string, unknown> } } }).backends.onnx
  const wasm = (onnx.wasm ??= {})
  wasm.wasmPaths = { mjs: glueUrl, wasm: wasmUrl }
}

