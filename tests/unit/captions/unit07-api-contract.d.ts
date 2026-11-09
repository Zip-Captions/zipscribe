// Unit-07 FROZEN API CONTRACT — test-author-owned ambient module declarations.
//
// The RED-phase suite of unit-07 (Caption Import, QC & Align-to-Audio) imports
// the production modules `src/engine/captions/**` through the
// `@engine/captions/...` specifiers (vite/vitest alias → `src/engine/captions/...`).
// The modules do not exist yet — that is the point: the tests import them and
// fail at *runtime* (missing module), while `pnpm typecheck` types the tests
// against the declarations below. The builder must export exactly these
// names/shapes; the runtime assertions (not these types) are the acceptance
// gate (unit-05 `unit05-api-contract.d.ts` precedent — kept byte-stable).
//
// Contract types from `knowledge/architecture.md` § engine/captions
// (CaptionFormat, ImportReport, QcIssueCode, QcIssue) are copied VERBATIM
// here (they are not in src/engine/model.ts — model.ts was generated from the
// canonical domain block only). ParsedCue is per unit-07 FR-07.2. The real
// model.ts types are re-exported under `@engine/model@07` — the `@07` suffix
// makes an accidental RUNTIME import impossible (nothing resolves it), so
// these contract modules are type-only by construction (unit-04 `@04` /
// unit-05 `@05` pattern).
//
// Test-hook seams (recorded in the unit report under ASSUMPTIONS — the
// builder implements them as declared here):
//  - Every parser takes `opts.scheduleYield` (FR-07.7 "parsing yields to the
//    event loop every 2 000 cues"). Default: a macrotask tick. The tests
//    inject a counter and assert ≥ one yield per completed 2 000-cue chunk.
//    This is why the parsers are async (`Promise<ParseResult>`); they remain
//    pure — the scheduler is the only effect.
//  - `importCaptions` is async for the same reason plus the injected
//    `detectLanguage` seam (US-07.2 — the LanguageDetector API is Window-only;
//    engine purity forbids `window` in src/engine, so the UI injects a
//    detector; the sample handed to it is ≤ 2 KB of cue text).
//  - `estimateCueWords` implements the exact pinned rule below (CC-07.1
//    goldens are byte-equal against it — character weight + punctuation pause
//    weight, 3-decimal quantization per domain invariant 6).
//  - `sourceTextHash` is the canonical TranslationEntry.sourceHash function
//    (qc.ts exports it because checkCaptions must compare it; unit-102's
//    state layer will reuse it — recorded as a proposed contract addition).
//  - Ids: blocks/speakers get `crypto.randomUUID()` (the engine never takes
//    an id factory — the golden comparison normalizes ids positionally in the
//    test's canonical serializer, tests/unit/captions/canonical.ts).
//
// Pinned word-timing estimation rule (FR/US-07.3, CC-07.1 goldens depend on
// it byte-for-byte):
//   tokens  = text split on whitespace runs; empty → []; a token followed by
//             a '\n' in the original text gets breakAfter: true.
//   weight  = max(1, codePointCount(text_i))
//             + (/[.,!?;:]$/.test(text_i) ? punctuationPauseWeight : 0)
//             (punctuationPauseWeight default 1 — "a short pause weight"
//             expressed in character-weight units, so its seconds cost scales
//             with the cue, keeping the rule deterministic).
//   bounds  = start_i = round3(start + (end − start) × (Σ_{j<i} weight_j) / Σ weight)
//             end_i   = round3(start + (end − start) × (Σ_{j≤i} weight_j) / Σ weight)
//             with start_0 = cue start and end_{n−1} = cue end exactly.
//   timing  = 'estimated'; word texts are the tokens (invariant 2 joinability).
//
// Alignment (FR-07.4): Needleman–Wunsch-style global alignment over the whole
// source track's words (block order, then word order) vs the injected ASR
// words, matching on normalizeToken equality where
// normalizeToken(t) = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim()
// (unit match score, unit gap penalties — maximum non-crossing matching).
// Matched words copy the ASR start/end (round3) and get timing 'aligned';
// unmatched words are re-interpolated linearly between the nearest aligned
// neighbours (or the block bounds when none exist) and stay 'estimated'.
// NEVER mutates word texts, word counts, block count, block text/bounds/ids.

