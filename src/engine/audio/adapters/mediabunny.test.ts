// Unit-04 slice 4D — L1 guard on the metadata-first duration rule
// (src/engine/audio/adapters/mediabunny.ts). Regression: fmt-30s.weba carried a
// randomised Matroska Duration element (0x4489 — mislabelled DateUTC in the
// fixture recipe) and the old `Number.isFinite(v) && v > 0` rule served
// 1.99e-195 s as the declared duration, poisoning progress/totalSec. The
// envelope keeps a healthy container's own metadata (the fast path) while
// implausible values fall through to `computeDuration()`.
//
// Unit-04 adversary F-3 (A-06): `openMediabunny` itself was executed by NO
// shipped test — the production module sat behind the frozen harness's inlined
// mirror, so flipping `path: 'webcodecs'` to `'ffmpeg'` at the return of the
// native open stayed green everywhere. The `mediabunny` SDK boundary below is
// the stubbed seam (per AGENTS.md, SDK imports live only in adapters/workers —
// the SDK itself is the mocked boundary); every branch of the REAL adapter —
// path labelling, probe assembly, duration envelope, fallback delegation and
// error taxonomy — is production code here.

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { isPlausibleDeclaredDuration, METADATA_DURATION_MAX_SEC, METADATA_DURATION_MIN_SEC, openMediabunny } from './mediabunny'
import type { MediaSourceLike, DecodeProbe } from '../decode'

interface FakeSdkSample {
  timestamp: number
  sampleRate: number
  numberOfFrames: number
  numberOfChannels: number
  planes: Float32Array[]
  copies: { planeIndex: number; format: string }[]
  closed: { count: number }
}

interface SdkState {
  config: null | {
    throwOnGetTracks?: Error
    audio: null | {
      canDecode: boolean
      codec: string
      sampleRate: number
      channels: number
      metadataDuration?: number | null
      samples?: FakeSdkSample[]
    }
    video: null | {
      codec: string
      width: number
      height: number
      fps?: number
      fpsThrows?: boolean
    }
    mimeType: string
    computedDuration: number
    trackCount: number
    audioTrackCount: number
  }
  disposed: number
  inputs: number
  blobSources: unknown[]
  sinkTrack: unknown
}

const sdk = vi.hoisted((): SdkState => ({
  config: null,
  disposed: 0,
  inputs: 0,
  blobSources: [],
  sinkTrack: null,
}))

type SdkAudio = NonNullable<NonNullable<SdkState['config']>['audio']>
type SdkVideo = NonNullable<NonNullable<SdkState['config']>['video']>

