// SRT parser (FR-07.2). De-facto grammar (no formal spec — unit-07 "Docs to
// consult"): cue blocks separated by blank lines; optional integer index
// line; timestamp line `HH:MM:SS,mmm --> HH:MM:SS,mmm` (1–2-digit hours and
// `.` fractions are tolerated as real-world variants); text lines verbatim
// after tag stripping. Cues keep what the FILE said — overlap/zero-duration/
// empty fixes are the importer's report adjustments (domain invariant 11).
// A malformed timestamp line is the typed 'UNRECOGNIZED_FORMAT' failure with
// its 1-based line number (FR-07.6 — codes/numbers only, never cue text).

import type { ParseOptions, ParseResult, ParsedCue } from '../types'
import { CaptionFailureError } from '../failure'
import { makeCue, stripTags, toLines, YIELD_EVERY_CUES, yieldScheduler } from './shared'

const SRT_TIME = String.raw`(\d{1,2}):([0-5]\d):([0-5]\d)[,.](\d{1,3})`
const SRT_TIMING = new RegExp(`^\\s*${SRT_TIME}\\s*-->\\s*${SRT_TIME}\\s*$`)

function timeToSeconds(h: string, m: string, s: string, frac: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(frac) / 10 ** frac.length
}

export async function parseSrt(text: string, opts?: ParseOptions): Promise<ParseResult> {
  const lines = toLines(text)
  const scheduleYield = yieldScheduler(opts)
  const cues: ParsedCue[] = []
  let at = 0
  while (at < lines.length) {
    while (at < lines.length && lines[at]!.trim() === '') at++
    if (at >= lines.length) break
    if (/^\s*\d+\s*$/.test(lines[at]!)) {
      at++
      if (at >= lines.length) throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `SRT cue index without a timestamp line (line ${at})`, { line: at })
    }
    const timingMatch = SRT_TIMING.exec(lines[at]!)
    if (!timingMatch) throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `SRT timestamp line malformed (line ${at + 1})`, { line: at + 1 })
    const start = timeToSeconds(timingMatch[1]!, timingMatch[2]!, timingMatch[3]!, timingMatch[4]!)
    const end = timeToSeconds(timingMatch[5]!, timingMatch[6]!, timingMatch[7]!, timingMatch[8]!)
    at++
    const textLines: string[] = []
    while (at < lines.length && lines[at]!.trim() !== '') {
      textLines.push(lines[at]!)
      at++
    }
    cues.push(makeCue(start, end, stripTags(textLines.join('\n'))))
    if (cues.length % YIELD_EVERY_CUES === 0) await scheduleYield()
  }
  return { format: 'srt', cues, language: null }
}
