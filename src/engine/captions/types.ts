// Caption-import contract types (FR-07.1/FR-07.2), verbatim from
// `knowledge/architecture.md` § engine/captions + unit-07 FR-07.2 (ParsedCue)
// and the frozen ambient contract `tests/unit/captions/unit07-api-contract.d.ts`
// (`@engine/captions/contract@07`). Production home of the types the ambient
// test declarations mirror — keep the two byte-identical in shape.

import type { Seconds } from '../model'

export type CaptionFormat = 'srt' | 'vtt' | 'sbv' | 'ttml' | 'ass' | 'zipscribe-json'

/** FR-07.2 — one cue as the FILE said it (clamping/dropping is the importer's job, domain invariant 11). */
export interface ParsedCue {
  start: Seconds
  end: Seconds
  text: string
  voice?: string
  lines: string[]
}

export interface ParseResult {
  format: CaptionFormat
  cues: ParsedCue[]
  /** Declared file language (VTT `Language:` header / TTML `xml:lang` / Zipscribe JSON `language`), else null. */
  language: string | null
}

export interface ParseOptions {
  /** Event-loop yield seam, called at least once per completed 2 000 cues (FR-07.7); default macrotask tick. */
  scheduleYield?: () => Promise<void>
}

/** FR-07.1 */
export type CaptionEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

/** FR-07.6 / FR-07.7 */
export type CaptionErrorCode = 'UNRECOGNIZED_FORMAT' | 'ENCODING' | 'FILE_TOO_LARGE' | 'TOO_MANY_CUES'

/**
 * Structural shape of every thrown caption failure (SECURITY-03: `message`
 * and `detail` carry codes/numbers/line numbers only — never cue text).
 * The class (`failure.ts`) is a builder internal; tests assert this shape
 * structurally, never by `instanceof`.
 */
export interface CaptionFailure {
  name: string
  message: string
  code: CaptionErrorCode
  /** 1-based source line for parse failures (FR-07.6); absent otherwise. */
  line?: number
  detail?: string
}
