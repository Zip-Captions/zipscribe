// CC-04.11 / CC-04.12 (L1/L3): the in-process decode pipeline — probe →
// `media:probed` → `decode:support` → 1 s `PcmChunk`s to EVERY port →
// `peaks:chunk` → `job:done`; cancel/retry leaves zero active decoders; the
// two-port tee is byte-identical; a stalled consumer pauses decode at a
// bounded queue of 30 chunks instead of buffering without limit (FR-04.1,
// US-1.2.5).
//
// Everything the pipeline needs from mediabunny/WebCodecs arrives through the
// injected `DecodeDeps.open()` seam — the real adapter is exercised in the
// browser suite (`e2e/media/**`); this suite proves the engine-side contract
// with a deterministic `MediaSourceLike` double (`src/test-support` doctrine
// would normally hold it; unit-04 keeps it here because nothing else uses it).
import { afterEach, describe, expect, test } from 'vitest'
import {
  decodeAudio,
  decodeForPlayback,
  handleMediaRequest,
  referenceMeter,
  type AudioSampleLike,
  type AudioTrackLike,
  type DecodeDeps,
  type MediaSourceLike,
  type DecodeProbe,
  type MediaWorkerEvent,
} from '@engine/audio/worker-core'
import { createMessageChannel, type CreateMessageChannel } from '@engine/audio/worker-core@ref'
import { assertDecodeContract, PortRecorder } from './decode-contract'

const opened: CreateMessageChannel[] = []

function channel(): CreateMessageChannel {
  const created = createMessageChannel()
  opened.push(created)
  return created
}

afterEach(() => {
  while (opened.length > 0) opened.pop()!.close()
})

interface SourceOptions {
  duration?: number
  sampleRate?: number
  channels?: number
  canDecode?: boolean
  path?: 'webcodecs' | 'ffmpeg'
  /** Raise from inside the sample loop after N samples (cancel mid-file). */
  onSample?: (index: number) => void
  /** Await between samples (lets a stalled consumer build its queue). */
  yieldEvery?: number
  probe?: Partial<DecodeProbe>
}

function vectorSample(timestamp: number, sampleRate: number, channels: number): Float32Array[] {
  const frames = Math.round(sampleRate * 0.05)
  return Array.from({ length: channels }, (_, channel) => {
    const plane = new Float32Array(frames)
    for (let index = 0; index < frames; index++) plane[index] = Math.sin((timestamp + index / sampleRate + channel * 0.001) * 440) * 0.5
    return plane
  })
}

function makeSource(options: SourceOptions = {}) {
  const duration = options.duration ?? 2.5
  const sampleRate = options.sampleRate ?? 16000
  const channels = options.channels ?? 1
  const track: AudioTrackLike = {
    number: 0,
    codec: 'aac',
    sampleRate,
    numberOfChannels: channels,
    canDecode: () => options.canDecode ?? true,
  }
  let liveDecoders = 0
  const source: MediaSourceLike = {
    getDuration: () => duration,
    audioTracks: () => [track],
    samples: async function* (): AsyncGenerator<AudioSampleLike> {
      liveDecoders++
      try {
        const step = 0.05
        let index = 0
        for (let timestamp = 0; timestamp < duration - 1e-9; timestamp += step) {
          options.onSample?.(index)
          if (options.yieldEvery) await new Promise((resolve) => setTimeout(resolve, options.yieldEvery))
          yield {
            timestamp,
            sampleRate,
            numberOfFrames: Math.round(sampleRate * step),
            numberOfChannels: channels,
            samples: () => vectorSample(timestamp, sampleRate, channels),
          }
          index++
        }
      } finally {
        liveDecoders--
      }
    },
  }
  const probe: DecodeProbe = {
    container: 'mp4',
    duration,
    audioCodec: 'aac',
    videoCodec: null,
    width: 0,
    height: 0,
    fps: 0,
    trackCount: 1,
    audioTrackCount: 1,
    canDecodeAudio: options.canDecode ?? true,
    ...options.probe,
  }
  return {
    source,
    probe,
    path: options.path ?? ('webcodecs' as const),
    track,
    liveDecoders: () => liveDecoders,
  }
}

