// ADVERSARY (unit-106): probeFingerprint correlation on `src/state/services/
// engine-port.ts` (FR-106.8) — the unit-04 worker stays the ONLY fingerprint
// computer. Pins: (a) the probe rides a DEDICATED media instance whose replies
// never fan out to the intake's media listeners, (b) the correlation handler is
// REMOVED on settle — repeated probes leak no listeners, (c) a null File is
// still protocol-shipped without a main-thread crash (the worker decides), and
// (d) a matching `job:error` rejects with the CODE only — the EngineError
// `detail` (canary) never crosses the boundary.
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'
import type { MediaEvent, MediaRequest } from '../../../src/engine/protocol'
import type { MediaFingerprint } from '@state/services/persistence'

// Non-literal specifier (editor-bridge-gate precedent): the tests tsconfig
// (no vite/client) cannot type-resolve worker-registry's `?worker` imports;
// vitest's alias resolves the module at runtime. The local structural shape
// is the test-side usage surface only — the port's own types live in the
// module (no contract-type restatement).
const ENGINE_PORT_MODULE = ['@state', 'services', 'engine-port'].join('/')

interface ProbePort {
  probeFingerprint(file: File): Promise<MediaFingerprint>
  postMedia(request: MediaRequest): void
  onMediaEvent(listener: (event: MediaEvent) => void): () => void
  dispose(): void
}

async function createPort(): Promise<ProbePort> {
  const mod = (await import(/* @vite-ignore */ ENGINE_PORT_MODULE)) as { createWorkerEnginePort(): ProbePort }
  return mod.createWorkerEnginePort()
}

class FakeWorker {
  static readonly created: FakeWorker[] = []
  readonly posted: unknown[] = []
  readonly handlerCount = (): number => this.handlers.length
  terminated = false
  private readonly handlers: ((event: { data: unknown }) => void)[] = []

  constructor() {
    FakeWorker.created.push(this)
  }

  addEventListener(_type: string, handler: (event: { data: unknown }) => void): void {
    this.handlers.push(handler)
  }

  removeEventListener(_type: string, handler: (event: { data: unknown }) => void): void {
    const index = this.handlers.indexOf(handler)
    if (index >= 0) this.handlers.splice(index, 1)
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

let restoreWorker: () => void = () => undefined
beforeEach(() => {
  FakeWorker.created.length = 0
  const previous = globalThis.Worker
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  restoreWorker = () => {
    if (previous === undefined) delete (globalThis as { Worker?: typeof Worker }).Worker
    else globalThis.Worker = previous
  }
})
afterEach(() => {
  restoreWorker()
})

const ASSET = {
  id: 'A',
  name: 'a.mp4',
  kind: 'audio',
  container: 'mp4',
  audioCodec: 'aac',
  videoCodec: null,
  duration: 1,
  width: 0,
  height: 0,
  fps: 0,
  fingerprint: { name: 'a.mp4', size: 10, durationMs: 1000, sampleHashes: ['h1', 'h2', 'h3'] },
} as const

let redaction: ReturnType<typeof createRedactionSpy>
beforeEach(() => {
  redaction = createRedactionSpy()
})
afterEach(() => {
  const verdict = redaction.settle()
  redaction.restore()
  expect(verdict.leaks, 'no canary content reached any console/error channel').toEqual([])
})

describe('AUDIT-106 probe correlation (FR-106.8): dedicated instance, no listener leak, code-only errors', () => {
  test('AUDIT-106.35: probes never ride the shared media worker, settle-detach their handler (no per-probe listener leak), dispose terminates the instance', async () => {
    const port = await createPort()
    const media: MediaEvent[] = []
    port.onMediaEvent((event) => {
      media.push(event)
    })
    port.postMedia({ t: 'probe', jobId: 'shared-1', file: new File(['x'], 'a.mp4', { type: 'video/mp4' }) })
    const shared = FakeWorker.created[0] as FakeWorker

    const first = port.probeFingerprint(new File(['x'], 'a.mp4', { type: 'video/mp4' }))
    const probeWorker = FakeWorker.created[1] as FakeWorker
    expect(probeWorker, 'a DEDICATED second media instance').not.toBe(shared)
    const jobId = (probeWorker.posted[0] as { jobId: string }).jobId
    probeWorker.emit({ t: 'media:probed', jobId: 'other', asset: ASSET })
    probeWorker.emit({ t: 'media:probed', jobId, asset: ASSET })
    await expect(first).resolves.toEqual(ASSET.fingerprint)
    probeWorker.emit({ t: 'media:probed', jobId, asset: ASSET }) // post-settle emission
    expect(probeWorker.handlerCount(), 'the correlation handler detached on settle — no leak per probe').toBe(0)

    const second = port.probeFingerprint(new File(['y'], 'b.mp4'))
    expect(FakeWorker.created, 'the dedicated instance is reused (one extra worker, total)').toHaveLength(2)
    const secondJobId = (probeWorker.posted[1] as { jobId: string }).jobId
    probeWorker.emit({ t: 'media:probed', jobId: secondJobId, asset: ASSET })
    await expect(second).resolves.toEqual(ASSET.fingerprint)
    expect(probeWorker.handlerCount(), 'the SECOND probe also self-detaches — listener count never grows').toBe(0)
    expect(media, 'probe replies NEVER reach the intake media listeners (no phantom createProject)').toEqual([])

    port.dispose()
    expect(shared.terminated).toBe(true)
    expect(probeWorker.terminated, 'dispose terminates the dedicated probe instance too').toBe(true)
  })

  test('AUDIT-106.36: a null File is protocol-shipped (main thread stays inert); a matching job:error rejects with the CODE only', async () => {
    const port = await createPort()
    const pending = port.probeFingerprint(null as unknown as File)
    const probeWorker = FakeWorker.created[0] as FakeWorker
    const request = probeWorker.posted[0] as { t: string; jobId: string; file: unknown }
    expect(request.t, 'the null file still crosses as a protocol probe request').toBe('probe')
    expect(request.file, 'nothing is computed or dereferenced on the main thread').toBeNull()
    probeWorker.emit({ t: 'job:error', jobId: request.jobId, error: { code: 'DECODE_FAILED', retryable: false, detail: `ffmpeg choked on ${CANARY_MARKER}` } })
    const message = await pending.then(
      () => 'NO REJECT',
      (thrown: unknown) => (thrown as Error).message,
    )
    expect(message, 'the rejection message is the EngineError CODE only').toBe('DECODE_FAILED')
    expect(message).not.toContain(CANARY_MARKER)
    expect(probeWorker.handlerCount(), 'the rejection path detaches its handler as well').toBe(0)
  })
})
