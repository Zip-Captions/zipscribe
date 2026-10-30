// Unit-04 FROZEN API CONTRACT — test-author-owned ambient module declarations.
//
// The RED-phase suite of unit-04 (Media Ingest) imports the production modules
// `src/engine/audio/{decode,resample,peaks,fingerprint,worker-core}.ts` and
// `src/engine/audio/adapters/probe.ts` through the `@engine/...` specifiers
// (vite/vitest alias → `src/engine/...`). The modules do not exist yet — that
// is the point: the tests import them and fail at *runtime* (missing
// module/exports), while `pnpm typecheck` types the tests against the
// declarations below. The builder must export exactly these names/shapes; the
// runtime assertions (not these types) are the acceptance gate. This file is
// the frozen contract, kept byte-stable by the builder.
//
// Contract types are NOT redefined here: the real `src/engine/protocol.ts` and
// `src/engine/model.ts` are pulled into this (type-only) program and re-exported
// under `@engine/protocol@04` / `@engine/model@04` so no test ever imports them
// by their bare alias (a bare `@engine/protocol` import in a Node test would
// load the real module at runtime — and vitest.config.ts aliases it).
//
// Tie-breaks recorded by the test author (see the unit report "Assumptions"):
// - `PcmChunkStream` is a FUNCTION returning an `AsyncIterable<PcmChunk>`; the
//   iterable also implements `AsyncIterator` (`next()`/`return()`) so both
//   `for await (const chunk of stream)` and `stream.next()` work.
// - `resample` is a one-shot windowed-sinc polyphase resampler. `speed` is the
//   Web Audio `playbackRate` semantic (AUDIO-DEMUXER § "Resampler design"):
//   `speed === 1` produces exactly `ceil(in.length × toRate / fromRate)`
//   samples and `out[n]` is the input at time `n / toRate`.
// - Channel downmix is NOT a separate module: it is the `channelInterpretation`
//   option of `resample` (Web Audio mixing rules), so `decode` can downmix and
//   resample in one pass ("downmix + resample", FR-04.1).

declare module '@engine/protocol@04' {
  export * from '@engine/protocol'
  export type { EngineError, EngineErrorCode, MediaEvent, MediaRequest, Notice, NoticeCode, PcmChunk, PcmSource, PeaksData } from '@engine/protocol'
}

declare module '@engine/model@04' {
  export type { MediaAsset, MediaFingerprint, Seconds } from '@engine/model'
}

declare module '@engine/audio/resample' {
  export const TARGET_SAMPLE_RATE: 16000

  /** Web Audio `ChannelInterpretation` mixing rules (speakers = the spec's default table). */
  export type ChannelInterpretation = 'speakers' | 'discrete'

  export interface ResampleOptions {
    /** Input sample rate in Hz (44100, 48000, 22050, 8000…). */
    fromRate: number
    /** Target rate; default and the decode path pin `TARGET_SAMPLE_RATE` (16000). */
    toRate?: number
    /** Input channels; default `1`. Planar layout: channel `c` is `in[n × channels + c]`. */
    channels?: number
    /** Web Audio mixing rule used for ANY channel-count change; default `'speakers'`. */
    channelInterpretation?: ChannelInterpretation
    /** Web Audio `playbackRate`-style speed factor; default `1`. */
    speed?: number
  }

  /**
   * Windowed-sinc polyphase resampler with an anti-alias low-pass at
   * `min(fromRate, toRate × speed) / 2 × 0.95` (AUDIO-DEMUXER § Resampler design).
   * Output is mono (`Float32Array`), length `ceil(in.length / channels × toRate / fromRate / max(speed, ε))`
   * for `speed === 1`, and `out[n]` is the input at time `n / toRate`.
   * Quality contract (FR-04.2, asserted at L1): a 10 kHz tone at 44.1 kHz
   * resampled to 16 kHz leaks ≤ −60 dBFS of energy at 6 kHz; a 1 kHz tone has
   * ≤ 0.1 dB passband ripple; speech at 44.1→16 kHz is within 1e-3 RMS of the
   * ffmpeg reference (`fixtures/golden/resample`).
   */
  export function resample(input: Float32Array, options: ResampleOptions): Float32Array

