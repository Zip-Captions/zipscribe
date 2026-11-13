// L1 contract for the production ExportWorkerPort (FR-102.7 seam, unit-106
// slice D provider). Same `globalThis.Worker` stub lineage as
// engine-port.test.ts / worker-registry.test.ts: the port is worker-boundary
// glue — these suites pin lazy creation, structured-clone pass-through of
// the request (File rides), protocol-Event filtering, per-listener
// unsubscribe and dispose.
import { describe, expect, test } from 'vitest'
import { createExportWorkerPort } from './export-worker-port'
import type { ExportEvent, ExportRequest } from '../../engine/protocol'
import type { ProjectSnapshot } from '../../engine/model'

class FakeWorker {
  static readonly created: FakeWorker[] = []
  readonly posted: unknown[] = []
  terminated = false
  private readonly handlers: ((event: { data: unknown }) => void)[] = []

  constructor() {
    FakeWorker.created.push(this)
  }

  addEventListener(_type: string, handler: (event: { data: unknown }) => void): void {
    this.handlers.push(handler)
  }

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(data: unknown): void {
    for (const handler of [...this.handlers]) handler({ data })
  }
}

function withFakeWorker(run: () => void): void {
  FakeWorker.created.length = 0
  const previous = globalThis.Worker
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    run()
  } finally {
    if (previous === undefined) delete (globalThis as { Worker?: typeof Worker }).Worker
    else globalThis.Worker = previous
  }
}

function requestFixture(): ExportRequest {
  const snapshot = {
    snapshotVersion: 1,
    id: 'p',
    name: 'n',
    schemaVersion: 1,
    asset: null,
    blocks: [],
    captionOrigin: 'none',
    translations: [],
    speakers: [],
    speakerSource: 'none',
    language: null,
    modelId: null,
    style: null,
    outputAspect: 'source',
    transcription: 'none',
    updatedAt: 0,
  } as unknown as ProjectSnapshot
  return {
    t: 'export',
    jobId: 'job-1',
    snapshot,
    file: new File(['abc'], 'media.mp4', { type: 'video/mp4' }),
    settings: { format: 'mp4-burn-in', width: 1280, height: 720, fps: 25 },
  }
}

describe('export worker port (FR-102.7 provider, unit-106)', () => {
  test('the worker is created lazily on the first post and reused', () => {
    withFakeWorker(() => {
      const port = createExportWorkerPort()
      expect(FakeWorker.created, 'no worker at port creation').toHaveLength(0)
      const request = requestFixture()
      port.postExport(request)
      port.postExport({ t: 'cancel', jobId: 'job-1' })
      expect(FakeWorker.created, 'one worker, reused').toHaveLength(1)
      const worker = FakeWorker.created[0] as FakeWorker
      expect(worker.posted[0], 'the request crosses verbatim (structured clone at the boundary; File rides)').toBe(request)
      expect((worker.posted[0] as { file: File }).file.name).toBe('media.mp4')
      expect(worker.posted[1]).toEqual({ t: 'cancel', jobId: 'job-1' })
    })
  })

  test('worker replies fan out to every listener', () => {
    withFakeWorker(() => {
      const port = createExportWorkerPort()
      const first: ExportEvent[] = []
      const second: ExportEvent[] = []
      port.onExportEvent((event) => first.push(event))
      port.onExportEvent((event) => second.push(event))
      port.postExport({ t: 'export', jobId: 'job-1', snapshot: {} as never, file: new File(['x'], 'a.mp4'), settings: { format: 'mp4-burn-in', width: 1, height: 1, fps: 1 } })
      const done: ExportEvent = { t: 'job:done', jobId: 'job-1' }
      ;(FakeWorker.created[0] as FakeWorker).emit(done)
      expect(first).toEqual([done])
      expect(second, 'fan-out, not ownership').toEqual([done])
    })
  })

  test('non-protocol messages never reach listeners', () => {
    withFakeWorker(() => {
      const port = createExportWorkerPort()
      const seen: ExportEvent[] = []
      port.onExportEvent((event) => seen.push(event))
      port.postExport({ t: 'cancel', jobId: 'job-1' })
      const worker = FakeWorker.created[0] as FakeWorker
      worker.emit(undefined)
      worker.emit(null)
      worker.emit('boot')
      worker.emit({})
      worker.emit({ t: 'job:done' })
      worker.emit({ jobId: 'job-1' })
      worker.emit({ t: 7, jobId: 'job-1' })
      expect(seen, 'shape filter keeps only protocol Events').toEqual([])
      worker.emit({ t: 'export:result', jobId: 'job-1', blob: new Blob(['x']) })
      expect(seen).toHaveLength(1)
    })
  })

  test('unsubscribing removes exactly that listener (idempotent)', () => {
    withFakeWorker(() => {
      const port = createExportWorkerPort()
      const first: ExportEvent[] = []
      const second: ExportEvent[] = []
      const off = port.onExportEvent((event) => first.push(event))
      port.onExportEvent((event) => second.push(event))
      port.postExport({ t: 'cancel', jobId: 'job-1' })
      off()
      off()
      ;(FakeWorker.created[0] as FakeWorker).emit({ t: 'job:done', jobId: 'job-1' })
      expect(first, 'the unsubscribed listener is gone').toEqual([])
      expect(second).toHaveLength(1)
    })
  })

  test('dispose terminates the worker and detaches every listener', () => {
    withFakeWorker(() => {
      const port = createExportWorkerPort()
      const seen: ExportEvent[] = []
      port.onExportEvent((event) => seen.push(event))
      port.postExport({ t: 'cancel', jobId: 'job-1' })
      const worker = FakeWorker.created[0] as FakeWorker
      port.dispose()
      expect(worker.terminated, 'the worker terminates').toBe(true)
      worker.emit({ t: 'job:done', jobId: 'job-1' })
      expect(seen, 'listeners are detached').toEqual([])
      expect(() => port.dispose(), 'dispose is idempotent and safe before any worker').not.toThrow()
    })
  })
})
