// Canonical project serialization (FR-102.9, domain invariant 8) — the ONE
// canonical byte form used by autosave, `.zipscribe.json` export and every
// golden. Rules (frozen by tests/unit/editor/unit102-api-contract.d.ts §
// '@state/services/serialize' + fixtures/golden/project-canonical-v1.json):
// recursively SORTED object keys (`Array#sort` code-unit order), `undefined`-
// valued keys omitted, every number rounded with the 3-decimal rule
// (`Math.round(v * 1000) / 1000`), compact output (no whitespace), strings
// escaped exactly as `JSON.stringify` escapes them.
//
// SECURITY-03: malformed input surfaces a CODE-only `ZipscribeError` subclass —
// never an input fragment (the native JSON.parse message embeds content).

import type { Project } from '../../engine/model'

/** Frozen canonical number precision (domain invariant 8). */
export const SERIALIZE_PRECISION_DIGITS = 3 as const

const PRECISION_FACTOR = 10 ** SERIALIZE_PRECISION_DIGITS

/** Codes the parse-side validator surfaces (SECURITY-03: codes, never content). */
export type ProjectParseErrorCode =
  'INVALID_JSON' | 'INVALID_PROJECT' | 'INVALID_ASSET' | 'INVALID_BLOCK' | 'INVALID_WORD' | 'INVALID_SPEAKER' | 'INVALID_TRANSLATION' | 'INVALID_STYLE' | 'INVALID_NUMBER' | 'INVALID_TYPE'

/** Base of the state-services error lineage (the contract's "ZipscribeError"). */
export class ZipscribeError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'ZipscribeError'
    this.code = code
  }
}

/** Strict-inverse failure of `parseProject` — message is the CODE only. */
export class ProjectParseError extends ZipscribeError {
  constructor(code: ProjectParseErrorCode) {
    super(code)
    this.name = 'ProjectParseError'
  }
}

/**
 * The 3-decimal rule, overflow-safe (CS.8, unit-102 adversary): scaling by
 * 1000 pushes |v| beyond MAX_VALUE into Infinity for 1e305-scale FINITE
 * inputs, which JSON.stringify would then render as `null` — breaking the
 * invariant-8 parse∘serialize roundtrip. Above the threshold the ulp
 * (≈2e289) dwarfs 0.001, so rounding is the identity anyway; -0 normalizes
 * to 0 (canonical value domain).
 */
function round3(value: number): number {
  if (Math.abs(value) >= Number.MAX_VALUE / PRECISION_FACTOR) return value
  const rounded = Math.round(value * PRECISION_FACTOR) / PRECISION_FACTOR
  return rounded === 0 ? 0 : rounded
}

function canonicalizeValue(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number': {
      if (!Number.isFinite(value)) throw new ProjectParseError('INVALID_NUMBER')
      return JSON.stringify(round3(value))
    }
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) {
        const items = (value as readonly unknown[]).map((item) => (item === undefined ? 'null' : canonicalizeValue(item)))
        return `[${items.join(',')}]`
      }
      const proto: unknown = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) throw new ProjectParseError('INVALID_TYPE')
      const parts: string[] = []
      for (const key of Object.keys(value).sort()) {
        const item = (value as Record<string, unknown>)[key]
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue
        parts.push(`${JSON.stringify(key)}:${canonicalizeValue(item)}`)
      }
      return `{${parts.join(',')}}`
    }
    default:
      throw new ProjectParseError('INVALID_TYPE')
  }
}

/** Canonical compact JSON bytes of any plain (Project-shaped) value. */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value)
}

/** The autosave/export/golden byte form of a project (invariant 8). */
export function serializeProject(project: Project): string {
  return canonicalizeValue(project)
}

// ── strict inverse ───────────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return isString(value) && (allowed as readonly string[]).includes(value)
}

function optionalString(value: unknown): boolean {
  return value === undefined || isString(value)
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value)
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function requireString(value: Record<string, unknown>, key: string, code: ProjectParseErrorCode): void {
  if (!isString(value[key])) throw new ProjectParseError(code)
}

