// L1 source-adjacent coverage: engine internals of `decode` that neither the
// frozen `tests/unit/audio` suites (excluded from the coverage child run by
// vitest.config.ts) nor `decode.test.ts` exercise — error-mapping legs, asset
// geometry, feed interleaving, timestamp-anchored placement, chunk-assembly
// splits, iterator failure paths, the consumer flow signals and the
// consumer-side `PcmChunkStream`/`referenceMeter` seams. Supports the
// per-file coverage gate on `src/engine/**` (unit-03/4A-D precedent for
// source-adjacent suites). No CC-tracing here — the frozen suites own the
// criterion evidence; every test below asserts real engine behaviour (byte
// boundaries at chunk assembly, drop-vs-clip priming, mapped codes).
import { describe, expect, test, vi } from 'vitest'
import { decodeAudio, decodeForPlayback, handleMediaRequest, PcmChunkStream, referenceMeter, type AudioSampleLike, type AudioTrackLike, type DecodeProbe, type MediaSourceLike, type MediaWorkerEvent } from './decode'
import type { MediaRequest, PcmChunk } from '../protocol'
import { createMessageChannel, type CreateMessageChannel } from './worker-core@ref'

const channels: CreateMessageChannel[] = []

function channel(): CreateMessageChannel {
  const created = createMessageChannel()
  channels.push(created)
  return created
}

async function until(predicate: () => boolean, timeoutMs = 8_000, label = 'condition'): Promise<void> {
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
  /** Per-channel constant fill; used when `planes` is absent. */
  fill?: number[]
  /** Explicit planes (planar); length may be < channels to model an interleaved single plane. */
  planes?: Float32Array[]
}

interface SourceSpec {
  sampleRate?: number
  channels?: number
  samples: SampleSpec[]
  /** Throw from the iterator when yielding this sample index. */
  throwAt?: number
  /** Invoke before yielding this sample index (e.g. to cancel mid-file). */
  at?: (index: number) => void
}

