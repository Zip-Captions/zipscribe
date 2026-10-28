// asr.worker entry stub (FR-1.0.2) — typed with its own request/event union,
// no-op behaviour. VAD + ASR engine wiring arrives in unit-05 behind the
// protocol contract.
import type { AsrEvent, AsrRequest } from '../engine/protocol'

interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<AsrRequest>) => void) | null
  postMessage(message: AsrEvent, options?: StructuredSerializeOptions): void
}

const scope = globalThis as unknown as DedicatedWorkerScope

scope.onmessage = (event: MessageEvent<AsrRequest>) => {
  const request = event.data
  if (request.t === 'transcribe' || request.t === 'cancel') {
    scope.postMessage({ t: 'job:done', jobId: request.jobId } satisfies AsrEvent)
  }
}