function depsFor(source: ReturnType<typeof makeSource>, events: MediaWorkerEvent[]) {
  const deps: DecodeDeps = {
    open: async () => ({ source: source.source, path: source.path, probe: source.probe }),
    emit: (event) => events.push(event),
    onDecoder: (track) => void track,
  }
  return deps
}

function file(): File {
  return new File([new Uint8Array(1024)], 'speech-2min.mp4', { type: 'video/mp4' })
}

describe('CC-04.11: decode pipeline event stream and cancel/retry decoder hygiene', () => {
  test('CC-04.11: decode emits media:probed → decode:support → chunks → job:done in contract order', async () => {
    const source = makeSource({ duration: 2.5 })
    const events: MediaWorkerEvent[] = []
    const { port1, port2 } = channel()
    const recorder = new PortRecorder(port1)
    const job = decodeAudio({ jobId: 'job-1', file: file(), ports: [port2] }, depsFor(source, events))
    await assertDecodeContract([recorder], 2.5, 'webcodecs')
    expect(await job.support).toBe('webcodecs')
    const seen = events.map((event) => event.t)
    expect(seen[0]).toBe('media:probed')
    expect(seen.filter((type) => type === 'decode:support')).toHaveLength(1)
    expect(seen).toContain('peaks:chunk')
    expect(seen.at(-1)).toBe('job:done')
    // media:probed carries the full MediaAsset contract (unit-106 consumes it)
    const probed = events[0] as Extract<MediaWorkerEvent, { t: 'media:probed' }>
    expect(probed.asset.id).toMatch(/\S/)
    expect(probed.asset.audioCodec).toBe('aac')
    expect(probed.asset.videoCodec).toBeNull()
    expect(probed.asset.width).toBe(0)
    expect(probed.asset.duration).toBeCloseTo(2.5, 3)
    expect(probed.asset.fingerprint.sampleHashes).toHaveLength(3)
  })

  test('CC-04.11: jobId is present on every job-scoped event', async () => {
    const source = makeSource({ duration: 1.2 })
    const events: MediaWorkerEvent[] = []
    const { port1, port2 } = channel()
    const recorder = new PortRecorder(port1)
    decodeAudio({ jobId: 'job-id-x', file: file(), ports: [port2] }, depsFor(source, events))
    await assertDecodeContract([recorder], 1.2, 'webcodecs')
    for (const event of events) expect((event as { jobId?: string }).jobId).toBe('job-id-x')
  })

  test('CC-04.11: job:progress is monotonic and ends at the total duration', async () => {
    const source = makeSource({ duration: 3 })
    const events: MediaWorkerEvent[] = []
    const { port1, port2 } = channel()
    const recorder = new PortRecorder(port1)
    decodeAudio({ jobId: 'job-2', file: file(), ports: [port2] }, depsFor(source, events))
    await assertDecodeContract([recorder], 3, 'webcodecs')
    const progress = events.filter((event): event is Extract<MediaWorkerEvent, { t: 'job:progress' }> => event.t === 'job:progress')
    for (let index = 1; index < progress.length; index++) {
      expect(progress[index]!.processedSec).toBeGreaterThanOrEqual(progress[index - 1]!.processedSec)
    }
    expect(progress.at(-1)!.totalSec).toBeCloseTo(3, 3)
  })

  test('CC-04.11: peaks:chunk events tile the timeline bucket-by-bucket', async () => {
    const source = makeSource({ duration: 6 })
    const events: MediaWorkerEvent[] = []
    const { port1, port2 } = channel()
    const recorder = new PortRecorder(port1)
    decodeAudio({ jobId: 'job-3', file: file(), ports: [port2] }, depsFor(source, events))
    await assertDecodeContract([recorder], 6, 'webcodecs')
    const peaks = events.filter((event): event is Extract<MediaWorkerEvent, { t: 'peaks:chunk' }> => event.t === 'peaks:chunk')
    expect(peaks.length, 'peaks stream incrementally').toBeGreaterThan(1)
    expect(peaks.every((event) => event.min.length === event.max.length)).toBe(true)
    expect(peaks[0]!.firstBucket).toBe(0)
    const totalBuckets = peaks.reduce((sum, event) => sum + event.min.length, 0)
    expect(totalBuckets, '~50 ms buckets over 6 s').toBeGreaterThanOrEqual(100)
    expect(totalBuckets).toBeLessThanOrEqual(130)
  })

  test('CC-04.11: cancel mid-file closes decoders, emits no job:done and leaves zero active decoders', async () => {
    let processed = 0
    const source = makeSource({
      duration: 10,
      onSample: (index) => {
        processed = index
      },
    })
    const events: MediaWorkerEvent[] = []
    const { port1, port2 } = channel()
    const recorder = new PortRecorder(port1)
    const job = decodeAudio({ jobId: 'job-cancel', file: file(), ports: [port2] }, depsFor(source, events))
    await recorder.waitFor(() => recorder.chunks.length >= 4, 10_000, 'a few chunks')
    expect(processed, 'decode is mid-file').toBeGreaterThan(0)
    job.cancel()
    await job.done
    expect(job.activeDecoders(), 'no decoder survives cancel').toBe(0)
    expect(source.liveDecoders(), 'the injected source was closed').toBe(0)
    expect(recorder.chunks.length, 'chunks stop arriving').toBeLessThan(10)
    expect(events.some((event) => event.t === 'job:done'), 'a cancelled job never completes').toBe(false)
    expect(events.some((event) => event.t === 'job:error' && event.error.code === 'CANCELLED')).toBe(true)
  })

  test('CC-04.11: retry after cancel succeeds and uses fresh, closed decoders', async () => {
    const first = makeSource({ duration: 8 })
    const second = makeSource({ duration: 2 })
    const events: MediaWorkerEvent[] = []
    const channels1 = channel()
    const recorder1 = new PortRecorder(channels1.port1)
    const job = decodeAudio({ jobId: 'job-retry-1', file: file(), ports: [channels1.port2] }, depsFor(first, events))
    await recorder1.waitFor((recorder) => recorder.chunks.length >= 2, 10_000, 'first chunks')
    job.cancel()
    await job.done
    const channels2 = channel()
    const recorder2 = new PortRecorder(channels2.port1)
    const retry = decodeAudio({ jobId: 'job-retry-2', file: file(), ports: [channels2.port2] }, depsFor(second, events))
    await assertDecodeContract([recorder2], 2, 'webcodecs')
    expect(retry.activeDecoders()).toBe(0)
    expect(second.liveDecoders()).toBe(0)
  })

  test('CC-04.11: an unsupported file emits job:error UNSUPPORTED_MEDIA and never creates a probed asset', async () => {
    const events: MediaWorkerEvent[] = []
    const { port1, port2 } = channel()
    const recorder = new PortRecorder(port1)
    const deps: DecodeDeps = {
      open: async () => {
        throw Object.assign(new Error('UNSUPPORTED_MEDIA'), { code: 'UNSUPPORTED_MEDIA' })
      },
      emit: (event) => events.push(event),
    }
    const job = decodeAudio({ jobId: 'job-unsupported', file: new File([new Uint8Array(64)], 'not-audio.mp3'), ports: [port2] }, deps)
    await job.done
    const errorEvent = events.find((event) => event.t === 'job:error')
    expect(errorEvent && errorEvent.t === 'job:error' ? errorEvent.error.code : null).toBe('UNSUPPORTED_MEDIA')
    expect(events.some((event) => event.t === 'media:probed'), 'no project/asset on an unsupported file').toBe(false)
    expect(recorder.chunks.length).toBe(0)
  })
})

