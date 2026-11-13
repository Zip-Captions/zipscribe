// L1 contract for the production EnginePort (FR-2.0.6 transport layer). The
// port is worker-boundary glue — these suites pin the message plumbing the
// e2e/bridge paths rely on (lazy creation, per-channel fan-out, unsubscribe,
// inject dispatch, dispose). Same `globalThis.Worker` stub lineage as
// worker-registry.test.ts.
import { describe, expect, test } from 'vitest'
import { createWorkerEnginePort } from './engine-port'
import type { AsrEvent, MediaEvent, MediaRequest } from '../../engine/protocol'

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

const PROBE: MediaRequest = { t: 'probe', jobId: 'job-1', file: new File(['x'], 'a.mp4', { type: 'video/mp4' }) }

describe('worker engine port (FR-2.0.6)', () => {
  test('workers are created lazily, per channel, and reused', () => {
    withFakeWorker(() => {
      const port = createWorkerEnginePort()
      expect(FakeWorker.created, 'no worker at port creation').toHaveLength(0)
      port.postMedia(PROBE)
      port.postMedia(PROBE)
      port.postAsr({ t: 'unload' })
      port.postDiarize({ t: 'unload' })
      expect(FakeWorker.created, 'one worker per channel, reused on later posts').toHaveLength(3)
      expect((FakeWorker.created[0] as FakeWorker).posted).toEqual([PROBE, PROBE])
    })
  })

  test('worker replies fan out per channel only', () => {
    withFakeWorker(() => {
      const port = createWorkerEnginePort()
      const media: MediaEvent[] = []
      const asr: AsrEvent[] = []
      port.onMediaEvent((event) => {
        media.push(event)
      })
      port.onAsrEvent((event) => {
        asr.push(event)
      })
      port.postMedia(PROBE)
      port.postAsr({ t: 'unload' })
      const [mediaWorker, asrWorker] = FakeWorker.created as [FakeWorker, FakeWorker]
      const probed: MediaEvent = {
        t: 'media:probed',
        jobId: 'job-1',
        asset: {
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
          fingerprint: { name: 'a.mp4', size: 1, durationMs: 1000, sampleHashes: ['h1', 'h2', 'h3'] },
        },
      }
      mediaWorker.emit(probed)
      expect(media, 'media worker events reach media listeners').toEqual([probed])
      expect(asr, 'media worker events never reach asr listeners').toEqual([])
      const progress: AsrEvent = { t: 'job:progress', jobId: 'job-1', processedSec: 1, totalSec: 2 }
      asrWorker.emit(progress)
      expect(asr, 'asr worker events reach asr listeners').toEqual([progress])
      expect(media, 'asr worker events never reach media listeners').toHaveLength(1)
    })
  })

  test('unsubscribing removes exactly that listener', () => {
    withFakeWorker(() => {
      const port = createWorkerEnginePort()
      const first: MediaEvent[] = []
      const second: MediaEvent[] = []
      const off = port.onMediaEvent((event) => {
        first.push(event)
      })
      port.onMediaEvent((event) => {
        second.push(event)
      })
      off()
      off() // idempotent
      port.postMedia(PROBE)
      ;(FakeWorker.created[0] as FakeWorker).emit({ t: 'decode:support', jobId: 'job-1', path: 'webcodecs' })
      expect(first, 'the unsubscribed listener is gone').toEqual([])
      expect(second, 'the other listener still receives').toHaveLength(1)
    })
  })

  test('inject* members dispatch to the same listeners without any worker', () => {
    withFakeWorker(() => {
      const port = createWorkerEnginePort()
      const media: MediaEvent[] = []
      const asr: AsrEvent[] = []
      port.onMediaEvent((event) => {
        media.push(event)
      })
      port.onAsrEvent((event) => {
        asr.push(event)
      })
      const batch: AsrEvent = { t: 'job:segments', jobId: 'job-1', segments: [{ start: 0, end: 1, text: 'x', words: [] }] }
      port.injectAsrEvent(batch)
      port.injectMediaEvent({ t: 'decode:support', jobId: 'job-1', path: 'ffmpeg' })
      expect(asr).toEqual([batch])
      expect(media).toHaveLength(1)
      expect(FakeWorker.created, 'injection never spawns a worker').toHaveLength(0)
    })
  })

  test('dispose terminates every live worker and detaches listeners', () => {
    withFakeWorker(() => {
      const port = createWorkerEnginePort()
      const seen: MediaEvent[] = []
      port.onMediaEvent((event) => {
        seen.push(event)
      })
      port.postMedia(PROBE)
      const mediaWorker = FakeWorker.created[0] as FakeWorker
      port.dispose()
      expect(mediaWorker.terminated, 'workers terminate').toBe(true)
      mediaWorker.emit({ t: 'decode:support', jobId: 'job-1', path: 'webcodecs' })
      expect(seen, 'listeners are detached').toEqual([])
    })
  })
})

