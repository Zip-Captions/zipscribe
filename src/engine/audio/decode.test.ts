// L1 source-adjacent coverage for the decode pipeline branches the frozen
// `tests/unit/audio/decode.test.ts` cannot exercise in-process (worker-entry
// probe/cancel routing, capability notices, error mapping, playback channel
// clamp and seek alignment, the reference channel's backpressure probes).
// Supports the per-file coverage gate on `src/engine/**` (unit-03/4A/4B
// precedent for source-adjacent suites). No CC- tracing here — the frozen
// suites own the criterion evidence.
import { describe, expect, test } from 'vitest'
import {
  decodeAudio,
  decodeForPlayback,
  handleMediaRequest,
  teePcm,
  transferSource,
  type AudioSampleLike,
  type AudioTrackLike,
  type DecodeDeps,
  type DecodeJob,
  type DecodeProbe,
  type MediaSourceLike,
  type MediaWorkerEvent,
} from './decode'
import { createMessageChannel, type CreateMessageChannel } from './worker-core@ref'

const channels: CreateMessageChannel[] = []

function channel(): CreateMessageChannel {
  const created = createMessageChannel()
  channels.push(created)
  return created
}

async function until(predicate: () => boolean, timeoutMs = 5_000, label = 'condition'): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 4))
  }
}

function probeWith(overrides: Partial<DecodeProbe> = {}): DecodeProbe {
  return { container: 'mp4', duration: 2, audioCodec: 'aac', videoCodec: null, width: 0, height: 0, fps: 0, trackCount: 1, audioTrackCount: 1, canDecodeAudio: true, ...overrides }
}

function source(durationSec = 2, sampleRate = 16000, sourceChannels = 1, step = 0.05): MediaSourceLike {
  const track: AudioTrackLike = { number: 0, codec: 'aac', sampleRate, numberOfChannels: sourceChannels, canDecode: () => true }
  return {
    getDuration: () => durationSec,
    audioTracks: () => [track],
    samples: async function* (): AsyncGenerator<AudioSampleLike> {
      const frames = Math.round(sampleRate * step)
      for (let timestamp = 0; timestamp < durationSec - 1e-9; timestamp += step) {
        await Promise.resolve()
        yield {
          timestamp,
          sampleRate,
          numberOfFrames: frames,
          numberOfChannels: sourceChannels,
          samples: () => Array.from({ length: sourceChannels }, (_, channel) => new Float32Array(frames).fill(channel === 0 ? 0.25 : -0.25)),
        }
      }
    },
  }
}

function file(name = 'clip.mp4'): File {
  return new File([new Uint8Array(4096)], name, { type: 'video/mp4' })
}

function collector(port: MessagePort): { chunks: { startSec: number; samples: Float32Array }[]; events: MediaWorkerEvent[] } {
  const store = { chunks: [] as { startSec: number; samples: Float32Array }[], events: [] as MediaWorkerEvent[] }
  port.onmessage = (event: { data: unknown }) => {
    const data = event.data as { t?: string; startSec?: number; samples?: Float32Array }
    if (data.t === undefined && typeof data.startSec === 'number' && data.samples instanceof Float32Array) store.chunks.push({ startSec: data.startSec, samples: data.samples })
    else if (typeof data.t === 'string') store.events.push(data as MediaWorkerEvent)
  }
  port.start?.()
  return store
}

