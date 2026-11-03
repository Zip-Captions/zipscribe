// FR-07.3 — `importCaptions(project, file, { as, … }) → { project, report }`,
// the caption-import mapper (domain job lifecycle: decoding-text → parsing →
// mapping(report) → done/error). Pure over injected input; async only for the
// FR-07.7 event-loop yield (forwarded to the parser) and the US-07.2
// LanguageDetector seam (the API is Window-only — the UI injects it, so the
// engine never touches `window`).
//
// as 'source': REPLACES `project.blocks` — cue segmentation and text are
// preserved exactly (domain invariant 12; the pinned estimation rule is
// estimate-timing's), VTT `<v>` voices and FR-07.5 speaker prefixes become
// speakers (`speakerSource:'manual'`, stable new `SPK_` ids), invariant 11
// fixes are clamped/fixed/dropped and COUNTED, `captionOrigin='imported'`;
// existing translations are dropped unless the user confirmed keeping them
// (confirmed `imported` tracks are reconciled: entries whose block id no
// longer exists are dropped — domain invariant 10).
// as { translation }: each cue → source block with MAXIMUM positive time
// overlap; several cues on one block space-join; cues overlapping no block
// are dropped and counted `CUE_UNMATCHED`; track `origin:'imported'`,
// entries `status:'edited'`; at most one track per language.
//
// Guards BEFORE any cue processing (FR-07.7): > 20 MiB → 'FILE_TOO_LARGE'.
// After parsing: > 100 000 cues → 'TOO_MANY_CUES'. On any failure the input
// project object is untouched (US-07.1 — nothing here mutates it).
// SECURITY-03/FR-07.6: failures carry codes/numbers/line numbers only —
// never caption text; nothing is ever logged.

import type { CaptionBlock, Project, Seconds, Speaker, TranslationEntry, WordToken } from '../model'
import type { CaptionEncoding, CaptionFormat, ParseResult, ParsedCue } from './types'

/** Verbatim from `knowledge/architecture.md` § engine/captions (ImportReport). */
export interface ImportReport {
  format: CaptionFormat
  encoding: string
  cues: number
  blocks: number
  detectedLanguage: string | null
  adjustments: {
    code: 'OVERLAP_CLAMPED' | 'ZERO_DURATION_FIXED' | 'TAGS_STRIPPED' | 'POSITION_DROPPED' | 'STYLE_DROPPED' | 'EMPTY_CUE_DROPPED' | 'CUE_UNMATCHED'
    count: number
  }[]
}
import { decodeCaptionBytes } from './decode-text'
import { CaptionFailureError } from './failure'
import { estimateCueWords } from './estimate-timing'
import { sourceTextHash } from './qc'
import { parseSrt } from './parse/srt'
import { parseVtt } from './parse/vtt'
import { parseSbv } from './parse/sbv'
import { parseTtml } from './parse/ttml'
import { parseAss } from './parse/ass'
import { parseZipscribeJson } from './parse/json'
import { stripTags } from './parse/shared'

export interface CaptionFileInput {
  /** File name; the extension is only a detection tie-breaker (FR-07.2). */
  name: string
  bytes: Uint8Array
}

export interface ImportOptions {
  as: 'source' | { translation: string }
  /** Re-decode override (FR-07.1); omit for BOM → strict UTF-8 → windows-1252 sniff. */
  encoding?: CaptionEncoding
  /** Source mode: keep pre-existing translation tracks (dialog confirm). Default false → they are dropped (all keys would be unmatched — domain invariant 10). */
  keepTranslations?: boolean
  /** FR-07.5. 'auto' (default) = apply when ≥ 30 % of cues match the heuristic. */
  speakerPrefixes?: 'auto' | 'on' | 'off'
  /** US-07.2 LanguageDetector seam (injected by the UI; engine stays Window-free). Called at most once, with a ≤ 2 KB cue-text sample. */
  detectLanguage?: (sample: string) => Promise<string | null>
  /** Event-loop yield seam forwarded to the parser (FR-07.7). */
  scheduleYield?: () => Promise<void>
}

