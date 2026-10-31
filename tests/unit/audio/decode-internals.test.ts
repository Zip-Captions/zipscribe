// Coverage provider suite (the `model-coverage`/`media-coverage` nested run
// only collects providers from this directory — unit-03 precedent, see
// `tests/unit/model/*-internals.test.ts`): engine internals of `decode` that
// the frozen suites here do not reach. Error-mapping legs, asset geometry,
// feed interleaving, priming placement, chunk-assembly splits, both gate
// release modes (uncooperative grace, cooperative stall), iterator failure
// paths, the full `handleMediaRequest` routing union and the native-rate
// playback legs. No CC-tracing — the frozen suites own the criterion
// evidence; every assertion below proves real engine behaviour (byte
// boundaries, drop-vs-clip priming, delivered chunk totals after release).
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  decodeAudio,
  decodeForPlayback,
  handleMediaRequest,
  type AudioSampleLike,
  type AudioTrackLike,
  type DecodeJob,
  type DecodeProbe,
  type MediaSourceLike,
  type MediaWorkerEvent,
} from '@engine/audio/worker-core'
import type { MediaRequest } from '@engine/protocol@04'
import { createMessageChannel, type CreateMessageChannel } from '@engine/audio/worker-core@ref'

const channels: CreateMessageChannel[] = []

function channel(): CreateMessageChannel {
  const created = createMessageChannel()
  channels.push(created)
  return created
}

afterEach(() => {
  while (channels.length > 0) channels.pop()!.close()
})

async function until(predicate: () => boolean, timeoutMs = 10_000, label = 'condition'): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 4))
  }
}

function probeWith(overrides: Partial<DecodeProbe> = {}): DecodeProbe {
  return { container: 'mp4', duration: 1, audioCodec: 'aac', videoCodec: null, width: 0, height: 0, fps: 0, trackCount: 1, audioTrackCount: 1, canDecodeAudio: true, ...overrides }
}

interface SampleSpec {
  timestamp: number
  frames: number
  fill?: number[]
  planes?: Float32Array[]
}

interface SourceSpec {
  sampleRate?: number
  channels?: number
  samples: SampleSpec[]
  throwAt?: number
  at?: (index: number) => void
  /** Real delay before each yield (lets consumers fall behind deterministically). */
  paceMs?: number
}

function scripted(spec: SourceSpec): { source: MediaSourceLike; track: AudioTrackLike; closed: boolean[] } {
  const sampleRate = spec.sampleRate ?? 16000
  const channels = spec.channels ?? 1
  const track: AudioTrackLike = { number: 0, codec: 'aac', sampleRate, numberOfChannels: channels, canDecode: () => true }
  const closed: boolean[] = spec.samples.map(() => false)
  const source: MediaSourceLike = {
    getDuration: () => (spec.samples.at(-1)?.timestamp ?? 0) + (spec.samples.at(-1)?.frames ?? 0) / sampleRate,
    audioTracks: () => [track],
    samples: async function* (): AsyncGenerator<AudioSampleLike> {
      for (let index = 0; index < spec.samples.length; index++) {
        if (spec.paceMs) await new Promise((resolve) => setTimeout(resolve, spec.paceMs))
        spec.at?.(index)
        if (spec.throwAt === index) throw new Error('scripted iterator failure')
        const sample = spec.samples[index]!
        yield {
          timestamp: sample.timestamp,
          sampleRate,
          numberOfFrames: sample.frames,
          numberOfChannels: channels,
          samples: () =>
            sample.planes ??
            Array.from({ length: channels }, (unused, channel) => new Float32Array(sample.frames).fill(sample.fill?.[channel] ?? (index + 1) / 10)),
          close: () => {
            closed[index] = true
          },
        }
        await Promise.resolve()
      }
    },
  }
  return { source, track, closed }
}

function file(name = 'speech-2min.mp4'): File {
  return new File([new Uint8Array(2048)], name, { type: 'video/mp4' })
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

function decodeWith(source: MediaSourceLike, probe: DecodeProbe, events: MediaWorkerEvent[], ports: MessagePort[]): DecodeJob {
  return decodeAudio({ jobId: 'int-1', file: file(), ports }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe }), emit: (event) => events.push(event) })
}

function secondsSource(seconds: number, fill = 0.2): SourceSpec {
  return { samples: Array.from({ length: Math.round(seconds * 20) }, (unused, index) => ({ timestamp: index * 0.05, frames: 800, fill: [fill] })) }
}

