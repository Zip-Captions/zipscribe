// L3 contract suite for `decodeAudio` — shared by the in-process
// `worker-core` implementation (Node, `../audio/decode.test.ts`) and the real
// `src/workers/media.worker.ts` over a real Worker (Playwright,
// `e2e/media/worker-contract.spec.ts`). Same driver, different transport:
// fakes and the real implementation must obey the same `MediaEvent` stream
// (conventions § Test levels, L3).
//
// Reported through the Playwright `MessagePort` and the Node message pair, so
// everything here is MessagePort-shaped (`postMessage(message, transfer)`).
import { expect } from 'vitest'
import type { MediaEvent, PcmChunk } from '@engine/protocol@04'

export interface PortLike {
  postMessage(message: unknown, transfer?: unknown[]): void
  // Deliberately loose: real MessagePort handlers are typed
  // `(this: MessagePort, ev: MessageEvent)` — this seam must accept both the
  // DOM port and a fake, so the parameter is a structural `{ data: unknown }`
  // and the listener may take `any` (contravariance-safe for fakes).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onmessage: ((event: any) => void) | null
  start?(): void
  close?(): void
}

export interface PortMessage {
  data: unknown
}

/** Collects everything a port receives until `stop()` (detached arrays keep their bytes). */
export class PortRecorder {
  readonly chunks: PcmChunk[] = []
  readonly events: MediaEvent[] = []
  // Waiters stay registered until their predicate is met (or `stop()` forces
  // them) — a message that satisfies no predicate must not discard pending
  // waiters, or an earlier waiter that a LATER message would satisfy hangs
  // until the timeout.
  private readonly waiters: { check: () => void; finish: () => void }[] = []
  private stopped = false
  private readonly port: PortLike

  constructor(port: PortLike) {
    this.port = port
    port.onmessage = (message: PortMessage) => {
      const data = message.data as { t?: string; startSec?: number; samples?: Float32Array }
      if (data.t === undefined && typeof data.startSec === 'number' && data.samples instanceof Float32Array) {
        this.chunks.push({ startSec: data.startSec, samples: data.samples })
      } else if (typeof data.t === 'string') {
        this.events.push(data as MediaEvent)
      }
      for (const waiter of [...this.waiters]) waiter.check()
    }
    port.start?.()
  }

  stop(): void {
    this.stopped = true
    for (const waiter of this.waiters.splice(0)) waiter.finish()
    this.port.onmessage = null
  }

  get isStopped(): boolean {
    return this.stopped
  }

  waitFor(predicate: (recorder: PortRecorder) => boolean, timeoutMs = 30_000, label = 'port condition'): Promise<void> {
    if (predicate(this)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs)
      const waiter: { check: () => void; finish: () => void } = {
        check: (): void => {
          if (predicate(this)) {
            const index = this.waiters.indexOf(waiter)
            if (index >= 0) this.waiters.splice(index, 1)
            waiter.finish()
          }
        },
        finish: (): void => {
          clearTimeout(timer)
          resolve()
        },
      }
      this.waiters.push(waiter)
    })
  }

  eventTypes(): string[] {
    return this.events.map((event) => event.t)
  }

  find<T extends MediaEvent['t']>(type: T): Extract<MediaEvent, { t: T }> | undefined {
    return this.events.find((event) => event.t === type) as Extract<MediaEvent, { t: T }> | undefined
  }
}

export interface DecodeRun {
  events: PortRecorder[]
  chunks: PcmChunk[]
  /** Union of every port's chunks in arrival order (single-port runs). */
  firstPort: PortRecorder
}

/**
 * Waits for `job:done`, then asserts the universal `decode` contract:
 *  - `media:probed` first (one `MediaAsset`), then exactly one `decode:support`;
 *  - every chunk is `{ startSec, samples: Float32Array }` with 16 000 samples
 *    per 1 s (only the final chunk may be shorter) and contiguous startSec;
 *  - chunks cover the asset duration (±1 s) and `job:progress` reaches the end;
 *  - `job:done` last, no `job:error`.
 */
export async function assertDecodeContract(ports: PortRecorder[], duration: number, path: 'webcodecs' | 'ffmpeg'): Promise<void> {
  const primary = ports[0]!
  await primary.waitFor((recorder) => recorder.events.some((event) => event.t === 'job:done' || event.t === 'job:error'), 120_000, 'decode completion')
  const errorEvent = primary.find('job:error')
  expect(errorEvent, `decode failed: ${errorEvent ? JSON.stringify(errorEvent.error) : ''}`).toBeUndefined()
  const types = primary.eventTypes()
  expect(types[0], 'media:probed precedes everything').toBe('media:probed')
  expect(types.filter((type) => type === 'decode:support')).toHaveLength(1)
  expect(primary.find('decode:support')?.path).toBe(path)
  expect(primary.events.at(-1)?.t, 'job:done is the last event').toBe('job:done')

  const probed = primary.find('media:probed')!
  expect(probed.asset.duration).toBeGreaterThan(0)
  expect(Math.abs(probed.asset.duration - duration)).toBeLessThanOrEqual(1)

  for (const recorder of ports) {
    expect(recorder.chunks.length, 'chunks arrived').toBeGreaterThan(0)
    recorder.chunks.forEach((chunk, index) => {
      expect(chunk.samples).toBeInstanceOf(Float32Array)
      expect(typeof chunk.startSec).toBe('number')
      expect(chunk.startSec).toBeCloseTo(index, 6)
      const isLast = index === recorder.chunks.length - 1
      if (!isLast) expect(chunk.samples.length, `chunk ${index} is a full 1 s`).toBe(16000)
      else expect(chunk.samples.length).toBeGreaterThan(0)
      expect(chunk.samples.length).toBeLessThanOrEqual(16000)
    })
    const covered = recorder.chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0) / 16000
    expect(Math.abs(covered - duration), 'chunks cover the whole duration').toBeLessThanOrEqual(1.5)
  }

  const progress = primary.events.filter((event): event is Extract<MediaEvent, { t: 'job:progress' }> => event.t === 'job:progress')
  if (progress.length > 0) {
    const last = progress.at(-1)!
    expect(Math.abs(last.processedSec - last.totalSec), 'final progress reaches the end').toBeLessThanOrEqual(1)
  }
}

/** Concatenate 1 s chunks into one mono buffer (drop the final partial chunk to keep alignment). */
export function concatChunks(chunks: readonly PcmChunk[]): Float32Array {
  const full = chunks.filter((chunk) => chunk.samples.length === 16000)
  const out = new Float32Array(full.length * 16000)
  full.forEach((chunk, index) => out.set(chunk.samples, index * 16000))
  return out
}

/** Downmix interleaved stereo frames to mono (bit-for-bit H1: every port sees the same bytes). */
export function interleavedToMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels === 1) return interleaved
  const frames = Math.floor(interleaved.length / channels)
  const out = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) sum += interleaved[frame * channels + channel]!
    out[frame] = sum / channels
  }
  return out
}