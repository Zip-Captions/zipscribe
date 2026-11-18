// TranslationSession (FR-301.3) — fills one project's TranslationTrack,
// generation-counted, batched, cancellable. Pure orchestration over the
// TranslationEngine seam (the adapter owns browser instances; everything here
// is engine-agnostic and unit-tested with a fake). Ported semantics from
// zip-captions v0.5.0 `SegmentTranslationSession` (discovery.md).
//
// SECURITY-03: the only log is ONE aggregated console.warn per failed run
// carrying codes/counts — never caption or translation text.

import type { EngineError } from '../protocol'
import type { Project, TranslationEntry } from '../model'
import { translateError, type TranslationEngine } from './engine'
import { normalizeForTranslate, planBlocks } from './plan'
import { STALE_HASH, sourceHash } from './track'

export const MAX_ATTEMPTS = 3
export const BATCH_SIZE = 20
export const TEXT_CACHE_LIMIT = 500

export interface SessionRunOptions {
  /** Transcript viewport — these blocks translate first (visible-first). */
  visibleIds?: ReadonlySet<string>
  /** Include stale entries (the "Retranslate stale" request). */
  retranslateStale?: boolean
  /** Cancel: stop observing results within 500 ms; in-flight resolves discard. */
  signal?: AbortSignal
  /** Batched store application — the state layer applies these as JOB OUTPUT (FR-301.5). */
  onEntries?: (entries: readonly { blockId: string; entry: TranslationEntry }[]) => void
  /** done/total translated blocks (pair download progress is the engine's onProgress). */
  onProgress?: (done: number, total: number) => void
  /** Download gating for `ensurePair` — a session run is user-initiated by default. */
  userInitiated?: boolean
}

export interface RunStats {
  planned: number
  translated: number
  passThrough: number
  failed: number
  /** Results that resolved after the run was superseded/cancelled. */
  discarded: number
  cancelled: boolean
  /** True when a background run met a `downloadable` pair (no download started). */
  pairDownloadable: boolean
  /** Distinct failure codes seen (for the aggregated warning + UI copy). */
  failureCodes: string[]
}

export interface TranslationSession {
  run(project: Project, language: string, options?: SessionRunOptions): Promise<RunStats>
  attemptsFor(language: string): ReadonlyMap<string, number>
  dispose(): void
}

export interface SessionDeps {
  /** Macrotask yield between batches (page default: setTimeout 0; tests inject). */
  scheduler?: () => Promise<void>
}

const defaultScheduler = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function primaryTag(bcp47: string): string {
  return bcp47.toLowerCase().split('-')[0] ?? bcp47.toLowerCase()
}