describe('decode: error mapping from the open seam (SECURITY-03)', () => {
  async function openFails(error: unknown): Promise<MediaWorkerEvent[]> {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const job = decodeAudio({ jobId: 'err', file: file(), ports: [ch.port2] }, { open: () => Promise.reject(error), emit: (event) => events.push(event) })
    await job.done
    return events
  }

  test('FFMPEG_CORE_UNAVAILABLE maps to retryable FFMPEG_REQUIRED without message text', async () => {
    const events = await openFails(Object.assign(new Error('cannot fetch /wasm/ffmpeg-core.wasm'), { code: 'FFMPEG_CORE_UNAVAILABLE' }))
    const error = events.at(-1)
    expect(error && error.t === 'job:error' ? error.error.code : null).toBe('FFMPEG_REQUIRED')
    expect(error && error.t === 'job:error' && error.error.retryable).toBe(true)
    expect(JSON.stringify(error)).not.toContain('ffmpeg-core')
  })

  test('a taxonomy code from the adapter passes through with its retry policy', async () => {
    const events = await openFails(Object.assign(new Error('stall'), { code: 'DECODE_STALL' }))
    const error = events.at(-1)
    expect(error && error.t === 'job:error' ? error.error : null).toEqual({ code: 'DECODE_STALL', retryable: true })
  })

  test('the demuxer name UnsupportedInputFormatError is UNSUPPORTED_MEDIA, not an internal fault', async () => {
    const events = await openFails(Object.assign(new Error('demux refused'), { name: 'UnsupportedInputFormatError' }))
    const error = events.at(-1)
    expect(error && error.t === 'job:error' ? error.error : null).toEqual({ code: 'UNSUPPORTED_MEDIA', retryable: false })
  })

  test('the demuxer message text shape-matches when the error carries no code', async () => {
    const events = await openFails(new Error('Unsupported or unrecognizable format'))
    const error = events.at(-1)
    expect(error && error.t === 'job:error' ? error.error.code : null).toBe('UNSUPPORTED_MEDIA')
  })

  test('an unrecognizable throw becomes retryable ENGINE_INTERNAL carrying only a code token', async () => {
    const events = await openFails(new Error('private decoder detail'))
    const error = events.at(-1)
    expect(error && error.t === 'job:error' ? error.error : null).toEqual({ code: 'ENGINE_INTERNAL', retryable: true, detail: 'code=unknown' })
    expect(JSON.stringify(error)).not.toContain('private decoder detail')
  })
})