  /** Streaming variant: resamples finite chunks with filter state, concatenation-equivalent to one `resample()` call on the concatenated input. */
  export interface StreamingResampler {
    push(input: Float32Array): Float32Array
    flush(): Float32Array
  }

  export function createResampler(options: ResampleOptions): StreamingResampler
}

declare module '@engine/audio/resample/film' {
  export interface FilmOptions {
    fromRate: number
    toRate: number
    /** 1 = linear interpolation only. */
    channels: number
    speed?: number
  }

  /** Linear-interpolation resampler (the ffmpeg editorial resampler — AUDIO-DEMUXER § "Resampler design"): the ffmpeg.wasm fallback path's reference, NOT the shipping resampler. */
  export function resampleFilm(input: Float32Array, options: FilmOptions): Float32Array
}

declare module '@engine/audio/peaks' {
  import type { PeaksData } from '@engine/protocol'

  export const TARGET_PEAK_BUCKETS: 20_000
  export const DEFAULT_BUCKET_SEC: number

  export interface PeaksOptions {
    /** Absolute media seconds per bucket (~50 ms for ≤ 1000 s files); default derived so buckets ≤ `TARGET_PEAK_BUCKETS`. */
    bucketSec?: number
    /** Total media duration in seconds (`PeaksData.bucketSec` is authoritative for the UI). */
    duration?: number
  }

  /** Streaming min/max bundler: feed 16 kHz mono chunks, get a serializable `PeaksData` (FR-04.4). Partial trailing buckets use the samples received so far. */
  export interface PeaksAccumulator {
    push(samples: Float32Array): void
    result(): PeaksData
  }

  export function createPeaksAccumulator(options?: PeaksOptions): PeaksAccumulator

  /** One-shot form of `createPeaksAccumulator`: buckets `samples` at `sampleRate` into `bucketSec`-wide min/max pairs. */
  export function computePeaks(samples: Float32Array, options?: { sampleRate: number; bucketSec?: number; duration?: number }): PeaksData

  /** Long-file contract: `bucketSec` for a file of `durationSec` so that the bucket count never exceeds `TARGET_PEAK_BUCKETS`. */
  export function bucketSecFor(durationSec: number): number
}

declare module '@engine/audio/fingerprint' {
  import type { MediaFingerprint } from '@engine/model'

  export const FINGERPRINT_SLICE_BYTES: 65536

  /** SHA-256 of three 64 KB `File.slice` regions — first, middle, last (FR-04.8); `durationMs` is supplied by the probe. */
  export function fingerprintFile(file: Blob, durationSec: number): Promise<MediaFingerprint>
}

declare module '@engine/audio/adapters/mediabunny' {
  /** Sanity envelope for container-declared durations (unit-04 4D;
   * FR-04.2/US-1.2.4): out-of-envelope metadata is rejected in favour of
   * the packet-summed `computeDuration()`. The harness mirror imports the
   * PRODUCTION predicate so it can never serve a metadata value the
   * production adapter would reject. */
  export const METADATA_DURATION_MIN_SEC: number
  export const METADATA_DURATION_MAX_SEC: number
  export function isPlausibleDeclaredDuration(value: unknown): value is number
}

declare module '@engine/audio/adapters/probe' {
  export const ALL_FORMAT_HINTS: readonly string[]

  /** `-`-joined magic-byte signature of the bytes in `[at, at + length)`; `''` when the region is shorter. */
  export function formatSignature(bytes: Uint8Array, at: number, length: number): string

  /** Content sniff of a sample of the file (FR-04.9: never by extension alone). */
  export function sniffContainer(bytes: Uint8Array): string

