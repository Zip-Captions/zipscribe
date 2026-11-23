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
  /** Online probe (injected for L1 determinism; bootRuntime defaults to
   *  `navigator.onLine`, true where no navigator exists). */
  isOnline?: () => boolean
  /** Cache-API presence probe (L1 seam; default scans every open cache). */
  cacheLookup?: (url: string) => Promise<boolean>
  /** SW-process online probe (L1 seam): the renderer's `navigator.onLine`
   *  can lag a network transition for the first instant of a fresh
   *  navigation — the SW process tracks it authoritatively. `undefined` =
   *  no opinion (no controlling SW). */
  swOnline?: () => Promise<boolean | undefined>
  /** Hard cap on a single seed attempt (default 8 s) — a warm fetch must
   *  never live across a later network transition (unit-204 flake). */
  timeoutMs?: number
}

/** Presence check across all open caches (the entry may sit in the workbox
 *  precache or the `zipscribe-wasm` runtime cache). */
async function cachedWasmEntry(url: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      if ((await cache.match(url)) !== undefined) return true
    }
  } catch {
    // Presence unknown — treated as a miss; the online gate still holds.
  }
  return false
}

/** Ask the controlling SW for its live `navigator.onLine` (one MessageChannel
 *  round trip; `undefined` when no controller or no reply within 1.5 s). */
async function probeSwOnline(): Promise<boolean | undefined> {
  if (typeof navigator === 'undefined' || typeof MessageChannel === 'undefined') return undefined
  const controller = navigator.serviceWorker?.controller ?? null
  if (controller === null) return undefined
  return new Promise<boolean | undefined>((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(undefined), 1500)
    channel.port1.onmessage = (event: MessageEvent<{ type?: string; online?: boolean }>) => {
      clearTimeout(timer)
      resolve(event.data?.type === 'zipscribe:online-reply' ? event.data.online === true : undefined)
    }
    controller.postMessage({ type: 'zipscribe:online-query' }, [channel.port2])
  })
}

/** Single-flight per URL: concurrent/repeat boots share ONE seed fetch, so a
 *  slow seed can never fork into parallel wire attempts. */
const warmInFlight = new Map<string, Promise<EngineError | null>>()

/** Seed the HTTP/service-worker cache for /wasm/* at boot so first inference
 *  (and offline use, invariant 9) does not depend on a cold CDN-less miss.
 *  The warm is a cache SEED — offline it can only fail, and a real attempt
 *  would breach the offline request audit (CC-204.3: zero network attempts),
 *  so it consults the Cache API first (cached ⇒ provably zero network),
 *  refuses while the SW process reports offline (the renderer's onLine can be
 *  stale-true at fresh-navigation boot — the unit-204 flake), and bounds the
 *  attempt so no seed fetch can live across a later offline transition.
 *  Never logs content — failures surface as coded EngineErrors only. */
export async function warmRuntimeWasm(options: WarmOptions): Promise<EngineError | null> {
  if ((options.isOnline ?? defaultIsOnline)() === false) return null
  const url = resolveWasmUrl(options.origin)
  const cached = await (options.cacheLookup ?? cachedWasmEntry)(url)
  if (cached) return null // invariant 9: cached ⇒ zero network, always
  if ((await (options.swOnline ?? probeSwOnline)()) === false) return null
  const existing = warmInFlight.get(url)
  if (existing !== undefined) return existing
  const attempt = (async (): Promise<EngineError | null> => {
    try {
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(options.timeoutMs ?? 8_000) : undefined
      const response = await options.fetchImpl(url, { cache: 'force-cache', ...(signal !== undefined ? { signal } : {}) })
      if (!response.ok) return { code: 'NETWORK', retryable: true, detail: `wasm:warm-up:status:${response.status}` }
      // Page-side put seeds the runtime cache even on a pre-control boot, so
      // the next boot is a cache hit and never re-fetches.
      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open('zipscribe-wasm')
          await cache.put(url, response.clone())
        } catch {
          // SW route still records it for controlled requests; never fail the warm on it.
        }
      }
      return null
    } catch {
      return { code: 'NETWORK', retryable: true, detail: 'wasm:warm-up:fetch-failed' }
    } finally {
      warmInFlight.delete(url)
    }
  })()
  warmInFlight.set(url, attempt)
  return attempt
}

const defaultIsOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine)

export function bootRuntime(options: Partial<WarmOptions> = {}): void {
  configureOnnxRuntime()
  const origin = options.origin ?? (typeof location === 'undefined' ? 'http://localhost' : location.origin)
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const isOnline = options.isOnline ?? defaultIsOnline
  void warmRuntimeWasm({ origin, fetchImpl, isOnline }).catch(() => {
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
