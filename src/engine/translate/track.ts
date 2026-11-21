// Invariant-10 translation-track rules + pure track maintenance (FR-301.4).
//
// domain.md § Invariant 10: every TranslationEntry key resolves to an existing
// source block; delete deletes the entry, merge concatenates (space-joined,
// stale), split keeps the entry on the first part marking both stale (second
// gets an empty stale entry), retime NEVER marks stale.
//
// unit-301 owns the real rules (was the FR-102.1 NO-OP stub; the composition
// roots now default to REAL_TRANSLATION_RULES — swapping stays a
// composition-root change only, frozen contract
// tests/unit/editor/unit102-api-contract.d.ts § '@engine/translate/track@102').
// `NO_OP_TRANSLATION_RULES` remains exported for suites that need the stub
// behaviour explicitly.
//
// Staleness is DERIVED: an entry is stale iff `sourceHash` !== sourceHash of
// the block's current text (or the STALE sentinel). That is why editing text
// auto-stales (hash mismatch) while retiming never does (text untouched).

import type { Project, TranslationEntry, TranslationTrack } from '../model'
// The canonical `TranslationEntry.sourceHash` is the QC checker's (unit-07,
// `knowledge/architecture.md` / qc.ts contract): the transcript + QC panel
// derive staleness from it, and `engine/captions/import` writes entries with
// it. The engine MUST stamp entries with the same function or every machine
// translation reads back as stale — so this is a delegation, not a second hash.
import { sourceTextHash } from '../captions/qc'

/** Hooks mirror domain invariant 10. All mutate the immer draft `project`. */
export interface TranslationRules {
  onBlockDelete(project: Project, deletedBlockId: string): void
  /** `sourceId` entry: kept on `firstId` marked stale; `secondId` gets an empty stale entry; merge-concat happens in `onBlockMerge`. */
  onBlockSplit(project: Project, sourceId: string, firstId: string, secondId: string): void
  /** Space-joined text of the sources' entries, marked stale (status keeps `edited` where any source was `edited`). */
  onBlockMerge(project: Project, mergedId: string, sourceIds: readonly string[]): void
  /** Retiming NEVER marks stale (invariant 10) — the hook exists so the call is observable/testable. */
  onBlockRetime(project: Project, blockId: string): void
}

/** The FR-102.1 stub: every hook returns without touching the project. */
export const NO_OP_TRANSLATION_RULES: TranslationRules = {
  onBlockDelete(): void {
    /* stub: nothing */
  },
  onBlockSplit(): void {
    /* stub: nothing */
  },
  onBlockMerge(): void {
    /* stub: nothing */
  },
  onBlockRetime(): void {
    /* stub: nothing */
  },
}

/** Sentinel `sourceHash` that can never equal a real hash → entry is stale. */
export const STALE_HASH = 'stale'

/**
 * The canonical `TranslationEntry.sourceHash` (delegates to the QC checker's
 * `sourceTextHash` — the single source of truth the transcript + QC panel and
 * `engine/captions/import` agree on). Deterministic for equal text; the hex
 * output can never equal `STALE_HASH` ('stale').
 */
export function sourceHash(text: string): string {
  return sourceTextHash(text)
}

export function isStale(entry: TranslationEntry, blockText: string): boolean {
  return entry.sourceHash !== sourceHash(blockText)
}

/** The production rules (FR-301.4 / domain invariant 10), applied to EVERY track. */
export const REAL_TRANSLATION_RULES: TranslationRules = {
  onBlockDelete(project: Project, deletedBlockId: string): void {
    for (const track of project.translations) {
      delete track.entries[deletedBlockId]
    }
  },

  onBlockSplit(project: Project, sourceId: string, firstId: string, secondId: string): void {
    for (const track of project.translations) {
      const entry = track.entries[sourceId]
      if (entry === undefined) continue // never-translated block: split creates NO entries
      // Kept on the first part; its block text changed ⇒ stale (hash mismatch).
      track.entries[firstId] = { ...entry }
      // Second part gets an empty stale entry (invariant 10, verbatim).
      track.entries[secondId] = { text: '', status: 'translated', sourceHash: STALE_HASH }
      delete track.entries[sourceId]
    }
  },

  onBlockMerge(project: Project, mergedId: string, sourceIds: readonly string[]): void {
    for (const track of project.translations) {
      const texts: string[] = []
      let anyEdited = false
      let anyEntry = false
      for (const id of sourceIds) {
        const entry = track.entries[id]
        if (entry === undefined) continue
        anyEntry = true
        if (entry.text.length > 0) texts.push(entry.text)
        if (entry.status === 'edited') anyEdited = true
        delete track.entries[id]
      }
      if (!anyEntry) continue
      track.entries[mergedId] = {
        text: texts.join(' '),
        status: anyEdited ? 'edited' : 'translated',
        sourceHash: STALE_HASH,
      }
    }
  },

  onBlockRetime(): void {
    // invariant 10: retime never marks stale — nothing to do (hook kept observable)
  },
}

/** Find (or, for machine application, ensure) the track for a language. */
function ensureTrack(project: Project, language: string, engine: TranslationTrack['engine']): TranslationTrack {
  let track = project.translations.find((t) => t.language === language)
  if (track === undefined) {
    track = { language, origin: 'machine', engine, entries: {} }
    project.translations.push(track)
  }
  return track
}

/**
 * Apply batched machine results (session output — applied as JOB OUTPUT via
 * the state-layer service, never as an undo step, FR-301.5). `updates` maps
 * block id → entry; the entry's `sourceHash` must have been computed against
 * the block text the machine translated (session does this). Unknown block ids
 * are skipped (invariant 10 can never be violated by late results).
 */
export function applyEntries(project: Project, language: string, updates: readonly { blockId: string; entry: TranslationEntry }[]): number {
  const track = ensureTrack(project, language, 'chrome-translator')
  let applied = 0
  for (const { blockId, entry } of updates) {
    if (!project.blocks.some((b) => b.id === blockId)) continue
    track.entries[blockId] = { ...entry }
    applied++
  }
  return applied
}

/** "Mark as reviewed" (US-301.3): sourceHash := current source text; text unchanged. */
export function markReviewed(project: Project, language: string, blockId: string): boolean {
  const track = project.translations.find((t) => t.language === language)
  const block = project.blocks.find((b) => b.id === blockId)
  if (track === undefined || block === undefined) return false
  const entry = track.entries[blockId]
  if (entry === undefined) return false
  entry.sourceHash = sourceHash(block.text)
  return true
}

/** Block ids whose entry is stale (sourceHash mismatch incl. the sentinel). */
export function staleIds(project: Project, language: string): string[] {
  const track = project.translations.find((t) => t.language === language)
  if (track === undefined) return []
  const ids: string[] = []
  for (const block of project.blocks) {
    const entry = track.entries[block.id]
    if (entry !== undefined && isStale(entry, block.text)) ids.push(block.id)
  }
  return ids
}