  /** In-memory per-session support matrix (FR-04.6). */
  export interface SupportEntry {
    container: string
    codec: string
    supported: 'webcodecs' | 'ffmpeg' | 'none'
  }

  export interface SupportMatrix {
    probe(fileKey: string, container: string, codec: string, env: { webcodecs: boolean; ffmpeg: boolean }): SupportEntry
    entries(): SupportEntry[]
  }

  export function createSupportMatrix(): SupportMatrix
}

declare module '@engine/audio/decode' {
  import type { MediaAsset } from '@engine/model'
  import type { PcmChunk, PcmSource } from '@engine/protocol'

  /** Structural (DOM-typed) views of mediabunny / WebCodecs the core needs — all injected, never imported. */
  export interface AudioTrackLike {
    number: number
    codec: string
    sampleRate: number
    numberOfChannels: number
    /** mediabunny `track.canDecode()`; false → the adapter registers an ffmpeg custom decoder (FR-04.5). */
    canDecode(): boolean
  }

  export interface AudioSampleLike {
    /** Absolute media timestamp in seconds (selection-relative when a seek was requested). */
    timestamp: number
    sampleRate: number
    numberOfFrames: number
    numberOfChannels: number
    /** Planar f32 (`Float32Array[]`, one per channel). */
    samples(): Float32Array[]
    close?(): void
  }

  export interface MediaSourceLike {
    getDuration(): number
    audioTracks(): AudioTrackLike[]
    /** Asynchronous source of audio samples in media order (mediabunny `AudioSampleSink.samples()` per track). */
    samples(track: AudioTrackLike): AsyncIterable<AudioSampleLike>
  }

  export interface DecodeProbe {
    container: string
    duration: number
    audioCodec: string | null
    videoCodec: string | null
    width: number
    height: number
    fps: number
    trackCount: number
    audioTrackCount: number
    canDecodeAudio: boolean
  }

  export type DecodePath = 'webcodecs' | 'ffmpeg'

  export type MediaWorkerEvent =
    | { t: 'media:probed'; jobId: string; asset: MediaAsset }
    | { t: 'decode:support'; jobId: string; path: DecodePath }
    | { t: 'peaks:chunk'; jobId: string; firstBucket: number; min: Float32Array; max: Float32Array }
    | { t: 'job:progress'; jobId: string; processedSec: number; totalSec: number }
    | { t: 'job:done'; jobId: string }
    | { t: 'job:error'; jobId: string; error: import('@engine/protocol@04').EngineError }
    | { t: 'notice'; jobId?: string; notice: import('@engine/protocol@04').Notice }

  export interface DecodeDeps {
    /** Opens the file through the adapter that owns the container/codec (mediabunny or the ffmpeg custom decoder). */
    open(
      file: Blob,
      options?: { onFallback?: (reason: { container: string; codec: string }) => void },
    ): Promise<{ source: MediaSourceLike; path: DecodePath; probe: DecodeProbe }>
    emit: (event: MediaWorkerEvent) => void
    /** Injected so tests can assert zero live decoders after cancel/retry (CC-04.11). */
    onDecoder?: (track: AudioTrackLike | null) => void
  }

  export interface MeterReading {
    value: number
    reference: number
  }

  /** Identity meter factory (the builder swaps in a real meter; tests always meter identity). */
  export function referenceMeter(): { create(): { begin(reference: number): void; current(): MeterReading | undefined } }

  export interface DecodeJob {
    readonly jobId: string
    /** Fires once the adapter reports the path (`webcodecs` | `ffmpeg`). */
    readonly support: Promise<DecodePath>
    readonly probed: Promise<MediaAsset>
    /** Backpressure bound of the internal chunk queue per port (FR-04.1: 30). */
    readonly queueLimit: number
    /** Ports that fell more than `queueLimit` chunks behind — decode pauses instead of buffering. */
    readonly stalled: Promise<{ jobId: string; pendingPorts: number; chunks: number }>
    done: Promise<void>
    cancel(): void
    activeDecoders(): number
    /** Every chunk handed to the ports (test bookkeeping over the shared sink). */
    tee: { count: number }
  }

