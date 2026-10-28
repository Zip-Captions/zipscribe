// export.worker entry stub (FR-1.0.2) — typed with its own request/event
// union, no-op behaviour. Frame render → VideoEncoder → mux arrives in
// unit-202 behind the protocol contract.
import type { ExportEvent, ExportRequest } from '../engine/protocol'

interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<ExportRequest>) => void) | null
  postMessage(message: ExportEvent, options?: StructuredSerializeOptions): void
}

const scope = globalThis as unknown as DedicatedWorkerScope

scope.onmessage = (event: MessageEvent<ExportRequest>) => {
  const request = event.data
  if (request.t === 'export' || request.t === 'cancel') {
    scope.postMessage({ t: 'job:done', jobId: request.jobId } satisfies ExportEvent)
  }
}