export interface ImportOutcome {
  project: Project
  report: ImportReport
}

/** FR-07.7 size guards. */
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_CUES = 100_000
/** US-07.2: the detector sample is ≤ 2 KB of cue text. */
const DETECTOR_SAMPLE_LIMIT_BYTES = 2_048
/** FR-07.5 dialog default. */
const PREFIX_SUGGEST_RATIO = 0.3
/** Domain invariant 11: zero/negative durations become this. */
const ZERO_DURATION_SEC: Seconds = 0.1

/** Report order — the emission order of the mapping pipeline (frozen goldens pin it). */
const ADJUSTMENT_ORDER: ImportReport['adjustments'][number]['code'][] = ['OVERLAP_CLAMPED', 'ZERO_DURATION_FIXED', 'TAGS_STRIPPED', 'POSITION_DROPPED', 'STYLE_DROPPED', 'EMPTY_CUE_DROPPED', 'CUE_UNMATCHED']

const SPEAKER_PALETTE = ['#4F8EF7', '#F76E6E', '#4FBF7F', '#F7B32B', '#A78BFA', '#22C3D6', '#F78ED1', '#8DB427']

let idSalt = 0

function newId(prefix: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? `${prefix}${crypto.randomUUID()}` : `${prefix}${Date.now().toString(36)}-${(idSalt += 1).toString(36)}`
}

/** Domain invariant 6. */
function round3(value: number): Seconds {
  const rounded = Math.round(value * 1000) / 1000
  return rounded === 0 ? 0 : rounded
}

/** Invariant 2 join (block.text is always derived from the words). */
function textFromWords(words: readonly WordToken[]): string {
  let text = ''
  words.forEach((word, index) => {
    text += word.text
    if (index < words.length - 1) text += word.breakAfter ? '\n' : ' '
  })
  return text
}

// --- FR-07.5 speaker-prefix heuristic ----------------------------------------

