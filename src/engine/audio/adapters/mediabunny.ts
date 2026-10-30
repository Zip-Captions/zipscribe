// CC-04.1/CC-04.2/CC-04.5 — the mediabunny adapter: the ONLY production
// module that touches the SDK (FR-1.0.5 engine-purity). Mirrors the harness
// adapter shape (e2e/media/fixtures/harness.ts): Input/BlobSource demux,
// AudioSampleSink → planar f32 `AudioSampleLike`s, `canDecode()` as the
// capability verdict (never the decision — `adapters/probe` decides).
//
// FFmpeg seam (FR-04.5, unit-04 slice 4D owns the real core): when WebCodecs
// cannot decode, the adapter reports the fallback via `onFallback` and
// delegates to an injected `openFfmpeg`; without one it fails with
// FFMPEG_CORE_UNAVAILABLE rather than silently pretending.

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny'
import type { AudioSampleLike, AudioTrackLike, DecodePath, DecodeProbe, MediaSourceLike } from '../decode'

export interface OpenFallbackReason {
  container: string
  codec: string
}

export interface OpenOptions {
  onFallback?: (reason: OpenFallbackReason) => void
  /** The ffmpeg.wasm path (unit-04 slice 4D). Injected so the engine core
   * never imports @ffmpeg/* (purity) and tests can stub the seam. */
  openFfmpeg?: (file: Blob, reason: OpenFallbackReason) => Promise<{ source: MediaSourceLike; path: 'ffmpeg'; probe: DecodeProbe }>
}

export interface OpenedMedia {
  source: MediaSourceLike
  path: DecodePath
  probe: DecodeProbe
}

async function videoFrameRate(track: { computeFrameRateMetrics?: () => Promise<{ bestGuessFrameRate?: number } | undefined> }): Promise<number> {
  try {
    const metrics = await track.computeFrameRateMetrics?.()
    return metrics?.bestGuessFrameRate ?? 0
  } catch {
    return 0
  }
}

export async function openMediabunny(file: Blob, options: OpenOptions = {}): Promise<OpenedMedia> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  let audioTrack: Awaited<ReturnType<Input['getPrimaryAudioTrack']>>
  let videoTrack: Awaited<ReturnType<Input['getPrimaryVideoTrack']>>
  try {
    audioTrack = await input.getPrimaryAudioTrack()
    videoTrack = await input.getPrimaryVideoTrack()
  } catch (error) {
    input.dispose()
    const name = (error as { name?: unknown } | null | undefined)?.name
    const message = error instanceof Error ? error.message : ''
    if (name === 'UnsupportedInputFormatError' || /unsupported or unrecognizable format/i.test(message)) {
      throw Object.assign(new Error('UNSUPPORTED_MEDIA'), { code: 'UNSUPPORTED_MEDIA' })
    }
    throw error
  }
  const container = await input.getMimeType()
  if (!audioTrack) {
    input.dispose()
    throw Object.assign(new Error('UNSUPPORTED_MEDIA'), { code: 'UNSUPPORTED_MEDIA' })
  }
  // Content duration: container metadata (edit lists, STREAMINFO sample
  // counts) is authoritative; packet-summed computeDuration() is the fallback
  // for header-less streams (FR-04.2 duration tolerances).
  const meta = await (audioTrack as { getDurationFromMetadata?: () => Promise<number | null> }).getDurationFromMetadata?.()
  const duration = typeof meta === 'number' && Number.isFinite(meta) && meta > 0 ? meta : await input.computeDuration()
  const decodable = await audioTrack.canDecode()
  const audioCodec = (await audioTrack.getCodec()) ?? 'unknown'
  if (!decodable) {
    input.dispose()
    const reason: OpenFallbackReason = { container, codec: audioCodec }
    options.onFallback?.(reason)
    if (!options.openFfmpeg) {
      throw Object.assign(new Error('FFMPEG_CORE_UNAVAILABLE'), { code: 'FFMPEG_CORE_UNAVAILABLE' })
    }
    return options.openFfmpeg(file, reason)
  }
  const probe: DecodeProbe = {
    container,
    duration,
    audioCodec,
    videoCodec: videoTrack ? await videoTrack.getCodec() : null,
    width: videoTrack ? await videoTrack.getDisplayWidth() : 0,
    height: videoTrack ? await videoTrack.getDisplayHeight() : 0,
    fps: videoTrack ? await videoFrameRate(videoTrack) : 0,
    trackCount: (await input.getTracks()).length,
    audioTrackCount: (await input.getAudioTracks()).length,
    canDecodeAudio: decodable,
  }
  const track: AudioTrackLike = {
    number: 0,
    codec: audioCodec,
    sampleRate: await audioTrack.getSampleRate(),
    numberOfChannels: await audioTrack.getNumberOfChannels(),
    canDecode: () => decodable,
  }
  const source: MediaSourceLike = {
    getDuration: () => duration,
    audioTracks: () => [track],
    samples: async function* (): AsyncGenerator<AudioSampleLike> {
      try {
        const sink = new AudioSampleSink(audioTrack)
        for await (const sample of sink.samples()) {
          const planes = Array.from({ length: sample.numberOfChannels }, (_, channel) => {
            const plane = new Float32Array(sample.numberOfFrames)
            sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' })
            return plane
          })
          yield {
            timestamp: sample.timestamp,
            sampleRate: sample.sampleRate,
            numberOfFrames: sample.numberOfFrames,
            numberOfChannels: sample.numberOfChannels,
            samples: () => planes,
            close: () => sample.close(),
          }
        }
      } finally {
        input.dispose()
      }
    },
  }
  return { source, path: 'webcodecs', probe }
}