vi.mock('mediabunny', () => {
  class FakeAudioTrack {
    private readonly spec: SdkAudio
    constructor(spec: SdkAudio) {
      this.spec = spec
    }
    canDecode() {
      return this.spec.canDecode
    }
    getCodec() {
      return this.spec.codec
    }
    getSampleRate() {
      return this.spec.sampleRate
    }
    getNumberOfChannels() {
      return this.spec.channels
    }
    getDurationFromMetadata() {
      return this.spec.metadataDuration ?? null
    }
  }
  class FakeVideoTrack {
    private readonly spec: SdkVideo
    constructor(spec: SdkVideo) {
      this.spec = spec
    }
    getCodec() {
      return this.spec.codec
    }
    getDisplayWidth() {
      return this.spec.width
    }
    getDisplayHeight() {
      return this.spec.height
    }
    computeFrameRateMetrics() {
      if (this.spec.fpsThrows) return Promise.reject(new Error('frame-rate metrics failed'))
      return { bestGuessFrameRate: this.spec.fps ?? 0 }
    }
  }
  class Input {
    readonly options: unknown
    constructor(options: unknown) {
      this.options = options
      sdk.inputs += 1
    }
    getPrimaryAudioTrack() {
      if (sdk.config?.throwOnGetTracks) throw sdk.config.throwOnGetTracks
      return sdk.config?.audio ? new FakeAudioTrack(sdk.config.audio) : null
    }
    getPrimaryVideoTrack() {
      return sdk.config?.video ? new FakeVideoTrack(sdk.config.video) : null
    }
    getMimeType() {
      if (sdk.config?.throwOnGetTracks) throw sdk.config.throwOnGetTracks
      return sdk.config?.mimeType ?? 'audio/wav'
    }
    computeDuration() {
      return sdk.config?.computedDuration ?? 0
    }
    getTracks() {
      return Array.from({ length: sdk.config?.trackCount ?? 0 }, (_, index) => ({ index }))
    }
    getAudioTracks() {
      return Array.from({ length: sdk.config?.audioTrackCount ?? 0 }, (_, index) => ({ index }))
    }
    dispose() {
      sdk.disposed += 1
    }
  }
  return {
    ALL_FORMATS: { fake: true },
    BlobSource: class {
      readonly blob: unknown
      constructor(blob: unknown) {
        this.blob = blob
        sdk.blobSources.push(blob)
      }
    },
    AudioSampleSink: class {
      readonly track: unknown
      constructor(track: unknown) {
        this.track = track
        sdk.sinkTrack = track
      }
      *samples() {
        for (const sample of sdk.config?.audio?.samples ?? []) {
          yield {
            timestamp: sample.timestamp,
            sampleRate: sample.sampleRate,
            numberOfFrames: sample.numberOfFrames,
            numberOfChannels: sample.numberOfChannels,
            copyTo: (plane: Float32Array, options: { planeIndex: number; format: string }) => {
              sample.copies.push(options)
              plane.set(sample.planes[options.planeIndex] ?? new Float32Array(sample.numberOfFrames))
            },
            close: () => {
              sample.closed.count += 1
            },
          }
        }
      }
    },
    Input,
  }
})

function resetSdk(overrides: Partial<NonNullable<(typeof sdk)['config']>> = {}): void {
  sdk.disposed = 0
  sdk.inputs = 0
  sdk.blobSources = []
  sdk.sinkTrack = null
  sdk.config = {
    audio: { canDecode: true, codec: 'mp4a.40.2', sampleRate: 48_000, channels: 2 },
    video: null,
    mimeType: 'audio/mp4',
    computedDuration: 30,
    trackCount: 1,
    audioTrackCount: 1,
    ...overrides,
  }
}

function fakeSample(timestamp: number, channels: number, frames = 1_024): FakeSdkSample {
  return {
    timestamp,
    sampleRate: 48_000,
    numberOfFrames: frames,
    numberOfChannels: channels,
    planes: Array.from({ length: channels }, (_, channel) => Float32Array.from({ length: frames }, (_, index) => (index + channel) / frames)),
    copies: [],
    closed: { count: 0 },
  }
}

beforeEach(() => resetSdk())

