// Chrome built-in Translator/LanguageDetector ADAPTER (FR-301.2) — the ONLY
// module touching `self.Translator` / `self.LanguageDetector` (the main-thread
// exception to architecture invariant 1: the API is Window-only). Coverage
// excluded (engine-coverage-gate); behaviour proven in tests with a scripted
// global per the API contract
// (https://developer.chrome.com/docs/ai/translator-api — docs re-verified
// 2026-11-18: availability(), create({monitor}), user-activation-gated
// download, sequential per-instance translate, destroy()).
//
// zip-captions patterns adopted (discovery.md): per-pair LRU ≤ 4 instances
// with destroy-on-eviction, pending-create dedupe (a user-initiated request
// never joins a background one), strict failure semantics, `UnknownError`
// destroy-and-rebuild.
//
// SECURITY-03: throws EngineError with codes + error NAME only — never text.

import { translateError, type EnsurePairResult, type EngineAvailability, type LanguageGuess, type PairAvailability, type TranslationEngine } from './engine'

// Minimal surface of the built-in APIs we consume (DOM lib doesn't define them yet).
interface TranslatorMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number; total: number }) => void): void
}
interface TranslatorInstance {
  translate(input: string): Promise<string>
  destroy?(): void
}
interface TranslatorCreateOptions {
  sourceLanguage: string
  targetLanguage: string
  monitor?: (m: TranslatorMonitor) => void
}
interface TranslatorApi {
  availability(init: { sourceLanguage: string; targetLanguage: string }): Promise<PairAvailability>
  create(init: TranslatorCreateOptions): Promise<TranslatorInstance>
}
interface DetectorResult {
  detectedLanguage: string
  confidence: number
}
interface DetectorInstance {
  detect(input: string): Promise<DetectorResult[]>
  destroy?(): void
}
interface DetectorApi {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>
  create(init?: { monitor?: (m: TranslatorMonitor) => void }): Promise<DetectorInstance>
}

