// Invariant-10 translation-track rules over block mutations (FR-102.1).
//
// domain.md § Invariant 10: every TranslationEntry key resolves to an existing
// source block; delete deletes the entry, merge concatenates (space-joined,
// stale), split keeps the entry on the first part marking both stale (second
// gets an empty stale entry), retime NEVER marks stale.
//
// unit-301 owns the real rules. Until it merges this module ships the frozen
// FR-102.1 NO-OP stub: every hook returns without touching the project, so a
// translation track stays byte-identical through any 102 command. Commands
// receive the rules by injection (`createEditorApp` deps, default =
// NO_OP_TRANSLATION_RULES) — swapping in unit-301's implementation is a
// composition-root change only (frozen contract ASSUMPTION,
// tests/unit/editor/unit102-api-contract.d.ts § '@engine/translate/track@102').

import type { Project } from '../model'

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
    /* unit-301: delete the entry (invariant 10) */
  },
  onBlockSplit(): void {
    /* unit-301: keep-first + stale-both (invariant 10) */
  },
  onBlockMerge(): void {
    /* unit-301: space-joined concat, marked stale (invariant 10) */
  },
  onBlockRetime(): void {
    /* invariant 10: retime never marks stale — nothing to do */
  },
}