describe('decode: asset geometry and identity (buildAsset / newAssetId)', () => {
  test('a decodable non-cover video track yields kind video with dimensions and fps', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ samples: [{ timestamp: 0, frames: 16000, fill: [0.25] }] })
    const job = decodeWith(source, probeWith({ duration: 1, videoCodec: 'h264', width: 1920, height: 1080, fps: 29.97, trackCount: 2 }), events, [ch.port2])
    const asset = await job.probed
    expect(asset.kind).toBe('video')
    expect([asset.width, asset.height, asset.fps]).toEqual([1920, 1080, 29.97])
    await job.done
  })

  test('container dimensions without a video codec still classify as audio', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ samples: [{ timestamp: 0, frames: 16000, fill: [0.25] }] })
    const job = decodeWith(source, probeWith({ duration: 1, videoCodec: null, width: 640, height: 480, fps: 24 }), events, [ch.port2])
    const asset = await job.probed
    expect(asset.kind).toBe('audio')
    expect([asset.width, asset.height, asset.fps]).toEqual([0, 0, 0])
    await job.done
  })

  test('without crypto.randomUUID the asset id still comes from a unique token generator', async () => {
    vi.stubGlobal('crypto', { subtle: globalThis.crypto.subtle })
    try {
      const ch = channel()
      const events: MediaWorkerEvent[] = []
      const { source } = scripted({ samples: [{ timestamp: 0, frames: 16000, fill: [0.25] }] })
      const asset = await decodeWith(source, probeWith({ duration: 1 }), events, [ch.port2]).probed
      expect(asset.id.startsWith('asset-')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('decode: feed interleaving and priming (FR-04.2, FR-04.3)', () => {
  test('planar stereo feeds the resampler interleaved and downmixes (L+R)/2', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const frames = 16000
    const { source } = scripted({ channels: 2, samples: [{ timestamp: 0, frames, planes: [new Float32Array(frames).fill(0.4), new Float32Array(frames).fill(0.2)] }] })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 1 }), events, [ch.port2]).done
    expect(store.chunks).toHaveLength(1)
    expect(store.chunks[0]!.samples).toHaveLength(16000)
    expect(store.chunks[0]!.samples[0]).toBeCloseTo(0.3, 6)
  })

  test('an already-interleaved single plane passes through and clips at t = 0', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const frames = 16000
    const interleaved = new Float32Array(frames * 2)
    for (let frame = 0; frame < frames; frame++) {
      interleaved[frame * 2] = 0.4
      interleaved[frame * 2 + 1] = 0.2
    }
    const { source } = scripted({ channels: 2, samples: [{ timestamp: -0.5, frames, planes: [interleaved] }] })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 0.5 }), events, [ch.port2]).done
    expect(store.chunks).toHaveLength(1)
    expect(store.chunks[0]!.samples).toHaveLength(8000)
    expect(store.chunks[0]!.samples[7999]).toBeCloseTo(0.3, 6)
  })

  test('samples ending at or before t = 0 are dropped (and closed), content is untouched', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source, closed } = scripted({
      samples: [
        { timestamp: -1, frames: 16000, fill: [0.9] },
        { timestamp: 0, frames: 16000, fill: [0.5] },
      ],
    })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 1 }), events, [ch.port2]).done
    expect(closed).toEqual([true, true])
    expect(store.chunks).toHaveLength(1)
    expect(store.chunks[0]!.samples[0]).toBeCloseTo(0.5, 6)
  })

  test('a sample straddling t = 0 is clipped so the timeline starts at content zero', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ samples: [{ timestamp: -0.5, frames: 16000, fill: [0.5] }] })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 0.5 }), events, [ch.port2]).done
    expect(store.chunks).toHaveLength(1)
    expect(store.chunks[0]!.samples).toHaveLength(8000)
  })

  test('a negative-timestamp sample whose rounding leaves no usable frames is closed', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source, closed } = scripted({
      samples: [
        { timestamp: -0.99998, frames: 16000, fill: [0.9] },
        { timestamp: 0.02, frames: 16000, fill: [0.5] },
      ],
    })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 1 }), events, [ch.port2]).done
    expect(closed[0]).toBe(true)
    expect(store.chunks[0]!.samples[0]).not.toBeCloseTo(0.9, 3)
  })
})

describe('decode: chunk assembly and tail flush (pump/resampler)', () => {
  test('carry segments split at the 1 s boundary with byte-exact boundaries', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({
      samples: [
        { timestamp: 0, frames: 10000, fill: [0.1] },
        { timestamp: 0.625, frames: 10000, fill: [0.2] },
        { timestamp: 1.25, frames: 10000, fill: [0.3] },
        { timestamp: 1.875, frames: 10000, fill: [0.4] },
      ],
    })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 2.5 }), events, [ch.port2]).done
    expect(store.chunks.map((chunk) => chunk.samples.length)).toEqual([16000, 16000, 8000])
    expect(store.chunks[0]!.samples[0]).toBeCloseTo(0.1, 6)
    expect(store.chunks[0]!.samples[9999]).toBeCloseTo(0.1, 6)
    expect(store.chunks[0]!.samples[10000]).toBeCloseTo(0.2, 6)
    expect(store.chunks[1]!.samples[0]).toBeCloseTo(0.2, 6)
    expect(store.chunks[1]!.samples[4000]).toBeCloseTo(0.3, 6)
    expect(store.chunks[1]!.samples[14000]).toBeCloseTo(0.4, 6)
    expect(store.chunks[2]!.samples.every((value) => Math.abs(value - 0.4) < 1e-6)).toBe(true)
    expect(store.chunks.map((chunk) => chunk.startSec)).toEqual([0, 1, 2])
  })

  test('the streaming resampler tail flush contributes the final short chunk at 44.1 kHz', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const samples: SampleSpec[] = Array.from({ length: 8 }, (unused, index) => ({ timestamp: (index * 10000) / 44100, frames: 10000, fill: [0.25] }))
    const { source } = scripted({ sampleRate: 44100, samples })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 80000 / 44100 }), events, [ch.port2]).done
    const total = store.chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0)
    expect(total).toBe(Math.ceil((80000 * 16000) / 44100))
    expect(store.chunks.at(-1)!.samples.length).toBeLessThan(16000)
  })
})

