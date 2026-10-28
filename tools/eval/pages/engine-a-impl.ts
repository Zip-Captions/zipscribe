// tools/eval/pages/engine-a-impl.ts — message protocol shared by the two
// engine-A workers (pinned 3.8.1 and the 4.x leak-study copy): the only
// difference between them is which transformers.js module gets injected.
import { loadAsr, runAsr, runAsrWindows, type AsrPipeline, type InjectedRuntime, type WindowProgress } from './asr-runner'

interface LoadRequest {
  t: 'load'
  repo: string
  device: 'webgpu' | 'wasm'
  wasmPaths: string
}
interface RunRequest {
  t: 'run'
  samples: number[]
  sampleRate: number
  language?: string
  noLanguageProbe: boolean
  ts?: string
}
interface LeakRequest {
  t: 'leak'
  samples: number[]
  sampleRate: number
  windowSeconds: number
  windowCount: number
}
interface DisposeRequest {
  t: 'dispose'
}
type WorkerRequest = LoadRequest | RunRequest | LeakRequest | DisposeRequest

interface WorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

const scope = self as unknown as WorkerScope

export function installEngineAWorker(runtime: InjectedRuntime): void {
  let pipeline: AsrPipeline | null = null

  const post = (message: Record<string, unknown>): void => scope.postMessage(message)

  const awaitAck = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const onAck = (event: MessageEvent<{ t?: string }>): void => {
        if (event.data?.t === 'ack') {
          scope.removeEventListener('message', onAck)
          resolve()
        }
      }
      scope.addEventListener('message', onAck)
    })

  async function handle(request: WorkerRequest): Promise<void> {
    if (request.t === 'load') {
      const began = performance.now()
      pipeline = await loadAsr(runtime, request.repo, request.device, request.wasmPaths)
      post({ t: 'loaded', ms: performance.now() - began })
      return
    }
    if (request.t === 'run') {
      if (!pipeline) throw new Error('engine-a: run before load')
      const samples = new Float32Array(request.samples)
      const began = performance.now()
      const output = await runAsr(pipeline, samples, request.sampleRate, request.noLanguageProbe ? undefined : request.language, request.ts)
      post({ t: 'runDone', wallMs: performance.now() - began, output })
      return
    }
    if (request.t === 'leak') {
      if (!pipeline) throw new Error('engine-a: leak before load')
      const samples = new Float32Array(request.samples)
      await runAsrWindows(pipeline, samples, request.sampleRate, request.windowSeconds, request.windowCount, async (progress: WindowProgress) => {
        post({ t: 'windowDone', index: progress.index, wallMs: progress.wallMs, textLength: progress.textLength })
        await awaitAck()
      })
      post({ t: 'leakDone' })
      return
    }
    if (request.t === 'dispose') {
      // US-02.3: does pipeline.dispose() reclaim the grown GPU memory?
      if (pipeline) {
        await pipeline.dispose()
        pipeline = null
      }
      post({ t: 'disposed' })
    }
  }

  scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
    void handle(event.data).catch((error: unknown) => {
      // SECURITY-03: codes/lengths only — never transcript text in messages.
      post({ t: 'error', error: error instanceof Error ? `${error.name}:${error.message.slice(0, 160)}` : 'unknown' })
    })
  })

  post({ t: 'boot' })
}
