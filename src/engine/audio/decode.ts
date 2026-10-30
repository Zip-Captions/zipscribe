// CC-04.1/04.2/04.11/04.12 — the decode pipeline behind `worker-core`:
// probe → `media:probed` → `decode:support` → 1 s `PcmChunk`s handed to EVERY
// port (byte-identical tee) → windowed `peaks:chunk` drains → `job:done`;
// cancel/retry never leaves a decoder live; a stalled consumer pauses the
// decode at a bounded queue of 30 chunks per port (FR-04.1, US-1.2.5).
//
// Engine purity: every SDK surface (mediabunny/WebCodecs/ffmpeg) arrives
// through the injected `DecodeDeps.open` seam — this module imports neither
// the SDK nor any DOM global (conventions § Architecture rules). The frozen
// shapes are the ambient contract `tests/unit/media/unit04-api-contract.d.ts`.

import { TARGET_SAMPLE_RATE, createResampler } from './resample'
import { createPeaksAccumulator } from './peaks'
import { fingerprintFile } from './fingerprint'
import type { MediaAsset, MediaFingerprint } from '../model'
import type { EngineError, EngineErrorCode, MediaRequest, Notice, PcmChunk, PcmSource } from '../protocol'

// --- frozen structural seams (injected by the adapters; never imported) ----

export interface AudioTrackLike {
  number: number
  codec: string
  sampleRate: number
  numberOfChannels: number
  canDecode(): boolean
}

export interface AudioSampleLike {
  timestamp: number
  sampleRate: number
  numberOfFrames: number
  numberOfChannels: number
  samples(): Float32Array[]
  close?(): void
}

export interface MediaSourceLike {
  getDuration(): number
  audioTracks(): AudioTrackLike[]
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
  | { t: 'job:error'; jobId: string; error: EngineError }
  | { t: 'notice'; jobId?: string; notice: Notice }

export interface DecodeDeps {
  open(file: Blob, options?: { onFallback?: (reason: { container: string; codec: string }) => void }): Promise<{ source: MediaSourceLike; path: DecodePath; probe: DecodeProbe }>
  emit: (event: MediaWorkerEvent) => void
  onDecoder?: (track: AudioTrackLike | null) => void
}

export interface MeterReading {
  value: number
  reference: number
}

export interface DecodeJob {
  readonly jobId: string
  readonly support: Promise<DecodePath>
  readonly probed: Promise<MediaAsset>
  readonly queueLimit: number
  readonly stalled: Promise<{ jobId: string; pendingPorts: number; chunks: number }>
  done: Promise<void>
  cancel(): void
  activeDecoders(): number
  tee: { count: number }
}

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

// --- constants ---------------------------------------------------------------

/** Backpressure bound per port (FR-04.1: a slow consumer pauses the decode). */
const QUEUE_LIMIT = 30
/** Samples per chunk: 1 s at the 16 kHz engine rate (protocol.ts PcmChunk). */
const CHUNK_SAMPLES = TARGET_SAMPLE_RATE
/** Grace before a never-confirming consumer (real MessagePort — no ack
 * protocol exists on the happy path) is treated as uncooperative: the gate
 * releases rather than stalling a healthy decode forever. */
const GATE_GRACE_MS = 750
/** In cooperative mode (at least one confirmation observed), a gated port
 * that makes no progress for this long is released so a non-acking consumer
 * cannot deadlock the decode; `stalled` has already reported it. */
const PORT_STALL_MS = 8_000

// --- error mapping (SECURITY-03: codes/numbers only, never message text) ----

const ENGINE_ERROR_CODES = new Set<string>([
  'MODEL_UNLOADED',
  'CACHE_CORRUPT',
  'NETWORK',
  'QUOTA_EXCEEDED',
  'GPU_OOM',
  'SESSION_LOST',
  'DECODE_STALL',
  'DIAR_SESSION_LOST',
  'UNSUPPORTED_MEDIA',
  'FFMPEG_REQUIRED',
  'ENCODER_UNSUPPORTED',
  'CANCELLED',
  'ENGINE_INTERNAL',
])

function toEngineError(error: unknown): EngineError {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (code === 'FFMPEG_CORE_UNAVAILABLE' || code === 'FFMPEG_REQUIRED') {
    return { code: 'FFMPEG_REQUIRED', retryable: true, detail: `code=${String(code)}` }
  }
  if (typeof code === 'string' && ENGINE_ERROR_CODES.has(code)) {
    const mapped = code as EngineErrorCode
    return { code: mapped, retryable: mapped !== 'UNSUPPORTED_MEDIA' }
  }
  // Shape-match the demuxer's 'no such file' error when the adapter rethrows
  // it unlabelled (the frozen harness adapter does): an unrecognizable
  // container is UNSUPPORTED_MEDIA, never an internal fault.
  const name = (error as { name?: unknown } | null | undefined)?.name
  const message = error instanceof Error ? error.message : ''
  if (name === 'UnsupportedInputFormatError' || /unsupported or unrecognizable format/i.test(message)) {
    return { code: 'UNSUPPORTED_MEDIA', retryable: false }
  }
  return { code: 'ENGINE_INTERNAL', retryable: true, detail: `code=${typeof code === 'string' ? code : 'unknown'}` }
}

function newAssetId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `asset-${Date.now().toString(36)}`
}

