// CC-04.1…CC-04.13 (L4) browser harness for the unit-04 media ingest suite —
// test-author-owned.
//
// The Playwright specs drive the REAL engine modules in a real Chromium page:
// mediabunny + WebCodecs demux/decode, the windowed-sinc resampler, peaks,
// fingerprint, and the ffmpeg.wasm fallback path (real ffmpeg when the prime
// serves it, a declared FILM-model stand-in adapter when it does not — see the
// unit report, Fixture notes).
//
// Hard rule (no mocks of the thing under test): the specs and this harness
// never stub `decodeAudio`, the resampler, peaks or the fingerprint. The only
// injected seams are the ones the frozen API declares (`DecodeDeps.open`,
// the capability probe override) — the same seam the in-process unit suite
// uses.
//
// SECURITY-03: nothing here logs or returns transcript text; only numbers,
// codes, sample buffers and hashes leave the page.
import { decodeAudio, decodeForPlayback, teePcm, type AudioSampleLike, type AudioTrackLike, type DecodeDeps, type MediaSourceLike, type MediaWorkerEvent } from '@engine/audio/worker-core'
import { fingerprintFile } from '@engine/audio/fingerprint'
import { createPeaksAccumulator } from '@engine/audio/peaks'
import { resample } from '@engine/audio/resample'
import { createSupportMatrix } from '@engine/audio/adapters/probe'
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny'

export interface ChunkRecord {
  startSec: number
  /** Copy of the samples (the transferred original is detached on arrival paths). */
  samples: Float32Array
}

export interface EventRecord {
  t: string
  path?: string
  code?: string
  notice?: string
  asset?: unknown
  processedSec?: number
  totalSec?: number
  firstBucket?: number
  buckets?: number
}

export interface PlaybackRecord {
  sampleRate: number
  channels: number
  path: string
  chunks: ChunkRecord[]
}

export interface ResampleRecord {
  out: Float32Array
}

/** Live MediaSourceLike wrappers so a test can assert "zero active decoders". */
const registry: { live: number } = { live: 0 }

function toRecord(chunk: { startSec: number; samples: Float32Array }): ChunkRecord {
  return { startSec: chunk.startSec, samples: chunk.samples.slice() }
}

function recordEvent(event: MediaWorkerEvent): EventRecord {
  const base: EventRecord = { t: event.t }
  if (event.t === 'decode:support') base.path = event.path
  if (event.t === 'job:error') base.code = event.error.code
  if (event.t === 'notice') base.notice = event.notice.code
  if (event.t === 'media:probed') base.asset = event.asset
  if (event.t === 'job:progress') {
    base.processedSec = event.processedSec
    base.totalSec = event.totalSec
  }
  if (event.t === 'peaks:chunk') {
    base.firstBucket = event.firstBucket
    base.buckets = event.min.length
  }
  return base
}

// --- mediabunny adapter (the production shape; the builder moves it into
// `src/engine/audio/adapters/mediabunny.ts`) --------------------------------