describe('CC-04.12: two-port tee and stalled-consumer backpressure', () => {
  test('CC-04.12: both ports receive byte-identical chunk sequences', async () => {
    const source = makeSource({ duration: 2.2 })
    const events: MediaWorkerEvent[] = []
    const asr = channel()
    const diarize = channel()
    const asrRecorder = new PortRecorder(asr.port1)
    const diarizeRecorder = new PortRecorder(diarize.port1)
    decodeAudio({ jobId: 'job-tee', file: file(), ports: [asr.port2, diarize.port2] }, depsFor(source, events))
    await assertDecodeContract([asrRecorder], 2.2, 'webcodecs')
    await diarizeRecorder.waitFor((recorder) => recorder.events.some((event) => event.t === 'job:done'))
    expect(diarizeRecorder.chunks.length).toBe(asrRecorder.chunks.length)
    asrRecorder.chunks.forEach((chunk, index) => {
      const other = diarizeRecorder.chunks[index]!
      expect(other.startSec).toBe(chunk.startSec)
      expect(other.samples.length).toBe(chunk.samples.length)
      expect(new Uint8Array(other.samples.buffer).every((byte, at) => byte === new Uint8Array(chunk.samples.buffer)[at]), `chunk ${index} is byte-identical`).toBe(true)
    })
  })

  test('CC-04.12: a stalled consumer pauses decode at the bounded queue of 30 chunks', async () => {
    const source = makeSource({ duration: 60, yieldEvery: 1 })
    const events: MediaWorkerEvent[] = []
    const live = channel()
    const stalledChannel = channel()
    const liveRecorder = new PortRecorder(live.port1)
    const stalledRecorder = new PortRecorder(stalledChannel.port1)
    // The stalled consumer never reads: freeze its handler immediately.
    stalledChannel.port1.onmessage = null
    const job = decodeAudio({ jobId: 'job-stall', file: file(), ports: [live.port2, stalledChannel.port2] }, depsFor(source, events))
    expect(job.queueLimit).toBe(30)
    await liveRecorder.waitFor((recorder) => recorder.chunks.length >= 30, 60_000, 'the fast port ran ahead')
    const stalledAt = await Promise.race([job.stalled, new Promise((resolve) => setTimeout(() => resolve(null), 60_000))])
    expect(stalledAt, 'decode reports the stalled port instead of buffering forever').not.toBeNull()
    // The live consumer never gets a chunk the stalled one has not accepted.
    expect(liveRecorder.chunks.length).toBeLessThanOrEqual(31)
    expect(stalledRecorder.chunks.length).toBeLessThanOrEqual(liveRecorder.chunks.length)
    job.cancel()
    await job.done
  })

})

