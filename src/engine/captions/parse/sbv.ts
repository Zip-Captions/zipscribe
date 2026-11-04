// SBV (YouTube SubRip-Variant) parser (FR-07.2): blocks of a timing line
// `H:MM:SS.mmm,H:MM:SS.mmm` (unpadded hour — the grammar the format actually
// uses; 1–2 digits tolerated) followed by text lines until the blank-line
// separator. No header, no declared language; formatting tags stripped with
// spacing preserved. Malformed first/timing line → typed
// 'UNRECOGNIZED_FORMAT' with the 1-based line number (FR-07.6).

import type { ParseOptions, ParseResult, ParsedCue } from '../types'
import { CaptionFailureError } from '../failure'
import { makeCue, stripTags, toLines, YIELD_EVERY_CUES, yieldScheduler } from './shared'

const SBV_TIME = String.raw`(\d{1,2}):([0-5]\d):([0-5]\d)\.(\d{1,3})`
const SBV_TIMING = new RegExp(`^\\s*${SBV_TIME}\\s*,\\s*${SBV_TIME}\\s*$`)

function timeToSeconds(h: string, m: string, s: string, frac: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(frac) / 10 ** frac.length
}

export async function parseSbv(text: string, opts?: ParseOptions): Promise<ParseResult> {
  const lines = toLines(text)
  const scheduleYield = yieldScheduler(opts)
  const cues: ParsedCue[] = []
  let at = 0
  while (at < lines.length) {
    while (at < lines.length && lines[at]!.trim() === '') at++
    if (at >= lines.length) break
    const timing = SBV_TIMING.exec(lines[at]!)
    if (!timing) throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `SBV timestamp line malformed (line ${at + 1})`, { line: at + 1 })
    const start = timeToSeconds(timing[1]!, timing[2]!, timing[3]!, timing[4]!)
    const end = timeToSeconds(timing[5]!, timing[6]!, timing[7]!, timing[8]!)
    at++
    const textLines: string[] = []
    while (at < lines.length && lines[at]!.trim() !== '') {
      textLines.push(lines[at]!)
      at++
    }
    cues.push(makeCue(start, end, stripTags(textLines.join('\n'))))
    if (cues.length % YIELD_EVERY_CUES === 0) await scheduleYield()
  }
  return { format: 'sbv', cues, language: null }
}