describe('decode: failure legs and notices', () => {
  test('an iterator throw maps to a retryable ENGINE_INTERNAL with zero live decoders', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ samples: Array.from({ length: 6 }, (unused, index) => ({ timestamp: index * 0.5, frames: 8000, fill: [0.2] })), throwAt: 3 })
    const job = decodeWith(source, probeWith({ duration: 3 }), events, [ch.port2])
    await job.done
    const last = events.at(-1)
    expect(last && last.t === 'job:error' ? last.error.code : null).toBe('ENGINE_INTERNAL')
    expect(job.activeDecoders()).toBe(0)
  })

  test('a throw after cancel reports CANCELLED, not the iterator fault', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({
      samples: Array.from({ length: 8 }, (unused, index) => ({ timestamp: index * 0.5, frames: 16000, fill: [0.2] })),
      at: (index) => {
        if (index === 3) job.cancel()
      },
      throwAt: 3,
    })
    const job = decodeWith(source, probeWith({ duration: 4 }), events, [ch.port2])
    await job.done
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'CANCELLED')).toBe(true)
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'ENGINE_INTERNAL')).toBe(false)
  })

  test('cancel while open is still pending emits CANCELLED without probing', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    let resolveOpen!: (value: { source: MediaSourceLike; path: 'webcodecs'; probe: DecodeProbe }) => void
    const job = decodeAudio({ jobId: 'early', file: file(), ports: [ch.port2] }, { open: () => new Promise((resolve) => (resolveOpen = resolve)), emit: (event) => events.push(event) })
    job.cancel()
    const { source } = scripted({ samples: [{ timestamp: 0, frames: 16000, fill: [0.2] }] })
    resolveOpen({ source, path: 'webcodecs', probe: probeWith() })
    await job.done
    expect(events.map((event) => event.t)).toEqual(['job:error'])
    expect(events[0]!.t === 'job:error' && events[0]!.error.code).toBe('CANCELLED')
  })

  test('a fallback reported by the adapter notices once with the reason metadata', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted(secondsSource(1))
    const job = decodeAudio({ jobId: 'fb', file: file(), ports: [ch.port2] }, {
      open: (unused, options) => {
        options?.onFallback?.({ container: 'aiff', codec: 'pcm_s16be' })
        return Promise.resolve({ source, path: 'ffmpeg' as const, probe: probeWith({ container: 'aiff', audioCodec: 'pcm_s16be' }) })
      },
      emit: (event) => events.push(event),
    })
    await job.done
    const notices = events.filter((event) => event.t === 'notice')
    expect(notices).toHaveLength(1)
    expect(notices[0] && notices[0].t === 'notice' ? notices[0].notice : null).toEqual({ code: 'FFMPEG_FALLBACK', params: { container: 'aiff', codec: 'pcm_s16be' } })
  })

  test('a fallback path without an onFallback callback still notices with probe metadata', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted(secondsSource(1))
    const job = decodeAudio({ jobId: 'ff', file: file(), ports: [ch.port2] }, { open: () => Promise.resolve({ source, path: 'ffmpeg' as const, probe: probeWith({ container: 'wma', audioCodec: 'wmav2' }) }), emit: (event) => events.push(event) })
    await job.done
    const notice = events.find((event) => event.t === 'notice')
    expect(notice && notice.t === 'notice' ? notice.notice : null).toEqual({ code: 'FFMPEG_FALLBACK', params: { container: 'wma', codec: 'wmav2' } })
  })

  test('a container without an audio codec notices codec "unknown"', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted(secondsSource(1))
    const job = decodeAudio({ jobId: 'ff2', file: file(), ports: [ch.port2] }, { open: () => Promise.resolve({ source, path: 'ffmpeg' as const, probe: probeWith({ container: 'caf', audioCodec: null }) }), emit: (event) => events.push(event) })
    await job.done
    const notice = events.find((event) => event.t === 'notice')
    expect(notice && notice.t === 'notice' ? notice.notice.params?.codec : null).toBe('unknown')
  })

  test('a multi-track file adds the MULTI_TRACK notice with the track count', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted(secondsSource(1))
    await decodeWith(source, probeWith({ duration: 1, audioTrackCount: 3, trackCount: 3 }), events, [ch.port2]).done
    const notice = events.find((event) => event.t === 'notice')
    expect(notice && notice.t === 'notice' ? notice.notice : null).toEqual({ code: 'MULTI_TRACK', params: { tracks: 3 } })
  })

  test('a container with no audio track fails UNSUPPORTED_MEDIA before any chunk', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const trackless: MediaSourceLike = { getDuration: () => 0, audioTracks: () => [], samples: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined }) }) }) }
    const job = decodeWith(trackless, probeWith({ duration: 0, audioCodec: null, canDecodeAudio: false }), events, [ch.port2])
    await job.done
    expect(events.map((event) => event.t)).toEqual(['media:probed', 'decode:support', 'job:error'])
    const lastError = events.at(-1)
    expect(lastError && lastError.t === 'job:error' ? lastError.error : null).toEqual({ code: 'UNSUPPORTED_MEDIA', retryable: false })
    expect(job.activeDecoders()).toBe(0)
  })
})