declare module '@engine/model@07' {
  export type { CaptionBlock, CaptionStyle, MediaAsset, Project, Seconds, Speaker, TranslationEntry, TranslationTrack, WordToken } from '@engine/model'
}

declare module '@engine/captions/contract@07' {
  import type { Project, Seconds, WordToken } from '@engine/model@07'

  // --- verbatim from knowledge/architecture.md § engine/captions -----------
  export type CaptionFormat = 'srt' | 'vtt' | 'sbv' | 'ttml' | 'ass' | 'zipscribe-json'
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
  export type QcIssueCode = 'CPS_HIGH' | 'LINE_TOO_LONG' | 'TOO_MANY_LINES' | 'DURATION_SHORT' | 'DURATION_LONG' | 'GAP_TINY' | 'OUT_OF_MEDIA' | 'TRANSLATION_STALE' | 'TRANSLATION_MISSING'
  export interface QcIssue {
    code: QcIssueCode
    blockId: string
    track: 'source' | string
    value: number
  }

  // --- FR-07.2 --------------------------------------------------------------
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

  // --- FR-07.1 / FR-07.6 / FR-07.7 -----------------------------------------
  export type CaptionEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
  export type CaptionErrorCode = 'UNRECOGNIZED_FORMAT' | 'ENCODING' | 'FILE_TOO_LARGE' | 'TOO_MANY_CUES'
  /**
   * Structural shape of every thrown caption failure (the class itself is a
   * builder internal — `Error` subclass per conventions § Errors; tests assert
   * this shape structurally, never by `instanceof`). SECURITY-03: `message`
   * and `detail` carry codes/numbers/line numbers only — never cue text.
   */
  export interface CaptionFailure {
    name: string
    message: string
    code: CaptionErrorCode
    /** 1-based source line for parse failures (FR-07.6); absent otherwise. */
    line?: number
    detail?: string
  }

  // --- FR-07.3 --------------------------------------------------------------
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

  // --- FR-07.4 --------------------------------------------------------------
  export interface EstimateOptions {
    /** Punctuation pause expressed in character-weight units; default 1. */
    punctuationPauseWeight?: number
  }
  export interface AsrWordInput {
    text: string
    start: Seconds
    end: Seconds
  }
  export interface AlignReport {
    wordsTotal: number
    wordsAligned: number
    /** wordsTotal === 0 → 0. */
    alignedRatio: number
  }
  export interface AlignOutcome {
    project: Project
    report: AlignReport
  }

  // --- FR-07.4 (retime) -----------------------------------------------------
  export interface RetimeOptions {
    offsetSec?: number
    scale?: number
    anchorSec?: number
  }
  export interface RetimeSolution {
    anchorSec: number
    scale: number
    offsetSec: number
  }

  // --- FR-07.4 (qc) ---------------------------------------------------------
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
}

declare module '@engine/captions/decode-text' {
  import type { CaptionEncoding } from '@engine/captions/contract@07'

  export interface DecodedText {
    text: string
    /** BOM sniffed or fallback applied — reported for the ImportReport/confirm dialog (FR-07.1). */
    encoding: CaptionEncoding
  }

  /**
   * Pure (FR-07.1): BOM sniff (UTF-8, UTF-16LE/BE; BOM stripped) → strict
   * UTF-8 → windows-1252 fallback. `opts.encoding` re-decodes the SAME bytes
   * with the user's choice (confirm-dialog override). Throws a
   * `CaptionFailure` with code 'ENCODING' when neither UTF-8 nor
   * windows-1252 can decode (undefined cp1252 byte positions).
   */
  export function decodeCaptionBytes(bytes: Uint8Array, opts?: { encoding?: CaptionEncoding }): DecodedText
}

