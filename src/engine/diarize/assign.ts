// Pure speaker assignment + mutation APIs (FR-06.3, US-1.3.2/US-1.3.3,
// FR-06.5/FR-06.6). Deterministic TypeScript: no SDK imports, no DOM globals,
// no I/O, no randomness, zero async. The exported surface is the frozen
// unit-06 contract (`tests/unit/diarization/unit06-api-contract.d.ts`) plus
// the VERBATIM state-seam functions pinned by `src/state/commands/deps.ts`
// and `src/state/CONTRACT.md` § speaker-* family (`majoritySpeakerId`,
// `reassignWords` — the production `DEFAULT_COMMAND_DEPS.speakerEngine`
// re-points here).
//
// `assignSpeakers` semantics (frozen): per-word assignment is the
// duration-weighted majority of `DiarFrames` overlap over the word span;
// the winner must exceed the runner-up by at least `DIAR_HYSTERESIS_SEC`
// (0.25 s, FR-06.3) to SWITCH away from the PREVIOUS assigned word's
// speaker, otherwise the previous speaker carries over (flap suppression;
// ties — margin 0 — carry over). The first assigned word takes the plain
// majority (ties → smaller cluster, deterministic). A word with NO
// overlapping frames keeps its existing `speakerId`. Frame cluster `c` maps
// to `word.speakerId = 'SPK_' + (c + 1)` (durable ids, US-1.3.2).
// `block.speakerId` = majority over the block's words (frozen
// `majoritySpeakerId` semantics). A block whose word speakers form ONE run
// is not re-blockized (only the speaker fields are rewritten — start/end/
// text/id preserved); a block forming TWO+ runs splits at the WORD boundary
// between runs (never mid-word — domain invariant 1) by COMPOSITION with the
// unit-05 `blockize` (FR-06.3); untouched blocks pass through unchanged.
// Input is never mutated; output block order follows the input with split
// parts inserted in place.

import type { CaptionBlock, Project, Seconds, Speaker, WordToken } from '../model'
import type { DiarFrames } from '../protocol'
import { blockize } from '../asr/blockize'

/** Inclusive index range into `block.words` (the frozen reassign seam). */
export type WordRange = readonly [fromIndex: number, toIndex: number]

/** FR-06.3 word-time majority hysteresis (seconds). */
export const DIAR_HYSTERESIS_SEC = 0.25

/**
 * FR-06.6: exactly 8 deterministic, distinct `#rrggbb` palette colors.
 * The values are a design constant — asserted for shape/distinctness/
 * stability, never pinned per-hex by the suites.
 */
export const SPEAKER_PALETTE: readonly string[] = ['#4c8dff', '#ff6b6b', '#45d17e', '#ffd166', '#c084fc', '#f472b6', '#22d3ee', '#fb923c']

/**
 * FR-06.5/US-1.3.2: cluster index `i` → durable `SPK_<i+1>` with label
 * `Speaker <i+1>` and palette color `SPEAKER_PALETTE[i % 8]` (palette
 * cycles beyond 8 speakers; ids/labels stay `SPK_<n>`/`Speaker N`).
 */
export function speakersFromClusters(count: number): Speaker[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `SPK_${i + 1}`,
    label: `Speaker ${i + 1}`,
    color: SPEAKER_PALETTE[i % SPEAKER_PALETTE.length] as string,
  }))
}

/**
 * Frozen seam (deps.ts/CONTRACT.md, VERBATIM semantics): most `word.speakerId`
 * occurrences wins, earliest-in-word-order on ties, `speakerId === undefined`
 * words skipped, none at all → `fallback`. Pure.
 */
