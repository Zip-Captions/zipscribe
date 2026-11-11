// Test-owned diarization ACCEPTANCE MATH (CC-06.1) — the scorer the L4
// e2e/diarization accuracy spec runs on, and nothing else. Pure, deterministic,
// no imports: reviewers scrutinize this file, so the definitions are explicit.
//
// Definitions (documented precisely — the L1 goldens in der-metrics.test.ts
// pin them):
//
//  * Frame resolution: the timeline is rasterized onto an ABSOLUTE grid of
//    bins of `frameSec` (default 0.01 s = 10 ms — the pyannote-segmentation-3.0
//    frame period). A bin `k` covers `[k·r, (k+1)·r)`; an interval `[s, e)`
//    (half-open — adjacent words do not double-count) covers bin k when it has
//    strictly positive overlap with the bin. Bin membership:
//    k ∈ [floor(s/r), ceil(e/r) − 1].
//
//  * Dominant frame speaker over an interval (word-level): per-speaker SUM of
//    overlap seconds with `frames`; the maximum wins; exact ties resolve to the
//    SMALLER numeric speaker id; no overlap → undefined (system silence).
//
//  * Per-word speaker accuracy (CC-06.1 ≥ 85 %): each ground-truth word gets
//    its dominant system speaker (above); the system↔reference label assignment
//    is the confusion-matrix-OPTIMAL 1:1 (injective) mapping maximizing matched
//    words — brute-forced over all injective assignments (reference labels and
//    system speakers are both ≤ 8 here, so ≤ 8! permutations; larger inputs
//    throw rather than silently approximate). accuracy = matched / total words.
//
//  * DER-style error (CC-06.1 ≤ 20 %) over the SAME grid, speech-time weighted,
//    no collar (beta: single-track media, no overlap modelling):
//      totalRef = bins covered by reference words
//      miss        = reference bins with no system speaker
//      confusion   = reference bins whose (mapped) reference speaker ≠ system speaker
//      falseAlarm  = system-covered bins outside the reference speech
//      der = (miss + confusion + falseAlarm) / totalRef   (each term normalized
//            by totalRef — the classic DER normalization)
//    Reference turns of DIFFERENT speakers must not overlap (throws).
export interface GtWord {
  /** Text is carried for call-site convenience; the math NEVER reads it (SECURITY-03: only indices/numbers in failure output). */
  text?: string
  start: number
  end: number
  speaker: string
}

export interface ScoreFrame {
  start: number
  end: number
  speaker: number
  prob?: number
}

export const DEFAULT_FRAME_SEC = 0.01

/** Dominant (duration-weighted) system speaker over [start, end); ties → smaller id; silence → undefined. */
export function dominantFrameSpeaker(start: number, end: number, frames: readonly ScoreFrame[]): number | undefined {
  const overlaps = new Map<number, number>()
  for (const frame of frames) {
    const overlap = Math.min(end, frame.end) - Math.max(start, frame.start)
    if (overlap > 0) overlaps.set(frame.speaker, (overlaps.get(frame.speaker) ?? 0) + overlap)
  }
  let best: number | undefined
  let bestOverlap = 0
  for (const [speaker, overlap] of [...overlaps.entries()].sort((a, b) => a[0] - b[0])) {
    if (overlap > bestOverlap) {
      best = speaker
      bestOverlap = overlap
    }
  }
  return best
}

/**
 * Confusion-matrix-optimal 1:1 reference-label → system-speaker mapping.
 * A word matches iff its dominant system speaker equals its label's mapped
 * speaker; UNMAPPED labels match nothing (system silence is never a hit).
 * Search: per-label counts + depth-first injective assignment with a
 * skip branch (a label may stay unmapped when that scores better). Brute
 * force is bounded (labels/speakers ≤ 8 each side); larger inputs throw
 * rather than silently approximate.
 */
