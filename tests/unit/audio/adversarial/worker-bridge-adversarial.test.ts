// Adversary round unit-04 — runtime contract of `src/workers/media.worker.ts`.
//
// The bridge had NO executing coverage: `media-worker-wiring.test.ts` only
// regex-scans its source, and the `e2e/media/worker-contract.spec.ts` named by
// `decode-contract.ts` does not exist. A mutant that deletes the ffmpeg
// fallback seam (`openFfmpeg`) or the event plumbing from the thin adapter
// passed every gate. These tests execute the real module against a fake
// DedicatedWorkerScope, real `MessageChannel` ports and stubbed SDK seams —
// the seam the wiring regex claims to protect.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { MediaWorkerEvent } from '@engine/audio/decode'
import type { MediaSourceLike, DecodeProbe } from '@engine/audio/decode'

const ffmpegProbe: DecodeProbe = {
  container: 'asf',
  duration: 3,
  audioCodec: 'wmav2',
  videoCodec: null,
  width: 0,
  height: 0,
  fps: 0,
  trackCount: 1,
  audioTrackCount: 1,
  canDecodeAudio: true,
}

function fakeSource(seconds = 3): MediaSourceLike {
  const track = { number: 0, codec: 'f32', sampleRate: 16_000, numberOfChannels: 1, canDecode: () => true }
  return {
    getDuration: () => seconds,
    audioTracks: () => [track],
    async *samples() {
      for (let i = 0; i < seconds; i++) {
        yield {
          timestamp: i,
          sampleRate: 16_000,
          numberOfFrames: 16_000,
          numberOfChannels: 1,
          samples: () => [new Float32Array(16_000).fill(0.25)],
        }
      }
    },
  }
}

const openMediabunny = vi.hoisted(() => vi.fn())
const openFfmpeg = vi.hoisted(() => vi.fn())

vi.mock('@engine/audio/adapters/mediabunny', () => ({
  openMediabunny: (file: Blob, options: unknown) => openMediabunny(file, options),
}))
vi.mock('@engine/audio/adapters/ffmpeg', () => ({
  openFfmpeg: (blob: Blob, reason: unknown) => openFfmpeg(blob, reason),
}))

interface Harness {
  posted: MediaWorkerEvent[]
  post: (request: unknown) => void
}

let harness: Harness | null = null

async function bootWorker(): Promise<Harness> {
  vi.resetModules()
  openMediabunny.mockClear()
  openFfmpeg.mockClear()
  const posted: MediaWorkerEvent[] = []
  const g = globalThis as unknown as {
    onmessage: ((event: MessageEvent) => void) | null
    postMessage: (message: unknown, options?: StructuredSerializeOptions) => void
  }
  const previousMessage = g.postMessage
  g.postMessage = (message) => {
    posted.push(message as MediaWorkerEvent)
  }
  g.onmessage = null
  const workerModule = '../../../../src/workers/media.worker'
  await import(workerModule)
  const handler = g.onmessage
  if (!handler) throw new Error('media.worker did not register onmessage')
  const dispatch: (event: MessageEvent) => void = handler
  harness = {
    posted,
    post: (request) => dispatch({ data: request } as MessageEvent),
  }
  ;(harness as Harness & { restore: () => void }).restore = () => {
    g.postMessage = previousMessage
  }
  return harness
}

function consumePort(port: MessagePort): { chunks: { startSec: number; samples: Float32Array }[]; events: { t: string }[] } {
  const chunks: { startSec: number; samples: Float32Array }[] = []
  const events: { t: string }[] = []
  port.onmessage = (event: MessageEvent) => {
    const data = event.data as { t?: string; startSec?: number; samples?: Float32Array }
    if (typeof data?.t === 'string') events.push(data as { t: string })
    else if (typeof data?.startSec === 'number' && data.samples instanceof Float32Array) chunks.push({ startSec: data.startSec, samples: data.samples })
    port.postMessage({ t: 'ack' })
  }
  return { chunks, events }
}