function buildAsset(name: string, probe: DecodeProbe, fingerprint: MediaFingerprint): MediaAsset {
  const isVideo = probe.videoCodec !== null && probe.width > 0 && probe.height > 0
  return {
    id: newAssetId(),
    name,
    kind: isVideo ? 'video' : 'audio',
    container: probe.container,
    audioCodec: probe.audioCodec,
    videoCodec: probe.videoCodec,
    duration: probe.duration,
    width: isVideo ? probe.width : 0,
    height: isVideo ? probe.height : 0,
    fps: isVideo ? probe.fps : 0,
    fingerprint,
  }
}

/** Planar → interleaved for the resampler (`in[n × channels + c]`); a single
 * plane wider than the frame count is already interleaved and passes through.
 * `frameOffset`/`usable` trim the head of a sample that straddles t = 0
 * (encoder priming delivered with a negative timestamp). */
function interleaveForFeed(sample: AudioSampleLike, frameOffset = 0, usable = sample.numberOfFrames): Float32Array {
  const planes = sample.samples()
  const channels = sample.numberOfChannels
  if (channels <= 1) return (planes[0] ?? new Float32Array(0)).subarray(frameOffset, frameOffset + usable)
  if (planes.length >= channels) {
    const out = new Float32Array(usable * channels)
    for (let frame = 0; frame < usable; frame++) {
      for (let channel = 0; channel < channels; channel++) out[frame * channels + channel] = planes[channel]![frameOffset + frame]!
    }
    return out
  }
  return (planes[0] ?? new Float32Array(0)).subarray(frameOffset * channels, (frameOffset + usable) * channels)
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

// --- decodeAudio -------------------------------------------------------------

export function decodeAudio(request: { jobId: string; file: File; ports: MessagePort[] }, deps: DecodeDeps): DecodeJob {
  const { jobId, file, ports } = request
  let cancelled = false
  let active = 0
  let everConfirmed = false
  let gateEntered = 0
  let stalledReported = false
  let fallbackNoticed = false
  const pending: number[] = ports.map(() => 0)
  const released: boolean[] = ports.map(() => false)
  const tee = { count: 0 }

  let resolveSupport!: (path: DecodePath) => void
  const support = new Promise<DecodePath>((resolve) => (resolveSupport = resolve))
  let resolveProbed!: (asset: MediaAsset) => void
  const probed = new Promise<MediaAsset>((resolve) => (resolveProbed = resolve))
  let resolveStalled!: (value: { jobId: string; pendingPorts: number; chunks: number }) => void
  const stalled = new Promise<{ jobId: string; pendingPorts: number; chunks: number }>((resolve) => (resolveStalled = resolve))
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => (resolveDone = resolve))

  let wakeResolvers: (() => void)[] = []
  const wake = (): void => {
    for (const resolve of wakeResolvers.splice(0)) resolve()
  }
  const sleep = (ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        wakeResolvers = wakeResolvers.filter((candidate) => candidate !== finish)
        resolve(true)
      }
      const timer = setTimeout(() => {
        wakeResolvers = wakeResolvers.filter((candidate) => candidate !== finish)
        resolve(false)
      }, ms)
      wakeResolvers.push(finish)
    })

  const send = (event: MediaWorkerEvent): void => {
    deps.emit(event)
    for (const port of ports) port.postMessage(event)
  }

  // Consumer-side flow signals: `{t:'ack'}` from the harness reader protocol,
  // or the reference channel's delivery receipt (Node). Either confirms ONE
  // queued message was consumed on that port.
  for (let index = 0; index < ports.length; index++) {
    const port = ports[index]!
    port.onmessage = (event: { data: unknown }) => {
      const data = event.data as { t?: unknown; __zReceipt?: unknown } | null
      if (data === null || typeof data !== 'object') return
      if (data.t === 'ack' || typeof data.__zReceipt === 'number' || data.__zReceipt === true) {
        everConfirmed = true
        if ((pending[index] ?? 0) > 0) pending[index] = (pending[index] ?? 0) - 1
        wake()
      }
    }
    port.start?.()
  }

  async function gate(): Promise<void> {
    for (;;) {
      if (cancelled) return
      const blocked: number[] = []
      for (let index = 0; index < ports.length; index++) if (!released[index] && (pending[index] ?? 0) >= QUEUE_LIMIT) blocked.push(index)
      if (blocked.length === 0) return
      if (gateEntered === 0) gateEntered = Date.now()
      if (!everConfirmed) {
        // No ack protocol on this transport (real MessagePort fast path):
        // give the consumers the grace window, then run unbounded rather
        // than stalling a healthy decode.
        if (Date.now() - gateEntered >= GATE_GRACE_MS) {
          for (let index = 0; index < released.length; index++) released[index] = true
          return
        }
        await sleep(25)
        continue
      }
      if (!stalledReported) {
        stalledReported = true
        resolveStalled({ jobId, pendingPorts: blocked.length, chunks: tee.count })
      }
      const progressed = await sleep(PORT_STALL_MS)
      if (!progressed) for (const index of blocked) released[index] = true
    }
  }

  async function run(): Promise<void> {
    let iterator: AsyncIterator<AudioSampleLike> | undefined
    let iteratorActive = false
    try {
      let opened: Awaited<ReturnType<DecodeDeps['open']>>
      try {
        opened = await deps.open(file, {
          onFallback: (reason) => {
            fallbackNoticed = true
            send({ t: 'notice', jobId, notice: { code: 'FFMPEG_FALLBACK', params: { container: reason.container, codec: reason.codec } } })
          },
        })
      } catch (error) {
        send({ t: 'job:error', jobId, error: toEngineError(error) })
        return
      }
      if (cancelled) {
        send({ t: 'job:error', jobId, error: { code: 'CANCELLED', retryable: true } })
        return
      }
      if (opened.path === 'ffmpeg' && !fallbackNoticed) {
        fallbackNoticed = true
        send({ t: 'notice', jobId, notice: { code: 'FFMPEG_FALLBACK', params: { container: opened.probe.container, codec: opened.probe.audioCodec ?? 'unknown' } } })
      }
      const fingerprint = await fingerprintFile(file, opened.probe.duration)
      const asset = buildAsset(file.name ?? '', opened.probe, fingerprint)
      send({ t: 'media:probed', jobId, asset })
      resolveProbed(asset)
      send({ t: 'decode:support', jobId, path: opened.path })
      resolveSupport(opened.path)
      if (opened.probe.audioTrackCount > 1) {
        send({ t: 'notice', jobId, notice: { code: 'MULTI_TRACK', params: { tracks: opened.probe.audioTrackCount } } })
      }
      const track = opened.source.audioTracks()[0]
      if (!track) {
        send({ t: 'job:error', jobId, error: { code: 'UNSUPPORTED_MEDIA', retryable: false } })
        return
      }
      active = 1
      deps.onDecoder?.(track)
      const iteratorSource = opened.source.samples(track)[Symbol.asyncIterator]()
      iterator = iteratorSource
      iteratorActive = true
      const resampler = createResampler({ fromRate: track.sampleRate, toRate: TARGET_SAMPLE_RATE, channels: track.numberOfChannels })
      const peaks = createPeaksAccumulator()
      const bucketSamples = Math.max(1, Math.round(peaks.result().bucketSec * TARGET_SAMPLE_RATE))

      const carry: Float32Array[] = []
      let carryTotal = 0
      let peaked = 0
      let emittedBuckets = 0
      let progressSec = 0

      const drainPeaks = (final: boolean): void => {
        const snapshot = peaks.result()
        const complete = final ? snapshot.min.length : Math.floor(peaked / bucketSamples)
        if (complete > emittedBuckets) {
          send({ t: 'peaks:chunk', jobId, firstBucket: emittedBuckets, min: snapshot.min.slice(emittedBuckets, complete), max: snapshot.max.slice(emittedBuckets, complete) })
          emittedBuckets = complete
        }
      }

      const handOff = async (samples: Float32Array): Promise<void> => {
        await gate()
        if (cancelled) return
        peaks.push(samples)
        peaked += samples.length
        for (let index = 0; index < ports.length; index++) {
          const copy = samples.slice()
          pending[index] = (pending[index] ?? 0) + 1
          ports[index]!.postMessage({ startSec: tee.count, samples: copy }, [copy.buffer as Transferable])
        }
        tee.count += 1
        send({ t: 'job:progress', jobId, processedSec: progressSec, totalSec: opened.probe.duration })
        drainPeaks(false)
        await macrotask()
      }

      const pump = async (flush: boolean): Promise<void> => {
        while (carryTotal >= CHUNK_SAMPLES && !cancelled) {
          const chunk = new Float32Array(CHUNK_SAMPLES)
          let need = CHUNK_SAMPLES
          while (need > 0) {
            const head = carry[0]!
            if (head.length <= need) {
              chunk.set(head, CHUNK_SAMPLES - need)
              need -= head.length
              carry.shift()
            } else {
              chunk.set(head.subarray(0, need), CHUNK_SAMPLES - need)
              carry[0] = head.subarray(need)
              need = 0
            }
          }
          carryTotal -= CHUNK_SAMPLES
          await handOff(chunk)
        }
        if (flush && !cancelled && carryTotal > 0) {
          const rest = new Float32Array(carryTotal)
          let at = 0
          for (const segment of carry) {
            rest.set(segment, at)
            at += segment.length
          }
          carry.length = 0
          carryTotal = 0
          await handOff(rest)
        }
      }

      for (;;) {
        if (cancelled) break
        const next = await iteratorSource.next()
        if (next.done) break
        const sample = next.value
        // Timestamp-anchored placement: container edit lists surface encoder
        // priming as samples with NEGATIVE timestamps — drop what ends at or
        // before t = 0 and clip the straddling sample so the 16 kHz timeline
        // starts at content zero, not at decoder priming (FR-04.2: 'encoder
        // priming/padding is compensated, so captions don't drift').
        const sampleEnd = sample.timestamp + sample.numberOfFrames / sample.sampleRate
        if (sampleEnd <= 0) {
          sample.close?.()
          continue
        }
        const frameOffset = Math.max(0, -Math.round(sample.timestamp * sample.sampleRate))
        const usable = sample.numberOfFrames - frameOffset
        if (usable <= 0) {
          sample.close?.()
          continue
        }
        const feed = interleaveForFeed(sample, frameOffset, usable)
        const out = resampler.push(feed)
        progressSec = sampleEnd
        sample.close?.()
        if (out.length > 0) {
          carry.push(out)
          carryTotal += out.length
        }
        await pump(false)
      }
      if (!cancelled) {
        const tail = resampler.flush()
        if (tail.length > 0) {
          carry.push(tail)
          carryTotal += tail.length
        }
        await pump(true)
      }
      if (cancelled) {
        send({ t: 'job:error', jobId, error: { code: 'CANCELLED', retryable: true } })
      } else {
        drainPeaks(true)
        send({ t: 'job:progress', jobId, processedSec: opened.probe.duration, totalSec: opened.probe.duration })
        send({ t: 'job:done', jobId })
      }
    } catch (error) {
      if (cancelled) send({ t: 'job:error', jobId, error: { code: 'CANCELLED', retryable: true } })
      else send({ t: 'job:error', jobId, error: toEngineError(error) })
    } finally {
      if (iteratorActive) {
        try {
          await iterator?.return?.()
        } catch {
          // the source's own teardown must not mask the decode outcome
        }
      }
      active = 0
      deps.onDecoder?.(null)
      for (const port of ports) port.onmessage = null
      wake()
      resolveDone()
    }
  }

  void run()

  return {
    jobId,
    support,
    probed,
    queueLimit: QUEUE_LIMIT,
    stalled,
    done,
    cancel() {
      cancelled = true
      wake()
    },
    activeDecoders() {
      return active
    },
    tee,
  }
}

