// THE single timecode formatter (conventions § State & commands; carried-101
// minor-11: defined exactly once here, shell + transport + timeline render
// through it — pinned by tests/unit/editor/carried-101-obligations.test.ts).
//
// `MM:SS.TENTHS` ('00:12.3') by default; with `{ fps }` → `MM:SS:FF` frames;
// leading `H:` when ≥ 1 h. No business logic, no store reads.

import type { Seconds } from '../engine/model'

const TENTHS_PER_SECOND = 10
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatTimecode(seconds: Seconds, options: { fps?: number } = {}): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '00:00.0'
  const fps = options.fps
  if (fps !== undefined && Number.isFinite(fps) && fps > 0) {
    const whole = Math.floor(seconds)
    const frames = Math.floor((seconds - whole) * fps + 1e-6)
    const h = Math.floor(whole / SECONDS_PER_HOUR)
    const m = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
    const s = whole % SECONDS_PER_MINUTE
    const mmss = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
    return `${mmss}:${pad2(frames)}`
  }
  const tenths = Math.round(seconds * TENTHS_PER_SECOND)
  const wholeSeconds = Math.floor(tenths / TENTHS_PER_SECOND)
  const h = Math.floor(wholeSeconds / SECONDS_PER_HOUR)
  const m = Math.floor((wholeSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const s = wholeSeconds % SECONDS_PER_MINUTE
  const tenth = tenths % TENTHS_PER_SECOND
  const head = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
  return `${head}.${tenth}`
}

function isTimeField(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/** `formatTimecode`'s inverse; unparseable → null (no silent clamp). */
export function parseTimecode(text: string, options: { fps?: number } = {}): Seconds | null {
  const parts = text.trim().split(':')
  if (parts.length < 2 || parts.length > 4) return null
  const numbers = parts.map((part) => Number(part))
  if (numbers.some((n) => !isTimeField(n))) return null
  const fps = options.fps

  if (fps !== undefined && Number.isFinite(fps) && fps > 0) {
    // MM:SS:FF (or H:MM:SS:FF) — frame field is an integer < fps.
    if (parts.length !== 3 && parts.length !== 4) return null
    const offset = parts.length === 4 ? 1 : 0
    const hours = offset === 1 ? (numbers[0] as number) : 0
    const minutes = numbers[offset] as number
    const seconds = numbers[offset + 1] as number
    const frames = numbers[offset + 2] as number
    if (![hours, minutes, seconds, frames].every(Number.isInteger)) return null
    if (frames >= fps) return null
    return Math.round((hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds + frames / fps) * 1e6) / 1e6
  }

  // MM:SS.TENTHS (or H:MM:SS.TENTHS) — only the seconds field may carry a fraction.
  if (parts.length !== 2 && parts.length !== 3) return null
  const offset = parts.length === 3 ? 1 : 0
  const hours = offset === 1 ? (numbers[0] as number) : 0
  const minutes = numbers[offset] as number
  const seconds = numbers[offset + 1] as number
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (parts.some((part) => part === '')) return null
  return Math.round((hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds) * TENTHS_PER_SECOND) / TENTHS_PER_SECOND
}
