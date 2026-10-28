// FR-1.0.2: the four workers from the architecture module map, wired through
// vite `?worker` imports (https://vite.dev/guide/workers). Nothing is
// instantiated at import time — workers are created on demand so the boot
// stays light; every message crosses the boundary as a protocol.ts union.
import MediaWorker from '../../workers/media.worker.ts?worker'
import AsrWorker from '../../workers/asr.worker.ts?worker'
import DiarizeWorker from '../../workers/diarize.worker.ts?worker'
import ExportWorker from '../../workers/export.worker.ts?worker'

const workerConstructors = {
  media: MediaWorker,
  asr: AsrWorker,
  diarize: DiarizeWorker,
  export: ExportWorker,
} as const

export type WorkerKind = keyof typeof workerConstructors

export function registeredWorkerKinds(): WorkerKind[] {
  return Object.keys(workerConstructors) as WorkerKind[]
}

export function createWorker(kind: WorkerKind): Worker {
  const Constructor = workerConstructors[kind]
  return new Constructor()
}