// One pure parser per format (FR-07.2, module map `captions/parse/*.ts`).
// Each throws a `CaptionFailure` code 'UNRECOGNIZED_FORMAT' (with `line` when
// the format was sniffed but a cue is malformed) — never cue text (FR-07.6).
// Timestamp grammars: SRT `HH:MM:SS,mmm`; VTT `[HH:]MM:SS.mmm` (+ cue
// settings, `<v Name>` voices, inline `<00:00:01.000>` timestamps, NOTE/
// STYLE/REGION blocks); SBV `H:MM:SS.mmm,H:MM:SS.mmm`; TTML clock/offset
// times incl. `ttp:frameRate` (`50f`); ASS `H:MM:SS.cc` Dialogue lines with
// `{\…}` override tags stripped. Tag stripping preserves text and spacing;
// empty cues and clamping counts are the importer's report adjustments
// (domain invariant 11), parsers report what the FILE said.

declare module '@engine/captions/parse/srt' {
  import type { ParseOptions, ParseResult } from '@engine/captions/contract@07'
  export function parseSrt(text: string, opts?: ParseOptions): Promise<ParseResult>
}
declare module '@engine/captions/parse/vtt' {
  import type { ParseOptions, ParseResult } from '@engine/captions/contract@07'
  export function parseVtt(text: string, opts?: ParseOptions): Promise<ParseResult>
}
declare module '@engine/captions/parse/sbv' {
  import type { ParseOptions, ParseResult } from '@engine/captions/contract@07'
  export function parseSbv(text: string, opts?: ParseOptions): Promise<ParseResult>
}
declare module '@engine/captions/parse/ttml' {
  import type { ParseOptions, ParseResult } from '@engine/captions/contract@07'
  export function parseTtml(text: string, opts?: ParseOptions): Promise<ParseResult>
}
declare module '@engine/captions/parse/ass' {
  import type { ParseOptions, ParseResult } from '@engine/captions/contract@07'
  export function parseAss(text: string, opts?: ParseOptions): Promise<ParseResult>
}
declare module '@engine/captions/parse/json' {
  import type { ParseOptions, ParseResult } from '@engine/captions/contract@07'
  /**
   * Zipscribe JSON sidecar: `{ "language"?: string, "blocks": [{ "start": number, "end": number, "text": string }] }`.
   * Words are cue-derived (ParsedCue carries no word times). Anything else → 'UNRECOGNIZED_FORMAT'.
   */
  export function parseZipscribeJson(text: string, opts?: ParseOptions): Promise<ParseResult>
}

declare module '@engine/captions/import' {
  import type { CaptionFileInput, ImportOptions, ImportOutcome, ParsedCue } from '@engine/captions/contract@07'
  import type { Project } from '@engine/model@07'

  /**
   * FR-07.3. Content sniff first, extension tie-break only (FR-07.2).
   * as 'source': replaces `project.blocks` (cue segmentation preserved —
   * domain invariant 12), `captionOrigin = 'imported'`, VTT voices and
   * speaker prefixes become speakers (`speakerSource: 'manual'`,
   * US-07.1/FR-07.5), clamping/fix counts land in `report.adjustments`
   * (domain invariant 11), translations dropped unless `keepTranslations`.
   * as { translation }: cues → source block with MAXIMUM time overlap;
   * several cues on one block are space-joined; cues overlapping no block are
   * dropped and counted (`CUE_UNMATCHED`); entries get `origin:'imported'`
   * (track) and `status:'edited'` (human-authored) — blocks untouched.
   * Guards BEFORE parsing: bytes > 20 MB → 'FILE_TOO_LARGE'; cues > 100 000 →
   * 'TOO_MANY_CUES' (FR-07.7). On ANY failure the input project object is
   * untouched (no partial change — US-07.1).
   */
  export function importCaptions(project: Project, file: CaptionFileInput, opts: ImportOptions): Promise<ImportOutcome>

  /**
   * FR-07.5 prefix heuristic, pure. Recognizes `[Name]: `, `NAME: ` (a
   * 1–20-char run of A–Z 0–9 space . ' - ending in ': ', not lowercase) and a
   * leading `- ` dialogue dash on the FIRST line. Returns the label + the
   * first line with the prefix stripped, or null. Pinned: a dialogue dash has
   * no name in the file, so its label is the literal `'-'` (the dialog renames).
   */
  export function parseSpeakerPrefix(line: string): { speaker: string; text: string } | null