describe('decode: consumer flow control (FR-04.1, US-1.2.5)', () => {
  test('garbage is ignored, an ack debriefs the gate, cancel exits the cooperative sleep cleanly', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted(secondsSource(32))
    const job = decodeWith(source, probeWith({ duration: 32 }), events, [ch.port2])
    expect(job.queueLimit).toBe(30)
    await until(() => job.tee.count >= 30, 20_000, 'queue to bound')
    ch.port1.postMessage(null)
    ch.port1.postMessage('junk')
    ch.port1.postMessage({ t: 'ack' })
    const stalled = await job.stalled
    expect(stalled.pendingPorts).toBe(1)
    expect(job.tee.count).toBeLessThanOrEqual(31)
    job.cancel()
    await job.done
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'CANCELLED')).toBe(true)
  }, 30_000)

  test('a transport that never confirms runs to completion after the gate grace, without stalling', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted(secondsSource(32))
    const job = decodeWith(source, probeWith({ duration: 32 }), events, [ch.port2])
    const raced = await Promise.race([job.stalled, new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000))])
    expect(raced).toBeNull()
    await job.done
    expect(job.tee.count).toBe(32)
    expect(events.at(-1)!.t).toBe('job:done')
  }, 30_000)

  test('after the port-stall timeout the gated port is released and every chunk is delivered', async () => {
    const live = channel()
    const gated = channel()
    const events: MediaWorkerEvent[] = []
    const liveStore = collector(live.port1)
    const { source } = scripted(secondsSource(34))
    const job = decodeAudio({ jobId: 'coop', file: file(), ports: [live.port2, gated.port2] }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe: probeWith({ duration: 34 }) }), emit: (event) => events.push(event) })
    const stalled = await job.stalled
    expect(stalled.pendingPorts).toBe(1)
    expect(liveStore.chunks.length).toBeLessThanOrEqual(31)
    await job.done
    // released by PORT_STALL: the decode finished instead of deadlocking.
    expect(job.tee.count).toBe(34)
    expect(events.at(-1)!.t).toBe('job:done')
    expect(liveStore.chunks.map((chunk) => chunk.startSec)).toEqual(Array.from({ length: 34 }, (unused, index) => index))
  }, 60_000)
})