async function openWithMediabunny(file: Blob, onFallback?: (reason: { container: string; codec: string }) => void): Promise<{ source: MediaSourceLike; path: 'webcodecs' | 'ffmpeg'; probe: import('@engine/audio/decode').DecodeProbe }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  const audioTrack = await input.getPrimaryAudioTrack()
  const videoTrack = await input.getPrimaryVideoTrack()
  // Verbatim mirror of the production adapter's duration rule
  // (src/engine/audio/adapters/mediabunny.ts:63-67, FR-04.2/US-1.2.4):
  // container metadata (edit lists, STREAMINFO sample counts) is
  // authoritative; packet-summed computeDuration() is the fallback for
  // header-less streams. Diverging here (compute-only) hid metadata-vs-content
  // disagreements from the matrix's duration rows.
  const meta = await (audioTrack as { getDurationFromMetadata?: () => Promise<number | null> }).getDurationFromMetadata?.()
  const duration = typeof meta === 'number' && Number.isFinite(meta) && meta > 0 ? meta : await input.computeDuration()
  const container = await input.getMimeType()
  if (!audioTrack) {
    throw Object.assign(new Error('UNSUPPORTED_MEDIA'), { code: 'UNSUPPORTED_MEDIA' })
  }
  const decodable = await audioTrack.canDecode()
  if (!decodable) onFallback?.({ container, codec: (await audioTrack.getCodec()) ?? 'unknown' })
  const probe = {
    container,
    duration,
    audioCodec: await audioTrack.getCodec(),
    videoCodec: videoTrack ? await videoTrack.getCodec() : null,
    width: videoTrack ? await videoTrack.getDisplayWidth() : 0,
    height: videoTrack ? await videoTrack.getDisplayHeight() : 0,
    fps: 0,
    trackCount: (await input.getTracks()).length,
    audioTrackCount: (await input.getAudioTracks()).length,
    canDecodeAudio: decodable,
  }
  const track: AudioTrackLike = {
    number: 0,
    codec: probe.audioCodec ?? 'unknown',
    sampleRate: await audioTrack.getSampleRate(),
    numberOfChannels: await audioTrack.getNumberOfChannels(),
    canDecode: () => decodable,
  }
  const source: MediaSourceLike = {
    getDuration: () => duration,
    audioTracks: () => [track],
    samples: async function* (): AsyncGenerator<AudioSampleLike> {
      registry.live++
      try {
        const sink = new AudioSampleSink(audioTrack)
        for await (const sample of sink.samples()) {
          const channels = Array.from({ length: sample.numberOfChannels }, (_, channel) => {
            const plane = new Float32Array(sample.numberOfFrames)
            sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' })
            return plane
          })
          yield {
            timestamp: sample.timestamp,
            sampleRate: sample.sampleRate,
            numberOfFrames: sample.numberOfFrames,
            numberOfChannels: sample.numberOfChannels,
            samples: () => channels,
            close: () => sample.close(),
          }
        }
      } finally {
        registry.live--
        input.dispose()
      }
    },
  }
  return { source, path: decodable ? 'webcodecs' : 'ffmpeg', probe }
}

// --- ffmpeg fallback seam ---------------------------------------------------

/**
 * Inject a fallback `open()` that decodes with ffmpeg.wasm (production) or the
 * declared FILM-model stand-in (when the prime serves no ffmpeg build — see
 * the unit report). Both produce the same `MediaSourceLike` shape, so
 * `decodeAudio` runs unmodified.
 */
async function ffmpegOpen(file: Blob, mode: 'real' | 'film'): Promise<{ source: MediaSourceLike; path: 'ffmpeg'; probe: import('@engine/audio/decode').DecodeProbe }> {
  if (mode === 'film') {
    const { filmDecode } = await import('./film-adapter')
    const decoded = filmDecode(new Uint8Array(await file.arrayBuffer()))
    const duration = decoded.length / decoded.sampleRate
    const track: AudioTrackLike = { number: 0, codec: 'pcm-s16', sampleRate: decoded.sampleRate, numberOfChannels: 1, canDecode: () => false }
    const source: MediaSourceLike = {
      getDuration: () => duration,
      audioTracks: () => [track],
      samples: async function* (): AsyncGenerator<AudioSampleLike> {
        const step = Math.round(decoded.sampleRate * 0.05)
        for (let offset = 0; offset < decoded.length; offset += step) {
          const plane = decoded.subarray(offset, offset + step)
          yield { timestamp: offset / decoded.sampleRate, sampleRate: decoded.sampleRate, numberOfFrames: plane.length, numberOfChannels: 1, samples: () => [plane.slice()] }
        }
      },
    }
    return {
      source,
      path: 'ffmpeg',
      probe: { container: 'ffmpeg', duration, audioCodec: track.codec, videoCodec: null, width: 0, height: 0, fps: 0, trackCount: 1, audioTrackCount: 1, canDecodeAudio: false },
    }
  }
  // CC-04.10 real-ffmpeg contract (frozen for the builder, verbatim):
  //   core script: /wasm/ffmpeg/ffmpeg-core.js
  //   core wasm:   /wasm/ffmpeg/ffmpeg-core.wasm
  // (pinned @ffmpeg/core@0.12.10 `dist/umd/ffmpeg-core.js|.wasm`, copied by a
  // builder copy script following the FR-1.0.9 self-hosted `/wasm/` pattern;
  // loaded through `@ffmpeg/ffmpeg` `load({ coreURL, wasmURL })` with exactly
  // these same-origin URLs — never a CDN, network policy). The production
  // adapter (src/engine/audio/adapters/ffmpeg.ts, builder) owns the transcode;
  // this seam proves the URL contract and stays honest while the copy script
  // is absent: a missing self-hosted path is FFMPEG_CORE_UNAVAILABLE, not a
  // silent film-mode fallback.
  const paths = ['/wasm/ffmpeg/ffmpeg-core.js', '/wasm/ffmpeg/ffmpeg-core.wasm'] as const
  for (const path of paths) {
    const response = await fetch(path, { method: 'HEAD' })
    if (!response.ok) throw Object.assign(new Error(`FFMPEG_CORE_UNAVAILABLE: ${path} (${response.status})`), { code: 'FFMPEG_CORE_UNAVAILABLE' })
  }
  throw Object.assign(new Error('FFMPEG_CORE_UNAVAILABLE: core present but the production ffmpeg adapter is not wired yet (builder)'), { code: 'FFMPEG_CORE_UNAVAILABLE' })
}

