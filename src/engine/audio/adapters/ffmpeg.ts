// CC-04.3/CC-04.10 (FR-04.5) — the ffmpeg.wasm fallback adapter: the ONLY
// production module that touches `@ffmpeg/ffmpeg` (FR-1.0.5 engine purity —
// SDKs live under adapters/). It sits behind the SAME seam the mediabunny
// adapter exposes: `DecodeDeps.open` receives `{ source, path, probe }`, so
// `decodeAudio` (resample → peaks → tee) is path-agnostic, and an adapter
// failure is signalled by CODE only (`FFMPEG_CORE_UNAVAILABLE` →
// `FFMPEG_REQUIRED` mapping lives in decode.ts `toEngineError`; frozen
// decode.test.ts:113 pins the code contract). SECURITY-03: nothing here
// puts file names, container bytes or ffmpeg log text into an error.
//
// Self-hosted core (settings.yml network allowlist: `self` + model hosts
// only): `@ffmpeg/ffmpeg` defaults its core to the unpkg CDN (dist/esm/
// const.js CORE_URL) — every load below overrides coreURL/wasmURL/
// classWorkerURL with the same-origin `/wasm/ffmpeg/` copies installed by
// scripts/copy-ffmpeg.ts (SHA-pinned). The URLs are exactly the frozen
// contract the e2e harness checks: /wasm/ffmpeg/ffmpeg-core.js +
// ffmpeg-core.wasm.
//
// API verified against the pinned sources (NOT memory), per AGENTS.md:
//   node_modules/@ffmpeg/ffmpeg/dist/esm/classes.js  — load({coreURL,
//     wasmURL, classWorkerURL}), writeFile, exec, readFile, terminate;
//   node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js   — the class worker runs
//     as `type: 'module'` (classes.js), where `importScripts` is unavailable,
//     so the core is loaded via `await import(coreURL)` — this requires the
//     ESM build (default export), which is what copy-ffmpeg.ts installs at
//     /wasm/ffmpeg/ffmpeg-core.js. classWorkerURL is passed explicitly
//     because bundlers cannot statically bundle worker.js's own relative
//     imports (`new URL('./const.js', …)` is runtime-resolved inside the
//     emitted worker), so the worker + its two imports are served as plain
//     files. Reference: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.15
//     (README `classWorkerURL`, and the vite/worker bundler notes).

import type { AudioSampleLike, AudioTrackLike, DecodeProbe, MediaSourceLike } from '../decode'

export interface FfmpegOpenReason {
  container: string
  codec: string
}

export interface FfmpegOpenedMedia {
  source: MediaSourceLike
  path: 'ffmpeg'
  probe: DecodeProbe
}

/** Structural surface of `@ffmpeg/ffmpeg`'s `FFmpeg` class that the adapter
 * uses (kept nominal + injectable so L1 tests drive the transcode without
 * spinning a real WebAssembly core). */
export interface FfmpegLike {
  load(config: { coreURL: string; wasmURL: string; classWorkerURL?: string }): Promise<unknown>
  writeFile(path: string, data: Uint8Array): Promise<unknown>
  exec(args: string[]): Promise<number>
  readFile(path: string, encoding?: 'binary' | 'utf8'): Promise<Uint8Array | string>
  deleteFile(path: string): Promise<unknown>
  terminate(): void
}

export interface OpenFfmpegOptions {
  /** Directory the pinned core files are served from (FR-04.5: self-hosted,
   * never a CDN). */
  coreBase?: string
  /** Test seam: construct the FFmpeg runtime (default: dynamic import of the
   * pinned `@ffmpeg/ffmpeg`, lazy on first need — FR-04.5). */
  createFfmpeg?: () => Promise<FfmpegLike>
  /** Test seam for the self-hosted-core presence check. */
  fetchCore?: (url: string) => Promise<{ ok: boolean; status: number }>
}

const CORE_BASE = '/wasm/ffmpeg'
/** PCM window handed to the pipeline per `AudioSampleLike` (~0.25 s at
 * typical rates — same progress/peaks granularity class the mediabunny
 * adapter yields at). */
const SAMPLE_FRAMES = 4096

function labelled(code: string): Error {
  // SECURITY-03: code-only errors — never message text from ffmpeg, never a
  // file name, never container bytes.
  return Object.assign(new Error(code), { code })
}

