// TranslationEngine — the backend-agnostic seam (FR-301.1, zip-captions ADR-013
// shape; architecture.md § Translation engine). The v1 backend is the Chrome
// built-in Translator/LanguageDetector adapter in `chrome-translator.ts` — the
// ONLY module allowed to touch `self.Translator` / `self.LanguageDetector`.
//
// SECURITY-03: every rejection carries an EngineError with a code and numeric
// detail only — never caption/translation text.

import type { EngineError } from '../protocol'

/** Translator.availability mapping (docs: 'unavailable' | 'downloadable' | 'downloading' | 'available'). */
export type PairAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

/** `isAvailable()` result — US-301.2: unsupported browsers get an honest reason. */
export interface EngineAvailability {
  available: boolean
  /** 'browser': no Translator API (Safari/Firefox). 'mobile': desktop-only API. */
  reason?: 'browser' | 'mobile'
}

export interface EnsurePairOptions {
  /** Downloads only start when true (avoids `NotAllowedError`; zip-captions pattern). */
  userInitiated: boolean
  /** 0–100 download progress; absent for non-download paths. */
  onProgress?: (percent: number) => void
}

export interface LanguageGuess {
  /** BCP-47 tag, e.g. 'en', 'zh-Hant'. */
  language: string
  confidence: number
}

/**
 * Outcome of `ensurePair`: `ready` = translate may proceed; `downloadable` = a
 * background request (userInitiated false) for a not-yet-downloaded pair —
 * NO download started and NO error thrown (zip-captions pattern, US-301.1).
 */
export type EnsurePairResult = 'ready' | 'downloadable'

export interface TranslationEngine {
  isAvailable(): EngineAvailability
  availability(source: string, target: string): Promise<PairAvailability>
  /**
   * Resolves `ready` when the pair can translate. A `downloadable` pair with
   * `userInitiated: false` returns `downloadable` without downloading and
   * without throwing; `userInitiated: true` downloads (progress via
   * `onProgress`) and failure rejects `DOWNLOAD_FAILED`. Missing user
   * activation for a required download rejects `NOT_ALLOWED`; an unsupported
   * pair rejects `PAIR_UNAVAILABLE`.
   */
  ensurePair(source: string, target: string, options: EnsurePairOptions): Promise<EnsurePairResult>
  /** Single block text (`'\n'` already normalized to spaces by the session). Rejects `TRANSLATE_FAILED`. */
  translate(source: string, target: string, text: string, signal: AbortSignal): Promise<string>
  /** Top detection result, or null when LanguageDetector is unavailable (caller asks the user). */
  detectLanguage(text: string): Promise<LanguageGuess | null>
  /** Destroy all instances; idempotent. */
  dispose(): void
}

/**
 * EngineError factory — codes/numbers only (SECURITY-03). Returns a real
 * `Error` so `throw` sites satisfy lint while the value stays structurally
 * assignable to `EngineError`; the message is derived from the code alone.
 */
export class TranslationError extends Error implements EngineError {
  readonly code: EngineError['code']
  readonly retryable: boolean
  readonly detail?: string
  constructor(code: EngineError['code'], retryable: boolean, detail?: string) {
    super(`engine:${code}`)
    this.name = 'TranslationError'
    this.code = code
    this.retryable = retryable
    if (detail !== undefined) this.detail = detail
  }
}

export function translateError(code: EngineError['code'], retryable: boolean, detail?: string): TranslationError {
  return new TranslationError(code, retryable, detail)
}