// --- harness surface ---------------------------------------------------------

export interface MediaHarness {
  /** CC-04.2/04.3: decode a fixture URL through the real pipeline. */
  decodeFile(url: string, options?: { forcedPath?: 'webcodecs' | 'ffmpeg'; ffmpegMode?: 'real' | 'film' }): Promise<{ events: EventRecord[]; chunks: ChunkRecord[]; live: number }>
  /** CC-04.12: tee via the production `teePcm` onto two independently-read ports. */
  decodeTee(url: string, readDelaysMs: [number, number]): Promise<{ first: ChunkRecord[]; second: ChunkRecord[]; identical: boolean; events: EventRecord[] }>
  /** CC-04.12: a consumer that never reads pauses decode (bounded queue). */
  decodeStalled(url: string): Promise<{ fast: ChunkRecord[]; stalled: number; stalledAt: { pendingPorts: number; chunks: number } | null; limit: number; live: number }>
  /** CC-04.11: cancel mid-file then retry. */
  decodeCancelThenRetry(url: string): Promise<{ afterCancel: { live: number; chunksBefore: number; chunksAfter: number; done: boolean }; afterRetry: { live: number; chunks: number; done: boolean; eventTypes: string[] } }>
  /** CC-04.6: native-rate playback decode from 0 s and from a mid-file seek. */
  playback(url: string, fromSec: number): Promise<PlaybackRecord>
  /** CC-04.13: fingerprint the same file twice and once with a 1-byte mutation. */
  fingerprint(url: string, mutateAt: 'first' | 'middle' | 'last' | null): Promise<{ first: unknown; second: unknown; mutated: unknown }>
  /** CC-04.8 (browser): resample a fixture's native samples to 16 kHz. */
  resampleFile(url: string, toRate: number): Promise<ResampleRecord>
  /** CC-04.4 (browser): peaks for a fixture. */
  peaksFile(url: string): Promise<{ buckets: number; bucketSec: number; min: number[]; max: number[] }>
  /** FR-04.6: per-session support matrix over the file's real container/codec. */
  supportMatrix(url: string): Promise<{ container: string; codec: string; supported: string }>
  /** Live decoder count from the adapter registry (CC-04.11 assertions). */
  liveDecoders(): number
  /**
   * CC-04.9: decode a large fixture WITHOUT retaining chunks — the consumer
   * drops every chunk, so the measurement covers only the decode window.
   * Calls `onProgress(coveredSec)` every second when supplied.
   */
  decodeStreaming(url: string, onProgress?: (coveredSec: number) => void): Promise<{ chunks: number; duration: number }>
}

// mediabunny is the SDK under test, pinned in settings.yml version_pins and
// installed (the builder moves this adapter shape into
// `src/engine/audio/adapters/mediabunny.ts`). It is imported statically so
// the harness bundle and the page use the SAME module instance as the
// production adapter will — no runtime specifier resolution.

function channelPair(): InstanceType<typeof MessageChannel> {
  return new MessageChannel()
}

function collectPort(port: InstanceType<typeof MessagePort>, chunks: ChunkRecord[], events: EventRecord[], readDelayMs = 0): void {
  port.onmessage = (message: MessageEvent) => {
    const data = message.data as { t?: string; startSec?: number; samples?: Float32Array }
    if (data.t === undefined && typeof data.startSec === 'number' && data.samples instanceof Float32Array) {
      chunks.push({ startSec: data.startSec, samples: data.samples.slice() })
      // Reader protocol (src/engine/audio/decode.ts:244-256): one `{t:'ack'}`
      // per delivered CHUNK — the gate's per-port pending count is chunk
      // accounting, so event messages get no ack (an over-eager ack would
      // under-count pending and the bounded queue could never fill).
      // `readDelayMs` models a slow consumer by delaying the ack.
      if (readDelayMs > 0) setTimeout(() => port.postMessage({ t: 'ack' }), readDelayMs)
      else port.postMessage({ t: 'ack' })
    } else if (typeof data.t === 'string') {
      events.push(recordEvent(data as MediaWorkerEvent))
    }
  }
  port.start()
}