const PROBE_ASSET = {
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

describe('probeFingerprint (FR-106.8 correlation, unit-106 slice D)', () => {
  test('resolves the matching media:probed fingerprint on a DEDICATED worker — the media listeners never see it', async () => {
    await withFakeWorkerAsync(async () => {
      const port = createWorkerEnginePort()
      const media: MediaEvent[] = []
      port.onMediaEvent((event) => {
        media.push(event)
      })
      const pending = port.probeFingerprint(new File(['x'], 'a.mp4', { type: 'video/mp4' }))
      const probeWorker = FakeWorker.created[0] as FakeWorker
      expect(FakeWorker.created, 'the probe uses its own instance, not the shared media channel worker').toHaveLength(1)
      const firstPosted = probeWorker.posted[0] as { t: string; jobId: string; file: File }
      expect(firstPosted.t, 'a probe request rides the protocol union').toBe('probe')
      expect(firstPosted.file.name, 'the File crosses to the worker').toBe('a.mp4')
      const jobId = firstPosted.jobId
      probeWorker.emit({ t: 'media:probed', jobId: 'other-job', asset: PROBE_ASSET })
      probeWorker.emit({ t: 'job:progress', jobId, processedSec: 0, totalSec: 1 })
      probeWorker.emit({ t: 'media:probed', jobId, asset: PROBE_ASSET })
      await expect(pending).resolves.toEqual(PROBE_ASSET.fingerprint)
      expect(media, 'probe replies never fan out to the media listeners (intake createProject stays probe-free)').toEqual([])
      const second = port.probeFingerprint(new File(['y'], 'b.mp4'))
      expect(FakeWorker.created, 'the probe instance is reused').toHaveLength(1)
      const secondJobId = (probeWorker.posted[1] as { jobId: string }).jobId
      probeWorker.emit({ t: 'media:probed', jobId: secondJobId, asset: PROBE_ASSET })
      await expect(second).resolves.toEqual(PROBE_ASSET.fingerprint)
    })
  })

  test('a matching job:error rejects with the CODE only (SECURITY-03)', async () => {
    await withFakeWorkerAsync(async () => {
      const port = createWorkerEnginePort()
      const pending = port.probeFingerprint(new File(['x'], 'a.mp4'))
      const probeWorker = FakeWorker.created[0] as FakeWorker
      const jobId = (probeWorker.posted[0] as { jobId: string }).jobId
      probeWorker.emit({ t: 'job:error', jobId, error: { code: 'UNSUPPORTED_MEDIA', retryable: false, detail: 'user content never crosses' } })
      await expect(pending).rejects.toThrow('UNSUPPORTED_MEDIA')
      await expect(pending).rejects.not.toThrow(/user content/u)
    })
  })

  test('dispose terminates the probe instance too', async () => {
    await withFakeWorkerAsync(() => {
      const port = createWorkerEnginePort()
      void port.probeFingerprint(new File(['x'], 'a.mp4'))
      const probeWorker = FakeWorker.created[0] as FakeWorker
      port.dispose()
      expect(probeWorker.terminated).toBe(true)
    })
  })
})

async function withFakeWorkerAsync(run: () => void | Promise<void>): Promise<void> {
  FakeWorker.created.length = 0
  const previous = globalThis.Worker
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    await run()
  } finally {
    if (previous === undefined) delete (globalThis as { Worker?: typeof Worker }).Worker
    else globalThis.Worker = previous
  }
}
