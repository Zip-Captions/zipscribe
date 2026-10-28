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
 * — only exposed on the cross-origin-isolated `pnpm preview:isolated` server
 * (settings.yml testing.memory_tests). Sampled every 250 ms while `work()`
 * runs; returns the peak bytes (null when unavailable).
 */
export async function peakJsMemory<T>(work: () => Promise<T>): Promise<{ result: T; peakJsHeapBytes: number | null; isolated: boolean }> {
  const isolated = window.crossOriginIsolated === true
  const measure = (performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<number> }).measureUserAgentSpecificMemory
  let peak: number | null = null
  let stop = false
  const poll = async (): Promise<void> => {
    if (!measure || !isolated) return
    while (!stop) {
      try {
        const value = await measure.call(performance)
        if (peak === null || value > peak) peak = value
      } catch {
        // The API throws when the page is not isolated; nothing to sample.
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  const poller = poll()
  try {
    const result = await work()
    return { result, peakJsHeapBytes: peak, isolated }
  } finally {
    stop = true
    await poller
  }
}

/** GPU availability probe (device policy): navigator.gpu presence. */
export function webgpuAvailable(): boolean {
  return typeof (navigator as unknown as { gpu?: unknown }).gpu !== 'undefined'
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
   * for the allowlisted HF URLs; runtimes from `self`).
   */
  load(options: Record<string, unknown>): Promise<{ ok: boolean; ms: number; error?: string }>
  /** One measured run over a corpus clip (already fetched+decoded by page). */
  run(clipUrl: string, options: Record<string, unknown>): Promise<{ ok: boolean; wallMs: number; error?: string; [key: string]: unknown }>
  /** US-02.3 leak protocol run (engine A only; sampled between windows). */
  leakRun?(clipUrl: string, options: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [key: string]: unknown }>
  dispose(): Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    __zipscribeEval?: EnginePageApi
  }
}