/** Scripted `MediaSourceLike`: exact sample geometry so chunk-assembly tests can assert byte boundaries. */
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
        spec.at?.(index)
        if (spec.throwAt === index) throw new Error('scripted iterator failure')
        const sample = spec.samples[index]!
        yield {
          timestamp: sample.timestamp,
          sampleRate,
          numberOfFrames: sample.frames,
          numberOfChannels: channels,
          samples: () => sample.planes ?? Array.from({ length: channels }, (_unused, channel) => new Float32Array(sample.frames).fill(sample.fill?.[channel] ?? (index + 1) / 10)),
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

function file(name = 'clip.mp4'): File {
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

function decodeWith(source: MediaSourceLike, probe: DecodeProbe, events: MediaWorkerEvent[], ports: MessagePort[]) {
  return decodeAudio({ jobId: 'int-1', file: file(), ports }, { open: () => Promise.resolve({ source, path: 'webcodecs', probe }), emit: (event) => events.push(event) })
}

describe('decode: error mapping from the open seam (SECURITY-03)', () => {
  async function openFails(error: Error): Promise<MediaWorkerEvent[]> {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const job = decodeAudio({ jobId: 'err', file: file(), ports: [ch.port2] }, { open: () => Promise.reject(error), emit: (event) => events.push(event) })
    await job.done
    return events
  }

  test('FFMPEG_CORE_UNAVAILABLE maps to retryable FFMPEG_REQUIRED without message text', async () => {
    const events = await openFails(Object.assign(new Error('cannot fetch /wasm/ffmpeg-core.wasm'), { code: 'FFMPEG_CORE_UNAVAILABLE' }))
    const error = events.find((event) => event.t === 'job:error')
    expect(error && error.t === 'job:error' ? error.error.code : null).toBe('FFMPEG_REQUIRED')
    expect(error && error.t === 'job:error' && error.error.retryable).toBe(true)
    expect(JSON.stringify(error)).not.toContain('ffmpeg-core')
  })

  test('a taxonomy code from the adapter passes through with its retry policy', async () => {
    const events = await openFails(Object.assign(new Error('stall'), { code: 'DECODE_STALL' }))
    const error = events.find((event) => event.t === 'job:error')
    expect(error && error.t === 'job:error' ? error.error.code : null).toBe('DECODE_STALL')
    expect(error && error.t === 'job:error' && error.error.retryable).toBe(true)
  })

  test('the demuxer name UnsupportedInputFormatError is UNSUPPORTED_MEDIA, not an internal fault', async () => {
    const events = await openFails(Object.assign(new Error('demux refused'), { name: 'UnsupportedInputFormatError' }))
    const error = events.find((event) => event.t === 'job:error')
    expect(error && error.t === 'job:error' ? error.error : null).toEqual({ code: 'UNSUPPORTED_MEDIA', retryable: false })
  })

  test('the demuxer message text shape-matches when the error carries no code', async () => {
    const events = await openFails(new Error('Unsupported or unrecognizable format'))
    const error = events.find((event) => event.t === 'job:error')
    expect(error && error.t === 'job:error' ? error.error.code : null).toBe('UNSUPPORTED_MEDIA')
  })

  test('an unrecognizable throw becomes retryable ENGINE_INTERNAL carrying only a code token', async () => {
    const events = await openFails(new Error('private decoder detail'))
    const error = events.find((event) => event.t === 'job:error')
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

describe('decode: feed interleaving (FR-04.3)', () => {
  test('planar stereo feeds the resampler interleaved and downmixes (L+R)/2', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const frames = 16000
    const left = new Float32Array(frames).fill(0.4)
    const right = new Float32Array(frames).fill(0.2)
    const { source } = scripted({ channels: 2, samples: [{ timestamp: 0, frames, planes: [left, right] }] })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 1 }), events, [ch.port2]).done
    expect(store.chunks).toHaveLength(1)
    expect(store.chunks[0]!.samples).toHaveLength(16000)
    expect(store.chunks[0]!.samples[0]).toBeCloseTo(0.3, 6)
    expect(store.chunks[0]!.samples[15999]).toBeCloseTo(0.3, 6)
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
    expect(store.chunks[0]!.samples[0]).toBeCloseTo(0.3, 6)
  })
})

describe('decode: priming and timestamp placement (FR-04.2)', () => {
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
    expect(store.chunks[0]!.samples[7999]).toBeCloseTo(0.5, 6)
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

describe('decode: chunk assembly (pump)', () => {
  test('carry segments split at the 1 s boundary and the tail flushes as the final chunk', async () => {
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
    const [first, second, tail] = store.chunks
    // chunk 1 = seg1 (10000 × 0.1) + split head of seg2 (6000 × 0.2)
    expect(first!.samples[0]).toBeCloseTo(0.1, 6)
    expect(first!.samples[9999]).toBeCloseTo(0.1, 6)
    expect(first!.samples[10000]).toBeCloseTo(0.2, 6)
    // chunk 2 = split remainder of seg2, whole seg3, split head of seg4
    expect(second!.samples[0]).toBeCloseTo(0.2, 6)
    expect(second!.samples[3999]).toBeCloseTo(0.2, 6)
    expect(second!.samples[4000]).toBeCloseTo(0.3, 6)
    expect(second!.samples[13999]).toBeCloseTo(0.3, 6)
    expect(second!.samples[14000]).toBeCloseTo(0.4, 6)
    // tail = undivided remainder
    expect(tail!.samples.every((value) => Math.abs(value - 0.4) < 1e-6)).toBe(true)
    expect(store.chunks.map((chunk) => chunk.startSec)).toEqual([0, 1, 2])
  })

  test('a single sub-second sample flushes as one short chunk at position 0', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ samples: [{ timestamp: 0, frames: 5000, fill: [0.6] }] })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 0.3125 }), events, [ch.port2]).done
    expect(store.chunks).toHaveLength(1)
    expect(store.chunks[0]!.samples.length).toBe(5000)
  })

  test('the streaming resampler tail flush contributes the final short chunk at 44.1 kHz', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const samples: SampleSpec[] = Array.from({ length: 8 }, (_unused, index) => ({ timestamp: (index * 10000) / 44100, frames: 10000, fill: [0.25] }))
    const { source } = scripted({ sampleRate: 44100, samples })
    const store = collector(ch.port1)
    await decodeWith(source, probeWith({ duration: 80000 / 44100 }), events, [ch.port2]).done
    const total = store.chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0)
    expect(total).toBe(Math.ceil((80000 * 16000) / 44100))
    expect(store.chunks[0]!.samples.length).toBe(16000)
    expect(store.chunks.at(-1)!.samples.length).toBeLessThan(16000)
  })
})

describe('decode: iterator failure and cancellation races', () => {
  test('an iterator throw maps to a retryable ENGINE_INTERNAL with zero live decoders', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ samples: Array.from({ length: 6 }, (_unused, index) => ({ timestamp: index * 0.5, frames: 8000, fill: [0.2] })), throwAt: 3 })
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
      samples: Array.from({ length: 8 }, (_unused, index) => ({ timestamp: index * 0.5, frames: 16000, fill: [0.2] })),
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
    expect(job.activeDecoders()).toBe(0)
  })
})