let runtime: Promise<FfmpegLike> | null = null
let sequence = 0

async function defaultCreateFfmpeg(coreBase: string): Promise<FfmpegLike> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const ffmpeg = new FFmpeg()
  await ffmpeg.load({
    coreURL: `${coreBase}/ffmpeg-core.js`,
    wasmURL: `${coreBase}/ffmpeg-core.wasm`,
    classWorkerURL: `${coreBase}/worker.js`,
  })
  return ffmpeg
}

async function ensureRuntime(options: OpenFfmpegOptions): Promise<FfmpegLike> {
  if (runtime) return runtime
  const coreBase = options.coreBase ?? CORE_BASE
  const fetchCore = options.fetchCore ?? ((url: string) => fetch(url, { method: 'HEAD' }))
  runtime = (async () => {
    for (const path of [`${coreBase}/ffmpeg-core.js`, `${coreBase}/ffmpeg-core.wasm`]) {
      let response: { ok: boolean; status: number }
      try {
        response = await fetchCore(path)
      } catch {
        throw labelled('FFMPEG_CORE_UNAVAILABLE')
      }
      if (!response.ok) throw labelled('FFMPEG_CORE_UNAVAILABLE')
    }
    try {
      return options.createFfmpeg ? await options.createFfmpeg() : await defaultCreateFfmpeg(coreBase)
    } catch (error) {
      const code = (error as { code?: unknown } | null | undefined)?.code
      throw typeof code === 'string' && code.length > 0 ? labelled(code) : labelled('FFMPEG_CORE_UNAVAILABLE')
    }
  })()
  runtime.catch(() => {
    // A failed load must not poison the session: the next open retries
    // (the e2e film stand-in handoff depends on the failure being re-raisable,
    // not cached as a rejected promise).
    runtime = null
  })
  return runtime
}

/** Parse a RIFF/WAVE `pcm_f32le` buffer produced by the transcode. Returns
 * `null` for anything that is not exactly that shape (the caller maps null to
 * UNSUPPORTED_MEDIA — a codec ffmpeg claimed to decode but produced no f32
 * WAV for is a broken input, not an internal fault). `data` is a COPY: the
 * caller keeps ownership of the source buffer. */
export function parseF32Wav(bytes: Uint8Array): { sampleRate: number; channels: number; frames: number; data: Float32Array } | null {
  if (bytes.length < 44) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number, text: string): boolean => {
    if (at + text.length > bytes.length) return false
    for (let index = 0; index < text.length; index++) if (bytes[at + index] !== text.charCodeAt(index)) return false
    return true
  }
  if (!tag(0, 'RIFF') || !tag(8, 'WAVE')) return null
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  let format = 0
  let subFormat = -1
  let dataStart = -1
  let dataLength = 0
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4))
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && size >= 16 && body + size <= bytes.length) {
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      // ffmpeg's wav muxer writes pcm_f32le as WAVE_FORMAT_EXTENSIBLE
      // (format 0xFFFE, fmt size 40) with the real tag in the subformat GUID
      // — measured against the pinned core's own output.
      if (format === 0xfffe && size >= 40) subFormat = view.getUint16(body + 24, true)
    } else if (id === 'data') {
      dataStart = body
      dataLength = Math.min(size, bytes.length - body)
    }
    offset = body + size + (size % 2)
  }
  const float = format === 3 || (format === 0xfffe && subFormat === 3)
  if (!float || bits !== 32 || channels < 1 || sampleRate <= 0 || dataStart < 0) return null
  const usable = dataLength - (dataLength % (channels * 4))
  const frames = usable / (channels * 4)
  if (frames <= 0) return null
  // Copy into a fresh, 4-byte-aligned buffer (the subarray view of the readFile
  // result may not be Float32Array-aligned, and the source is discarded).
  const copy = new Uint8Array(usable)
  copy.set(bytes.subarray(dataStart, dataStart + usable))
  return { sampleRate, channels, frames, data: new Float32Array(copy.buffer) }
}

/**
 * The fallback `open` behind the mediabunny adapter's `openFfmpeg` option
 * (and the direct forced-fallback entry): transcode the whole file to
 * 32-bit float PCM WAV in the worker, then stream it back through the frozen
 * `MediaSourceLike` contract. Single-threaded core only (no SharedArrayBuffer
 * → no COOP/COEP, repo policy); the whole decoded buffer is resident for the
 * duration of one open (the long-tail codecs this serves are short-form
 * inputs; the 120-min streaming gate is the mediabunny path).
 */
