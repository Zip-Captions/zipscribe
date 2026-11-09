// Production EnginePort (FR-2.0.6) — the app-side adapter over the real
// workers in `worker-registry`. Requests cross the boundary as protocol.ts
// unions; replies fan out to the registered listeners. The `inject*` members
// are the ziptest-bridge seam (unit-101 frozen contract § Window
// __zipWorkbenchBridge): they dispatch into the SAME listeners a worker
// reply reaches, with no worker round-trip. Production code paths never call
// them; the bridge itself is lazily imported behind `?ziptest=1`.

import { createWorker, type WorkerKind } from './worker-registry'
import type { AsrEvent, AsrRequest, DiarizeRequest, MediaEvent, MediaRequest } from '../../engine/protocol'
import type { EnginePort } from '../jobs'

export interface WorkerEnginePort extends EnginePort {
  /** Test-only dispatch to the media listeners (ziptest bridge). */
  injectMediaEvent(event: MediaEvent): void
  /** Test-only dispatch to the asr listeners (ziptest bridge). */
  injectAsrEvent(event: AsrEvent): void
}

function dispatch<E>(listeners: readonly ((event: E) => void)[], event: E): void {
  for (const listener of [...listeners]) listener(event)
}

export function createWorkerEnginePort(): WorkerEnginePort {
  const workers = new Map<WorkerKind, Worker>()
  const mediaListeners: ((event: MediaEvent) => void)[] = []
  const asrListeners: ((event: AsrEvent) => void)[] = []

  // Workers are created on first use (boot stays light, FR-1.0.2 doctrine);
  // the diarize/export workers get no listener wiring — the unit-101 slices
  // consume media/asr events only (unit-102 owns the further slices).
  function workerFor(kind: WorkerKind): Worker {
    const existing = workers.get(kind)
    if (existing !== undefined) return existing
    const worker = createWorker(kind)
    if (kind === 'media') {
      worker.addEventListener('message', (event) => {
        dispatch(mediaListeners, event.data as MediaEvent)
      })
    } else if (kind === 'asr') {
      worker.addEventListener('message', (event) => {
        dispatch(asrListeners, event.data as AsrEvent)
      })
    }
    workers.set(kind, worker)
    return worker
  }

  function subscribe<E>(listeners: ((event: E) => void)[], listener: (event: E) => void): () => void {
    listeners.push(listener)
    return () => {
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    }
  }

  return {
    postMedia(request: MediaRequest): void {
      workerFor('media').postMessage(request)
    },
    postAsr(request: AsrRequest): void {
      workerFor('asr').postMessage(request)
    },
    postDiarize(request: DiarizeRequest): void {
      workerFor('diarize').postMessage(request)
    },
    onMediaEvent(listener: (event: MediaEvent) => void): () => void {
      return subscribe(mediaListeners, listener)
    },
    onAsrEvent(listener: (event: AsrEvent) => void): () => void {
      return subscribe(asrListeners, listener)
    },
    injectMediaEvent(event: MediaEvent): void {
      dispatch(mediaListeners, event)
    },
    injectAsrEvent(event: AsrEvent): void {
      dispatch(asrListeners, event)
    },
    dispose(): void {
      for (const worker of workers.values()) worker.terminate()
      workers.clear()
      mediaListeners.length = 0
      asrListeners.length = 0
    },
  }
}
