// Canonical JSON sidecar (FR-202.1): project subset — blocks (+words) +
// speakers + the selected track's entries. parseZipscribeJson (unit-07) is
// the round-trip peer. Pure code; stable key order (JSON.stringify of a
// literal-built object).
import type { ProjectSnapshot } from '../model'
import { exportFileName, type SidecarOptions } from './cue-model'

export function toJson(snapshot: ProjectSnapshot, options: SidecarOptions): string {
  const track = options.track === 'source' ? null : (snapshot.translations.find((t) => t.language === options.track) ?? null)
  const blockIds = new Set(snapshot.blocks.map((b) => b.id))
  const entries: Record<string, { text: string; status: string }> = {}
  if (track !== null) {
    for (const [id, e] of Object.entries(track.entries)) {
      if (!blockIds.has(id)) continue
      entries[id] = { text: e.text, status: e.status }
    }
  }
  const doc = {
    zipscribe: 1,
    language: options.track === 'source' ? snapshot.language : options.track,
    blocks: snapshot.blocks.map((b) => ({
      id: b.id,
      start: b.start,
      end: b.end,
      text: b.text,
      words: b.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
      speakerId: b.speakerId,
    })),
    speakers: snapshot.speakers.map((s) => ({ id: s.id, label: s.label })),
    ...(track !== null ? { track: { language: track.language, origin: track.origin, entries } } : {}),
  }
  return JSON.stringify(doc, null, 2) + '\n'
}

export { exportFileName }
