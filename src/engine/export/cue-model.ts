// Shared block→cue model for the sidecar serializers (FR-202.1, unit-202).
// Pure engine code: no DOM globals, no React, no network. SECURITY-03: no
// logging of transcript content anywhere in this layer.
import type { ProjectSnapshot } from '../model'

export type SidecarTrack = 'source' | (string & {})
export type SpeakerLabelMode = 'off' | 'vtt-voice' | 'prefix'

export interface SidecarOptions {
  track: SidecarTrack
  speakerLabels: SpeakerLabelMode
}

export interface ExportCue {
  start: number
  end: number
  speaker: string | null // resolved display label, or null when unavailable
  text: string // may contain '\n'; raw (each format escapes as it must)
}

const RTL_BASES = new Set(['ar', 'he', 'fa', 'ur', 'ckb', 'yi', 'ps', 'sd', 'ug'])

export function isRtlTrack(language: string): boolean {
  return RTL_BASES.has(language.toLowerCase().split(/[-_]/)[0] ?? '')
}

/** Cue source blocks/entries for the requested track. Translation tracks use
 *  the SOURCE block's timing (domain invariant — entries only carry text);
 *  failed entries are skipped. */
export function buildCues(snapshot: ProjectSnapshot, track: SidecarTrack): ExportCue[] {
  const labelOf = (speakerId: string | null): string | null => {
    if (speakerId === null) return null
    const speaker = snapshot.speakers.find((s) => s.id === speakerId)
    return speaker?.label ?? null
  }
  if (track === 'source') {
    return snapshot.blocks.map((b) => ({ start: b.start, end: b.end, speaker: labelOf(b.speakerId), text: b.text }))
  }
  const t = snapshot.translations.find((x) => x.language === track)
  if (t === undefined) return []
  const cues: ExportCue[] = []
  for (const b of snapshot.blocks) {
    const entry = t.entries[b.id]
    if (entry === undefined || entry.status === 'failed') continue
    cues.push({ start: b.start, end: b.end, speaker: labelOf(b.speakerId), text: entry.text })
  }
  return cues
}

/** HH:MM:SS<sep>mmm from seconds (millisecond rounds half-up; carries). */
export function timeCode(seconds: number, msSep: ',' | '.'): string {
  const total = Math.max(0, Math.round(seconds * 1000))
  const ms = total % 1000
  const s = Math.floor(total / 1000) % 60
  const m = Math.floor(total / 60000) % 60
  const h = Math.floor(total / 3600000)
  const p = (n: number, w: number): string => String(n).padStart(w, '0')
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)}${msSep}${p(ms, 3)}`
}

/** `{slug}[.{lang}].{ext}` (US-3.2.1 filename contract). */
export function exportFileName(projectName: string, track: SidecarTrack, ext: string): string {
  const slug =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'captions'
  return track === 'source' ? `${slug}.${ext}` : `${slug}.${track}.${ext}`
}

/** Escape a cue text so no line can be mistaken for a timing line by SRT
 *  consumers: a full `HH:MM:SS,mmm --> HH:MM:SS,mmm` text line gets the first
 *  hyphen replaced by an HTML numeric entity (reversible for entity-aware
 *  consumers; our parser's round-trip normalizes it — see tests). */
export function sanitizeTimingLines(text: string): string {
  const TIMING = /^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}$/
  return text
    .split('\n')
    .map((l) => (TIMING.test(l) ? l.replace('-', '&#45;') : l))
    .join('\n')
}

/** Wrap RTL text in RLE…PDF so bidi runs render base-right (non-source
 *  tracks only; the spec's "RTL marks"). */
export function wrapRtl(text: string, rtl: boolean): string {
  return rtl ? `\u202B${text}\u202C` : text
}

/** VTT escape matrix (US-3.2.1): `&` → `&amp;`, `<` → `&lt;` (and `>` for
 *  good measure) first; then NO `-->` may survive: remaining occurrences
 *  become `&#45;&#45;&gt;`. The unit-07 parser's decodeEntities restores all
 *  of it text-exactly. */
export function vttEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/--&gt;/g, '&#45;&#45;&gt;')
}

/** Cue text as it goes into a line-oriented container (SRT/VTT): a blank
 *  line would end the cue block, so runs of newlines collapse to one and
 *  edges are trimmed (documented in the unit report; the property test
 *  compares trimmed/collapsed text for exactness). */
export function blockText(text: string): string {
  return text
    .replace(/\n{2,}/g, '\n')
    .replace(/^[\s\n]+/, '')
    .replace(/[\s\n]+$/, '')
}
