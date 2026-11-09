// CC-07.5 / US-07.5 (FR-07.4): caption-quality issues. `checkCaptions`
// derives QcIssue[] for the pinned rule set; `createQcChecker` is the
// incremental variant — `changedBlock` re-evaluates only the changed block,
// its immediate ordering neighbours (gap rules) and the translation entries
// of exactly those blocks, so a 1-block change in a 10 000-block project
// costs O(1), never a full re-scan. Issues are DERIVED, never stored (domain
// glossary "QC issue"). `sourceTextHash` is the canonical
// TranslationEntry.sourceHash (proposed contract addition — unit-102 reuses
// it): FNV-1a 32-bit hex over the text as-is, 8 lowercase hex digits.
//
// Issue semantics pinned by the frozen contract
// (tests/unit/captions/unit07-api-contract.d.ts § qc): CPS counts characters
// excluding '\n'; lines are '\n'-split; GAP_TINY fires only for non-negative
// gaps under minGapFrames / fps; OUT_OF_MEDIA reports the end overflow;
// translation issues carry track = language code, value = 1, on the source
// block. Only the first failing check per (block, code) is reported. Pure —
// no DOM/React/SDK surface (engine-purity); nothing content-bearing is ever
// thrown or logged (SECURITY-03 — this module throws nothing at all).

import type { Project } from '../model'

export type QcIssueCode = 'CPS_HIGH' | 'LINE_TOO_LONG' | 'TOO_MANY_LINES' | 'DURATION_SHORT' | 'DURATION_LONG' | 'GAP_TINY' | 'OUT_OF_MEDIA' | 'TRANSLATION_STALE' | 'TRANSLATION_MISSING'

export interface QcIssue {
  code: QcIssueCode
  blockId: string
  /** 'source' for block rules, the language code for translation rules (contract declares `'source' | string`, which TypeScript collapses to `string`). */
  track: string
  value: number
}

export interface QcRules {
  /** Default 20 (US-07.5). CPS counts text characters excluding '\n'. */
  cpsMax: number
  /** Default 42. Longest '\n'-split line. */
  lineCharsMax: number
  /** Default 'style' → project.style.maxLinesPerBlock. */
  maxLinesPerBlock: number | 'style'
  /** Default 0.7. */
  minDurationSec: number
  /** Default 7. */
  maxDurationSec: number
  /** Default 2; frame rate from `fps` (default 'asset': asset.fps > 0 ? asset.fps : 25). */
  minGapFrames: number
  fps: number | 'asset'
  /** Default true: gap issues fire only for non-negative gaps < minGapFrames / fps. */
  checkGaps: boolean
}

export interface QcChecker {
  all(): QcIssue[]
  /**
   * Incremental re-check after `blockId` changed: re-evaluates only that
   * block, its immediate ordering neighbours (gap rules) and the
   * translation tracks — never the full track (US-07.5 ≤ 5 ms on 10 000
   * blocks). Returns the issues related to exactly those blocks; equal to
   * `all().filter(i => i.blockId ∈ {block, prev, next})` for a single-block
   * mutation.
   */
  changedBlock(blockId: string): QcIssue[]
}

const DEFAULT_RULES: QcRules = { cpsMax: 20, lineCharsMax: 42, maxLinesPerBlock: 'style', minDurationSec: 0.7, maxDurationSec: 7, minGapFrames: 2, fps: 'asset', checkGaps: true }

/** Absolute slack for strict boundary comparisons on 3-decimal float times. */
const EPS = 1e-9

function resolveRules(rules: Partial<QcRules> | undefined): QcRules {
  const resolved = { ...DEFAULT_RULES }
  if (rules === undefined) return resolved
  for (const key of Object.keys(rules) as (keyof QcRules)[]) {
    const value = rules[key]
    if (value !== undefined) (resolved as Record<string, unknown>)[key] = value
  }
  return resolved
}

/** FNV-1a 32-bit over the text as-is, 8 lowercase hex digits (pinned). */
export function sourceTextHash(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return rounded === 0 ? 0 : rounded
}

function countCharsExcludingNewline(text: string): number {
  let count = 0
  for (const char of text) if (char !== '\n') count += 1
  return count
}

function lineLengths(text: string): { count: number; longest: number } {
  const lines = text.split('\n')
  let longest = 0
  for (const line of lines) {
    let length = 0
    for (const _char of line) length += 1
    if (length > longest) longest = length
  }
  return { count: lines.length, longest }
}

