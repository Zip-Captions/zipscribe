// media.worker entry stub (FR-1.0.2) — typed with its own request/event union
// (architecture.md § Worker protocol), no-op behaviour. Real demux/PCM logic
// arrives in unit-04 (media ingest) behind the protocol contract.
import type { MediaEvent, MediaRequest } from '../engine/protocol'

interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<MediaRequest>) => void) | null
  postMessage(message: MediaEvent, options?: StructuredSerializeOptions): void
}

const scope = globalThis as unknown as DedicatedWorkerScope

scope.onmessage = (event: MessageEvent<MediaRequest>) => {
  const request = event.data
  // No-op: acknowledge requests that carry a job id, do nothing else.
  if (request.t === 'probe' || request.t === 'decode' || request.t === 'cancel') {
    scope.postMessage({ t: 'job:done', jobId: request.jobId } satisfies MediaEvent)
  }
}