describe('decode: ffmpeg notice legs and missing audio track', () => {
  async function openWith(path: 'webcodecs' | 'ffmpeg', probe: DecodeProbe): Promise<MediaWorkerEvent[]> {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ samples: [{ timestamp: 0, frames: 16000, fill: [0.25] }] })
    const job = decodeAudio({ jobId: 'ff', file: file(), ports: [ch.port2] }, { open: () => Promise.resolve({ source, path, probe }), emit: (event) => events.push(event) })
    await job.done
    return events
  }

  test('a fallback open without an onFallback callback still notices with probe metadata', async () => {
    const events = await openWith('ffmpeg', probeWith({ container: 'wma', audioCodec: 'wmav2' }))
    const notices = events.filter((event) => event.t === 'notice')
    expect(notices).toHaveLength(1)
    const notice = notices[0]
    expect(notice && notice.t === 'notice' ? notice.notice : null).toEqual({ code: 'FFMPEG_FALLBACK', params: { container: 'wma', codec: 'wmav2' } })
  })

  test('a container without an audio codec notices codec "unknown"', async () => {
    const events = await openWith('ffmpeg', probeWith({ container: 'caf', audioCodec: null }))
    const notice = events.find((event) => event.t === 'notice')
    expect(notice && notice.t === 'notice' ? notice.notice.params?.codec : null).toBe('unknown')
  })

  test('a container with no audio track fails UNSUPPORTED_MEDIA before decode:support', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const trackless: MediaSourceLike = { getDuration: () => 0, audioTracks: () => [], samples: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined }) }) }) }
    const job = decodeWith(trackless, probeWith({ duration: 0, audioCodec: null, canDecodeAudio: false }), events, [ch.port2])
    await job.done
    expect(events.map((event) => event.t)).toEqual(['media:probed', 'decode:support', 'job:error'])
    const error = events.at(-1)
    expect(error && error.t === 'job:error' ? error.error : null).toEqual({ code: 'UNSUPPORTED_MEDIA', retryable: false })
    expect(job.activeDecoders()).toBe(0)
  })
})

describe('decode: consumer flow signals (ack protocol and gate release)', () => {
  test('garbage is ignored, an explicit ack debriefs the gate, cancel exits the coop sleep cleanly', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const samples: SampleSpec[] = Array.from({ length: 640 }, (_unused, index) => ({ timestamp: index * 0.05, frames: 800, fill: [0.2] }))
    const { source } = scripted({ samples })
    const job = decodeWith(source, probeWith({ duration: 32 }), events, [ch.port2])
    expect(job.queueLimit).toBe(30)
    // no consumer handler exists: pending climbs to the bound.
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
    expect(job.activeDecoders()).toBe(0)
  }, 30_000)
})

describe('PcmChunkStream: the consumer-side seam (unit-05 contract)', () => {
  test('chunks arrive in order and {t:"end"} completes the iteration', async () => {
    const ch = channel()
    const stream = PcmChunkStream(ch.port1)
    const seen: { startSec: number; value: number }[] = []
    const collect = (async () => {
      for await (const chunk of stream) seen.push({ startSec: chunk.startSec, value: chunk.samples[0] ?? -1 })
    })()
    ch.port2.postMessage({ startSec: 0, samples: new Float32Array([1, 2]) })
    ch.port2.postMessage({ startSec: 1, samples: new Float32Array([3]) })
    ch.port2.postMessage({ t: 'end' })
    await collect
    expect(seen).toEqual([
      { startSec: 0, value: 1 },
      { startSec: 1, value: 3 },
    ])
  })

  test('job:done completes and job:error rejects with the code as the message', async () => {
    const doneChannel = channel()
    const doneStream = PcmChunkStream(doneChannel.port1)
    const doneIter = doneStream[Symbol.asyncIterator]()
    doneChannel.port2.postMessage({ t: 'job:done', jobId: 'a' })
    expect(await doneIter.next()).toEqual({ done: true, value: undefined })

    const failChannel = channel()
    const failStream = PcmChunkStream(failChannel.port1)
    failChannel.port2.postMessage({ t: 'job:error', jobId: 'b', error: { code: 'DECODE_STALL' } })
    await expect(failStream[Symbol.asyncIterator]().next()).rejects.toThrow('DECODE_STALL')
  })

  test('an error without a usable code rejects as ENGINE_INTERNAL', async () => {
    const ch = channel()
    const stream = PcmChunkStream(ch.port1)
    ch.port2.postMessage({ t: 'job:error', jobId: 'c', error: { code: '' } })
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow('ENGINE_INTERNAL')
  })

  test('non-chunk traffic is ignored and return() drains a pending queue', async () => {
    const ch = channel()
    const stream = PcmChunkStream(ch.port1)
    ch.port2.postMessage(null)
    ch.port2.postMessage('noise')
    ch.port2.postMessage({ t: 'notice', notice: { code: 'MULTI_TRACK' } })
    ch.port2.postMessage({ startSec: 4, samples: new Float32Array([7]) })
    const iter = stream[Symbol.asyncIterator]() as unknown as AsyncIterator<PcmChunk, void, void>
    const first = await iter.next()
    if (first.done) throw new Error('expected the queued chunk before end')
    expect(first.value.startSec).toBe(4)
    expect(first.value.samples).toBeInstanceOf(Float32Array)
    expect(await iter.return?.()).toEqual({ done: true, value: undefined })
    expect(await iter.next()).toEqual({ done: true, value: undefined })
  })
})