function buildHarness(): MediaHarness {
  const harness: MediaHarness = {
    async decodeFile(url, options) {
      const file = await fetchFile(url)
      const events: EventRecord[] = []
      const chunks: ChunkRecord[] = []
      const channel = channelPair()
      collectPort(channel.port1, chunks, events)
      const forced = options?.forcedPath
      const deps: DecodeDeps = {
        open: forced === 'ffmpeg' ? (blob) => ffmpegOpen(blob, options?.ffmpegMode ?? 'film') : (blob, openOptions) => openWithMediabunny(blob, openOptions?.onFallback),
        emit: (event) => events.push(recordEvent(event)),
      }
      const job = decodeAudio({ jobId: 'harness-decode', file, ports: [channel.port2] }, deps)
      await job.done
      return { events, chunks, live: job.activeDecoders() }
    },

    async decodeTee(url, readDelaysMs) {
      const file = await fetchFile(url)
      const first: ChunkRecord[] = []
      const second: ChunkRecord[] = []
      const events: EventRecord[] = []
      const channel = channelPair()
      // Production tee path (FR-04.1, mirrors media.worker.ts): `decodeAudio`
      // takes ONE port; this fan-out clones every chunk with the production
      // `teePcm` onto two independently-reading consumer ports — exactly the
      // worker's two-port arrangement. The fan-out listens on the read end of
      // the engine port (decodeAudio posts chunks to `channel.port2`).
      // Upstream is acked once per chunk only when BOTH consumers have acked
      // it, so the slowest consumer bounds the queue.
      const firstChannel = channelPair()
      const secondChannel = channelPair()
      let handed = 0
      let acked = 0
      let fromFirst = 0
      let fromSecond = 0
      const pump = (): void => {
        while (acked < handed && fromFirst > acked && fromSecond > acked) {
          acked += 1
          channel.port2.postMessage({ t: 'ack' })
        }
      }
      channel.port1.onmessage = (message: MessageEvent) => {
        const data = message.data as { t?: string; startSec?: number; samples?: Float32Array }
        // Events are recorded once through `deps.emit` — the engine
        // double-delivers (deps.emit AND a postMessage per port), and the
        // chunk messages are the only thing forwarded to consumers here.
        if (data.t === undefined && typeof data.startSec === 'number' && data.samples instanceof Float32Array) {
          teePcm({ startSec: data.startSec, samples: data.samples }, [firstChannel.port2, secondChannel.port2])
          handed += 1
        }
      }
      channel.port1.start()
      collectPort(firstChannel.port1, first, events, readDelaysMs[0])
      collectPort(secondChannel.port1, second, events, readDelaysMs[1])
      firstChannel.port2.onmessage = () => {
        fromFirst += 1
        pump()
      }
      firstChannel.port2.start()
      secondChannel.port2.onmessage = () => {
        fromSecond += 1
        pump()
      }
      secondChannel.port2.start()
      const deps: DecodeDeps = { open: (blob, openOptions) => openWithMediabunny(blob, openOptions?.onFallback), emit: (event) => events.push(recordEvent(event)) }
      const job = decodeAudio({ jobId: 'harness-tee', file, ports: [channel.port2] }, deps)
      await job.done
      const identical = first.length === second.length && first.every((chunk, index) => chunk.startSec === second[index]!.startSec && bytesEqual(chunk.samples, second[index]!.samples))
      return { first, second, identical, events }
    },

    async decodeStalled(url) {
      const file = await fetchFile(url)
      const fast: ChunkRecord[] = []
      const events: EventRecord[] = []
      const fastChannel = channelPair()
      const stalledChannel = channelPair()
      collectPort(fastChannel.port1, fast, events)
      // The stalled consumer installs no handler at all (never reads).
      const deps: DecodeDeps = { open: (blob, openOptions) => openWithMediabunny(blob, openOptions?.onFallback), emit: (event) => events.push(recordEvent(event)) }
      const job = decodeAudio({ jobId: 'harness-stall', file, ports: [fastChannel.port2, stalledChannel.port2] }, deps)
      const stalledAt = await Promise.race([job.stalled, new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000))])
      const stalled = job.queueLimit + 1 - fast.length
      job.cancel()
      await job.done
      return { fast, stalled, stalledAt, limit: job.queueLimit, live: job.activeDecoders() }
    },

    async decodeCancelThenRetry(url) {
      const file = await fetchFile(url)
      const events: EventRecord[] = []
      const channel = channelPair()
      const chunks: ChunkRecord[] = []
      collectPort(channel.port1, chunks, events)
      const deps: DecodeDeps = { open: (blob, openOptions) => openWithMediabunny(blob, openOptions?.onFallback), emit: (event) => events.push(recordEvent(event)) }
      const job = decodeAudio({ jobId: 'harness-cancel', file, ports: [channel.port2] }, deps)
      while (chunks.length < 3) await new Promise((resolve) => setTimeout(resolve, 20))
      job.cancel()
      await job.done
      const chunksBefore = chunks.length
      await new Promise((resolve) => setTimeout(resolve, 300))
      const chunksAfterCancel = chunks.length
      const liveAfterCancel = job.activeDecoders()
      const retryEvents: EventRecord[] = []
      const retryChunks: ChunkRecord[] = []
      const retryChannel = channelPair()
      collectPort(retryChannel.port1, retryChunks, retryEvents)
      const retry = decodeAudio({ jobId: 'harness-retry', file, ports: [retryChannel.port2] }, { ...deps, emit: (event) => retryEvents.push(recordEvent(event)) })
      await retry.done
      return {
        afterCancel: { live: liveAfterCancel, chunksBefore, chunksAfter: chunksAfterCancel, done: chunksAfterCancel === chunksBefore },
        afterRetry: { live: retry.activeDecoders(), chunks: retryChunks.length, done: retryEvents.some((event) => event.t === 'job:done'), eventTypes: retryEvents.map((event) => event.t) },
      }
    },

    async playback(url, fromSec) {
      const file = await fetchFile(url)
      const events: EventRecord[] = []
      const channel = channelPair()
      const chunks: ChunkRecord[] = []
      collectPort(channel.port1, chunks, events)
      const job = decodeForPlayback({ jobId: 'harness-playback', file, fromSec, port: channel.port2 }, { open: (blob) => openWithMediabunny(blob), emit: (event) => events.push(recordEvent(event)) })
      await job.done
      return { sampleRate: job.sampleRate, channels: job.channels, path: await job.path, chunks }
    },

    async fingerprint(url, mutateAt) {
      const bytes = new Uint8Array(await (await fetchFile(url)).arrayBuffer())
      const makeFile = (data: Uint8Array): File => new File([data.slice().buffer], 'fingerprint-fixture', { type: 'application/octet-stream' })
      const first = await fingerprintFile(makeFile(bytes), 30)
      const second = await fingerprintFile(makeFile(bytes), 30)
      const mutated = bytes.slice()
      if (mutateAt !== null && mutated.length > 0) {
        const at = mutateAt === 'first' ? 64 : mutateAt === 'middle' ? Math.floor(mutated.length / 2) : mutated.length - 64
        mutated[at] = mutated[at]! ^ 0xff
      }
      const changed = await fingerprintFile(makeFile(mutated), 30)
      return { first, second, mutated: changed }
    },

    async resampleFile(url, toRate) {
      // Source samples come from the real mediabunny/WebCodecs decode; the
      // resampler under test is the shipped module (no stub).
      const nativePlanar = await readNative(url)
      const out = resample(nativePlanar.data, { fromRate: nativePlanar.sampleRate, toRate, channels: nativePlanar.channels })
      return { out }
    },

    async peaksFile(url) {
      const record = await harness.decodeFile(url)
      const accumulator = createPeaksAccumulator({ duration: 30 })
      for (const chunk of record.chunks) accumulator.push(chunk.samples)
      const peaks = accumulator.result()
      return { buckets: peaks.min.length, bucketSec: peaks.bucketSec, min: Array.from(peaks.min), max: Array.from(peaks.max) }
    },

    async supportMatrix(url) {
      const file = await fetchFile(url)
      // mediabunny is CAPABILITY EVIDENCE, never the decision: fallback-set
      // containers (aiff/caf/wma/amr) do not parse through it at all, and the
      // production probe sniffs those itself (sniffContainer /
      // ALL_FORMAT_HINTS in the frozen adapters/probe surface). A mediabunny
      // miss therefore still asks OUR matrix, with the raw evidence it has.
      let container = 'unknown'
      let codec: string = 'none'
      let webcodecs = false
      try {
        const opened = await openWithMediabunny(file)
        container = opened.probe.container
        codec = opened.probe.audioCodec ?? 'none'
        webcodecs = opened.probe.canDecodeAudio
      } catch {
        /* unsupported by mediabunny: matrix.probe decides from url + hints */
      }
      const matrix = createSupportMatrix()
      return matrix.probe(url, container, codec, { webcodecs, ffmpeg: true })
    },

    async decodeStreaming(url, onProgress) {
      const file = await fetchFile(url)
      const channel = channelPair()
      const events: EventRecord[] = []
      let covered = 0
      let count = 0
      // Drop each chunk immediately: bounded consumer (no history retained).
      channel.port1.onmessage = (message: MessageEvent) => {
        const data = message.data as { t?: string; startSec?: number; samples?: Float32Array }
        if (data.t === undefined && typeof data.startSec === 'number') {
          count++
          covered += (data.samples?.length ?? 0) / 16000
          if (count % 60 === 0) onProgress?.(covered)
        } else if (typeof data.t === 'string') {
          events.push(recordEvent(data as MediaWorkerEvent))
        }
      }
      channel.port1.start()
      const job = decodeAudio(
        { jobId: 'harness-streaming', file, ports: [channel.port2] },
        { open: (blob, openOptions) => openWithMediabunny(blob, openOptions?.onFallback), emit: (event) => events.push(recordEvent(event)) },
      )
      await job.done
      const probed = events.find((event) => event.t === 'media:probed')
      const duration = (probed?.asset as { duration?: number } | undefined)?.duration ?? 0
      return { chunks: count, duration }
    },

    liveDecoders() {
      return registry.live
    },
  }
  return harness
}