describe('CC-04.11: handleMediaRequest + transferable plumbing', () => {
  test('CC-04.11: handleMediaRequest wires a decode request to the scope adapter', async () => {
    const source = makeSource({ duration: 1.1 })
    const events: MediaWorkerEvent[] = []
    const { port1, port2 } = channel()
    const recorder = new PortRecorder(port1)
    const posted: MediaWorkerEvent[] = []
    const job = handleMediaRequest({ t: 'decode', jobId: 'job-request', file: file(), ports: [port2] }, { postMessage: (event) => posted.push(event) }, depsFor(source, events))
    expect(job).toBeDefined()
    await assertDecodeContract([recorder], 1.1, 'webcodecs')
    expect(posted.map((event) => event.t)).toEqual(events.map((event) => event.t))
  })

  test('CC-04.11: referenceMeter is an identity meter the pipeline can poll', () => {
    const meter = referenceMeter().create()
    expect(meter.current()).toBeUndefined()
    meter.begin(42)
    const reading = meter.current()
    expect(reading?.value).toBe(42)
    expect(reading?.reference).toBe(42)
  })
})

describe('CC-04.6: decodeForPlayback streams native-rate f32 from 0 s and from a seek', () => {
  function makePlaybackSource(duration = 2) {
    const sampleRate = 44100
    const channels = 2
    const frames = Array.from({ length: channels }, () => new Float32Array(Math.round(sampleRate * duration)))
    for (let channel = 0; channel < channels; channel++) {
      for (let frame = 0; frame < frames[channel]!.length; frame++) {
        // Ramp so the start position is identifiable from the first frame.
        frames[channel]![frame] = (frame / sampleRate / duration) * 2 - 1 + channel * 0.25
      }
    }
    const track: AudioTrackLike = { number: 0, codec: 'aac', sampleRate, numberOfChannels: channels, canDecode: () => true }
    const source: MediaSourceLike = {
      getDuration: () => duration,
      audioTracks: () => [track],
      samples: async function* (): AsyncGenerator<AudioSampleLike> {
        const step = Math.round(sampleRate * 0.05)
        for (let offset = 0; offset < frames[0]!.length; offset += step) {
          const slice = frames.map((channel) => channel.subarray(offset, offset + step))
          const interleaved = new Float32Array(slice[0]!.length * channels)
          for (let frame = 0; frame < slice[0]!.length; frame++) {
            for (let channel = 0; channel < channels; channel++) interleaved[frame * channels + channel] = slice[channel]![frame]!
          }
          yield {
            timestamp: offset / sampleRate,
            sampleRate,
            numberOfFrames: slice[0]!.length,
            numberOfChannels: channels,
            samples: () => [interleaved],
          }
        }
      },
    }
    const probe: DecodeProbe = {
      container: 'mp4',
      duration,
      audioCodec: 'aac',
      videoCodec: 'h264',
      width: 320,
      height: 180,
      fps: 10,
      trackCount: 2,
      audioTrackCount: 1,
      canDecodeAudio: true,
    }
    return { source, probe }
  }

  test('CC-04.6: from 0 s streams interleaved f32 at the source rate, stereo max', async () => {
    const { source, probe } = makePlaybackSource(2)
    const events: MediaWorkerEvent[] = []
    const { port1, port2 } = channel()
    const recorder = new PortRecorder(port1)
    const job = decodeForPlayback(
      { jobId: 'pb-0', file: file(), fromSec: 0, port: port2 },
      { open: async () => ({ source, path: 'webcodecs', probe }), emit: (event) => events.push(event) },
    )
    await job.done
    expect(job.sampleRate).toBe(44100)
    expect(job.channels).toBe(2)
    expect(await job.path).toBe('webcodecs')
    expect(recorder.chunks.length).toBeGreaterThan(0)
    const first = recorder.chunks[0]!
    expect(first.startSec).toBe(0)
    // Interleaved: two channels per frame; the ramp starts at −1 (L) / −0.75 (R).
    expect(first.samples[0]).toBeCloseTo(-1, 3)
    expect(first.samples[1]).toBeCloseTo(-0.75, 3)
  })

  test('CC-04.6: a mid-file seek restarts the stream at the requested position', async () => {
    const { source, probe } = makePlaybackSource(2)
    const events: MediaWorkerEvent[] = []
    const { port1, port2 } = channel()
    const recorder = new PortRecorder(port1)
    const job = decodeForPlayback(
      { jobId: 'pb-seek', file: file(), fromSec: 1, port: port2 },
      { open: async () => ({ source, path: 'webcodecs', probe }), emit: (event) => events.push(event) },
    )
    await job.done
    expect(job.activeDecoders()).toBe(0)
    expect(recorder.chunks.length).toBeGreaterThan(0)
    const first = recorder.chunks[0]!
    expect(first.startSec, 'timeline continues at the seek point').toBeCloseTo(1, 6)
    expect(first.samples[0], 'first frame is the sample at 1 s (ramp midpoint)').toBeCloseTo(0, 2)
  })
})