describe('decode: capability notices and error mapping (FR-04.5, SECURITY-03)', () => {
  test('an ffmpeg-path open emits one FFMPEG_FALLBACK notice with the container/codec', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const job = decodeAudio(
      { jobId: 'ff-1', file: file(), ports: [ch.port2] },
      {
        open: (_file, options) => {
          options?.onFallback?.({ container: 'aiff', codec: 'pcm_s16be' })
          return Promise.resolve({ source: source(1), path: 'ffmpeg', probe: probeWith({ container: 'aiff', audioCodec: 'pcm_s16be' }) })
        },
        emit: (event) => events.push(event),
      },
    )
    await job.done
    const notices = events.filter((event) => event.t === 'notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]!.t === 'notice' && notices[0]!.notice.code).toBe('FFMPEG_FALLBACK')
    expect(events.map((event) => event.t).at(-1)).toBe('job:done')
  })

  test('a multi-track probe adds a MULTI_TRACK notice (FR-04.10 multi-audio)', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const job = decodeAudio(
      { jobId: 'mt-1', file: file(), ports: [ch.port2] },
      { open: () => Promise.resolve({ source: source(1), path: 'webcodecs', probe: probeWith({ audioTrackCount: 2, trackCount: 2 }) }), emit: (event) => events.push(event) },
    )
    await job.done
    expect(events.some((event) => event.t === 'notice' && event.notice.code === 'MULTI_TRACK')).toBe(true)
  })

  test('FFMPEG_CORE_UNAVAILABLE from the adapter maps to FFMPEG_REQUIRED, never message text', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const job = decodeAudio(
      { jobId: 'ff-err', file: file(), ports: [ch.port2] },
      {
        open: () => {
          throw Object.assign(new Error('core missing: /wasm/ffmpeg/ffmpeg-core.wasm'), { code: 'FFMPEG_CORE_UNAVAILABLE' })
        },
        emit: (event) => events.push(event),
      },
    )
    await job.done
    const error = events.find((event) => event.t === 'job:error')
    expect(error && error.t === 'job:error' ? error.error.code : null).toBe('FFMPEG_REQUIRED')
    expect(error && error.t === 'job:error' ? JSON.stringify(error.error) : '').not.toContain('wasm/ffmpeg')
  })
})

describe('decode: cancel leaves zero live decoders (CC-04.11 in-process proof)', () => {
  test('cancel mid-file closes the iterator, emits job:error CANCELLED and no job:done', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const job = decodeAudio(
      { jobId: 'cancel-1', file: file(), ports: [ch.port2] },
      { open: () => Promise.resolve({ source: source(10), path: 'webcodecs', probe: probeWith({ duration: 10 }) }), emit: (event) => events.push(event) },
    )
    await until(() => job.tee.count >= 4, 10_000, 'chunks flowing')
    job.cancel()
    await job.done
    expect(job.activeDecoders()).toBe(0)
    expect(events.some((event) => event.t === 'job:done')).toBe(false)
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'CANCELLED')).toBe(true)
  })

  test('a stalled consumer reports job.stalled with exactly the lagging port and pauses at the bound (FR-04.1)', async () => {
    const live = channel()
    const stalled = channel()
    const events: MediaWorkerEvent[] = []
    const liveStore = collector(live.port1)
    const job = decodeAudio(
      { jobId: 'stall-1', file: file(), ports: [live.port2, stalled.port2] },
      { open: () => Promise.resolve({ source: source(60, 16000, 1, 0.02), path: 'webcodecs', probe: probeWith({ duration: 60 }) }), emit: (event) => events.push(event) },
    )
    expect(job.queueLimit).toBe(30)
    await until(() => liveStore.chunks.length >= 30, 60_000, 'the live port runs to the bound')
    const stalledAt = await Promise.race([job.stalled, new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000))])
    expect(stalledAt).not.toBeNull()
    expect(stalledAt!.pendingPorts).toBe(1)
    expect(stalledAt!.chunks).toBeLessThanOrEqual(31)
    expect(liveStore.chunks.length).toBeLessThanOrEqual(31)
    job.cancel()
    await job.done
    expect(job.activeDecoders()).toBe(0)
  })

  test('a consumer transport without any flow signal releases the gate instead of stalling (browser parity)', async () => {
    const ch = channel()
    // No handler on port1 at all: nothing can ever confirm (the real
    // MessagePort fast path) — the decode must still finish.
    const job = decodeAudio(
      { jobId: 'uncoop', file: file(), ports: [ch.port2] },
      { open: () => Promise.resolve({ source: source(62, 16000, 1, 0.02), path: 'webcodecs', probe: probeWith({ duration: 62 }) }), emit: () => undefined },
    )
    await job.done
    expect(job.tee.count).toBeGreaterThanOrEqual(61)
  })
})