function api(): TranslatorApi | null {
  return (globalThis as { Translator?: TranslatorApi }).Translator ?? null
}
function detectorApi(): DetectorApi | null {
  return (globalThis as { LanguageDetector?: DetectorApi }).LanguageDetector ?? null
}
function isMobileUserAgent(): boolean {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
}
function userActivationActive(): boolean {
  return typeof navigator === 'undefined' ? false : ((navigator as { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? false)
}
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Unknown'
}

/**
 * SECURITY-03: error NAMES are attacker-/browser-controlled and may contain
 * content — only whitelisted names are ever mapped into `detail`; everything
 * else collapses to a fixed token.
 */
function safeNameToken(name: string): string {
  if (name === 'UnknownError') return 'UNKNOWN'
  if (name === 'AbortError') return 'ABORTED'
  if (name === 'NotSupportedError') return 'NOT_SUPPORTED'
  if (name === 'InvalidStateError') return 'INVALID_STATE'
  return 'API'
}

const LRU_LIMIT = 4

export function createChromeTranslationEngine(): TranslationEngine {
  /** `src|tgt` → instance, insertion-ordered = LRU (recency via delete+set). */
  const instances = new Map<string, TranslatorInstance>()
  /** `src|tgt` → in-flight create; initiated flag enforces the join rule. */
  const pending = new Map<string, { promise: Promise<TranslatorInstance>; initiated: boolean }>()
  const pendingDetect = new Map<string, { promise: Promise<DetectorInstance>; initiated: boolean }>()
  let detectorInstance: DetectorInstance | null = null

  function pairKey(source: string, target: string): string {
    return `${source}|${target}`
  }

  function touch(key: string): void {
    const instance = instances.get(key)
    if (instance === undefined) return
    instances.delete(key)
    instances.set(key, instance)
  }

  function evictIfNeeded(): void {
    while (instances.size > LRU_LIMIT) {
      const key = instances.keys().next().value as string
      const instance = instances.get(key)
      instances.delete(key)
      instance?.destroy?.()
    }
  }

  async function createInstance(source: string, target: string, userInitiated: boolean, onProgress?: (percent: number) => void): Promise<TranslatorInstance> {
    const translator = api()
    if (translator === null) throw translateError('PAIR_UNAVAILABLE', false, 'NO_API')
    const availability = await translator.availability({ sourceLanguage: source, targetLanguage: target })
    if (availability === 'unavailable') throw translateError('PAIR_UNAVAILABLE', false, 'PAIR_UNSUPPORTED')
    // Background (`userInitiated === false`) downloadable requests never reach
    // here — ensurePair returns 'downloadable' before creating (zip-captions
    // pattern); this call site is only for user-initiated creates and the
    // 'downloading' background case.
    if (availability === 'downloadable' && !userActivationActive()) {
      throw translateError('NOT_ALLOWED', false, 'NO_USER_ACTIVATION')
    }
    const key = pairKey(source, target)
    const existing = pending.get(key)
    // Pending-create dedupe: join an in-flight create unless this is a
    // user-initiated request and the pending one is background (never join).
    if (existing !== undefined && !(userInitiated && !existing.initiated)) return existing.promise
    const promise = (async () => {
      try {
        const instance = await translator.create({
          sourceLanguage: source,
          targetLanguage: target,
          ...(onProgress === undefined
            ? {}
            : {
                monitor: (m: TranslatorMonitor) => {
                  m.addEventListener('downloadprogress', (event) => {
                    const total = event.total > 0 ? event.total : 1
                    onProgress(Math.min(100, Math.max(0, Math.round((event.loaded / total) * 100))))
                  })
                },
              }),
        })
        instances.set(key, instance)
        evictIfNeeded()
        touch(key)
        return instance
      } catch (error) {
        throw translateError(availability === 'downloading' || availability === 'downloadable' ? 'DOWNLOAD_FAILED' : 'TRANSLATE_FAILED', true, `CREATE:${safeNameToken(errorName(error))}`)
      } finally {
        pending.delete(key)
      }
    })()
    pending.set(key, { promise, initiated: userInitiated })
    return promise
  }

  function drop(key: string): void {
    const instance = instances.get(key)
    if (instance !== undefined) {
      instances.delete(key)
      instance.destroy?.()
    }
  }

  return {
    isAvailable(): EngineAvailability {
      if (api() !== null) return { available: true }
      // API absent on desktop = browser without it; mobile UA explains absence
      // honestly (desktop-only API).
      return { available: false, reason: isMobileUserAgent() ? 'mobile' : 'browser' }
    },

    async availability(source, target): Promise<PairAvailability> {
      const translator = api()
      if (translator === null) return 'unavailable'
      try {
        return await translator.availability({ sourceLanguage: source, targetLanguage: target })
      } catch {
        return 'unavailable'
      }
    },

    async ensurePair(source, target, options): Promise<EnsurePairResult> {
      const translator = api()
      if (translator === null) throw translateError('PAIR_UNAVAILABLE', false, 'NO_API')
      const availability = await this.availability(source, target)
      if (availability === 'unavailable') throw translateError('PAIR_UNAVAILABLE', false, 'PAIR_UNSUPPORTED')
      if (availability === 'downloadable' && !options.userInitiated) return 'downloadable'
      await createInstance(source, target, options.userInitiated, options.onProgress)
      return 'ready'
    },

    async translate(source, target, text, signal): Promise<string> {
      if (signal.aborted) throw translateError('CANCELLED', false, 'ABORTED')
      const key = pairKey(source, target)
      touch(key)
      let instance = instances.get(key)
      if (instance === undefined) instance = await createInstance(source, target, true)
      try {
        const result = await instance.translate(text)
        touch(key)
        if (signal.aborted) {
          drop(key)
          throw translateError('CANCELLED', false, 'ABORTED')
        }
        return result
      } catch (error) {
        // Strict semantics + UnknownError recovery (zip-captions): destroy the
        // (possibly poisoned) instance; the next attempt rebuilds it.
        drop(key)
        if (signal.aborted || errorName(error) === 'AbortError') throw translateError('CANCELLED', false, 'ABORTED')
        if ((error as { code?: unknown })?.code !== undefined) throw error // our own CANCELLED from above, verbatim
        throw translateError('TRANSLATE_FAILED', true, safeNameToken(errorName(error)))
      }
    },

    async detectLanguage(text): Promise<LanguageGuess | null> {
      const detector = detectorApi()
      if (detector === null) return null
      try {
        if (detectorInstance === null) {
          const pendingEntry = pendingDetect.get('detector')
          const creation = pendingEntry !== undefined ? pendingEntry.promise : undefined
          if (creation !== undefined) {
            detectorInstance = await creation
          } else {
            const promise = detector.create()
            pendingDetect.set('detector', { promise, initiated: true })
            try {
              detectorInstance = await promise
            } finally {
              pendingDetect.delete('detector')
            }
          }
        }
        const results = await detectorInstance.detect(text)
        const top = results[0]
        if (top === undefined) return null
        return { language: top.detectedLanguage, confidence: top.confidence }
      } catch {
        // Detector failure never blocks a translation run (caller treats as no-detection).
        detectorInstance?.destroy?.()
        detectorInstance = null
        return null
      }
    },

    dispose(): void {
      for (const instance of instances.values()) instance.destroy?.()
      instances.clear()
      pending.clear()
      pendingDetect.clear()
      detectorInstance?.destroy?.()
      detectorInstance = null
    },
  }
}
