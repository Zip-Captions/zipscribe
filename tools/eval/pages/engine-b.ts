// tools/eval/pages/engine-b.ts — page controller for engine B (sherpa-onnx
// WASM vad-asr). Decode + JS-heap sampling on the page (same protocol as
// engine A); VAD+ASR in the classic worker under /sherpa (self-hosted).
import { decodeClip, peakJsMemory, webgpuAvailable, type EnginePageApi } from './common'

interface WorkerReply {
  t: string
  [key: string]: unknown
}

function bridge(worker: Worker): { request(message: Record<string, unknown>, expect: string, timeoutMs?: number): Promise<WorkerReply> } {
  const pending = new Map<string, (reply: WorkerReply) => void>()
  worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
    const reply = event.data
    if (!reply || reply.t === 'ack' || reply.t === 'boot') return
    const resolve = pending.get(reply.t) ?? (reply.t === 'error' ? pending.values().next().value : undefined)
    if (resolve) {
      for (const [key] of pending) {
        if (pending.get(key) === resolve) pending.delete(key)
      }
      resolve(reply)
    }
  })
  return {
    request(message, expect, timeoutMs = 15 * 60_000) {
      return new Promise<WorkerReply>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(expect)
          reject(new Error(`engine-b: timeout waiting for ${expect}`))
        }, timeoutMs)
        pending.set(expect, (reply) => {
          clearTimeout(timer)
          if (reply.t === 'error') reject(new Error(String(reply.error ?? 'worker error')))
          else resolve(reply)
        })
        worker.postMessage(message)
      })
    },
  }
}

let worker: Worker | null = null
let rpc: ReturnType<typeof bridge> | null = null

const api: EnginePageApi = {
  async ready() {
    return { ok: true, webgpu: webgpuAvailable(), isolated: window.crossOriginIsolated === true }
  },
  async load(options) {
    const began = performance.now()
    try {
      worker = new Worker('/sherpa/engine-b.worker.js')
      rpc = bridge(worker)
      const reply = await rpc.request(
        {
          t: 'load',
          modelFiles: options.modelFiles,
          vadFile: options.vadFile,
          vadUrl: options.vadUrl,
          maxWindowSeconds: options.maxWindowSeconds,
        },
        'loaded',
        25 * 60_000,
      )
      return { ok: true, ms: Number(reply.ms ?? performance.now() - began), heapBytes: reply.heapBytes }
    } catch (error) {
      return { ok: false, ms: performance.now() - began, error: error instanceof Error ? `${error.name}:${error.message.slice(0, 200)}` : 'load-failed' }
    }
  },
  async run(clipUrl) {
    if (!rpc) return { ok: false, wallMs: 0, error: 'engine-b: not loaded' }
    try {
      const { result, peakJsHeapBytes, isolated } = await peakJsMemory(async () => {
        const began = performance.now()
        const clip = await decodeClip(clipUrl)
        const decodeMs = performance.now() - began
        const reply = await rpc!.request({ t: 'run', samples: Array.from(clip.samples), sampleRate: clip.sampleRate }, 'runDone')
        return { ...reply, decodeMs, durationSeconds: clip.durationSeconds } as { t: string; wallMs: number; decodeMs: number; durationSeconds: number; output: unknown; segmentCount: unknown }
      })
      return {
        ok: true,
        wallMs: Number(result.wallMs) + Number(result.decodeMs ?? 0),
        decodeMs: Number(result.decodeMs ?? 0),
        durationSeconds: Number(result.durationSeconds ?? 0),
        output: result.output,
        segmentCount: result.segmentCount,
        peakJsHeapBytes,
        isolated,
      }
    } catch (error) {
      return { ok: false, wallMs: 0, error: error instanceof Error ? `${error.name}:${error.message.slice(0, 200)}` : 'run-failed' }
    }
  },
  async dispose() {
    try {
      if (rpc) await rpc.request({ t: 'dispose' }, 'disposed', 60_000)
      worker?.terminate()
      worker = null
      rpc = null
      return { ok: true }
    } catch {
      return { ok: false }
    }
  },
}

;(window as unknown as Record<string, unknown>).__zipscribeEval = api