describe('referenceMeter: identity meter seam', () => {
  test('current() is undefined until begin(reference) pins the reading', () => {
    const meter = referenceMeter().create()
    expect(meter.current()).toBeUndefined()
    meter.begin(42.5)
    expect(meter.current()).toEqual({ value: 42.5, reference: 42.5 })
    const fresh = referenceMeter().create()
    expect(fresh.current()).toBeUndefined()
  })
})

describe('handleMediaRequest: unknown protocol requests', () => {
  test('an unrecognised request type emits nothing and registers no job', () => {
    const posted: MediaWorkerEvent[] = []
    const emitted: MediaWorkerEvent[] = []
    const result = handleMediaRequest(
      { t: 'not-a-command', jobId: 'bogus' } as unknown as MediaRequest,
      { postMessage: (event) => posted.push(event) },
      { open: () => Promise.reject(new Error('must not be called')), emit: (event) => emitted.push(event) },
    )
    expect(posted).toHaveLength(0)
    expect(emitted).toHaveLength(0)
    expect(result === undefined || typeof result === 'object').toBe(true)
  })
})

describe('decodeForPlayback: failure and assembly legs (FR-04.10)', () => {
  function playbackDeps(source: MediaSourceLike, probe: DecodeProbe) {
    return { open: () => Promise.resolve({ source, path: 'webcodecs' as const, probe }), emit: () => undefined }
  }

  test('an open failure surfaces as the mapped job:error', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const job = decodeForPlayback(
      { jobId: 'pb-err', file: file(), fromSec: 0, port: ch.port2 },
      { open: () => Promise.reject(Object.assign(new Error('junk'), { code: 'UNSUPPORTED_MEDIA' })), emit: (event) => events.push(event) },
    )
    await job.done
    expect(events).toHaveLength(1)
    expect(events[0]!.t === 'job:error' && events[0]!.error).toEqual({ code: 'UNSUPPORTED_MEDIA', retryable: false })
  })

  test('a source with no audio track fails UNSUPPORTED_MEDIA', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const trackless: MediaSourceLike = { getDuration: () => 0, audioTracks: () => [], samples: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true as const, value: undefined }) }) }) }
    const job = decodeForPlayback({ jobId: 'pb-notrack', file: file(), fromSec: 0, port: ch.port2 }, { ...playbackDeps(trackless, probeWith()), emit: (event) => events.push(event) })
    await job.done
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'UNSUPPORTED_MEDIA')).toBe(true)
  })

  test('an interleaved single-plane stereo source streams [L,R] pairs', async () => {
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
    expect(job.channels).toBe(2)
    const chunk = store.chunks[0]!
    expect(chunk.samples.length).toBe(frames * 2)
    expect(chunk.samples[0]).toBeCloseTo(0.4, 6)
    expect(chunk.samples[1]).toBeCloseTo(0.2, 6)
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
    expect(store.chunks[0]!.samples[0]).toBeCloseTo(0.1, 6)
    expect(store.chunks[0]!.samples[15999]).toBeCloseTo(0.2, 6)
    expect(store.chunks[1]!.samples[0]).toBeCloseTo(0.2, 6)
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
    const job = decodeForPlayback({ jobId: 'pb-drop', file: file(), fromSec: 1.0, port: ch.port2 }, { ...playbackDeps(source, probeWith({ duration: 1 })), emit: (event) => events.push(event) })
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

  test('an iterator throw maps to job:error and resolves done', async () => {
    const ch = channel()
    const events: MediaWorkerEvent[] = []
    const { source } = scripted({ samples: Array.from({ length: 4 }, (_unused, index) => ({ timestamp: index * 0.05, frames: 800, fill: [0.2] })), throwAt: 2 })
    const job = decodeForPlayback({ jobId: 'pb-throw', file: file(), fromSec: 0, port: ch.port2 }, { ...playbackDeps(source, probeWith({ duration: 0.2 })), emit: (event) => events.push(event) })
    await job.done
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'ENGINE_INTERNAL')).toBe(true)
    expect(job.activeDecoders()).toBe(0)
  })
})