function requireFinite(value: Record<string, unknown>, key: string, code: ProjectParseErrorCode): void {
  if (!isFiniteNumber(value[key])) throw new ProjectParseError(code)
}

const ASSET_KINDS = ['video', 'audio'] as const
const CAPTION_ORIGINS = ['none', 'transcribed', 'imported', 'mixed'] as const
const SPEAKER_SOURCES = ['none', 'auto-beta', 'manual'] as const
const OUTPUT_ASPECTS = ['source', '16:9', '9:16', '1:1', '4:5'] as const
const TRANSCRIPTION_STATES = ['none', 'partial', 'complete'] as const
const WORD_TIMINGS = ['asr', 'aligned', 'estimated', 'manual'] as const
const ENTRY_STATUSES = ['translated', 'edited', 'failed'] as const
const TRACK_ORIGINS = ['machine', 'imported', 'manual'] as const
const TEXT_TRANSFORMS = ['none', 'lowercase', 'uppercase'] as const
const POSITIONS = ['top', 'center', 'bottom'] as const
const ALIGNMENTS = ['left', 'center', 'right'] as const
const HIGHLIGHT_MODES = ['none', 'karaoke', 'bold-active'] as const

function parseWord(value: unknown): void {
  if (!isObject(value)) throw new ProjectParseError('INVALID_WORD')
  requireString(value, 'text', 'INVALID_WORD')
  requireFinite(value, 'start', 'INVALID_WORD')
  requireFinite(value, 'end', 'INVALID_WORD')
  if (!optionalFiniteNumber(value['probability']) || !optionalString(value['speakerId']) || !optionalBoolean(value['breakAfter']) || !oneOf(value['timing'] ?? 'asr', WORD_TIMINGS)) {
    throw new ProjectParseError('INVALID_WORD')
  }
}

function parseBlock(value: unknown): void {
  if (!isObject(value)) throw new ProjectParseError('INVALID_BLOCK')
  requireString(value, 'id', 'INVALID_BLOCK')
  requireString(value, 'text', 'INVALID_BLOCK')
  requireString(value, 'speakerId', 'INVALID_BLOCK')
  requireFinite(value, 'start', 'INVALID_BLOCK')
  requireFinite(value, 'end', 'INVALID_BLOCK')
  if (!optionalFiniteNumber(value['confidence']) || !optionalBoolean(value['retimeFromWords']) || !Array.isArray(value['words'])) {
    throw new ProjectParseError('INVALID_BLOCK')
  }
  for (const word of value['words']) parseWord(word)
}

function parseAsset(value: unknown): void {
  if (!isObject(value)) throw new ProjectParseError('INVALID_ASSET')
  requireString(value, 'id', 'INVALID_ASSET')
  requireString(value, 'name', 'INVALID_ASSET')
  requireString(value, 'container', 'INVALID_ASSET')
  if (!oneOf(value['kind'], ASSET_KINDS) || !(value['audioCodec'] === null || isString(value['audioCodec'])) || !(value['videoCodec'] === null || isString(value['videoCodec']))) {
    throw new ProjectParseError('INVALID_ASSET')
  }
  requireFinite(value, 'duration', 'INVALID_ASSET')
  requireFinite(value, 'width', 'INVALID_ASSET')
  requireFinite(value, 'height', 'INVALID_ASSET')
  requireFinite(value, 'fps', 'INVALID_ASSET')
  const fingerprint = value['fingerprint']
  if (
    !isObject(fingerprint) ||
    !isString(fingerprint['name']) ||
    !isFiniteNumber(fingerprint['size']) ||
    !isFiniteNumber(fingerprint['durationMs']) ||
    !Array.isArray(fingerprint['sampleHashes']) ||
    fingerprint['sampleHashes'].length !== 3 ||
    !fingerprint['sampleHashes'].every(isString)
  ) {
    throw new ProjectParseError('INVALID_ASSET')
  }
}

function parseSpeaker(value: unknown): void {
  if (!isObject(value)) throw new ProjectParseError('INVALID_SPEAKER')
  requireString(value, 'id', 'INVALID_SPEAKER')
  requireString(value, 'label', 'INVALID_SPEAKER')
  requireString(value, 'color', 'INVALID_SPEAKER')
}