describe('handleMediaRequest: worker-entry routing (the media.worker seam)', () => {
  test('a probe request emits media:probed on both the scope and deps.emit', async () => {
    const posted: MediaWorkerEvent[] = []
    const emitted: MediaWorkerEvent[] = []
    const result = handleMediaRequest(
      { t: 'probe', jobId: 'probe-1', file: file('speech.mp4') },
      { postMessage: (event) => posted.push(event) },
      { open: () => Promise.resolve({ source: source(2), path: 'webcodecs', probe: probeWith() }), emit: (event) => emitted.push(event) },
    )
    expect(result).toBeUndefined()
    await until(() => emitted.length > 0, 5_000, 'probe result')
    expect(emitted[0]!.t).toBe('media:probed')
    expect(posted[0]!.t).toBe('media:probed')
    expect(posted.map((event) => event.t)).toEqual(emitted.map((event) => event.t))
    expect(emitted[0]!.t === 'media:probed' && emitted[0]!.asset.kind).toBe('audio')
  })

  test('a probe failure surfaces as job:error with the mapped code', async () => {
    const posted: MediaWorkerEvent[] = []
    handleMediaRequest(
      { t: 'probe', jobId: 'probe-err', file: file('junk.mp3') },
      { postMessage: (event) => posted.push(event) },
      {
        open: () => {
          throw Object.assign(new Error('no audio track'), { code: 'UNSUPPORTED_MEDIA' })
        },
        emit: () => undefined,
      },
    )
    await until(() => posted.length > 0, 5_000, 'error event')
    expect(posted[0]!.t === 'job:error' && posted[0]!.error.code).toBe('UNSUPPORTED_MEDIA')
  })

  test('decode routes through worker-core and cancel finds the live job by id (worker has no logic)', async () => {
    const ch = channel()
    const posted: MediaWorkerEvent[] = []
    const deps: DecodeDeps = { open: () => Promise.resolve({ source: source(10), path: 'webcodecs', probe: probeWith({ duration: 10 }) }), emit: () => undefined }
    const job = handleMediaRequest({ t: 'decode', jobId: 'req-1', file: file(), ports: [ch.port2] }, { postMessage: (event) => posted.push(event) }, deps) as DecodeJob | undefined
    expect(job).toBeDefined()
    expect(job!.jobId).toBe('req-1')
    await until(() => job!.tee.count >= 3, 5_000, 'chunks')
    const cancelled = handleMediaRequest({ t: 'cancel', jobId: 'req-1' }, { postMessage: () => undefined }, deps)
    expect(cancelled).toBe(job)
    await job!.done
    expect(job!.activeDecoders()).toBe(0)
    expect(posted.some((event) => event.t === 'job:error' && event.error.code === 'CANCELLED')).toBe(true)
    // the unknown job is a no-op, not a throw
    expect(handleMediaRequest({ t: 'cancel', jobId: 'ghost' }, { postMessage: () => undefined }, deps)).toBeUndefined()
  })
})