describe('isPlausibleDeclaredDuration (unit-04 4D sanity envelope)', () => {
  test('accepts real-world durations at the envelope edges', () => {
    expect(isPlausibleDeclaredDuration(30)).toBe(true)
    expect(isPlausibleDeclaredDuration(METADATA_DURATION_MIN_SEC)).toBe(true)
    expect(isPlausibleDeclaredDuration(METADATA_DURATION_MAX_SEC)).toBe(true)
  })

  test('rejects the weba-regression value and every non-positive / non-finite shape', () => {
    expect(isPlausibleDeclaredDuration(1.9915549954142635e-195)).toBe(false)
    expect(isPlausibleDeclaredDuration(0)).toBe(false)
    expect(isPlausibleDeclaredDuration(-30)).toBe(false)
    expect(isPlausibleDeclaredDuration(Number.NaN)).toBe(false)
    expect(isPlausibleDeclaredDuration(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isPlausibleDeclaredDuration(Number.MAX_VALUE)).toBe(false)
  })

  test('rejects non-numbers (undefined metadata ⇒ computeDuration fallback)', () => {
    expect(isPlausibleDeclaredDuration(undefined)).toBe(false)
    expect(isPlausibleDeclaredDuration(null)).toBe(false)
    expect(isPlausibleDeclaredDuration('30')).toBe(false)
  })
})

describe('openMediabunny (adversary F-3/A-06: the real adapter open, path labelling and fallback delegation)', () => {
  test('a natively decodable asset opens with path "webcodecs" and the metadata-authoritative probe', async () => {
    resetSdk({ audio: { canDecode: true, codec: 'mp4a.40.2', sampleRate: 48_000, channels: 2, metadataDuration: 30.004 }, mimeType: 'audio/mp4', computedDuration: 999, trackCount: 1, audioTrackCount: 1 })
    const file = new Blob([new Uint8Array(64)])
    const opened = await openMediabunny(file)

    // A-06 kill: the native path label is produced HERE — flipping the
    // literal at mediabunny.ts's return fails this assertion.
    expect(opened.path, 'canDecode()==true opens must be labelled webcodecs').toBe('webcodecs')
    const probe: DecodeProbe = opened.probe
    expect(probe).toMatchObject({
      container: 'audio/mp4',
      duration: 30.004, // in-envelope container metadata is authoritative (999 ignored)
      audioCodec: 'mp4a.40.2',
      videoCodec: null,
      width: 0,
      height: 0,
      fps: 0,
      trackCount: 1,
      audioTrackCount: 1,
      canDecodeAudio: true,
    })
    expect(sdk.inputs, 'a real Input was constructed from the file').toBe(1)
    expect(sdk.blobSources).toEqual([file])
    expect(opened.source.getDuration()).toBe(30.004)
    const track = opened.source.audioTracks()[0]!
    expect(track).toMatchObject({ number: 0, codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2 })
    expect(track.canDecode()).toBe(true)
  })

  test('implausible declared duration falls through to computeDuration()', async () => {
    resetSdk({ audio: { canDecode: true, codec: 'opus', sampleRate: 48_000, channels: 1, metadataDuration: 1.9915549954142635e-195 }, mimeType: 'audio/webm', computedDuration: 30 })
    const opened = await openMediabunny(new Blob([new Uint8Array(16)]))
    expect(opened.path).toBe('webcodecs')
    expect(opened.probe.duration).toBe(30)
  })

  test('samples() yields planar f32 AudioSampleLikes per channel and closes the SDK sample', async () => {
    const first = fakeSample(0, 2)
    const second = fakeSample(1024 / 48_000, 2)
    resetSdk({ audio: { canDecode: true, codec: 'opus', sampleRate: 48_000, channels: 2, samples: [first, second] } })
    const opened = await openMediabunny(new Blob([new Uint8Array(8)]))
    const yielded = []
    for await (const sample of opened.source.samples(opened.source.audioTracks()[0]!)) {
      yielded.push(sample)
      sample.close?.()
    }
    expect(yielded.map((sample) => sample.timestamp)).toEqual([0, 1024 / 48_000])
    expect(yielded[0]!.numberOfChannels).toBe(2)
    expect(yielded[0]!.numberOfFrames).toBe(1_024)
    const planes = yielded[0]!.samples()
    expect(planes).toHaveLength(2)
    expect(Array.from(planes[1]!.slice(0, 3))).toEqual(Array.from(first.planes[1]!.slice(0, 3)))
    expect(first.copies).toEqual([
      { planeIndex: 0, format: 'f32-planar' },
      { planeIndex: 1, format: 'f32-planar' },
    ])
    expect(first.closed.count).toBe(1)
    expect(sdk.disposed, 'full iteration disposes the Input (finally path)').toBe(1)
  })

  test('video track metadata flows into the probe; frame-rate metrics failure degrades to 0 fps', async () => {
    resetSdk({ audio: { canDecode: true, codec: 'aac', sampleRate: 44_100, channels: 2 }, video: { codec: 'avc1.42E01E', width: 1280, height: 720, fps: 29.97 }, mimeType: 'video/mp4', trackCount: 2, audioTrackCount: 1 })
    const opened = await openMediabunny(new Blob())
    expect(opened.probe).toMatchObject({ videoCodec: 'avc1.42E01E', width: 1280, height: 720, fps: 29.97, trackCount: 2 })

    resetSdk({ audio: { canDecode: true, codec: 'aac', sampleRate: 44_100, channels: 2 }, video: { codec: 'avc1', width: 640, height: 360, fpsThrows: true } })
    const degraded = await openMediabunny(new Blob())
    expect(degraded.probe.fps, 'frame-rate metrics throwing must not fail the open — degrade to 0').toBe(0)
  })

  test('an unparseable container is UNSUPPORTED_MEDIA by error name AND by message, and disposes the input', async () => {
    resetSdk({ throwOnGetTracks: Object.assign(new Error('whatever'), { name: 'UnsupportedInputFormatError' }) })
    await expect(openMediabunny(new Blob())).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' })
    expect(sdk.disposed).toBe(1)

    resetSdk({ throwOnGetTracks: new Error('The file is an unsupported or unrecognizable format') })
    await expect(openMediabunny(new Blob())).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' })

    resetSdk({ throwOnGetTracks: new Error('boom unrelated') })
    await expect(openMediabunny(new Blob())).rejects.toThrow(/boom unrelated/)
  })

  test('a container without any audio track is UNSUPPORTED_MEDIA', async () => {
    resetSdk({ audio: null })
    await expect(openMediabunny(new Blob())).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' })
    expect(sdk.disposed).toBe(1)
  })

  test('canDecode()==false reports the fallback and delegates to openFfmpeg — producing the ffmpeg path', async () => {
    resetSdk({ audio: { canDecode: false, codec: 'alac', sampleRate: 44_100, channels: 2 }, mimeType: 'audio/mp4' })
    const ffmpegSource = { getDuration: () => 3, audioTracks: () => [], samples: async function* () {} } satisfies MediaSourceLike
    const ffmpegProbe: DecodeProbe = { container: 'audio/mp4', duration: 3, audioCodec: 'alac', videoCodec: null, width: 0, height: 0, fps: 0, trackCount: 1, audioTrackCount: 1, canDecodeAudio: false }
    const openFfmpeg = vi.fn((_file: Blob, _reason: { container: string; codec: string }) => Promise.resolve({ source: ffmpegSource, path: 'ffmpeg' as const, probe: ffmpegProbe }))
    const onFallback = vi.fn()
    const file = new Blob([new Uint8Array(32)])

    const opened = await openMediabunny(file, { onFallback, openFfmpeg })
    expect(opened).toEqual({ source: ffmpegSource, path: 'ffmpeg', probe: ffmpegProbe })
    expect(onFallback).toHaveBeenCalledWith({ container: 'audio/mp4', codec: 'alac' })
    expect(openFfmpeg).toHaveBeenCalledTimes(1)
    expect(openFfmpeg.mock.calls[0]![0]).toBe(file)
    expect(openFfmpeg.mock.calls[0]![1]).toEqual({ container: 'audio/mp4', codec: 'alac' })
    expect(sdk.disposed, 'the mediabunny input is disposed before delegating').toBe(1)
  })

  test('a negative capability probe with no ffmpeg seam fails FFMPEG_CORE_UNAVAILABLE — never a silent fake', async () => {
    resetSdk({ audio: { canDecode: false, codec: 'alac', sampleRate: 44_100, channels: 2 }, mimeType: 'audio/mp4' })
    const onFallback = vi.fn()
    await expect(openMediabunny(new Blob(), { onFallback })).rejects.toMatchObject({ code: 'FFMPEG_CORE_UNAVAILABLE' })
    expect(onFallback, 'the fallback is reported even when no seam exists').toHaveBeenCalledOnce()
    expect(sdk.disposed).toBe(1)
  })
})