const BRACKET_PREFIX = /^\[([^\]\r\n]{1,20})\]:[ \t]+(.*)$/
/** 1–20-char run of A–Z 0–9 space . ' - ending in ': ' — uppercase only, not lowercase. */
const NAME_PREFIX = /^([A-Z0-9 .'-]{1,20}):[ \t]+(.*)$/
/** Dialogue dash: the label is the literal '-' (the dialog renames). */
const DASH_PREFIX = /^-[ \t]+(.*)$/

export function parseSpeakerPrefix(line: string): { speaker: string; text: string } | null {
  const bracket = BRACKET_PREFIX.exec(line)
  if (bracket?.[1] && bracket[2] !== undefined) return { speaker: bracket[1].trim(), text: bracket[2] }
  const name = NAME_PREFIX.exec(line)
  if (name?.[1]?.trim() && name[2] !== undefined) return { speaker: name[1].trim(), text: name[2] }
  const dash = DASH_PREFIX.exec(line)
  if (dash?.[1] !== undefined) return { speaker: '-', text: dash[1] }
  return null
}

export function speakerPrefixStats(cues: readonly ParsedCue[]): { matchRatio: number; suggestEnabled: boolean } {
  if (cues.length === 0) return { matchRatio: 0, suggestEnabled: false }
  let matched = 0
  for (const cue of cues) {
    const firstLine = cue.text.split('\n', 1)[0] ?? ''
    if (parseSpeakerPrefix(firstLine) !== null) matched += 1
  }
  const matchRatio = matched / cues.length
  return { matchRatio, suggestEnabled: matchRatio >= PREFIX_SUGGEST_RATIO }
}

// --- FR-07.2 format sniffing ---------------------------------------------------

const EXTENSION_FORMATS: [string, CaptionFormat][] = [
  ['.zipscribe.json', 'zipscribe-json'],
  ['.json', 'zipscribe-json'],
  ['.srt', 'srt'],
  ['.vtt', 'vtt'],
  ['.sbv', 'sbv'],
  ['.ttml', 'ttml'],
  ['.dfxp', 'ttml'],
  ['.xml', 'ttml'],
  ['.ass', 'ass'],
  ['.ssa', 'ass'],
]

const SBV_TIMING_LINE = /^[ \t]*\d{1,2}:[0-5]\d:[0-5]\d\.\d{1,3}[ \t]*,[ \t]*\d{1,2}:[0-5]\d:[0-5]\d\.\d{1,3}[ \t]*$/m

/** Content sniff first, extension tie-break only (FR-07.2). */
function sniffFormat(text: string, name: string): CaptionFormat {
  if (/^[ \t\r\n]*\{/.test(text)) return 'zipscribe-json'
  if (/<tt[\s>]/i.test(text)) return 'ttml'
  if (/^WEBVTT([ \t]|$)/.test(text.replace(/\r\n?/g, '\n').split('\n', 1)[0] ?? '')) return 'vtt'
  if (/(^|\n)[ \t]*\[events\]/i.test(text) || /^Dialogue:[ \t]*/m.test(text)) return 'ass'
  if (text.includes('-->')) return 'srt'
  if (SBV_TIMING_LINE.test(text)) return 'sbv'
  const lower = name.toLowerCase()
  for (const [suffix, format] of EXTENSION_FORMATS) {
    if (lower.endsWith(suffix)) return format
  }
  throw new CaptionFailureError('UNRECOGNIZED_FORMAT', 'no caption format could be sniffed from the file content', { detail: `byteLength ${text.length}` })
}

// --- adjustment scan (invariant 11 counts + what the parser stripped) ----------
// The parsers report what the FILE said (frozen contract); the importer owns
// the report. Content-drop counts are derived from the raw decoded text,
// mirroring each parser's block structure — counts only, cue text never
// leaves this function.

const HAS_TAGISH = /<\/?[a-zA-Z0-9][^>]*>/
const VOICE_TAGISH = /<\/?v\b[^>]*>/gi
const HAS_OVERRIDE = /\{[^}]*\}/
const ASS_OVERRIDE = /\{[^}]*\}/g
const VTT_SETTINGS = /-->\s*(?:\d{1,3}:)?[0-5]\d:[0-5]\d\.\d{1,3}[ \t]+\S/
const TTML_INNER = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi

interface ScanResult {
  /** Per parsed cue (file order), whether the parser stripped formatting/tag content from it. */
  tagFlags: boolean[]
  position: number
  style: number
}

function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

function scanCues(format: CaptionFormat, text: string): ScanResult {
  const scan: ScanResult = { tagFlags: [], position: 0, style: 0 }
  if (format === 'zipscribe-json') return scan
  if (format === 'ttml') {
    for (const match of text.matchAll(TTML_INNER)) {
      const inner = match[1] ?? ''
      scan.tagFlags.push(HAS_TAGISH.test(inner) && stripTags(inner).trim() !== '')
    }
    return scan
  }
  if (format === 'ass') {
    for (const line of toLines(text)) {
      const dialogue = /^Dialogue:[ \t]*(.*)$/.exec(line)
      if (!dialogue) continue
      const fields = (dialogue[1] ?? '').split(',')
      if (fields.length < 10) continue
      const raw = fields.slice(9).join(',')
      const stripped = raw.replace(ASS_OVERRIDE, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ')
      scan.tagFlags.push(HAS_OVERRIDE.test(raw) && stripped.trim() !== '')
    }
    return scan
  }
  const lines = toLines(text)
  let at = 0
  if (format === 'vtt') {
    // Signature line + header block (Language:) up to the first blank line.
    at = 1
    while (at < lines.length && lines[at]!.trim() !== '') at += 1
  }
  while (at < lines.length) {
    while (at < lines.length && lines[at]!.trim() === '') at += 1
    if (at >= lines.length) break
    const block: string[] = []
    while (at < lines.length && lines[at]!.trim() !== '') {
      block.push(lines[at]!)
      at += 1
    }
    if (format === 'vtt') {
      const keyword = block[0]!.trim().split(/[ \t]/)[0]!.toUpperCase()
      if (keyword === 'NOTE' || keyword === 'REGION') continue
      if (keyword === 'STYLE') {
        scan.style += 1
        continue
      }
    } else if (format === 'srt' && /^\s*\d+\s*$/.test(block[0]!)) {
      block.shift()
    }
    const timingIndex = block.findIndex((line) => line.includes('-->') || (format === 'sbv' && SBV_TIMING_LINE.test(line)))
    const raw = block.slice(timingIndex + 1).join('\n')
    if (timingIndex >= 0 && VTT_SETTINGS.test(block[timingIndex]!)) scan.position += 1
    const stripped = stripTags(raw)
    // VTT `<v>` voice spans are speakers, not stripped formatting.
    const formatTags = format === 'vtt' ? HAS_TAGISH.test(raw.replace(VOICE_TAGISH, '')) : HAS_TAGISH.test(raw)
    scan.tagFlags.push(formatTags && stripped.trim() !== '')
  }
  return scan
}

// --- source-mode cue fixing (domain invariant 11) ------------------------------

interface MappedCue {
  start: Seconds
  end: Seconds
  text: string
  voice?: string
  speaker?: string
}

// --- main entry ------------------------------------------------------------------

export async function importCaptions(project: Project, file: CaptionFileInput, opts: ImportOptions): Promise<ImportOutcome> {
  if (file.bytes.byteLength > MAX_FILE_BYTES) {
    throw new CaptionFailureError('FILE_TOO_LARGE', 'caption file exceeds the 20 MiB limit', { detail: `byteLength ${file.bytes.byteLength}` })
  }
  const decoded = decodeCaptionBytes(file.bytes, { encoding: opts.encoding })
  const format = sniffFormat(decoded.text, file.name)
  const parsed = await parseCaptions(format, decoded.text, opts.scheduleYield)
  if (parsed.cues.length > MAX_CUES) {
    throw new CaptionFailureError('TOO_MANY_CUES', 'caption file exceeds the 100 000 cue limit', { detail: `cues ${parsed.cues.length}` })
  }

  const scan = scanCues(parsed.format, decoded.text)
  const adjustments = new Map<ImportReport['adjustments'][number]['code'], number>()
  if (scan.position > 0) adjustments.set('POSITION_DROPPED', scan.position)
  if (scan.style > 0) adjustments.set('STYLE_DROPPED', scan.style)

  const translationLanguage = typeof opts.as === 'object' ? opts.as.translation : null
  const cues: MappedCue[] = []
  let emptyDropped = 0
  let tagsStripped = 0
  const keepCue = (index: number, cue: MappedCue): void => {
    if (cue.text.trim() === '') {
      emptyDropped += 1
      return
    }
    if (scan.tagFlags[index] === true) tagsStripped += 1
    cues.push(cue)
  }
  if (translationLanguage === null) {
    const mode = opts.speakerPrefixes ?? 'auto'
    const usePrefixes = mode === 'on' || (mode === 'auto' && speakerPrefixStats(parsed.cues).suggestEnabled)
    parsed.cues.forEach((cue, index) => {
      let mapped: MappedCue = { start: cue.start, end: cue.end, text: cue.text, ...(cue.voice === undefined ? {} : { voice: cue.voice }) }
      if (usePrefixes) {
        const firstLine = cue.text.split('\n', 1)[0] ?? ''
        const prefix = parseSpeakerPrefix(firstLine)
        if (prefix !== null) {
          const rest = cue.text.includes('\n') ? cue.text.slice(firstLine.length) : ''
          mapped = { ...mapped, text: prefix.text + rest, speaker: prefix.speaker }
        }
      }
      keepCue(index, mapped)
    })
    if (emptyDropped > 0) adjustments.set('EMPTY_CUE_DROPPED', emptyDropped)
    clampAndFix(cues, adjustments)
  } else {
    parsed.cues.forEach((cue, index) => {
      keepCue(index, { start: cue.start, end: cue.end, text: cue.text, ...(cue.voice === undefined ? {} : { voice: cue.voice }) })
    })
    if (emptyDropped > 0) adjustments.set('EMPTY_CUE_DROPPED', emptyDropped)
  }
  if (tagsStripped > 0) adjustments.set('TAGS_STRIPPED', tagsStripped)

  let detectedLanguage = parsed.language
  if (translationLanguage === null && detectedLanguage === null && opts.detectLanguage !== undefined && cues.length > 0) {
    const sample = buildDetectorSample(cues)
    if (sample !== '') detectedLanguage = await opts.detectLanguage(sample)
  }

  const buildReport = (blocks: number): ImportReport => ({
    format: parsed.format,
    encoding: decoded.encoding,
    cues: parsed.cues.length,
    blocks,
    detectedLanguage,
    adjustments: ADJUSTMENT_ORDER.filter((code) => (adjustments.get(code) ?? 0) > 0).map((code) => ({ code, count: adjustments.get(code)! })),
  })

  if (translationLanguage !== null) {
    const entries: Record<string, TranslationEntry> = {}
    let unmatched = 0
    for (const cue of cues) {
      const block = maximumOverlapBlock(project.blocks, cue)
      if (block === null) {
        unmatched += 1
        continue
      }
      entries[block.id] = entries[block.id] === undefined ? { text: cue.text, status: 'edited', sourceHash: sourceTextHash(block.text) } : { ...entries[block.id]!, text: `${entries[block.id]!.text} ${cue.text}` }
    }
    if (unmatched > 0) adjustments.set('CUE_UNMATCHED', unmatched)
    const track = { language: translationLanguage, origin: 'imported' as const, engine: null, entries }
    return {
      project: { ...project, translations: [...project.translations.filter((existing) => existing.language !== translationLanguage), track] },
      report: buildReport(project.blocks.length),
    }
  }

  const speakerIds = new Map<string, string>()
  const speakers: Speaker[] = []
  let namedSpeakerSeen = false
  const speakerFor = (label: string | undefined): string => {
    const named = label !== undefined
    const key = label ?? 'Unknown'
    if (named) namedSpeakerSeen = true
    const existing = speakerIds.get(key)
    if (existing !== undefined) return existing
    const id = newId('SPK_')
    speakerIds.set(key, id)
    speakers.push({ id, label: key, color: SPEAKER_PALETTE[speakers.length % SPEAKER_PALETTE.length]! })
    return id
  }

  const blocks: CaptionBlock[] = cues.map((cue) => {
    const words = estimateCueWords(cue)
    return {
      id: newId(''),
      start: cue.start,
      end: cue.end,
      text: textFromWords(words),
      words,
      speakerId: speakerFor(cue.voice ?? cue.speaker),
    }
  })

  // FR-07.3 confirm-gate: kept tracks must not dangle — source replacement
  // mints new block ids, so an 'imported' track's keys (the cues-to-block
  // mappings of a previous import) that no longer resolve are dropped, the
  // FR-07.3 "unmatched are dropped" rule reapplied on reconciliation (domain
  // invariant 10). 'machine'/'manual' tracks are confirmed user assets and
  // stay as they were (QC flags drift via sourceHash on surviving blocks).
  const blockIds = new Set(blocks.map((block) => block.id))
  const keptTranslations = opts.keepTranslations === true
    ? project.translations.map((track) => {
        if (track.origin !== 'imported') return track
        const entries: Record<string, TranslationEntry> = {}
        for (const [blockId, entry] of Object.entries(track.entries)) {
          if (blockIds.has(blockId)) entries[blockId] = entry
        }
        return { ...track, entries }
      })
    : []

  return {
    project: {
      ...project,
      blocks,
      speakers,
      speakerSource: namedSpeakerSeen ? 'manual' : project.speakerSource,
      captionOrigin: 'imported',
      translations: keptTranslations,
    },
    report: buildReport(cues.length),
  }
}

async function parseCaptions(format: CaptionFormat, text: string, scheduleYield: (() => Promise<void>) | undefined): Promise<ParseResult> {
  const opts = { scheduleYield }
  switch (format) {
    case 'srt':
      return parseSrt(text, opts)
    case 'vtt':
      return parseVtt(text, opts)
    case 'sbv':
      return parseSbv(text, opts)
    case 'ttml':
      return parseTtml(text, opts)
    case 'ass':
      return parseAss(text, opts)
    case 'zipscribe-json':
      return parseZipscribeJson(text, opts)
  }
}

/** Zero/negative-duration repair (invariant 11): 0.1 s, never past `capSec`. */
function repairZeroDuration(start: Seconds, capSec: Seconds): Seconds {
  return Math.max(start, Math.min(round3(start + ZERO_DURATION_SEC), capSec))
}

/**
 * Domain invariant 11, counted, never silent: file-order pass — an earlier
 * cue whose end passes a later cue's start ends at that start
 * (OVERLAP_CLAMPED); a zero/negative duration becomes 0.1 s
 * (ZERO_DURATION_FIXED), a clamp-induced one never past the later cue's
 * start (prev.end ≤ next.start survives the repair). The cues are then
 * ordered ascending by start (invariant 1 "blocks ordered" — file order is
 * the stable tie-break) and a final pass re-clamps neighbour pairs the
 * file-order pass could not compare; a pair already clamped (and counted)
 * above is repaired without a second OVERLAP_CLAMPED count.
 * (EMPTY_CUE_DROPPED happens before this pass.)
 */
function clampAndFix(cues: MappedCue[], adjustments: Map<ImportReport['adjustments'][number]['code'], number>): void {
  let overlaps = 0
  let zeros = 0
  const originalIndex = new Map<MappedCue, number>()
  cues.forEach((cue, index) => originalIndex.set(cue, index))
  const pairKey = (a: MappedCue, b: MappedCue): string => {
    const ia = originalIndex.get(a)!
    const ib = originalIndex.get(b)!
    return ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`
  }
  const clampedPairs = new Set<string>()
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index]!
    if (cue.end <= cue.start) {
      cue.end = round3(cue.start + ZERO_DURATION_SEC)
      zeros += 1
    }
    if (index > 0) {
      const previous = cues[index - 1]!
      if (previous.end > cue.start) {
        previous.end = cue.start
        overlaps += 1
        clampedPairs.add(pairKey(previous, cue))
        if (previous.end <= previous.start) {
          previous.end = repairZeroDuration(previous.start, cue.start)
          zeros += 1
        }
      }
    }
  }
  cues.sort((a, b) => a.start - b.start)
  for (let at = 1; at < cues.length; at++) {
    const previous = cues[at - 1]!
    const cue = cues[at]!
    if (previous.end > cue.start) {
      previous.end = cue.start
      const pair = pairKey(previous, cue)
      if (!clampedPairs.has(pair)) {
        clampedPairs.add(pair)
        overlaps += 1
      }
      if (previous.end <= previous.start) {
        previous.end = repairZeroDuration(previous.start, cue.start)
        zeros += 1
      }
    }
  }
  if (overlaps > 0) adjustments.set('OVERLAP_CLAMPED', overlaps)
  if (zeros > 0) adjustments.set('ZERO_DURATION_FIXED', zeros)
}

/** US-07.2: cue texts up to a ≤ 2 KB UTF-8 sample, joined with newlines. */
function buildDetectorSample(cues: readonly MappedCue[]): string {
  const encoder = new TextEncoder()
  let sample = ''
  for (const cue of cues) {
    const candidate = sample === '' ? cue.text : `${sample}\n${cue.text}`
    if (encoder.encode(candidate).byteLength > DETECTOR_SAMPLE_LIMIT_BYTES) break
    sample = candidate
  }
  return sample
}

/** FR-07.3: the source block with MAXIMUM positive overlap with the cue (first on ties). */
function maximumOverlapBlock(blocks: readonly CaptionBlock[], cue: MappedCue): CaptionBlock | null {
  let best: CaptionBlock | null = null
  let bestOverlap = 0
  for (const block of blocks) {
    const overlap = Math.min(cue.end, block.end) - Math.max(cue.start, block.start)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = block
    }
  }
  return best
}