function bytesEqual(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false
  const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  const right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

async function fetchFile(url: string): Promise<File> {
  // Root-absolute so the spec's `/fixtures/**` route policy (and the static
  // server) see the same path regardless of the harness page's own directory.
  const response = await fetch(new URL(url, globalThis.location.origin + '/').href)
  if (!response.ok) throw new Error(`fixture fetch failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  return new File([new Blob([bytes])], url.split('/').pop() ?? 'fixture', { type: response.headers.get('content-type') ?? 'application/octet-stream' })
}

async function readNative(url: string): Promise<{ sampleRate: number; channels: number; data: Float32Array }> {
  const file = await fetchFile(url)
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  const track = await input.getPrimaryAudioTrack()
  if (!track) throw new Error('no audio track')
  const sampleRate = await track.getSampleRate()
  const channels = await track.getNumberOfChannels()
  const planes: Float32Array[][] = []
  let total = 0
  for await (const sample of new AudioSampleSink(track).samples()) {
    const framePlanes = Array.from({ length: sample.numberOfChannels }, (_, channel) => {
      const plane = new Float32Array(sample.numberOfFrames)
      sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar' })
      return plane
    })
    planes.push(framePlanes)
    total += sample.numberOfFrames
    sample.close()
  }
  input.dispose()
  const out = new Float32Array(total * channels)
  let frame = 0
  for (const framePlanes of planes) {
    for (let index = 0; index < framePlanes[0]!.length; index++, frame++) {
      for (let channel = 0; channel < channels; channel++) out[frame * channels + channel] = framePlanes[channel]![index]!
    }
  }
  return { sampleRate, channels, data: out }
}

const harness = buildHarness()
// Publish before the module finishes: a later top-level throw (a RED-phase
// stub module, a bad import) must leave a diagnosable marker rather than a
// silent blank page. The specs wait on `__zipscribeMediaHarness` and assert
// `__zipscribeMediaHarnessReady` before calling into it.
;(globalThis as unknown as { __zipscribeMediaHarness?: MediaHarness }).__zipscribeMediaHarness = harness
;(globalThis as unknown as Record<string, unknown>).__zipscribeMediaHarnessReady = true