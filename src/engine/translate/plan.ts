// Translation plan (FR-301.3) — pure ordering/filtering of blocks a session
// should translate. Deterministic; zero engine access.

import type { Project } from '../model'
import { isStale } from './track'

export interface PlanOptions {
  /** Include stale entries (the "Retranslate stale" request). */
  retranslateStale?: boolean
  /** Failed-block attempt counts from the session (per target language). */
  attempts?: ReadonlyMap<string, number>
  /** Attempts cap per block (FR-301.3: 3). Blocks at the cap are left `failed`. */
  maxAttempts?: number
  /** Transcript viewport ids — these blocks translate first (visible-first). */
  visibleIds?: ReadonlySet<string>
}

export interface TranslationPlan {
  /** Block ids in run order (visible-first, then document order). */
  ordered: string[]
  /** Entries that are stale right now (informational; also planned when retranslateStale). */
  stale: string[]
}

/** FR-301.3: block text enters the API with `'\n'` replaced by spaces (the renderer re-wraps). */
export function normalizeForTranslate(text: string): string {
  return text.replace(/\n/g, ' ')
}

export function planBlocks(project: Project, language: string, options: PlanOptions = {}): TranslationPlan {
  const maxAttempts = options.maxAttempts ?? 3
  const track = project.translations.find((t) => t.language === language)
  const stale: string[] = []
  const missing: string[] = []
  const retriableFailed: string[] = []
  const staleSet = new Set<string>()

  for (const block of project.blocks) {
    const entry = track?.entries[block.id]
    if (entry === undefined) {
      missing.push(block.id)
      continue
    }
    if (entry.status === 'failed') {
      const used = options.attempts?.get(block.id) ?? 0
      if (used < maxAttempts) retriableFailed.push(block.id)
      continue
    }
    if (isStale(entry, block.text)) {
      stale.push(block.id)
      if (options.retranslateStale === true) staleSet.add(block.id)
    }
  }

  const wanted = new Set<string>([...missing, ...retriableFailed, ...staleSet])
  const visibleFirst: string[] = []
  const rest: string[] = []
  for (const block of project.blocks) {
    if (!wanted.has(block.id)) continue
    if (options.visibleIds?.has(block.id) === true) visibleFirst.push(block.id)
    else rest.push(block.id)
  }
  return { ordered: [...visibleFirst, ...rest], stale }
}