// --- decodeForPlayback (CC-04.6) ---------------------------------------------

export function decodeForPlayback(request: { jobId: string; file: File; fromSec: number; port: MessagePort }, deps: PlaybackDeps): PlaybackJob {
  const { jobId, file, fromSec, port } = request
  let cancelled = false
  let active = 0
  let sampleRate = 0
  let channels = 0
  let resolvePath!: (path: DecodePath) => void
  const path = new Promise<DecodePath>((resolve) => (resolvePath = resolve))
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => (resolveDone = resolve))

  async function run(): Promise<void> {
    let iterator: AsyncIterator<AudioSampleLike> | undefined
    try {
      let opened: Awaited<ReturnType<PlaybackDeps['open']>>
      try {
        opened = await deps.open(file)
      } catch (error) {
        deps.emit({ t: 'job:error', jobId, error: toEngineError(error) })
        return
      }
      const track = opened.source.audioTracks()[0]
      if (!track) {
        deps.emit({ t: 'job:error', jobId, error: { code: 'UNSUPPORTED_MEDIA', retryable: false } })
        return
      }
      sampleRate = track.sampleRate
      channels = Math.min(track.numberOfChannels, 2)
      deps.emit({ t: 'decode:support', jobId, path: opened.path })
      resolvePath(opened.path)
      const iteratorSource = opened.source.samples(track)[Symbol.asyncIterator]()
      iterator = iteratorSource
      active = 1
      const sourceChannels = track.numberOfChannels
      const chunkFrames = sampleRate
      const carry: Float32Array[] = []
      let carryTotal = 0
      let absoluteFrame = 0
      let positioned = false

      const flushChunk = (): void => {
        const chunkFloats = chunkFrames * channels
        while (carryTotal >= chunkFrames) {
          const chunk = new Float32Array(chunkFloats)
          let need = chunkFloats
          while (need > 0) {
            const head = carry[0]!
            if (head.length <= need) {
              chunk.set(head, chunkFloats - need)
              need -= head.length
              carry.shift()
            } else {
              chunk.set(head.subarray(0, need), chunkFloats - need)
              carry[0] = head.subarray(need)
              need = 0
            }
          }
          carryTotal -= chunkFrames
          const copy = chunk.slice()
          port.postMessage({ startSec: absoluteFrame / sampleRate, samples: copy }, [copy.buffer as Transferable])
          absoluteFrame += chunkFrames
        }
      }

      for (;;) {
        if (cancelled) break
        const next = await iteratorSource.next()
        if (next.done) break
        const sample = next.value
        const sampleEnd = sample.timestamp + sample.numberOfFrames / sample.sampleRate
        if (sampleEnd <= fromSec) {
          sample.close?.()
          continue
        }
        const frameOffset = Math.max(0, Math.round((fromSec - sample.timestamp) * sample.sampleRate))
        const usable = sample.numberOfFrames - frameOffset
        if (usable <= 0) {
          sample.close?.()
          continue
        }
        if (!positioned) {
          positioned = true
          absoluteFrame = Math.round(sample.timestamp * sample.sampleRate) + frameOffset
        }
        const planes = sample.samples()
        const block = new Float32Array(usable * channels)
        if (planes.length >= sourceChannels) {
          for (let frame = 0; frame < usable; frame++) {
            for (let channel = 0; channel < channels; channel++) block[frame * channels + channel] = planes[channel]![frameOffset + frame]!
          }
        } else {
          const source = planes[0] ?? new Float32Array(0)
          for (let frame = 0; frame < usable; frame++) {
            for (let channel = 0; channel < channels; channel++) block[frame * channels + channel] = source[(frameOffset + frame) * sourceChannels + channel]!
          }
        }
        sample.close?.()
        carry.push(block)
        carryTotal += usable
        flushChunk()
      }
      if (!cancelled && carryTotal > 0) {
        const rest = new Float32Array(carryTotal * channels)
        let at = 0
        for (const segment of carry) {
          rest.set(segment, at)
          at += segment.length
        }
        const copy = rest.slice()
        port.postMessage({ startSec: absoluteFrame / sampleRate, samples: copy }, [copy.buffer as Transferable])
      }
      if (cancelled) deps.emit({ t: 'job:error', jobId, error: { code: 'CANCELLED', retryable: true } })
      else deps.emit({ t: 'job:done', jobId })
    } catch (error) {
      deps.emit({ t: 'job:error', jobId, error: toEngineError(error) })
    } finally {
      try {
        await iterator?.return?.()
      } catch {
        // teardown must not mask the decode outcome
      }
      active = 0
      resolveDone()
    }
  }

  void run()

  return {
    path,
    get sampleRate() {
      return sampleRate
    },
    get channels() {
      return channels
    },
    done,
    cancel() {
      cancelled = true
    },
    activeDecoders() {
      return active
    },
  }
}