describe('handleMediaRequest: the complete routing union', () => {
  test('decode registers the live job; job:done deregisters it', async () => {
    const ch = channel()
    const posted: MediaWorkerEvent[] = []
    const { source } = scripted(secondsSource(2))
    const job = handleMediaRequest({ t: 'decode', jobId: 'route-1', file: file(), ports: [ch.port2] }, { postMessage: (event) => posted.push(event) }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe: probeWith({ duration: 2 }) }), emit: () => undefined }) as DecodeJob
    expect(job.jobId).toBe('route-1')
    await job.done
    expect(posted.some((event) => event.t === 'job:done')).toBe(true)
    expect(handleMediaRequest({ t: 'cancel', jobId: 'route-1' }, { postMessage: () => undefined }, { open: () => Promise.reject(new Error('unused')), emit: () => undefined })).toBeUndefined()
  })

  test('cancel routes to the live job and a ghost job is a no-op', async () => {
    const ch = channel()
    const { source } = scripted(secondsSource(20))
    const job = handleMediaRequest({ t: 'decode', jobId: 'route-2', file: file(), ports: [ch.port2] }, { postMessage: () => undefined }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe: probeWith({ duration: 20 }) }), emit: () => undefined }) as DecodeJob
    await until(() => job.tee.count >= 2, 10_000, 'chunks')
    expect(handleMediaRequest({ t: 'cancel', jobId: 'route-2' }, { postMessage: () => undefined }, { open: () => Promise.reject(new Error('unused')), emit: () => undefined })).toBe(job)
    await job.done
    expect(job.activeDecoders()).toBe(0)
  })

  test('probe emits media:probed on the scope and on deps.emit', async () => {
    const posted: MediaWorkerEvent[] = []
    const emitted: MediaWorkerEvent[] = []
    const { source } = scripted(secondsSource(2))
    const result = handleMediaRequest({ t: 'probe', jobId: 'probe-1', file: file() }, { postMessage: (event) => posted.push(event) }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe: probeWith({ duration: 2 }) }), emit: (event) => emitted.push(event) })
    expect(result).toBeUndefined()
    await until(() => emitted.length > 0, 5_000, 'probe result')
    expect(emitted[0]!.t).toBe('media:probed')
    expect(posted.map((event) => event.t)).toEqual(emitted.map((event) => event.t))
  })

  test('a probe failure surfaces as job:error with the mapped code', async () => {
    const posted: MediaWorkerEvent[] = []
    handleMediaRequest({ t: 'probe', jobId: 'probe-err', file: file() }, { postMessage: (event) => posted.push(event) }, { open: () => Promise.reject(Object.assign(new Error('junk container'), { code: 'UNSUPPORTED_MEDIA' })), emit: () => undefined })
    await until(() => posted.length > 0, 5_000, 'error event')
    const firstPosted = posted[0]
    expect(firstPosted && firstPosted.t === 'job:error' ? firstPosted.error.code : null).toBe('UNSUPPORTED_MEDIA')
  })

  test('an unrecognised request type emits nothing and registers no job', () => {
    const posted: MediaWorkerEvent[] = []
    handleMediaRequest({ t: 'not-a-command', jobId: 'bogus' } as unknown as MediaRequest, { postMessage: (event) => posted.push(event) }, { open: () => Promise.reject(new Error('must not be called')), emit: () => undefined })
    expect(posted).toHaveLength(0)
  })
})