  /** FR-07.5 dialog default: `suggestEnabled` = matchRatio ≥ 0.3. */
  export function speakerPrefixStats(cues: readonly ParsedCue[]): { matchRatio: number; suggestEnabled: boolean }
}

declare module '@engine/captions/estimate-timing' {
  import type { EstimateOptions } from '@engine/captions/contract@07'
  import type { Seconds, WordToken } from '@engine/model@07'

  /** Pure character-weight estimation (file-header rule, pinned). */
  export function estimateCueWords(cue: { start: Seconds; end: Seconds; text: string }, opts?: EstimateOptions): WordToken[]
}

declare module '@engine/captions/align' {
  import type { AlignOutcome, AsrWordInput } from '@engine/captions/contract@07'
  import type { Project } from '@engine/model@07'

  /**
   * FR-07.4, pure — ASR words are INJECTED (no SDK import; unit-testable
   * with fixtures). Needleman–Wunsch-style global alignment (file header);
   * text, word count, block count/text/bounds/ids/speakers NEVER change
   * (US-07.3 / CC-07.3). Input project is not mutated.
   */
  export function alignCaptionsToWords(project: Project, asrWords: readonly AsrWordInput[]): AlignOutcome
}

declare module '@engine/captions/retime' {
  import type { RetimeOptions, RetimeSolution } from '@engine/captions/contract@07'
  import type { Project } from '@engine/model@07'

  /**
   * US-07.4, pure. Every block and word time maps
   * t → anchor + (t − anchor) × scale + offset (defaults offset 0, scale 1,
   * anchor 0), clamped into [0, asset.duration]. Input untouched; returns a
   * new project (one undoable command in unit-101).
   */
  export function retimeAll(project: Project, opts?: RetimeOptions): Project

  /**
   * US-07.4 two-point sync: solves (scale, offset) so
   * retimeAll(..., solveRetime(fromA,toA,fromB,toB)) maps fromA→toA and
   * fromB→toB (anchor 0). Throws TypeError when fromA === fromB (degenerate).
   */
  export function solveRetime(fromA: number, toA: number, fromB: number, toB: number): RetimeSolution
}

declare module '@engine/captions/qc' {
  import type { QcChecker, QcIssue, QcRules } from '@engine/captions/contract@07'
  import type { Project } from '@engine/model@07'

  /**
   * US-07.5, pure. QcIssues are derived, never stored (domain glossary).
   * Issue semantics (pinned for tests):
   *  - CPS_HIGH       value = characters(excluding '\n') / duration
   *  - LINE_TOO_LONG  value = longest '\n'-split line length
   *  - TOO_MANY_LINES value = line count (> effective maxLinesPerBlock)
   *  - DURATION_SHORT value = end − start (< minDurationSec)
   *  - DURATION_LONG  value = end − start (> maxDurationSec)
   *  - GAP_TINY       next block, value = next.start − prev.end (frames/fps)
   *  - OUT_OF_MEDIA   value = end − asset.duration (end beyond media)
   *  - TRANSLATION_STALE / TRANSLATION_MISSING: track = language code,
   *    blockId = the source block, value = 1. Missing = block has no entry.
   * Only the first failing check per (block, kind) is reported; gap/out-of-
   * media/translation issues are per block.
   */
  export function checkCaptions(project: Project, rules?: Partial<QcRules>): QcIssue[]

  /** Incremental variant (US-07.5): ≤ 5 ms for one changed block in 10 000. */
  export function createQcChecker(project: Project, rules?: Partial<QcRules>): QcChecker

  /**
   * Canonical TranslationEntry.sourceHash over block text (proposed contract
   * addition — unit-102's state layer will reuse it; pinned so stale checks
   * are testable): FNV-1a 32-bit hex over the text as-is (8 lowercase hex
   * digits).
   */
  export function sourceTextHash(text: string): string
}
