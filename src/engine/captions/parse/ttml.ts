// TTML/DFXP text-profile parser (FR-07.2) per https://www.w3.org/TR/ttml2/:
// `<p>` elements in document order, `begin`/`end` (or `begin`+`dur`) as
// clock times (`hh:mm:ss(.fff | :ff)`) or offset times (`123.456s`, `50f`
// frames via `ttp:frameRate`, TTML2 default frameRate 30). `xml:lang` on
// `<tt>` is the declared language. Hand-rolled matching (no XML parser): the
// engine is framework-agnostic and `DOMParser` is a DOM global — the text
// profile's flat `<div>/<p>` shape needs only this surface. Nested inline
// tags are stripped and XML entities decoded; outer whitespace trimmed
// (xml:space="default" behaviour). Malformed time → typed
// 'UNRECOGNIZED_FORMAT' with the 1-based line (FR-07.6).

import type { ParseOptions, ParseResult, ParsedCue } from '../types'
import { CaptionFailureError } from '../failure'
import { decodeEntities, stripTags, toLines, YIELD_EVERY_CUES, yieldScheduler } from './shared'

// TTML2 clock time (§ 12.3.1): hours ':' minutes ':' seconds (('.' fraction) |
// (':' frames)) — hours are hours2|hours3plus (no length cap) and frames are
// 2+ digits per spec; this parser additionally tolerates 1-digit forms
// (ttml.test.ts).
const CLOCK = /^(\d+):([0-5]\d):([0-5]\d)(?:[.](\d{1,9})|:(\d+))?$/
// TTML2 offset time: number + unit (h | m | s | ms | f | t).
const OFFSET = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/

function parseTtmlTime(value: string, frameRate: number): number {
  const clock = CLOCK.exec(value)
  if (clock) {
    const seconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
    if (clock[4] !== undefined) return seconds + Number(clock[4]) / 10 ** clock[4].length
    if (clock[5] !== undefined) return seconds + Number(clock[5]) / frameRate
    return seconds
  }
  const offset = OFFSET.exec(value)
  if (offset) {
    const count = Number(offset[1])
    switch (offset[2]) {
      case 'h':
        return count * 3600
      case 'm':
        return count * 60
      case 's':
        return count
      case 'ms':
        return count / 1000
      case 'f':
        return count / frameRate
      case 't':
        return count / frameRate // ticks: subFrameRate/tickRate default to 1 (TTML2 § 5.5)
    }
  }
  return Number.NaN
}

function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|[ \\t])${name}[ \\t]*=[ \\t]*"([^"]*)"`).exec(attrs)
  return match?.[1]
}

export async function parseTtml(text: string, opts?: ParseOptions): Promise<ParseResult> {
  const scheduleYield = yieldScheduler(opts)
  if (!/<tt[\s>]/.test(text)) {
    throw new CaptionFailureError('UNRECOGNIZED_FORMAT', 'TTML root element <tt> missing (line 1)', { line: 1 })
  }
  const ttTag = /<tt\b[^>]*>/i.exec(text)?.[0] ?? ''
  const declaredRate = /(?:^|[ \t])ttp:frameRate[ \t]*=[ \t]*"([^"]*)"/i.exec(ttTag)?.[1]
  const frameRate = declaredRate !== undefined ? Number(declaredRate) : 30
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new CaptionFailureError('UNRECOGNIZED_FORMAT', 'TTML ttp:frameRate malformed (line 1)', { line: 1 })
  }
  const declaredLanguage = /(?:^|[ \t])xml:lang[ \t]*=[ \t]*"([^"]*)"/i.exec(ttTag)?.[1]?.trim()
  const language = declaredLanguage === undefined || declaredLanguage === '' ? null : declaredLanguage

  const newlines = toLines(text)
  const lineStarts: number[] = []
  let offset = 0
  for (const line of newlines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }
  const lineAt = (index: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (lineStarts[mid]! <= index) low = mid
      else high = mid - 1
    }
    return low + 1
  }

  const cues: ParsedCue[] = []
  const paragraph = /<p\b([^>/]*)>([\s\S]*?)<\/p\s*>/gi
  let match: RegExpExecArray | null
  while ((match = paragraph.exec(text)) !== null) {
    const attrs = match[1] ?? ''
    const beginRaw = attribute(attrs, 'begin')
    const endRaw = attribute(attrs, 'end')
    const durRaw = attribute(attrs, 'dur')
    const line = lineAt(match.index)
    const begin = beginRaw === undefined ? Number.NaN : parseTtmlTime(beginRaw, frameRate)
    let end = endRaw === undefined ? Number.NaN : parseTtmlTime(endRaw, frameRate)
    if (Number.isNaN(end) && !Number.isNaN(begin) && durRaw !== undefined) {
      const dur = parseTtmlTime(durRaw, frameRate)
      if (!Number.isNaN(dur)) end = begin + dur
    }
    if (Number.isNaN(begin) || Number.isNaN(end)) {
      throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `TTML <p> has missing or malformed timing (line ${line})`, { line })
    }
    const cueText = decodeEntities(stripTags(match[2] ?? '')).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
    cues.push({ start: begin, end, text: cueText, lines: cueText.split('\n') })
    if (cues.length % YIELD_EVERY_CUES === 0) await scheduleYield()
  }
  return { format: 'ttml', cues, language }
}