function parseTranslationTrack(value: unknown): void {
  if (!isObject(value)) throw new ProjectParseError('INVALID_TRANSLATION')
  requireString(value, 'language', 'INVALID_TRANSLATION')
  if (!oneOf(value['origin'], TRACK_ORIGINS) || !(value['engine'] === null || value['engine'] === 'chrome-translator') || !isObject(value['entries'])) {
    throw new ProjectParseError('INVALID_TRANSLATION')
  }
  for (const entry of Object.values(value['entries'])) {
    if (!isObject(entry) || !isString(entry['text']) || !isString(entry['sourceHash']) || !oneOf(entry['status'], ENTRY_STATUSES)) {
      throw new ProjectParseError('INVALID_TRANSLATION')
    }
  }
}

function parseStyle(value: unknown): void {
  if (!isObject(value)) throw new ProjectParseError('INVALID_STYLE')
  requireString(value, 'fontFamily', 'INVALID_STYLE')
  if (value['fontWeight'] !== 400 && value['fontWeight'] !== 700) throw new ProjectParseError('INVALID_STYLE')
  requireFinite(value, 'fontSizePct', 'INVALID_STYLE')
  if (!oneOf(value['textTransform'], TEXT_TRANSFORMS) || !oneOf(value['position'], POSITIONS) || !oneOf(value['alignment'], ALIGNMENTS) || !oneOf(value['highlightMode'], HIGHLIGHT_MODES)) {
    throw new ProjectParseError('INVALID_STYLE')
  }
  requireString(value, 'color', 'INVALID_STYLE')
  requireString(value, 'highlightColor', 'INVALID_STYLE')
  requireString(value, 'outlineColor', 'INVALID_STYLE')
  requireFinite(value, 'outlineWidth', 'INVALID_STYLE')
  requireFinite(value, 'backgroundOpacity', 'INVALID_STYLE')
  requireFinite(value, 'marginVPct', 'INVALID_STYLE')
  if (value['maxLinesPerBlock'] !== 1 && value['maxLinesPerBlock'] !== 2 && value['maxLinesPerBlock'] !== 3) throw new ProjectParseError('INVALID_STYLE')
  if (!optionalString(value['backgroundColor']) || !optionalString(value['animationPreset'])) {
    throw new ProjectParseError('INVALID_STYLE')
  }
}

/** Strict inverse of `serializeProject` — a well-formed canonical project,
 *  otherwise a CODE-only `ProjectParseError` (never input content). */
export function parseProject(json: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ProjectParseError('INVALID_JSON')
  }
  if (!isObject(raw)) throw new ProjectParseError('INVALID_PROJECT')
  requireString(raw, 'id', 'INVALID_PROJECT')
  requireString(raw, 'name', 'INVALID_PROJECT')
  if (raw['schemaVersion'] !== 1) throw new ProjectParseError('INVALID_PROJECT')
  if (!oneOf(raw['captionOrigin'], CAPTION_ORIGINS) || !oneOf(raw['speakerSource'], SPEAKER_SOURCES) || !oneOf(raw['outputAspect'], OUTPUT_ASPECTS) || !oneOf(raw['transcription'], TRANSCRIPTION_STATES)) {
    throw new ProjectParseError('INVALID_PROJECT')
  }
  if (!(raw['language'] === null || isString(raw['language'])) || !(raw['modelId'] === null || isString(raw['modelId']))) {
    throw new ProjectParseError('INVALID_PROJECT')
  }
  requireFinite(raw, 'updatedAt', 'INVALID_PROJECT')
  if (!Array.isArray(raw['blocks']) || !Array.isArray(raw['speakers']) || !Array.isArray(raw['translations'])) {
    throw new ProjectParseError('INVALID_PROJECT')
  }
  parseAsset(raw['asset'])
  for (const block of raw['blocks']) parseBlock(block)
  for (const speaker of raw['speakers']) parseSpeaker(speaker)
  for (const track of raw['translations']) parseTranslationTrack(track)
  parseStyle(raw['style'])
  return raw as unknown as Project
}