export function createTranslationSession(engine: TranslationEngine, deps: SessionDeps = {}): TranslationSession {
  const scheduler = deps.scheduler ?? defaultScheduler
  /** generation counter: any newer run (e.g. target-language switch) discards older in-flight results. */
  let generation = 0
  const attemptsByLang = new Map<string, Map<string, number>>()
  /** `src->tgt:text` → translated text, ≤ 500 (FIFO evict), survives across runs. */
  const cache = new Map<string, string>()
  const detectCache = new Map<string, string>()
  let disposed = false

  function cacheGet(key: string): string | undefined {
    const hit = cache.get(key)
    if (hit !== undefined) {
      // refresh recency
      cache.delete(key)
      cache.set(key, hit)
    }
    return hit
  }
  function cacheSet(key: string, value: string): void {
    cache.set(key, value)
    while (cache.size > TEXT_CACHE_LIMIT) {
      const oldest = cache.keys().next()
      if (oldest.done === true) break
      cache.delete(oldest.value)
    }
  }

  async function run(project: Project, language: string, options: SessionRunOptions = {}): Promise<RunStats> {
    if (disposed) throw translateError('PAIR_UNAVAILABLE', false, 'DISPOSED')
    const availability = engine.isAvailable()
    if (!availability.available) throw translateError('PAIR_UNAVAILABLE', false, `ENGINE_UNAVAILABLE:${availability.reason ?? 'unknown'}`)
    const source = project.language
    if (source === null) throw translateError('PAIR_UNAVAILABLE', false, 'NO_SOURCE_LANGUAGE')

    const stats: RunStats = { planned: 0, translated: 0, passThrough: 0, failed: 0, discarded: 0, cancelled: false, pairDownloadable: false, failureCodes: [] }
    const myGeneration = ++generation
    const attempts = attemptsByLang.get(language) ?? new Map<string, number>()
    attemptsByLang.set(language, attempts)
    const signal = options.signal
    const aborted = () => signal?.aborted === true || myGeneration !== generation

    const ready = await engine.ensurePair(source, language, { userInitiated: options.userInitiated ?? true })
    if (ready === 'downloadable') {
      stats.pairDownloadable = true
      return stats
    }
    if (aborted()) {
      stats.cancelled = true
      return stats
    }

    const plan = planBlocks(project, language, {
      ...(options.retranslateStale === undefined ? {} : { retranslateStale: options.retranslateStale }),
      attempts,
      maxAttempts: MAX_ATTEMPTS,
      ...(options.visibleIds === undefined ? {} : { visibleIds: options.visibleIds }),
    })
    stats.planned = plan.ordered.length
    const total = plan.ordered.length
    let done = 0
    const failureCodes = new Map<string, number>()
    let batch: { blockId: string; entry: TranslationEntry }[] = []

    const flush = (): void => {
      if (batch.length === 0) return
      const delivering = batch
      batch = []
      if (aborted()) {
        stats.discarded += delivering.length
        return
      }
      options.onEntries?.(delivering)
    }

    for (let i = 0; i < plan.ordered.length; i++) {
      if (aborted()) {
        stats.cancelled = true
        stats.discarded += plan.ordered.length - i
        break
      }
      if (i > 0 && i % BATCH_SIZE === 0) await scheduler()

      const blockId = plan.ordered[i] as string
      const block = project.blocks.find((b) => b.id === blockId)
      if (block === undefined) continue // invariant 10: never emit entries for absent blocks
      const text = normalizeForTranslate(block.text)
      const cacheKey = `${source}->${language}:${text}`
      const entry: (o: { text: string; status: TranslationEntry['status']; hash: string }) => { blockId: string; entry: TranslationEntry } = (o) => ({
        blockId,
        entry: { text: o.text, status: o.status, sourceHash: o.hash },
      })

      const cached = cacheGet(cacheKey)
      if (cached !== undefined) {
        batch.push(entry({ text: cached, status: 'translated', hash: sourceHash(block.text) }))
        stats.translated++
        done++
        options.onProgress?.(done, total)
        if (batch.length >= BATCH_SIZE) flush()
        continue
      }

      // Pass-through (FR-301.6): detector says the block is already in the target language.
      const detectKey = text
      let detected = detectCache.get(detectKey)
      if (detected === undefined) {
        const guess = await engine.detectLanguage(text)
        if (aborted()) {
          stats.cancelled = true
          stats.discarded += plan.ordered.length - i
          break
        }
        detected = guess?.language ?? ''
        detectCache.set(detectKey, detected)
      }
      if (detected !== '' && primaryTag(detected) === primaryTag(language)) {
        batch.push(entry({ text: block.text, status: 'translated', hash: sourceHash(block.text) }))
        stats.passThrough++
        done++
        options.onProgress?.(done, total)
        if (batch.length >= BATCH_SIZE) flush()
        continue
      }

      let translated: string | null = null
      let attemptsUsed = 0
      let lastCode = 'TRANSLATE_FAILED'
      while (attemptsUsed < MAX_ATTEMPTS && translated === null) {
        attemptsUsed++
        try {
          translated = await engine.translate(source, language, text, signal ?? new AbortController().signal)
        } catch (error) {
          const engineError = error as EngineError
          lastCode = engineError?.code ?? 'TRANSLATE_FAILED'
          if (aborted()) break
          if (!(engineError?.retryable ?? false)) break
        }
      }
      attempts.set(blockId, attemptsUsed)

      if (aborted()) {
        stats.cancelled = true
        stats.discarded += plan.ordered.length - i
        break
      }
      if (translated !== null) {
        cacheSet(cacheKey, translated)
        attempts.delete(blockId)
        batch.push(entry({ text: translated, status: 'translated', hash: sourceHash(block.text) }))
        stats.translated++
      } else {
        stats.failed++
        failureCodes.set(lastCode, (failureCodes.get(lastCode) ?? 0) + 1)
        batch.push(entry({ text: '', status: 'failed', hash: STALE_HASH }))
      }
      done++
      options.onProgress?.(done, total)
      if (batch.length >= BATCH_SIZE) flush()
    }

    flush()
    if (failureCodes.size > 0) {
      stats.failureCodes = [...failureCodes.keys()]
      // ONE aggregated warning per run — codes and counts only (SECURITY-03).
      console.warn('translation run finished with failures', { codes: [...failureCodes.entries()], target: language })
    }
    return stats
  }

  return {
    run,
    attemptsFor: (language) => attemptsByLang.get(language) ?? new Map(),
    dispose: () => {
      disposed = true
      generation++
      cache.clear()
      detectCache.clear()
      engine.dispose()
    },
  }
}
