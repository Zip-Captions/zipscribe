// The "film" (editorial) resampler: linear interpolation. This is the
// reference resampler for the ffmpeg.wasm editorial path (AUDIO-DEMUXER §
// "Resampler design") — NOT the shipping resampler. Same time mapping and
// output-length formula as `resample` (so both paths align), but each output
// is the linear blend of its two neighbouring input samples. Deterministic,
// no filter state, zero group delay.

export interface FilmOptions {
  fromRate: number
  toRate: number
  /** 1 = linear interpolation only. */
  channels: number
  speed?: number
}

export function resampleFilm(input: Float32Array, options: FilmOptions): Float32Array {
  const { fromRate, toRate, channels } = options
  const speed = options.speed ?? 1
  if (!Number.isFinite(fromRate) || fromRate <= 0) throw new RangeError(`resampleFilm: fromRate must be a positive finite number (got ${fromRate})`)
  if (!Number.isFinite(toRate) || toRate <= 0) throw new RangeError(`resampleFilm: toRate must be a positive finite number (got ${toRate})`)
  if (!Number.isInteger(channels) || channels < 1) throw new RangeError(`resampleFilm: channels must be a positive integer (got ${channels})`)
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError(`resampleFilm: speed must be a positive finite number (got ${speed})`)

  const frames = Math.floor(input.length / channels)
  const count = Math.ceil((frames * toRate) / (fromRate * Math.max(speed, Number.EPSILON)))
  const posScale = (fromRate * speed) / toRate
  const out = new Float32Array(count * channels)
  for (let n = 0; n < count; n++) {
    const x = n * posScale
    const q = Math.floor(x)
    const fraction = x - q
    for (let c = 0; c < channels; c++) {
      const a = q < frames ? input[q * channels + c]! : 0
      const b = q + 1 < frames ? input[(q + 1) * channels + c]! : 0
      out[n * channels + c] = (1 - fraction) * a + fraction * b
    }
  }
  return out
}
