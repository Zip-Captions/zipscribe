// tools/eval/pages/common.ts — shared page-side helpers for the unit-02
// eval pages (FR-02.1/FR-02.2). Kept framework-free (no React): these pages
// are harness surfaces, not the app.

/** One decoded corpus clip, mono 16 kHz — what every engine worker consumes. */
export interface DecodedClip {
  samples: Float32Array
  sampleRate: number
  durationSeconds: number
}

/**
 * Fetch + decode a corpus clip to 16 kHz mono Float32, INSIDE the measured
 * wall time (FR-02.2 "RTF measured per engine incl. audio decode").
 * WebCodecs/AudioContext decode of the AAC track of the unit-01 MP4 fixtures
 * happens here on the page; the worker only sees PCM.
 */
export async function decodeClip(url: string): Promise<DecodedClip> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`clip fetch failed ${response.status}`)
  const bytes = await response.arrayBuffer()
  const decoded = await decodeToMono16k(bytes)
  return decoded
}

async function decodeToMono16k(bytes: ArrayBuffer): Promise<DecodedClip> {
  const AudioCtor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtor()
  try {
    const buffer = await ctx.decodeAudioData(bytes.slice(0))
    const targetRate = 16000
    const length = Math.max(1, Math.ceil((buffer.duration * targetRate) | 0))
    const oac = new OfflineAudioContext(1, length, targetRate)
    const source = oac.createBufferSource()
    source.buffer = buffer
    source.connect(oac.destination)
    source.start()
    const rendered = await oac.startRendering()
    const samples = new Float32Array(rendered.getChannelData(0))
    return { samples, sampleRate: targetRate, durationSeconds: buffer.duration }
  } finally {
    void ctx.close()
  }
}

/**
 * JS-heap peak sampler (FR-02.2): performance.measureUserAgentSpecificMemory()
 * — only usable on the cross-origin-isolated `pnpm preview:isolated` server
 * (settings.yml testing.memory_tests). Per MDN the promise resolves to a
 * MemoryInfo object whose `bytes` field carries the total (window + workers
 * included) — sampling the resolved value as a number (build-1) compared an
 * object and kept the peak null forever:
 * https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory
 * MDN also prescribes periodic calls (it is a tracking API, not a one-shot)
 * and a SecurityError when the isolation requirements are unmet; a genuinely
 * unmeasurable heap returns null + reason, never 0-as-data (slice-2B defect
 * #4).
 */
export interface JsHeapSample {
  result: unknown
  peakJsHeapBytes: number | null
  jsHeapSamples: number
  peakJsHeapReason: string | null
  isolated: boolean
}