describe('decodeForPlayback: native-rate legs (FR-04.10)', () => {
  function playbackDeps(source: MediaSourceLike, probe: DecodeProbe, events?: MediaWorkerEvent[]) {
    return { open: () => Promise.resolve({ source, path: 'webcodecs' as const, probe }), emit: (event: MediaWorkerEvent) => void events?.push(event) }
  }

  test('an open failure surfaces as the mapped job:error', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const job = decodeForPlayback({ jobId: 'pb-err', file: file(), fromSec: 0, port: ch.port2 }, { open: () => Promise.reject(Object.assign(new Error('junk'), { code: 'UNSUPPORTED_MEDIA' })), emit: (event) => events.push(event) })
    await job.done
    expect(events).toHaveLength(1)
    expect(events[0]!.t === 'job:error' && events[0]!.error).toEqual({ code: 'UNSUPPORTED_MEDIA', retryable: false })
  })

  test('a source with no audio track fails UNSUPPORTED_MEDIA', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const trackless: MediaSourceLike = { getDuration: () => 0, audioTracks: () => [], samples: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined }) }) }) }
    const job = decodeForPlayback({ jobId: 'pb-notrack', file: file(), fromSec: 0, port: ch.port2 }, playbackDeps(trackless, probeWith(), events))
    await job.done
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'UNSUPPORTED_MEDIA')).toBe(true)
  })

  test('planar stereo streams interleaved [L,R] pairs at the source rate', async () => {
    const ch = channel()
    const store = collector(ch.port1)
    const frames = 10000
    const { source } = scripted({ channels: 2, samples: [{ timestamp: 0, frames, planes: [new Float32Array(frames).fill(0.4), new Float32Array(frames).fill(0.2)] }] })
    const job = decodeForPlayback({ jobId: 'pb-planar', file: file(), fromSec: 0, port: ch.port2 }, playbackDeps(source, probeWith({ duration: 0.625 })))
    await job.done
    expect(job.channels).toBe(2)
    const chunk = store.chunks[0]!
    expect(chunk.samples.length).toBe(frames * 2)
    expect(chunk.samples[0]).toBeCloseTo(0.4, 6)
    expect(chunk.samples[1]).toBeCloseTo(0.2, 6)
  })

  test('an interleaved single-plane stereo source produces the same geometry', async () => {
    const ch = channel()
    const store = collector(ch.port1)
    const frames = 10000
    const interleaved = new Float32Array(frames * 2)
    for (let frame = 0; frame < frames; frame++) {
      interleaved[frame * 2] = 0.4
      interleaved[frame * 2 + 1] = 0.2
    }
    const { source } = scripted({ channels: 2, samples: [{ timestamp: 0, frames, planes: [interleaved] }] })
    const job = decodeForPlayback({ jobId: 'pb-plane', file: file(), fromSec: 0, port: ch.port2 }, playbackDeps(source, probeWith({ duration: 0.625 })))
    await job.done
    expect(store.chunks[0]!.samples.length).toBe(frames * 2)
    expect(store.chunks[0]!.samples[1]).toBeCloseTo(0.2, 6)
  })

  test('native-rate carry splits at the 1 s boundary and flushes the tail', async () => {
    const ch = channel()
    const store = collector(ch.port1)
    const { source } = scripted({
      samples: [
        { timestamp: 0, frames: 10000, fill: [0.1] },
        { timestamp: 0.625, frames: 10000, fill: [0.2] },
      ],
    })
    const job = decodeForPlayback({ jobId: 'pb-split', file: file(), fromSec: 0, port: ch.port2 }, playbackDeps(source, probeWith({ duration: 1.25 })))
    await job.done
    expect(store.chunks.map((chunk) => chunk.samples.length)).toEqual([16000, 4000])
    expect(store.chunks[0]!.samples[9999]).toBeCloseTo(0.1, 6)
    expect(store.chunks[0]!.samples[10000]).toBeCloseTo(0.2, 6)
    expect(store.chunks[1]!.startSec).toBe(1)
  })

  test('samples entirely before fromSec are dropped without emitting chunks', async () => {
    const ch = channel()
    const store = collector(ch.port1)
    const events: MediaWorkerEvent[] = []
    const { source, closed } = scripted({
      samples: [
        { timestamp: 0, frames: 800, fill: [0.1] },
        { timestamp: 0.5, frames: 800, fill: [0.9] },
      ],
    })
    const job = decodeForPlayback({ jobId: 'pb-drop', file: file(), fromSec: 1.0, port: ch.port2 }, playbackDeps(source, probeWith({ duration: 1 }), events))
    await job.done
    expect(store.chunks).toHaveLength(0)
    expect(closed).toEqual([true, true])
    expect(events.map((event) => event.t)).toEqual(['decode:support', 'job:done'])
  })

  test('a sample whose rounding leaves no frames after fromSec is closed and skipped', async () => {
    const ch = channel()
    const store = collector(ch.port1)
    const { source, closed } = scripted({
      samples: [
        { timestamp: 0.5, frames: 800, fill: [0.1] },
        { timestamp: 0.55, frames: 800, fill: [0.7] },
      ],
    })
    const job = decodeForPlayback({ jobId: 'pb-edge', file: file(), fromSec: 0.54998, port: ch.port2 }, playbackDeps(source, probeWith({ duration: 1 })))
    await job.done
    expect(closed[0]).toBe(true)
    expect(store.chunks.length).toBeGreaterThan(0)
    expect(store.chunks[0]!.samples[0]).not.toBeCloseTo(0.1, 3)
  })

  test('cancel mid-playback ends the job with CANCELLED and zero live decoders', async () => {
    const ch = channel()
    const store = collector(ch.port1)
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ ...secondsSource(30), paceMs: 2 })
    const job = decodeForPlayback({ jobId: 'pb-cancel', file: file(), fromSec: 0, port: ch.port2 }, playbackDeps(source, probeWith({ duration: 30 }), events))
    await until(() => store.chunks.length >= 1, 10_000, 'first chunk')
    job.cancel()
    await job.done
    expect(job.activeDecoders()).toBe(0)
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'CANCELLED')).toBe(true)
  }, 30_000)

  test('an iterator throw maps to job:error and resolves done', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ samples: Array.from({ length: 4 }, (unused, index) => ({ timestamp: index * 0.05, frames: 800, fill: [0.2] })), throwAt: 2 })
    const job = decodeForPlayback({ jobId: 'pb-throw', file: file(), fromSec: 0, port: ch.port2 }, playbackDeps(source, probeWith({ duration: 0.2 }), events))
    await job.done
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'ENGINE_INTERNAL')).toBe(true)
    expect(job.activeDecoders()).toBe(0)
  })
})
