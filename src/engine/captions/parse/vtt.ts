// WebVTT parser (FR-07.2) per https://www.w3.org/TR/webvtt1/: signature line
// `WEBVTT`, header block (our `Language:` declaration is read for the format
// metadata — unit-07 FR-07.2), NOTE/STYLE/REGION blocks ignored, cue blocks
// = optional identifier + timing line `[HH:]MM:SS.mmm --> [HH:]MM:SS.mmm
// [settings]` + cue text. Cue settings are dropped (positioning → the
// importer's POSITION_DROPPED report); `<v Name>` becomes `voice` and inline
// tags — formatting spans and `<00:00:01.000>` timestamps (Risks: timing is
// the cue's own, text keeps words) — are stripped with spacing preserved.

import type { ParseOptions, ParseResult, ParsedCue } from '../types'
import { CaptionFailureError } from '../failure'
import { decodeEntities, makeCue, stripTags, toLines, YIELD_EVERY_CUES, yieldScheduler } from './shared'

// WebVTT timestamp (spec § "WebVTT timestamp"): (H+ ':')? MM ':' SS '.' MMM
// with exactly two digits for minutes/seconds and one-to-three for fraction.
const VTT_TIMESTAMP = String.raw`(?:(\d{1,3}):)?([0-5]\d):([0-5]\d)\.(\d{1,3})`
const VTT_TIMING = new RegExp(`^\\s*${VTT_TIMESTAMP}\\s*-->\\s*${VTT_TIMESTAMP}(?:[ \\t].*)?\\s*$`)
const VOICE_TAG = /<v[ \t]+([^>]+)>/i
const BLOCK_KEYWORDS = new Set(['NOTE', 'STYLE', 'REGION'])

function timeToSeconds(h: string | undefined, m: string, s: string, frac: string): number {
  return (h === undefined ? 0 : Number(h)) * 3600 + Number(m) * 60 + Number(s) + Number(frac) / 10 ** frac.length
}

function extractVoice(cueText: string): string | undefined {
  const match = VOICE_TAG.exec(cueText)
  if (!match?.[1]) return undefined
  // `<v Speaker.class>` — the name is everything before the first '.'.
  const name = match[1].split('.')[0]!.trim()
  return name === '' ? undefined : name
}

export async function parseVtt(text: string, opts?: ParseOptions): Promise<ParseResult> {
  const lines = toLines(text)
  const scheduleYield = yieldScheduler(opts)
  if (lines.length === 0 || !/^WEBVTT([ \t]|$)/.test(lines[0]!)) {
    throw new CaptionFailureError('UNRECOGNIZED_FORMAT', 'WebVTT signature "WEBVTT" missing on line 1', { line: 1 })
  }
  let at = 1
  let language: string | null = null
  while (at < lines.length && lines[at]!.trim() !== '') {
    const declared = /^Language:[ \t]*(\S[^\r\n]*?)[ \t]*$/i.exec(lines[at]!)
    if (declared?.[1]) language = declared[1]
    at++
  }
  const cues: ParsedCue[] = []
  while (at < lines.length) {
    while (at < lines.length && lines[at]!.trim() === '') at++
    if (at >= lines.length) break
    const blockStart = at
    const block: string[] = []
    while (at < lines.length && lines[at]!.trim() !== '') {
      block.push(lines[at]!)
      at++
    }
    const keyword = block[0]!.trim().split(/[ \t]/)[0]!
    if (BLOCK_KEYWORDS.has(keyword)) continue
    const timingIndex = block.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) {
      throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `WebVTT cue block has no timestamp line (line ${blockStart + 1})`, { line: blockStart + 1 })
    }
    const timing = VTT_TIMING.exec(block[timingIndex]!)
    if (!timing) {
      throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `WebVTT timestamp line malformed (line ${blockStart + timingIndex + 1})`, { line: blockStart + timingIndex + 1 })
    }
    const start = timeToSeconds(timing[1], timing[2]!, timing[3]!, timing[4]!)
    const end = timeToSeconds(timing[5], timing[6]!, timing[7]!, timing[8]!)
    const raw = block.slice(timingIndex + 1).join('\n')
    cues.push(makeCue(start, end, decodeEntities(stripTags(raw)), extractVoice(raw)))
    if (cues.length % YIELD_EVERY_CUES === 0) await scheduleYield()
  }
  return { format: 'vtt', cues, language }
}