export async function peakJsMemory<T>(work: () => Promise<T>): Promise<{ result: T } & Omit<JsHeapSample, 'result'>> {
  const isolated = window.crossOriginIsolated === true
  const perf = performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes?: number } | number> }
  const measure = perf.measureUserAgentSpecificMemory
  let peak: number | null = null
  let samples = 0
  let reason: string | null = isolated ? null : 'not-cross-origin-isolated'
  if (isolated && !measure) reason = 'measureUserAgentSpecificMemory-unavailable'
  let stop = false
  const poll = async (): Promise<void> => {
    if (!measure || !isolated) return
    while (!stop) {
      try {
        const value = await measure.call(performance)
        const bytes = typeof value === 'number' ? value : value?.bytes
        if (typeof bytes === 'number' && Number.isFinite(bytes)) {
          samples += 1
          if (peak === null || bytes > peak) peak = bytes
        }
      } catch (error) {
        reason = `sample-threw:${error instanceof Error ? error.name : 'unknown'}`
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  const poller = poll()
  try {
    const result = await work()
    if (samples === 0 && reason === null) reason = 'no-samples-in-run-window'
    return { result, peakJsHeapBytes: peak, jsHeapSamples: samples, peakJsHeapReason: samples > 0 ? null : reason, isolated }
  } finally {
    stop = true
    await poller
  }
}

/** GPU presence check (navigator.gpu only) — the weak probe kept for the
 *  engine B/C pages (T2 wasm runs). Engine A must use probeWebgpu() instead:
 *  navigator.gpu existing without a usable adapter is NOT WebGPU availability
 *  (slice-2B defect #1, fail-closed gate). */
export function webgpuAvailable(): boolean {
  return typeof (navigator as unknown as { gpu?: unknown }).gpu !== 'undefined'
}

/** Fail-closed WebGPU probe (slice-2B defect #1): navigator.gpu AND a real
 *  requestAdapter() result, with adapter info + fallback flag recorded.
 *  requestAdapter() returning null means "no adapter" per
 *  https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
 *  (adapter-null causes listed there); `isFallbackAdapter === true` means the
 *  adapter is the SwiftShader software fallback — measurements taken on it
 *  would not represent T1 hardware, so it is recorded and gated too.
 *  `adapter.info` is the current surface (Chrome 130+);
 *  `requestAdapterInfo()` was the pre-130 path — both handled defensively. */
export interface WebGpuProbe {
  probed: true
  navigatorGpu: boolean
  adapter: boolean
  fallbackAdapter: boolean | null
  adapterInfo: { vendor: string | null; architecture: string | null; device: string | null; description: string | null } | null
  error: string | null
}

interface AdapterLike {
  isFallbackAdapter?: boolean
  info?: { vendor?: string; architecture?: string; device?: string; description?: string }
  requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; device?: string; description?: string }>
}

export async function probeWebgpu(): Promise<WebGpuProbe> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<AdapterLike | null> } }).gpu
  if (!gpu) return { probed: true, navigatorGpu: false, adapter: false, fallbackAdapter: null, adapterInfo: null, error: 'navigator.gpu-undefined' }
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) return { probed: true, navigatorGpu: true, adapter: false, fallbackAdapter: null, adapterInfo: null, error: 'requestAdapter-null' }
    let info = adapter.info
    if (!info && typeof adapter.requestAdapterInfo === 'function') {
      try {
        info = await adapter.requestAdapterInfo()
      } catch {
        info = undefined
      }
    }
    return {
      probed: true,
      navigatorGpu: true,
      adapter: true,
      fallbackAdapter: adapter.isFallbackAdapter === true,
      adapterInfo: info
        ? {
            vendor: typeof info.vendor === 'string' ? info.vendor : null,
            architecture: typeof info.architecture === 'string' ? info.architecture : null,
            device: typeof info.device === 'string' ? info.device : null,
            description: typeof info.description === 'string' ? info.description : null,
          }
        : null,
      error: null,
    }
  } catch (error) {
    return { probed: true, navigatorGpu: true, adapter: false, fallbackAdapter: null, adapterInfo: null, error: `requestAdapter-threw:${error instanceof Error ? error.name : 'unknown'}` }
  }
}

export interface EnginePageBridge {
  /** Engine id (Candidates-table letter). */
  engineId: 'A' | 'B' | 'C'
  /** Engine runtime version string (npm package version measured). */
  version: string
  /** Called by the harness via page.evaluate once the page is interactive. */
  __zipscribeEval: EnginePageApi
}

export interface EnginePageApi {
  ready(): Promise<{ ok: boolean; webgpu: boolean; isolated: boolean; detail?: string }>
  /**
   * Load the engine (model bytes come from the harness's route interceptor
   * for the allowlisted HF URLs; runtimes from `self`). Engine A fails closed
   * on `device:'webgpu'` without a real adapter (defect #1) and records the
   * probe + attempted device either way.
   */
  load(options: Record<string, unknown>): Promise<{ ok: boolean; ms: number; error?: string; attemptedDevice?: string; adapter?: WebGpuProbe }>
  /** One measured run over a corpus clip (already fetched+decoded by page). */
  run(clipUrl: string, options: Record<string, unknown>): Promise<{ ok: boolean; wallMs: number; error?: string; [key: string]: unknown }>
  /** US-02.3 leak protocol run (engine A only; sampled between windows). */
  leakRun?(clipUrl: string, options: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [key: string]: unknown }>
  /** Fail-closed WebGPU adapter probe (recorded on every measured row). */
  adapterProbe?(): Promise<Record<string, unknown>>
  dispose(): Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    __zipscribeEval?: EnginePageApi
  }
}
