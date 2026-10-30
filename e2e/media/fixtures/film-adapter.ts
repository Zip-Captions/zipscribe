// FILM-model fallback stand-in for the unit-04 browser suites — test-author-owned.
//
// The ffmpeg.wasm fallback path (FR-04.5) must be proven end-to-end WITHOUT
// a runtime import of @ffmpeg/ffmpeg: the dependency is not installed yet
// (the builder adds it in unit-04) and the prime serves no ffmpeg core
// (network is blocked at test time). This module decodes the committed
// fallback fixtures with a small, deterministic FILM decoder (the same
// "editorial resampler" the architecture documents) so the ffmpeg-path specs
// prove the PIPELINE — mediabunny refused the container/codec → fallback path
// → identical PcmChunk contract → correlation to fmt-30s.ref.wav — rather
// than a real ffmpeg build.
//
// It is a declared, reviewed stand-in — never a mock of the thing under test
// (`decodeAudio`, resample, peaks, fingerprint stay real). `ffmpegMode:
// 'real'` throws a labelled FFMPEG_CORE_UNAVAILABLE instead of silently
// greening, so the day the builder installs @ffmpeg/ffmpeg the specs switch
// over without changing their assertions.
//
// Supported (all 16 kHz mono in the committed fixtures):
//   - AIFF (pcm_s16be), CAF (lpcm s16le), WAV (pcm_s16le / f32)
//   - ALAC-in-M4A: NOT decodable here → FILM_ALAC_UNSUPPORTED
//   - WMA / AMR / 3GP: FILM_CODEC_UNSUPPORTED (the committed assets are
//     unusable placeholders — see the unit report, Fixture notes)
export function filmDecode(bytes: Uint8Array): Float32Array & { sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number, length: number): string => new TextDecoder('latin1').decode(bytes.subarray(at, at + length))
  const isRiff = tag(0, 4) === 'RIFF' && tag(8, 4) === 'WAVE'
  const isAiff = tag(0, 4) === 'FORM' && (tag(8, 4) === 'AIFF' || tag(8, 4) === 'AIFC')
  const isCaf = tag(0, 4) === 'caff'
  if (!isRiff && !isAiff && !isCaf) {
    if (bytes.byteLength > 8 && tag(4, 4) === 'ftyp') throw labelled('FILM_ALAC_UNSUPPORTED', 'ALAC-in-MP4 needs the real ffmpeg adapter')
    throw labelled('FILM_CODEC_UNSUPPORTED', 'container is not PCM (WMA/AMR/3GP placeholders)')
  }
  let sampleRate = 16000
  let channels = 1
  let bits = 16
  let float = false
  let bigEndian = isAiff
  let dataStart = -1
  let dataLength = 0
  let offset = isCaf ? 8 : 12
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset, 4)
    // Chunk sizes are little-endian in RIFF and big-endian in AIFF/CAF
    // (the flag argument of getUint32 is `littleEndian`).
    const size = isCaf ? view.getUint32(offset + 4) * 4294967296 + view.getUint32(offset + 8) : view.getUint32(offset + 4, isRiff)
    const body = isCaf ? offset + 12 : offset + 8
    if (isRiff && id === 'fmt ') {
      const formatTag = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      float = formatTag === 3
    }
    if (isAiff && id === 'COMM') {
      channels = view.getUint16(body)
      bits = view.getUint16(body + 6)
      sampleRate = extendedToNumber(view, body + 8)
    }
    if (isCaf && id === 'desc') {
      // CAF AudioDescription (8-byte caff file header, chunks start at 8):
      // f64 mSampleRate @+0, u32 mFormatID @+8 ('lpcm'), u32 mFormatFlags
      // @+12, u32 mBytesPerPacket @+16, u32 mFramesPerPacket @+20,
      // u32 mChannels @+24, u32 mBitsPerChannel @+28 (all BE).
      sampleRate = Number(view.getFloat64(body))
      channels = view.getUint32(body + 24)
      bits = view.getUint32(body + 28)
      // The committed fmt-30s.caf (ffmpeg caf muxer) sets mFormatFlags to the
      // big-endian bit but writes little-endian samples — verified
      // byte-identical to fmt-30s.ref.wav as LE s16. Trust the bytes.
      float = false
      bigEndian = false
    }
    if (isRiff && id === 'data') {
      dataStart = body
      dataLength = size
    }
    if (isAiff && id === 'SSND') {
      dataStart = body + 8
      dataLength = size - 8
    }
    if (isCaf && id === 'data') {
      dataStart = body + 4 // CAF data chunk carries a 4-byte edit count
      dataLength = size - 4
    }
    offset = body + size + (isCaf ? 0 : size % 2)
  }
  if (dataStart < 0) throw labelled('FILM_CODEC_UNSUPPORTED', 'no PCM data chunk')
  const bytesPerSample = bits / 8
  const frames = Math.floor(Math.min(dataLength, bytes.byteLength - dataStart) / (bytesPerSample * channels))
  const out = new Float32Array(frames) as Float32Array & { sampleRate: number }
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) {
      const at = dataStart + (frame * channels + channel) * bytesPerSample
      if (float && bits === 32) sum += view.getFloat32(at, !bigEndian)
      else if (bits === 16) sum += view.getInt16(at, !bigEndian) / 32768
      else if (bits === 8) sum += (view.getUint8(at) - 128) / 128
      else throw labelled('FILM_CODEC_UNSUPPORTED', `unsupported PCM depth ${bits}`)
    }
    out[frame] = sum / channels
  }
  out.sampleRate = sampleRate
  return out
}

/** 80-bit IEEE 754 extended precision (AIFF COMM sample rate). */
function extendedToNumber(view: DataView, at: number): number {
  const exponent = view.getUint16(at)
  const high = view.getUint32(at + 2)
  const low = view.getUint32(at + 6)
  if (exponent === 0 && high === 0 && low === 0) return 0
  const sign = exponent & 0x8000 ? -1 : 1
  const exp = (exponent & 0x7fff) - 16383
  return sign * (high * 2 ** -31 + low * 2 ** -63) * 2 ** exp
}

function labelled(code: string, detail: string): Error {
  return Object.assign(new Error(`${code}: ${detail}`), { code })
}