export function bestSpeakerMapping(words: readonly GtWord[], frames: readonly ScoreFrame[]): { mapping: Map<string, number>; matched: number; total: number } {
  const labels = [...new Set(words.map((w) => w.speaker))].sort()
  const doms = words.map((w) => dominantFrameSpeaker(w.start, w.end, frames))
  const speakers = [...new Set(doms.filter((d): d is number => d !== undefined))].sort((a, b) => a - b)
  if (labels.length > 8 || speakers.length > 8) throw new Error(`mapping space too large: ${labels.length} labels × ${speakers.length} speakers`)
  const counts = labels.map(() => new Array<number>(speakers.length).fill(0))
  const labelRow = new Map(labels.map((l, i) => [l, i]))
  const speakerCol = new Map(speakers.map((s, i) => [s, i]))
  words.forEach((w, i) => {
    const dom = doms[i]
    if (dom === undefined) return
    const row = counts[labelRow.get(w.speaker) as number]
    const col = speakerCol.get(dom) as number
    if (row !== undefined) row[col] = (row[col] ?? 0) + 1
  })
  const used = new Array<boolean>(speakers.length).fill(false)
  const mapping = new Map<string, number>()
  let best = -1
  let bestMapping = new Map<string, number>()
  const search = (li: number, matched: number): void => {
    if (li === labels.length) {
      if (matched > best) {
        best = matched
        bestMapping = new Map(mapping)
      }
      return
    }
    search(li + 1, matched) // label stays unmapped
    const label = labels[li] as string
    for (let si = 0; si < speakers.length; si++) {
      if (used[si]) continue
      used[si] = true
      mapping.set(label, speakers[si] as number)
      search(li + 1, matched + (counts[li] as number[])[si]!)
      mapping.delete(label)
      used[si] = false
    }
  }
  search(0, 0)
  return { mapping: bestMapping, matched: Math.max(0, best), total: words.length }
}

export interface WordAccuracy {
  accuracy: number
  matched: number
  total: number
  mapping: Map<string, number>
}

export function wordSpeakerAccuracy(words: readonly GtWord[], frames: readonly ScoreFrame[]): WordAccuracy {
  if (words.length === 0) return { accuracy: 0, matched: 0, total: 0, mapping: new Map() }
  const { mapping, matched, total } = bestSpeakerMapping(words, frames)
  return { accuracy: matched / total, matched, total, mapping }
}

export interface DerBreakdown {
  der: number
  miss: number
  falseAlarm: number
  confusion: number
  totalRefBins: number
  frameSec: number
}

function binsOf(start: number, end: number, frameSec: number): number[] {
  const from = Math.floor(start / frameSec)
  const to = Math.ceil(end / frameSec) - 1
  const out: number[] = []
  for (let k = from; k <= to; k++) out.push(k)
  return out
}

export function derStyle(words: readonly GtWord[], frames: readonly ScoreFrame[], opts: { frameSec?: number; mapping?: Map<string, number> } = {}): DerBreakdown {
  const frameSec = opts.frameSec ?? DEFAULT_FRAME_SEC
  if (!(frameSec > 0)) throw new Error(`frameSec must be positive, got ${frameSec}`)
  const ref = new Map<number, string>()
  for (const word of words) {
    for (const bin of binsOf(word.start, word.end, frameSec)) {
      const existing = ref.get(bin)
      if (existing !== undefined && existing !== word.speaker) throw new Error(`overlapping reference turns at bin ${bin}`)
      ref.set(bin, word.speaker)
    }
  }
  const mapping = opts.mapping ?? bestSpeakerMapping(words, frames).mapping
  const system = new Map<number, number>()
  for (const bin of new Set(frames.flatMap((frame) => binsOf(frame.start, frame.end, frameSec)))) {
    const lo = bin * frameSec
    const speaker = dominantFrameSpeaker(lo, lo + frameSec, frames)
    if (speaker !== undefined) system.set(bin, speaker)
  }
  const totalRefBins = ref.size
  if (totalRefBins === 0) return { der: 0, miss: 0, falseAlarm: 0, confusion: 0, totalRefBins: 0, frameSec }
  let miss = 0
  let confusion = 0
  for (const [bin, label] of ref) {
    const speaker = system.get(bin)
    if (speaker === undefined) miss += 1
    else if (speaker !== mapping.get(label)) confusion += 1
  }
  let falseAlarm = 0
  for (const bin of system.keys()) if (!ref.has(bin)) falseAlarm += 1
  return { der: (miss + confusion + falseAlarm) / totalRefBins, miss: miss / totalRefBins, falseAlarm: falseAlarm / totalRefBins, confusion: confusion / totalRefBins, totalRefBins, frameSec }
}

/** Median over an odd-sized run set (CC-06.1 "3-run median", no cherry-picking). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of empty set')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}