async function until(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function wavFile(): File {
  return new File([new Uint8Array(4096)], 'sample.wav')
}

afterEach(() => {
  const h = harness as (Harness & { restore?: () => void }) | null
  h?.restore?.()
  harness = null
})

describe('adversary[adv-unit04]: media.worker runtime bridge (was zero-coverage)', () => {
  beforeEach(() => {
    openMediabunny.mockResolvedValue({ source: fakeSource(), path: 'webcodecs', probe: ffmpegProbe })
    openFfmpeg.mockResolvedValue({ source: fakeSource(), path: 'ffmpeg', probe: ffmpegProbe })
  })

  test('decode request through the worker wires mediabunny AND the lazy ffmpeg fallback seam', async () => {
    const h = await bootWorker()
    const channel = new MessageChannel()
    const consumer = consumePort(channel.port1)
    h.post({ t: 'decode', jobId: 'j-seam', file: wavFile(), ports: [channel.port2] })
    await until(() => openMediabunny.mock.calls.length > 0, 'openMediabunny called')
    const [, options] = openMediabunny.mock.calls[0] as [Blob, { openFfmpeg?: unknown; onFallback?: unknown }]
    expect(typeof options.openFfmpeg, 'worker passes the ffmpeg fallback seam to the mediabunny adapter (FR-04.5)').toBe('function')
    const fallback = await (options.openFfmpeg as (blob: Blob, reason: unknown) => Promise<{ path: string }>)(new Blob([new Uint8Array([1])]), { container: 'asf', codec: 'wmav2' })
    expect(fallback.path, 'the seam resolves through the ffmpeg adapter module').toBe('ffmpeg')
    expect(openFfmpeg).toHaveBeenCalledTimes(1)
    channel.port1.close()
    channel.port2.close()
  })

  test('decode events cross the boundary on the MAIN channel with the adapter-declared path', async () => {
    const h = await bootWorker()
    const channel = new MessageChannel()
    consumePort(channel.port1)
    h.post({ t: 'decode', jobId: 'j-main', file: wavFile(), ports: [channel.port2] })
    await until(() => h.posted.some((e) => e.t === 'job:done'), 'job:done on main channel')
    expect(h.posted).toContainEqual({ t: 'decode:support', jobId: 'j-main', path: 'webcodecs' })
    expect(h.posted.some((e) => e.t === 'peaks:chunk'), 'peaks:chunk tiles the main channel').toBe(true)
    channel.port1.close()
    channel.port2.close()
  })

  test('1 s mono f32 chunks reach a REAL MessagePort in ascending order via the tee', async () => {
    const h = await bootWorker()
    const first = new MessageChannel()
    const second = new MessageChannel()
    const a = consumePort(first.port1)
    const b = consumePort(second.port1)
    h.post({ t: 'decode', jobId: 'j-tee', file: wavFile(), ports: [first.port2, second.port2] })
    // Hermeticity (unit-01 adversary-harness-fix precedent): on the 2-core CI
    // runner the main-channel job:done can be observed while the last tee
    // chunk is still in flight on the ports — poll until both consumers have
    // their full delivery, then run the ORIGINAL assertions. A product that
    // loses chunks now fails via the until() timeout (RED), never via a
    // flaky half-delivered pass; assertions below are unchanged.
    await until(() => h.posted.some((e) => e.t === 'job:done') && a.chunks.length === 3 && b.chunks.length === 3, 'job:done + both tee consumers drained')
    for (const consumer of [a, b]) {
      expect(consumer.chunks.map((c) => c.startSec), 'identical chunks on every port (protocol tee)').toEqual([0, 1, 2])
      for (const chunk of consumer.chunks) {
        expect(chunk.samples).toBeInstanceOf(Float32Array)
        expect(chunk.samples.length, '1 s at 16 kHz').toBe(16_000)
        expect(chunk.samples[0], 'content survives the bridge').toBeCloseTo(0.25, 5)
      }
    }
    for (const ch of [first, second]) {
      ch.port1.close()
      ch.port2.close()
    }
  })

  test('a cancel request through the bridge terminates the job with CANCELLED', async () => {
    const h = await bootWorker()
    const channel = new MessageChannel()
    consumePort(channel.port1)
    h.post({ t: 'decode', jobId: 'j-cancel', file: wavFile(), ports: [channel.port2] })
    await until(() => openMediabunny.mock.calls.length > 0, 'open called')
    h.post({ t: 'cancel', jobId: 'j-cancel' })
    await until(() => h.posted.some((e) => e.t === 'job:error' && e.error.code === 'CANCELLED'), 'CANCELLED job:error', 10_000)
    channel.port1.close()
    channel.port2.close()
  })

  test('a probe request returns media:probed with a fingerprint through the bridge', async () => {
    const h = await bootWorker()
    h.post({ t: 'probe', jobId: 'j-probe', file: wavFile() })
    await until(() => h.posted.some((e) => e.t === 'media:probed'), 'media:probed')
    const probed = h.posted.find((e) => e.t === 'media:probed') as { asset: { container: string; fingerprint: { sampleHashes: string[] } } }
    expect(probed.asset.container).toBe('asf')
    expect(probed.asset.fingerprint.sampleHashes).toHaveLength(3)
    expect(probed.asset.fingerprint.sampleHashes[0]).toMatch(/^[0-9a-f]{64}$/)
  })

  test('documented mask: PortRecorder.stop() resolves unmet waiters (drivers must assert events, not rely on waitFor after stop)', async () => {
    const { PortRecorder } = await import('../decode-contract')
    const channel = new MessageChannel()
    const recorder = new PortRecorder(channel.port1)
    const never = recorder.waitFor((r) => r.events.some((e) => e.t === 'job:done'), 30, 'job:done that never arrives')
    recorder.stop()
    await expect(never, 'stop() resolves pending waiters even with zero matching messages — silent-pass vector').resolves.toBeUndefined()
    channel.port1.close()
    channel.port2.close()
  })
})
