// diarize.worker entry stub (FR-1.0.2) — typed with its own request/event
// union, no-op behaviour. Segmentation/embeddings/clustering arrive in
// unit-06 behind the protocol contract.
import type { DiarizeEvent, DiarizeRequest } from '../engine/protocol'

interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<DiarizeRequest>) => void) | null
  postMessage(message: DiarizeEvent, options?: StructuredSerializeOptions): void
}

const scope = globalThis as unknown as DedicatedWorkerScope

scope.onmessage = (event: MessageEvent<DiarizeRequest>) => {
  const request = event.data
  if (request.t === 'diarize' || request.t === 'cancel') {
    scope.postMessage({ t: 'job:done', jobId: request.jobId } satisfies DiarizeEvent)
  }
}
