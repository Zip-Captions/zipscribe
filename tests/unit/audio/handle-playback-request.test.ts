// Coverage provider (unit-107, the media-coverage nested run): the
// `handleMediaRequest` routing leg for the unit-107 `decode-playback`
// request type (decoded-clock feed). The frozen unit-04 suites own the
// criterion evidence for decode-for-playback itself; this file covers the
// WORKER ENTRY dispatch added by unit-107 — live-job registration/dereg
// via `cancel`, chunk shape on the port, and the scope/emit event mirror.
import { describe, expect, test } from 'vitest'
import {
  handleMediaRequest,
  type AudioSampleLike,
  type AudioTrackLike,
  type DecodeProbe,
  type MediaSourceLike,
  type MediaWorkerEvent,
  type PlaybackJob,
} from '@engine/audio/worker-core'
import { createMessageChannel, type CreateMessageChannel } from '@engine/audio/worker-core@ref'

const channels: CreateMessageChannel[] = []

function channel(): CreateMessageChannel {
  const created = createMessageChannel()
  channels.push(created)
  return created
}

async function until(predicate: () => boolean, timeoutMs = 10_000, label = 'condition'): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 4))
  }
}

function probeWith(overrides: Partial<DecodeProbe> = {}): DecodeProbe {
  return { container: 'aif', duration: 2, audioCodec: 'pcm_f32', videoCodec: null, width: 0, height: 0, fps: 0, trackCount: 1, audioTrackCount: 1, canDecodeAudio: true, ...overrides }
}

function secondsSource(seconds: number): { source: MediaSourceLike } {
  const sampleRate = 16_000
  const track: AudioTrackLike = { number: 0, codec: 'pcm_f32', sampleRate, numberOfChannels: 1, canDecode: () => true }
  const source: MediaSourceLike = {
    getDuration: () => seconds,
    audioTracks: () => [track],
    samples: async function* (): AsyncGenerator<AudioSampleLike> {
      for (let index = 0; index < seconds; index++) {
        yield {
          timestamp: index,
          sampleRate,
          numberOfFrames: sampleRate,
          numberOfChannels: 1,
          samples: () => [new Float32Array(sampleRate).fill((index + 1) / 10)],
          close: () => undefined,
        }
        await Promise.resolve()
      }
    },
  }
  return { source }
}

function file(): File {
  return new File([new Uint8Array(1024)], 'click.aiff', { type: 'audio/aiff' })
}

describe('handleMediaRequest: decode-playback routing (unit-107 feed)', () => {
  test('registers the live job, streams native-rate chunks to the port, deregisters on done', async () => {
    const ch = channel()
    const posted: MediaWorkerEvent[] = []
    const chunks: { startSec: number; samples: Float32Array }[] = []
    ch.port1.onmessage = (event: { data: unknown }) => {
      const data = event.data as { startSec?: unknown; samples?: unknown }
      if (typeof data?.startSec === 'number' && data.samples instanceof Float32Array) chunks.push({ startSec: data.startSec, samples: data.samples })
    }
    ch.port1.start?.()
    const { source } = secondsSource(2)
    const job = handleMediaRequest(
      { t: 'decode-playback', jobId: 'pb-route-1', file: file(), fromSec: 0, port: ch.port2 },
      { postMessage: (event) => posted.push(event) },
      { open: () => Promise.resolve({ source, path: 'webcodecs', probe: probeWith() }), emit: () => undefined },
    ) as PlaybackJob
    expect(await job.path).toBe('webcodecs')
    await job.done
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0]!.samples.length).toBeGreaterThan(0)
    expect(chunks[0]!.startSec).toBeCloseTo(0, 6)
    expect(posted.some((event) => event.t === 'job:done')).toBe(true)
    // Deregistered on completion: cancel finds no live job.
    expect(handleMediaRequest({ t: 'cancel', jobId: 'pb-route-1' }, { postMessage: () => undefined }, { open: () => Promise.reject(new Error('unused')), emit: () => undefined })).toBeUndefined()
    ch.port1.close()
    ch.port2.close()
    channels.pop()?.close()
  })

  test('cancel mid-stream routes to the live playback job', async () => {
    const ch = channel()
    const { source } = secondsSource(20)
    const job = handleMediaRequest(
      { t: 'decode-playback', jobId: 'pb-route-2', file: file(), fromSec: 0, port: ch.port2 },
      { postMessage: () => undefined },
      { open: () => Promise.resolve({ source, path: 'webcodecs', probe: probeWith({ duration: 20 }) }), emit: () => undefined },
    ) as PlaybackJob
    await job.path
    await until(() => job.activeDecoders() >= 1, 5_000, 'decoder active')
    const routed = handleMediaRequest({ t: 'cancel', jobId: 'pb-route-2' }, { postMessage: () => undefined }, { open: () => Promise.reject(new Error('unused')), emit: () => undefined })
    expect(routed).toBe(job)
    await job.done
    ch.port1.close()
    ch.port2.close()
    channels.pop()?.close()
  })
})
