// tools/eval/pages/engine-a.ts — page controller for engine A. Owns audio
// decode (FR-02.2 "incl. audio decode" — measured inside run()) and the
// JS-memory peak sampler; inference happens in the worker module selected by
// ?runtime= (3.8.1 pinned | 4x isolated leak-study copy).
import { decodeClip, peakJsMemory, probeWebgpu, type EnginePageApi, type WebGpuProbe } from './common'
import EngineAWorker from './engine-a.worker.ts?worker&module'
import EngineA4xWorker from './engine-a4x.worker.ts?worker&module'

interface WorkerReply {
  t: string
  [key: string]: unknown
}

function createWorker(): Worker {
  const runtime = new URLSearchParams(location.search).get('runtime') === '4x' ? '4x' : '3.8.1'
  return runtime === '4x' ? new EngineA4xWorker() : new EngineAWorker()
}

function bridge(worker: Worker): {
  request(message: Record<string, unknown>, expect: string, timeoutMs?: number): Promise<WorkerReply>
  ack(): void
} {
  const pending = new Map<string, (reply: WorkerReply) => void>()
  worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
    const reply = event.data
    if (reply?.t === 'ack' || reply?.t === 'boot') return
    const resolve = pending.get(reply.t) ?? (reply.t === 'error' ? pending.values().next().value : undefined)
    if (resolve) {
      for (const [key] of pending) {
        if (pending.get(key) === resolve) pending.delete(key)
      }
      resolve(reply)
    }
  })
  return {
    request(message, expect, timeoutMs = 10 * 60_000) {
      return new Promise<WorkerReply>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(expect)
          reject(new Error(`engine-a: timeout waiting for ${expect}`))
        }, timeoutMs)
        pending.set(expect, (reply) => {
          clearTimeout(timer)
          if (reply.t === 'error') reject(new Error(String(reply.error ?? 'worker error')))
          else resolve(reply)
        })
        worker.postMessage(message)
      })
    },
    ack() {
      worker.postMessage({ t: 'ack' })
    },
  }
}

const worker = createWorker()
const rpc = bridge(worker)

// Fail-closed WebGPU gate (slice-2B defect #1): the adapter is probed BEFORE
// the pipeline is asked for device:'webgpu'. No adapter → load fails with the
// attempted device + reason recorded, never an ok:true webgpu row.
let lastAdapter: WebGpuProbe | null = null

const api: EnginePageApi = {
  async ready() {
    const probe = await probeWebgpu()
    return { ok: true, webgpu: probe.adapter && probe.fallbackAdapter !== true, isolated: window.crossOriginIsolated === true, detail: probe.error ?? (probe.adapterInfo?.description ?? 'adapter-ok') }
  },
  async load(options) {
    const began = performance.now()
    const device = String(options.device)
    const probe = await probeWebgpu()
    lastAdapter = probe
    if (device === 'webgpu') {
      if (!probe.adapter || probe.fallbackAdapter === true) {
        return {
          ok: false,
          ms: performance.now() - began,
          error: `webgpu-adapter-unavailable:${probe.error ?? (probe.fallbackAdapter === true ? 'fallback-adapter' : 'no-adapter')}`,
          attemptedDevice: device,
          adapter: probe,
        }
      }
    }
    try {
      const reply = await rpc.request(
        {
          t: 'load',
          repo: String(options.repo),
          device,
          wasmPaths: String(options.wasmPaths ?? '/wasm/'),
        },
        'loaded',
        15 * 60_000,
      )
      return { ok: true, ms: Number(reply.ms ?? performance.now() - began), attemptedDevice: device, adapter: probe }
    } catch (error) {
      return { ok: false, ms: performance.now() - began, error: error instanceof Error ? `${error.name}:${error.message.slice(0, 200)}` : 'load-failed', attemptedDevice: device, adapter: probe }
    }
  },
  async run(clipUrl, options) {
    try {
      const { result, peakJsHeapBytes, peakJsHeapReason, jsHeapSamples, isolated } = await peakJsMemory(async () => {
        const began = performance.now()
        const clip = await decodeClip(clipUrl)
        const decodeMs = performance.now() - began
        const reply = await rpc.request(
          {
            t: 'run',
            samples: Array.from(clip.samples),
            sampleRate: clip.sampleRate,
            language: options.language === null || options.language === undefined ? undefined : String(options.language),
            noLanguageProbe: options.language === null,
            ts: new URLSearchParams(location.search).get('ts') ?? undefined,
          },
          'runDone',
        )
        return { ...reply, decodeMs, durationSeconds: clip.durationSeconds } as { t: string; wallMs: number; decodeMs: number; durationSeconds: number; output: unknown }
      })
      if (!isolated) {
        // FR-02.2: heap sampling (and the numThreads:1 WASM contract) is only
        // valid on the COOP/COEP isolated preview — fail closed, never sample
        // a non-isolated page and call the 0 it produces "data".
        return { ok: false, wallMs: 0, error: 'not-cross-origin-isolated' }
      }
      return {
        ok: true,
        wallMs: Number(result.wallMs) + Number(result.decodeMs ?? 0),
        decodeMs: Number(result.decodeMs ?? 0),
        durationSeconds: Number(result.durationSeconds ?? 0),
        output: result.output,
        peakJsHeapBytes,
        peakJsHeapReason,
        jsHeapSamples,
        isolated,
      }
    } catch (error) {
      return { ok: false, wallMs: 0, error: error instanceof Error ? `${error.name}:${error.message.slice(0, 200)}` : 'run-failed' }
    }
  },
  async adapterProbe() {
    if (!lastAdapter) lastAdapter = await probeWebgpu()
    return lastAdapter as unknown as Record<string, unknown>
  },
  async leakRun(clipUrl, options) {
    const windowSeconds = Number(options.windowSeconds ?? 28)
    const windowCount = Number(options.windowCount ?? 20)
    try {
      const clip = await decodeClip(clipUrl)
      const samples = Array.from(clip.samples)
      const windows: Array<{ index: number; gpuMemBytes: number | null; wallMs: number; textLength: number }> = []
      const finished = new Promise<WorkerReply>((resolve, reject) => {
        worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
          if (event.data?.t === 'windowDone') {
            windows.push({
              index: Number(event.data.index),
              gpuMemBytes: null,
              wallMs: Number(event.data.wallMs),
              textLength: Number(event.data.textLength),
            })
            const sampler = (window as unknown as { __zipscribeSampleGpuMem?: () => Promise<number | null> }).__zipscribeSampleGpuMem
            void (async () => {
              const sample = sampler ? await sampler() : null
              const row = windows.find((entry) => entry.index === Number(event.data?.index))
              if (row) row.gpuMemBytes = sample
              rpc.ack()
            })()
          } else if (event.data?.t === 'leakDone') resolve(event.data)
          else if (event.data?.t === 'error') reject(new Error(String(event.data.error)))
        })
        setTimeout(() => reject(new Error('engine-a: leak timeout')), 45 * 60_000)
      })
      worker.postMessage({ t: 'leak', samples, sampleRate: clip.sampleRate, windowSeconds, windowCount })
      await finished
      return { ok: true, windows, windowCount, windowSeconds, error: undefined }
    } catch (error) {
      return { ok: false, windows: [], windowCount, windowSeconds, error: error instanceof Error ? `${error.name}:${error.message.slice(0, 200)}` : 'leak-failed' }
    }
  },
  async dispose() {
    try {
      await rpc.request({ t: 'dispose' }, 'disposed', 60_000)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  },
}

;(window as unknown as Record<string, unknown>).__zipscribeEval = api
