// Production ExportWorkerPort (FR-102.7 seam; unit-106 slice D provider) —
// the adapter the composition root hands `createExportService` over the
// `export` worker in `worker-registry`. Follows engine-port.ts (the
// asr/diarize/media precedent): the worker is created lazily on first use,
// requests cross as protocol.ts unions (structured clone — the request's
// `File` passes), replies fan out to registered listeners, `dispose`
// terminates. Message payloads are filtered to protocol Events (shape check
// on `t` + `jobId`) so a foreign postMessage never reaches the correlation
// layer. SECURITY-03: nothing here logs; failures are the worker's own
// `job:error` codes, delivered verbatim through the event union.

import { createWorker } from './worker-registry'
import type { ExportEvent, ExportRequest } from '../../engine/protocol'
import type { ExportWorkerPort } from './export'

/** Protocol-shape filter: an ExportEvent is a tagged object with a jobId.
 *  Everything else (foreign scripts, devtools chatter) is dropped. */
function isExportEvent(value: unknown): value is ExportEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { t?: unknown; jobId?: unknown }
  return typeof candidate.t === 'string' && typeof candidate.jobId === 'string'
}

export function createExportWorkerPort(): ExportWorkerPort {
  let worker: Worker | null = null
  const listeners: ((event: ExportEvent) => void)[] = []

  function workerFor(): Worker {
    if (worker !== null) return worker
    const created = createWorker('export')
    created.addEventListener('message', (event: MessageEvent<unknown>) => {
      const data = event.data
      if (!isExportEvent(data)) return
      for (const listener of [...listeners]) listener(data)
    })
    worker = created
    return created
  }

  return {
    postExport(request: ExportRequest): void {
      workerFor().postMessage(request)
    },
    onExportEvent(listener: (event: ExportEvent) => void): () => void {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    dispose(): void {
      worker?.terminate()
      worker = null
      listeners.length = 0
    },
  }
}