export function majoritySpeakerId(words: readonly WordToken[], fallback: string): string {
  const counts = new Map<string, number>()
  for (const word of words) {
    const id = word.speakerId
    if (id === undefined) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = 0
  for (const word of words) {
    const id = word.speakerId
    if (id === undefined) continue
    const count = counts.get(id) ?? 0
    if (count > bestCount) {
      best = id
      bestCount = count
    }
  }
  return best ?? fallback
}

/**
 * Frozen seam (deps.ts/CONTRACT.md, VERBATIM): move every word whose
 * `speakerId === fromSpeakerId` to `toSpeakerId`; everything else is passed
 * through untouched. Pure — returns a new array, never mutates the input.
 */
export function reassignWords(words: readonly WordToken[], fromSpeakerId: string, toSpeakerId: string): WordToken[] {
  return words.map((word) => (word.speakerId === fromSpeakerId ? { ...word, speakerId: toSpeakerId } : word))
}

interface WordSpeakerRun {
  speaker: string
  from: number
  to: number
}

/**
 * FR-06.3: assign `word.speakerId` from `DiarFrames` (duration-weighted
 * overlap majority + 0.25 s hysteresis), materialize `block.speakerId` by
 * the frozen majority rule, and boundary-snap split two-run blocks at word
 * boundaries via unit-05 `blockize` composition. Pure and synchronous.
 */
export function assignSpeakers(blocks: CaptionBlock[], frames: DiarFrames): CaptionBlock[] {
  const out: CaptionBlock[] = []
  for (const block of blocks) {
    const assigned = assignWordSpeakers(block.words, frames)
    const runs = wordRuns(assigned)
    if (runs.length <= 1) {
      const newWords = block.words.map((word, index) => {
        const speaker = assigned[index]
        return speaker === undefined || speaker === word.speakerId ? word : { ...word, speakerId: speaker }
      })
      out.push({ ...block, words: newWords, speakerId: majoritySpeakerId(newWords, block.speakerId) })
      continue
    }
    // Two or more runs: contiguous word spans (undefined-speaker words
    // attach to the PRECEDING run; leading ones to the first run), each span
    // re-blockized through unit-05 `blockize` — never mid-word.
    const tagged = block.words.map((word, index) => {
      const speaker = assigned[index]
      return speaker === undefined || speaker === word.speakerId ? word : { ...word, speakerId: speaker }
    })
    let lastPart: CaptionBlock | null = null
    for (let run = 0; run < runs.length; run++) {
      const current = runs[run] as WordSpeakerRun
      const next = runs[run + 1]
      const from = run === 0 ? 0 : current.from
      const to = next !== undefined ? next.from - 1 : block.words.length - 1
      const parts = blockize(tagged.slice(from, to + 1))
      for (const part of parts) {
        if (lastPart !== null && lastPart.end > part.start) {
          // Cross-span boundary: blockize pads independently per call, so
          // snap the shared edge into the inter-word gap (never mid-word).
          const boundary = roundSeconds(((lastPart.words[lastPart.words.length - 1] as WordToken).end + (part.words[0] as WordToken).start) / 2)
          lastPart.end = boundary
          part.start = boundary
        }
        part.start = roundSeconds(part.start)
        part.end = roundSeconds(part.end)
        lastPart = part
        out.push(part)
      }
    }
  }
  return out
}

/** Domain invariant 6 / the serializer's canonical rule: every WRITTEN time is 3-decimal quantized. */
function roundSeconds(value: Seconds): Seconds {
  return Math.round(value * 1000) / 1000
}

/** Per-word speaker assignment; `undefined` = word untouched by frames. */
function assignWordSpeakers(words: readonly WordToken[], frames: DiarFrames): (string | undefined)[] {
  const assigned: (string | undefined)[] = new Array<string | undefined>(words.length)
  let previous: string | undefined
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as WordToken
    const ranked = rankedOverlaps(word, frames)
    if (ranked.length === 0) {
      // No overlapping frames → keep whatever speakerId it already had.
      const kept = word.speakerId
      assigned[i] = kept
      if (kept !== undefined) previous = kept
      continue
    }
    const [winner, winnerSeconds] = ranked[0] as [number, number]
    const margin = winnerSeconds - (ranked[1]?.[1] ?? 0)
    let chosen = `SPK_${winner + 1}`
    if (previous !== undefined && chosen !== previous && margin < DIAR_HYSTERESIS_SEC) {
      chosen = previous
    }
    assigned[i] = chosen
    previous = chosen
  }
  return assigned
}