export async function openFfmpeg(file: Blob, reason: FfmpegOpenReason, options: OpenFfmpegOptions = {}): Promise<FfmpegOpenedMedia> {
  const ffmpeg = await ensureRuntime(options)
  const bytes = new Uint8Array(await file.arrayBuffer())
  sequence += 1
  const input = `zipscribe-in-${sequence}.bin`
  const output = `zipscribe-out-${sequence}.wav`
  const cleanup = async (): Promise<void> => {
    for (const path of [input, output]) {
      try {
        await ffmpeg.deleteFile(path)
      } catch {
        // MEMFS teardown must not mask the open outcome
      }
    }
  }
  try {
    await ffmpeg.writeFile(input, bytes)
    const ret = await ffmpeg.exec(['-i', input, '-vn', '-map', '0:a:0', '-f', 'wav', '-c:a', 'pcm_f32le', output])
    if (ret !== 0) throw labelled('UNSUPPORTED_MEDIA')
    const wav = await ffmpeg.readFile(output)
    if (!(wav instanceof Uint8Array)) throw labelled('UNSUPPORTED_MEDIA')
    const decoded = parseF32Wav(wav)
    if (!decoded) throw labelled('UNSUPPORTED_MEDIA')
    const { sampleRate, channels, frames, data } = decoded
    const track: AudioTrackLike = {
      number: 0,
      codec: reason.codec.length > 0 ? reason.codec : 'unknown',
      sampleRate,
      numberOfChannels: channels,
      canDecode: () => false,
    }
    const streamSamples = (): Iterator<AudioSampleLike> =>
      (function* (): Generator<AudioSampleLike> {
        try {
          for (let offset = 0; offset < frames; offset += SAMPLE_FRAMES) {
            const end = Math.min(frames, offset + SAMPLE_FRAMES)
            yield {
              timestamp: offset / sampleRate,
              sampleRate,
              numberOfFrames: end - offset,
              numberOfChannels: channels,
              // Single interleaved plane: decode.ts `interleaveForFeed`
              // treats a lone plane with channels > 1 as interleaved.
              samples: () => [data.subarray(offset * channels, end * channels)],
              close: () => undefined,
            }
          }
        } finally {
          // Release the decoded buffer on early return (cancel) as well as
          // normal completion.
          data.fill(0)
        }
      })()
    const source: MediaSourceLike = {
      getDuration: () => frames / sampleRate,
      audioTracks: () => [track],
      // The transcode output is fully materialised, so streaming needs no
      // awaits: a synchronous generator bridges to the frozen
      // `AsyncIterable<AudioSampleLike>` contract. `return`/`throw` forward
      // to the generator's finally (buffer release on cancel).
      samples: () => ({
        [Symbol.asyncIterator]: () => {
          const iterator = streamSamples()
          return {
            next: () => Promise.resolve(iterator.next()),
            return: (value?: AudioSampleLike) => {
              iterator.return?.(value)
              return Promise.resolve({ done: true, value })
            },
            throw: (reason?: unknown) => {
              iterator.throw?.(reason)
              return Promise.resolve({ done: true, value: undefined })
            },
          }
        },
      }),
    }
    const probe: DecodeProbe = {
      container: reason.container.length > 0 ? reason.container : 'unknown',
      duration: frames / sampleRate,
      audioCodec: reason.codec.length > 0 ? reason.codec : 'unknown',
      videoCodec: null,
      width: 0,
      height: 0,
      fps: 0,
      trackCount: 1,
      audioTrackCount: 1,
      canDecodeAudio: false,
    }
    return { source, path: 'ffmpeg', probe }
  } catch (error) {
    await cleanup()
    const code = (error as { code?: unknown } | null | undefined)?.code
    if (typeof code === 'string' && code.length > 0) throw labelled(code)
    // exec/writeFile rejections carry ffmpeg text in `message` — never let it
    // escape (SECURITY-03): keep only the code shape.
    throw labelled('UNSUPPORTED_MEDIA')
  } finally {
    // The output file is consumed; keep MEMFS lean between opens.
    void cleanup()
  }
}