describe('decodeForPlayback: native-rate geometry (FR-04.6)', () => {
  function stereoSource(durationSec: number, sourceChannels: number, paceMs = 0) {
    const sampleRate = 44100
    const track: AudioTrackLike = { number: 0, codec: 'aac', sampleRate, numberOfChannels: sourceChannels, canDecode: () => true }
    return {
      sampleRate,
      source: {
        getDuration: () => durationSec,
        audioTracks: () => [track],
        samples: async function* (): AsyncGenerator<AudioSampleLike> {
          const step = Math.round(sampleRate * 0.05)
          for (let offset = 0; offset < Math.round(sampleRate * durationSec); offset += step) {
            if (paceMs) await new Promise((resolve) => setTimeout(resolve, paceMs))
            yield {
              timestamp: offset / sampleRate,
              sampleRate,
              numberOfFrames: step,
              numberOfChannels: sourceChannels,
              samples: () =>
                Array.from({ length: sourceChannels }, (_, channel) => {
                  const plane = new Float32Array(step)
                  for (let frame = 0; frame < step; frame++) plane[frame] = (offset + frame) / sampleRate + channel * 0.5
                  return plane
                }),
            }
          }
        },
      } satisfies MediaSourceLike,
      probe: probeWith({ duration: durationSec, videoCodec: 'h264', width: 320, height: 180, fps: 24, trackCount: 2 }),
    }
  }

  test('stereo keeps interleaved two-channel geometry from 0 s', async () => {
    const { source, probe, sampleRate } = stereoSource(2, 2)
    const ch = channel()
    const store = collector(ch.port1)
    const job = decodeForPlayback({ jobId: 'pb-st', file: file(), fromSec: 0, port: ch.port2 }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe }), emit: () => undefined })
    await job.done
    expect(job.sampleRate).toBe(sampleRate)
    expect(job.channels).toBe(2)
    const total = store.chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0)
    expect(total).toBe(2 * sampleRate * 2)
    expect(store.chunks[0]!.startSec).toBe(0)
  })

  test('5.1-style sources clamp to two interleaved channels and the seek slice matches the head stream', async () => {
    const { source, probe, sampleRate } = stereoSource(3, 4)
    const headCh = channel()
    const seekCh = channel()
    const head = collector(headCh.port1)
    const seeked = collector(seekCh.port1)
    const headJob = decodeForPlayback({ jobId: 'pb-head', file: file(), fromSec: 0, port: headCh.port2 }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe }), emit: () => undefined })
    await headJob.done
    expect(headJob.channels).toBe(2)
    const seekJob = decodeForPlayback({ jobId: 'pb-seek', file: file(), fromSec: 1, port: seekCh.port2 }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe }), emit: () => undefined })
    await seekJob.done
    expect(seeked.chunks[0]!.startSec).toBeCloseTo(1, 6)
    expect(seeked.chunks[0]!.samples[0]).toBeCloseTo(1, 3)
    const flat = (chunks: { samples: Float32Array }[]): Float32Array => {
      const out = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0))
      let at = 0
      for (const chunk of chunks) {
        out.set(chunk.samples, at)
        at += chunk.samples.length
      }
      return out
    }
    const reference = flat(head.chunks).subarray(Math.round(1 * sampleRate) * 2)
    const actual = flat(seeked.chunks)
    expect(actual.length).toBe(reference.length)
    for (let index = 0; index < actual.length; index += 401) expect(actual[index]).toBeCloseTo(reference[index]!, 5)
  })

  test('cancel mid-playback ends the job with zero live decoders', async () => {
    const { source, probe } = stereoSource(30, 1, 2)
    const ch = channel()
    const job = decodeForPlayback({ jobId: 'pb-cancel', file: file(), fromSec: 0, port: ch.port2 }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe }), emit: () => undefined })
    await until(() => job.activeDecoders() === 1, 5_000, 'decoder live')
    job.cancel()
    await job.done
    expect(job.activeDecoders()).toBe(0)
  })
})

describe('reference channel plumbing (worker-core@ref)', () => {
  test('teePcm keeps the source intact and queues both ports (buffered probe)', async () => {
    const first = channel()
    const second = channel()
    const samples = new Float32Array(16000).fill(0.5)
    teePcm({ startSec: 7, samples }, [first.port2, second.port2])
    expect(samples.length).toBe(16000)
    expect(samples[0]).toBe(0.5)
    expect(first.buffered(first.port1)).toBe(1)
    expect(second.buffered(second.port1)).toBe(1)
    const firstStore = collector(first.port1)
    await until(() => firstStore.chunks.length === 1, 2_000, 'arrival')
    expect(firstStore.chunks[0]!.startSec).toBe(7)
    expect(first.received[0]!.t).toBe('chunk')
  })

  test('close() drops undelivered queues and received records classify events', () => {
    const ch = channel()
    ch.port2.postMessage({ t: 'job:done', jobId: 'rec-1' })
    expect(ch.received.some((message) => message.t === 'done' && message.jobId === 'rec-1')).toBe(true)
    ch.port2.postMessage({ startSec: 0, samples: new Float32Array(4) })
    ch.close()
    expect(ch.buffered(ch.port1)).toBe(0)
    const transferred = transferSource(new ArrayBuffer(8))
    expect(transferred.kind).toBe('transfer')
    expect(transferred.kind === 'transfer' && transferred.buffer.byteLength).toBe(8)
  })
})