function effectiveFps(project: Project, rules: QcRules): number {
  if (rules.fps !== 'asset') return rules.fps
  return project.asset.fps > 0 ? project.asset.fps : 25
}

/**
 * Every issue whose `blockId` is `project.blocks[index]`: the block's own
 * rules, its gap to the PREVIOUS block (reported on the later block, per the
 * frozen contract) and its per-translation-track stale/missing state.
 * `all()` concatenates these in block order, so `changedBlock`'s
 * prev/self/next concatenation is exactly `all().filter(...)` by
 * construction.
 */
function issuesForBlockIndex(project: Project, rules: QcRules, index: number): QcIssue[] {
  const block = project.blocks[index]!
  const issues: QcIssue[] = []
  const duration = block.end - block.start

  const cps = countCharsExcludingNewline(block.text) / duration
  if (cps > rules.cpsMax + EPS) issues.push({ code: 'CPS_HIGH', blockId: block.id, track: 'source', value: round3(cps) })

  const { count: lineCount, longest } = lineLengths(block.text)
  if (longest > rules.lineCharsMax) issues.push({ code: 'LINE_TOO_LONG', blockId: block.id, track: 'source', value: longest })
  const maxLines = rules.maxLinesPerBlock === 'style' ? project.style.maxLinesPerBlock : rules.maxLinesPerBlock
  if (lineCount > maxLines) issues.push({ code: 'TOO_MANY_LINES', blockId: block.id, track: 'source', value: lineCount })

  if (duration < rules.minDurationSec - EPS) issues.push({ code: 'DURATION_SHORT', blockId: block.id, track: 'source', value: round3(duration) })
  if (duration > rules.maxDurationSec + EPS) issues.push({ code: 'DURATION_LONG', blockId: block.id, track: 'source', value: round3(duration) })

  const mediaEnd = project.asset.duration
  if (block.end > mediaEnd + EPS) issues.push({ code: 'OUT_OF_MEDIA', blockId: block.id, track: 'source', value: round3(block.end - mediaEnd) })

  if (rules.checkGaps && index > 0) {
    const gap = block.start - project.blocks[index - 1]!.end
    const threshold = rules.minGapFrames / effectiveFps(project, rules)
    if (gap >= -EPS && gap < threshold - EPS) issues.push({ code: 'GAP_TINY', blockId: block.id, track: 'source', value: round3(gap) })
  }

  for (const track of project.translations) {
    const entry = track.entries[block.id]
    if (entry === undefined) issues.push({ code: 'TRANSLATION_MISSING', blockId: block.id, track: track.language, value: 1 })
    else if (entry.sourceHash !== sourceTextHash(block.text)) issues.push({ code: 'TRANSLATION_STALE', blockId: block.id, track: track.language, value: 1 })
  }
  return issues
}

function issuesForIds(project: Project, rules: QcRules, indices: number[]): QcIssue[] {
  const issues: QcIssue[] = []
  for (const index of indices) {
    if (index < 0 || index >= project.blocks.length) continue
    issues.push(...issuesForBlockIndex(project, rules, index))
  }
  return issues
}

/** US-07.5 full pass: every block, in order (per-block rules, gap, translations). */
export function checkCaptions(project: Project, rules?: Partial<QcRules>): QcIssue[] {
  const resolved = resolveRules(rules)
  return issuesForIds(
    project,
    resolved,
    project.blocks.map((_block, index) => index),
  )
}

/**
 * US-07.5 incremental variant. Reads the LIVE project on every call (QC
 * issues are derived, never stored); `changedBlock` evaluates exactly the
 * changed block + its two ordering neighbours + their translation entries.
 * The id→index map is cached per `project.blocks` array identity.
 */
export function createQcChecker(project: Project, rules?: Partial<QcRules>): QcChecker {
  const resolved = resolveRules(rules)
  let cache: { source: typeof project.blocks; index: Map<string, number> } | null = null
  const indexOf = (blockId: string): number => {
    if (cache === null || cache.source !== project.blocks) cache = { source: project.blocks, index: new Map(project.blocks.map((block, position) => [block.id, position])) }
    return cache.index.get(blockId) ?? -1
  }
  return {
    all(): QcIssue[] {
      return issuesForIds(
        project,
        resolved,
        project.blocks.map((_block, index) => index),
      )
    },
    changedBlock(blockId: string): QcIssue[] {
      const index = indexOf(blockId)
      if (index < 0) return []
      return issuesForIds(project, resolved, [index - 1, index, index + 1])
    },
  }
}