  /**
   * `decodeAudio` runs the whole pipeline in-process: probe → `media:probed`
   * → `decode:support` → 1 s `PcmChunk`s (`{startSec, samples}` with `samples.length === 16000`
   * except a final short chunk) transferred to EVERY port → `peaks:chunk`
   * events (windowed drains, ≤ 30 s per event) → `job:done`. Backpressure =
   * slowest consumer, bounded queue of 30 chunks per port.
   */
  export function decodeAudio(request: { jobId: string; file: File; ports: MessagePort[] }, deps: DecodeDeps): DecodeJob

  /**
   * FR-04.10 native-rate playback decode: interleaved f32 at the source rate,
   * `channels` = min(source, 2), starting at `fromSec` (a mid-file seek
   * restarts the same source). Emits `decode:support` then streams
   * `{startSec, samples}` messages to `port`; `cancel()` closes it.
   */
  export interface PlaybackDeps {
    open(file: Blob): Promise<{ source: MediaSourceLike; path: DecodePath; probe: DecodeProbe }>
    emit: (event: MediaWorkerEvent) => void
  }

  export interface PlaybackJob {
    readonly path: Promise<DecodePath>
    readonly sampleRate: number
    readonly channels: number
    done: Promise<void>
    cancel(): void
    activeDecoders(): number
  }

  export function decodeForPlayback(request: { jobId: string; file: File; fromSec: number; port: MessagePort }, deps: PlaybackDeps): PlaybackJob

  /** `PcmChunkStream` — async-iterable over `PcmChunk { startSec, samples }` read from a `MessagePort` (unit-05/06 consume the same). */
  export function PcmChunkStream(port: MessagePort): AsyncIterable<PcmChunk> & AsyncIterator<PcmChunk>

  /** Engine-side tee: clones every chunk to two ports (byte-identical) — the contract the worker fulfils. */
  export function teePcm(chunk: PcmChunk, ports: readonly MessagePort[]): void

  /** `MediaRequest`-shaped entry used by `src/workers/media.worker.ts` (postMessage adapter). */
  export function handleMediaRequest(
    request: import('@engine/protocol@04').MediaRequest,
    scope: { postMessage(message: MediaWorkerEvent, transfer?: Transferable[]): void },
    deps: DecodeDeps,
  ): DecodeJob | PlaybackJob | undefined

  /** `PcmSource` helper for the transfer path (unit-05). */
  export function transferSource(buffer: ArrayBuffer): PcmSource
}

declare module '@engine/audio/worker-core' {
  export type { AudioSampleLike, AudioTrackLike, DecodeDeps, DecodeJob, DecodePath, DecodeProbe, MediaSourceLike, MediaWorkerEvent, MeterReading, PlaybackDeps, PlaybackJob } from '@engine/audio/decode'
  export {
    PcmChunkStream,
    decodeAudio,
    decodeForPlayback,
    handleMediaRequest,
    referenceMeter,
    teePcm,
    transferSource,
  } from '@engine/audio/decode'
}

declare module '@engine/audio/worker-core@ref' {
  export interface RefMessage {
    t: 'chunk' | 'done' | 'error' | 'cancelled'
    jobId: string
  }

  /**
   * Reference MessagePort pair for Node tests: a connected port pair plus a
   * recorder, so the suite exercises the real `postMessage`/transfer/
   * backpressure contract without a browser. Both ends are closed by `close()`.
   */
  export interface CreateMessageChannel {
    port1: MessagePort
    port2: MessagePort
    /** Messages received on `port1` (transferred arrays arrive as real `Float32Array`). */
    received: RefMessage[]
    /** Backpressure probe: messages still buffered on `port1`. */
    buffered(port: MessagePort): number
    close(): void
  }

  export function createMessageChannel(): CreateMessageChannel
}