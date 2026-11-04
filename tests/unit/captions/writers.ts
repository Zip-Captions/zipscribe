// MINIMAL in-test caption writers for the CC-07.2 round-trip property.
// ASSUMPTIONS (unit report): unit-202's `src/engine/export/{srt,vtt,...}.ts`
// serializers are not landed yet — per the unit spec these writers are stubs
// owned by the property test and must be SWAPPED for the real serializers when
// unit-202 lands (round-trip then covers both sides of the same contract).
// They emit only canonical minimal forms (no ids, no settings, no styling) so
// "parse(serialize(p)) round-trips text exactly and times ± 1 ms" is the
// narrow, honest claim.
import type { ParsedCue } from '@engine/captions/contract@07'

function clock(ms: number, separator: ',' | '.'): string {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor(total / 60_000) % 60
  const s = Math.floor(total / 1000) % 60
  const milli = total % 1000
  const pad = (value: number, width: number): string => String(value).padStart(width, '0')
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${separator}${pad(milli, 3)}`
}

export function writeSrt(cues: readonly ParsedCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${clock(cue.start * 1000, ',')} --> ${clock(cue.end * 1000, ',')}\n${cue.text}\n`).join('\n')
}

export function writeVtt(cues: readonly ParsedCue[]): string {
  const body = cues.map((cue) => `${clock(cue.start * 1000, '.')} --> ${clock(cue.end * 1000, '.')}\n${cue.text}\n`).join('\n')
  return `WEBVTT\n\n${body}`
}

export function writeSbv(cues: readonly ParsedCue[]): string {
  // SBV's canonical shape is H:MM:SS.mmm (unpadded hour) — the writer emits
  // exactly that so the round-trip covers the grammar the format actually uses.
  return cues.map((cue) => `${sbvClock(cue.start * 1000)},${sbvClock(cue.end * 1000)}\n${cue.text}\n`).join('\n')
}

function sbvClock(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor(total / 60_000) % 60
  const s = Math.floor(total / 1000) % 60
  const milli = total % 1000
  const pad = (value: number, width: number): string => String(value).padStart(width, '0')
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`
}

export function writeTtml(cues: readonly ParsedCue[]): string {
  const paragraphs = cues.map((cue) => `      <p begin="${cue.start.toFixed(3)}s" end="${cue.end.toFixed(3)}s">${cue.text}</p>`).join('\n')
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<tt xml:lang="en" xmlns="http://www.w3.org/ns/ttml">', '  <body>', '    <div>', paragraphs, '    </div>', '  </body>', '</tt>', ''].join('\n')
}
