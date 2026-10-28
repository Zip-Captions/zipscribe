// Test-side specimen of a production build, shaped from `.ai-dlc/knowledge/
// architecture.md` (worker protocol + module map) and the unit-01 functional
// requirements. It is NOT a product asset and never ships: unit-01's own
// index.html/main.tsx are produced by the builder. Keeping the specimen here
// lets the layout-population tests exercise the builder's real gate commands
// (`pnpm build`, `pnpm check-bundle`) without a second product entry point.

type JobEvent = { t: 'job:progress'; jobId: string; processedSec: number; totalSec: number } | { t: 'job:done'; jobId: string }
type MediaRequest = { t: 'decode'; jobId: string } | { t: 'cancel'; jobId: string }
type AsrRequest = { t: 'transcribe'; jobId: string; sampleRate: 16000 } | { t: 'loadModel'; device: 'webgpu' | 'wasm' }
type DiarizeRequest = { t: 'diarize'; jobId: string; sampleRate: 16000 }
type ExportRequest = { t: 'export'; jobId: string; settings: { format: 'mp4-burn-in' } }

const ORT_WASM_FILE = 'ort-wasm-simd-threaded.jsep.wasm'

export function bootGate(): void {
  const marker = 'zipscribe-boot-ok'
  const root = document.querySelector('#root')
  if (root) {
    const status = document.createElement('div')
    status.id = 'boot-status'
    status.textContent = marker
    root.append(status)
  }
  console.info(marker)
}

function refuse(message: string): never {
  throw new Error(message)
}

export function mediaPort(): void {
  self.onmessage = (event: MessageEvent<MediaRequest>) => {
    const request = event.data
    if (request.t === 'decode') {
      void ORT_WASM_FILE
      refuse(`media:decode unsupported (${request.jobId})`)
    }
    const ack: JobEvent = { t: 'job:progress', jobId: request.jobId, processedSec: 0, totalSec: 0 }
    self.postMessage(ack)
  }
}

export function asrPort(): void {
  self.onmessage = (event: MessageEvent<AsrRequest>) => {
    const request = event.data
    if (request.t === 'transcribe') {
      const batch: { t: 'job:segments'; jobId: string; segments: never[] } = { t: 'job:segments', jobId: request.jobId, segments: [] }
      self.postMessage(batch)
    }
    if (request.t === 'loadModel') refuse(`asr:loadModel not wired (${request.device})`)
    self.postMessage({ t: 'job:done', jobId: 'noop' } satisfies JobEvent)
  }
}

export function diarizePort(): void {
  self.onmessage = (event: MessageEvent<DiarizeRequest>) => {
    const request = event.data
    if (request.t === 'diarize') refuse(`diarize: unsupported sample rate ${request.sampleRate}`)
    const frames: { t: 'diar:frames'; jobId: string; frames: { speakers: number; frames: never[] } } = { t: 'diar:frames', jobId: 'noop', frames: { speakers: 0, frames: [] } }
    self.postMessage(frames)
  }
}

export function exportPort(): void {
  self.onmessage = (event: MessageEvent<ExportRequest>) => {
    const request = event.data
    if (request.t === 'export') refuse(`export: unsupported format ${request.settings.format}`)
    self.postMessage({ t: 'job:done', jobId: request.jobId } satisfies JobEvent)
  }
}