// --- worker-entry helpers ------------------------------------------------------

/** Async-iterable over the `PcmChunk`s a decode job posts to one port; ends on
 * `{t:'end'}`/`job:done`, rejects on `job:error` (protocol.ts wire shapes). */
export function PcmChunkStream(port: MessagePort): AsyncIterable<PcmChunk> & AsyncIterator<PcmChunk> {
  const queue: PcmChunk[] = []
  let ended = false
  let failure: Error | null = null
  const waiters: (() => void)[] = []
  const wake = (): void => {
    for (const resolve of waiters.splice(0)) resolve()
  }
  port.onmessage = (event: { data: unknown }) => {
    const data = event.data as { t?: unknown; startSec?: unknown; samples?: unknown; error?: { code?: unknown } } | null
    if (data === null || typeof data !== 'object') return
    if (data.t === undefined && typeof data.startSec === 'number' && data.samples instanceof Float32Array) {
      queue.push({ startSec: data.startSec, samples: data.samples })
    } else if (data.t === 'end' || data.t === 'job:done') {
      ended = true
    } else if (data.t === 'job:error') {
      const code = data.error?.code
      failure = new Error(typeof code === 'string' && code.length > 0 ? code : 'ENGINE_INTERNAL')
      ended = true
    }
    wake()
  }
  port.start?.()
  const stream: AsyncIterable<PcmChunk> & AsyncIterator<PcmChunk> = {
    async next(): Promise<IteratorResult<PcmChunk>> {
      while (queue.length === 0 && !ended && failure === null) {
        await new Promise<void>((resolve) => waiters.push(resolve))
      }
      if (failure !== null) {
        const error = failure
        failure = null
        throw error
      }
      const chunk = queue.shift()
      return chunk ? { done: false, value: chunk } : { done: true, value: undefined }
    },
    return(): Promise<IteratorResult<PcmChunk>> {
      ended = true
      wake()
      return Promise.resolve({ done: true, value: undefined })
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
  return stream
}

/** Engine-side tee: every port gets a byte-identical COPY (the original
 * stays usable — callers keep the buffer for peaks/fingerprint reuse). */
export function teePcm(chunk: PcmChunk, ports: readonly MessagePort[]): void {
  for (const port of ports) {
    const copy = chunk.samples.slice()
    port.postMessage({ startSec: chunk.startSec, samples: copy }, [copy.buffer as Transferable])
  }
}

/** `PcmSource` helper for the transfer path (unit-05 consumers). */
export function transferSource(buffer: ArrayBuffer): PcmSource {
  return { kind: 'transfer', buffer }
}

/** Identity meter factory: `begin(reference)` pins the reading; tests and
 * the builder's real meter share the shape. */
export function referenceMeter(): { create(): { begin(reference: number): void; current(): MeterReading | undefined } } {
  return {
    create() {
      let current: MeterReading | undefined
      return {
        begin(reference: number) {
          current = { value: reference, reference }
        },
        current() {
          return current
        },
      }
    },
  }
}

const liveJobs = new Map<string, DecodeJob | PlaybackJob>()

/** `MediaRequest`-shaped entry used by `src/workers/media.worker.ts`: routes
 * the protocol union to the engine surface and mirrors every emitted event
 * onto the scope's `postMessage` (worker-core owns the logic, not the worker). */
export function handleMediaRequest(request: MediaRequest, scope: { postMessage(message: MediaWorkerEvent, transfer?: Transferable[]): void }, deps: DecodeDeps): DecodeJob | PlaybackJob | undefined {
  const emit = (event: MediaWorkerEvent): void => {
    deps.emit(event)
    scope.postMessage(event)
    if (event.t === 'job:done' || event.t === 'job:error') liveJobs.delete(event.jobId)
  }
  switch (request.t) {
    case 'decode': {
      const job = decodeAudio({ jobId: request.jobId, file: request.file, ports: request.ports }, { ...deps, emit })
      liveJobs.set(request.jobId, job)
      return job
    }
    case 'cancel': {
      const job = liveJobs.get(request.jobId)
      job?.cancel()
      return job
    }
    case 'probe': {
      void (async () => {
        try {
          const opened = await deps.open(request.file)
          const fingerprint = await fingerprintFile(request.file, opened.probe.duration)
          emit({ t: 'media:probed', jobId: request.jobId, asset: buildAsset(request.file.name ?? '', opened.probe, fingerprint) })
        } catch (error) {
          emit({ t: 'job:error', jobId: request.jobId, error: toEngineError(error) })
        }
      })()
      return undefined
    }
    default: {
      const exhaustive: never = request
      return exhaustive
    }
  }
}
