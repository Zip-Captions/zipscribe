// ASS/SSA parser (FR-07.2): `Dialogue:` lines of the `[Events]` section
// only; the 10 standard fields (Layer, Start, End, Style, Name, MarginL,
// MarginR, MarginV, Effect, Text) are comma-split with the text field
// re-joined (text itself may contain commas). Times are `H:MM:SS.cc`
// (centiseconds; 3 fractional digits tolerated as milliseconds). Text drops
// `{\…}` override tags (karaoke/movement/styling is v1-dropped per Risks)
// and maps the `\N`/`\n`/`\h` line controls. Other sections/lines
// (`Style:`, `Comment:`, …) are not cues. No cue at all / malformed time →
// typed 'UNRECOGNIZED_FORMAT' with the 1-based line (FR-07.6).

import type { ParseOptions, ParseResult, ParsedCue } from '../types'
import { CaptionFailureError } from '../failure'
import { toLines, YIELD_EVERY_CUES, yieldScheduler } from './shared'

const ASS_TIME = /^(\d{1,2}):([0-5]\d):([0-5]\d)\.(\d{2,3})$/
const DIALOGUE = /^Dialogue:[ \t]*(.*)$/
const OVERRIDE_TAGS = /\{[^}]*\}/g

function timeToSeconds(h: string, m: string, s: string, frac: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(frac) / 10 ** frac.length
}

function parseTime(value: string, line: number): number {
  const match = ASS_TIME.exec(value.trim())
  if (!match) throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `ASS Dialogue timestamp malformed (line ${line})`, { line })
  return timeToSeconds(match[1]!, match[2]!, match[3]!, match[4]!)
}

export async function parseAss(text: string, opts?: ParseOptions): Promise<ParseResult> {
  const lines = toLines(text)
  const scheduleYield = yieldScheduler(opts)
  const cues: ParsedCue[] = []
  for (let index = 0; index < lines.length; index++) {
    const dialogue = DIALOGUE.exec(lines[index]!)
    if (!dialogue) continue
    const line = index + 1
    const fields = (dialogue[1] ?? '').split(',')
    if (fields.length < 10) {
      throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `ASS Dialogue line has ${fields.length} fields, expected 10 (line ${line})`, { line })
    }
    const start = parseTime(fields[1]!, line)
    const end = parseTime(fields[2]!, line)
    const cueText = fields.slice(9).join(',').replace(OVERRIDE_TAGS, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ')
    cues.push({ start, end, text: cueText, lines: cueText.split('\n') })
    if (cues.length % YIELD_EVERY_CUES === 0) await scheduleYield()
  }
  if (cues.length === 0) {
    throw new CaptionFailureError('UNRECOGNIZED_FORMAT', 'ASS file has no Dialogue lines (line 1)', { line: 1 })
  }
  return { format: 'ass', cues, language: null }
}
