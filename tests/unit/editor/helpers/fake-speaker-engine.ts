// SpeakerEngine double (FR-102.1 speaker-* seam). engine-06 is unmerged:
// tests exercise the command wiring through THIS fake only; when
// `src/engine/diarize/assign.ts` lands, the same suites swap `deps.speakerEngine`
// for the real pure fns without touching assertions (contract header ASSUMPTION).
import type { WordToken } from '@engine/model@102'
import type { SpeakerEngine } from '@state/history'

export interface FakeSpeakerEngine extends SpeakerEngine {
  readonly calls: { fn: 'majoritySpeakerId' | 'reassignWords'; arg: string }[]
  /** When set, `majoritySpeakerId` returns this instead of computing. */
  nextMajority: string | null
}

export function createFakeSpeakerEngine(): FakeSpeakerEngine {
  const calls: FakeSpeakerEngine['calls'] = []
  let nextMajority: string | null = null
  return {
    calls,
    get nextMajority() {
      return nextMajority
    },
    set nextMajority(value: string | null) {
      nextMajority = value
    },
    majoritySpeakerId: (words, fallback) => {
      calls.push({ fn: 'majoritySpeakerId', arg: String(words.length) })
      if (nextMajority !== null) return nextMajority
      // Same rule the contract freezes for engine-06: count ids, most wins,
      // earliest-in-order on ties, none → fallback.
      const counts = new Map<string, number>()
      for (const w of words) {
        if (w.speakerId === undefined) continue
        counts.set(w.speakerId, (counts.get(w.speakerId) ?? 0) + 1)
      }
      let best: string | null = null
      let bestCount = 0
      for (const w of words) {
        const id = w.speakerId
        if (id === undefined) continue
        const c = counts.get(id) ?? 0
        if (c > bestCount) {
          best = id
          bestCount = c
        }
      }
      return best ?? fallback
    },
    reassignWords: (words, from, to) => {
      calls.push({ fn: 'reassignWords', arg: `${from}→${to}` })
      return words.map((w) => (w.speakerId === from ? { ...w, speakerId: to } : { ...w }))
    },
  }
}
