// Shared internals for the per-format parsers (FR-07.2/FR-07.7). Pure — the
// injected scheduler is the only effect; each parser is an async pure
// function per the frozen contract (tests/unit/captions/unit07-api-contract.d.ts).

import type { ParseOptions, ParsedCue } from '../types'

/** FR-07.7: parsing yields to the event loop every 2 000 cues. */
export const YIELD_EVERY_CUES = 2_000

/** Contract default: a macrotask tick. */
export function defaultScheduleYield(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

export function yieldScheduler(opts: ParseOptions | undefined): () => Promise<void> {
  return opts?.scheduleYield ?? defaultScheduleYield
}

export function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * Tag-ish spans: `<name …>` / `</name>` where name starts alphanumeric —
 * covers formatting tags (<i>, <b>, <font …>), VTT voice/ruby classes and
 * VTT inline timestamp tags (`<00:00:01.000>`, WebVTT spec
 * https://www.w3.org/TR/webvtt1/ § cue timestamp text alternative) while
 * leaving a prose `<3` alone. Stripping removes only the tag delimiters and
 * their payload, preserving surrounding text and spacing (contract parser
 * note).
 */
const TAGISH = /<\/?[a-zA-Z0-9][^>]*>/g

export function stripTags(text: string): string {
  return text.replace(TAGISH, '')
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** The five XML/HTML entities the caption formats use; `&amp;` decodes last (no double-decode). */
export function decodeEntities(text: string): string {
  const numeric = text.replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number(digits))).replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
  return numeric.replace(/&(lt|gt|quot|apos);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match).replace(/&amp;/g, '&')
}

export function makeCue(start: number, end: number, text: string, voice?: string): ParsedCue {
  const cue: ParsedCue = { start, end, text, lines: text.split('\n') }
  if (voice !== undefined && voice !== '') cue.voice = voice
  return cue
}