/** Frame clusters by overlap seconds over the word span, descending; ties → smaller cluster. */
function rankedOverlaps(word: WordToken, frames: DiarFrames): [number, number][] {
  const overlaps = new Map<number, number>()
  for (const frame of frames.frames) {
    const overlap = Math.min(word.end, frame.end) - Math.max(word.start, frame.start)
    if (overlap > 0) overlaps.set(frame.speaker, (overlaps.get(frame.speaker) ?? 0) + overlap)
  }
  return [...overlaps.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
}

/**
 * Maximal contiguous runs of one non-`undefined` assigned speaker (undefined
 * entries attach to the preceding run / the first run — see `assignSpeakers`);
 * each run records its FIRST word index (the split boundary source).
 */
function wordRuns(assigned: readonly (string | undefined)[]): WordSpeakerRun[] {
  const runs: WordSpeakerRun[] = []
  for (let i = 0; i < assigned.length; i++) {
    const speaker = assigned[i]
    if (speaker === undefined) continue
    const last = runs[runs.length - 1]
    if (last !== undefined && last.speaker === speaker) continue
    runs.push({ speaker, from: i, to: i })
  }
  return runs
}

/** US-1.3.2 (engine half): label updates everywhere, ids untouched (invariant 4); manual flip (invariant 5); total no-op on unknown ids. */
export function renameSpeaker(project: Project, speakerId: string, label: string): Project {
  if (!project.speakers.some((speaker) => speaker.id === speakerId)) return project
  return {
    ...project,
    speakers: project.speakers.map((speaker) => (speaker.id === speakerId ? { ...speaker, label } : speaker)),
    speakerSource: 'manual',
  }
}

/** US-1.3.3 (engine half): only the inclusive word range + the resulting block majority change; timings never move. */
export function reassign(project: Project, blockId: string, wordRange: WordRange, toSpeakerId: string): Project {
  if (!project.speakers.some((speaker) => speaker.id === toSpeakerId)) return project
  const index = project.blocks.findIndex((block) => block.id === blockId)
  if (index < 0) return project
  const block = project.blocks[index] as CaptionBlock
  const from = Math.max(0, wordRange[0])
  const to = Math.min(block.words.length - 1, wordRange[1])
  const newWords = block.words.map((word, i) => (i >= from && i <= to && word.speakerId !== toSpeakerId ? { ...word, speakerId: toSpeakerId } : word))
  if (newWords.every((word, i) => word === block.words[i])) return project
  const newBlocks = project.blocks.slice()
  newBlocks[index] = { ...block, words: newWords, speakerId: majoritySpeakerId(newWords, block.speakerId) }
  return { ...project, blocks: newBlocks, speakerSource: 'manual' }
}

/** US-1.3.3 (engine half): ALL of `b`'s words move to `a`, `b` is removed, block majorities materialized. */
export function mergeSpeakers(project: Project, a: string, b: string): Project {
  if (a === b) return project
  if (!project.speakers.some((speaker) => speaker.id === a) || !project.speakers.some((speaker) => speaker.id === b)) return project
  const newBlocks = project.blocks.map((block) => {
    // `b`'s words: explicit `speakerId === b`, or untagged words in a block
    // whose speaker IS `b` (effective attribution — a block's words inherit
    // its speakerId).
    const words = block.words.map((word) => ((word.speakerId ?? block.speakerId) === b ? { ...word, speakerId: a } : word))
    if (block.speakerId !== b && words.every((word, index) => word === block.words[index])) return block
    return { ...block, words, speakerId: majoritySpeakerId(words, block.speakerId === b ? a : block.speakerId) }
  })
  return {
    ...project,
    blocks: newBlocks,
    speakers: project.speakers.filter((speaker) => speaker.id !== b),
    speakerSource: 'manual',
  }
}

/** US-1.3.3 (engine half): `from`'s words with `start ≥ cutTime` move to a new APPENDED speaker (next free `SPK_<n>`, label `Speaker <n>`, color `newColor`); block majorities materialized. */
export function splitSpeaker(project: Project, from: string, cutTime: Seconds, newColor: string): Project {
  if (!project.speakers.some((speaker) => speaker.id === from)) return project
  const number = nextSpeakerNumber(project.speakers)
  const newId = `SPK_${number}`
  const newBlocks = project.blocks.map((block) => {
    const words = block.words.map((word) => (word.speakerId === from && word.start >= cutTime ? { ...word, speakerId: newId } : word))
    if (words.every((word, i) => word === block.words[i])) return block
    return { ...block, words, speakerId: majoritySpeakerId(words, block.speakerId) }
  })
  return {
    ...project,
    blocks: newBlocks,
    speakers: [...project.speakers, { id: newId, label: `Speaker ${number}`, color: newColor }],
    speakerSource: 'manual',
  }
}

/** Smallest `n ≥ 1` with `SPK_<n>` not already used (durable ids, label reuse only through ids). */
function nextSpeakerNumber(speakers: readonly Speaker[]): number {
  const used = new Set<number>()
  for (const speaker of speakers) {
    const match = /^SPK_(\d+)$/.exec(speaker.id)
    if (match !== null) used.add(Number(match[1]))
  }
  let number = 1
  while (used.has(number)) number += 1
  return number
}
