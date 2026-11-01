// Unit-05 FROZEN API CONTRACT — test-author-owned ambient module declarations.
//
// The RED-phase suite of unit-05 (Transcription Pipeline) imports the
// production modules `src/engine/asr/{chunker,blockize,transcriber,worker-host}.ts`
// through the `@engine/asr/...` specifiers (vite/vitest alias →
// `src/engine/asr/...`). The modules do not exist yet — that is the point: the
// tests import them and fail at *runtime* (missing module), while
// `pnpm typecheck` types the tests against the declarations below. The builder
// must export exactly these names/shapes; the runtime assertions (not these
// types) are the acceptance gate. This file is the frozen contract, kept
// byte-stable by the builder (unit-03/04 precedent).
//
// Contract types are NOT redefined here: the real `src/engine/protocol.ts` and
// `src/engine/model.ts` are pulled into this (type-only) program and
// re-exported under `@engine/protocol@05` / `@engine/model@05` so no test ever
// imports them by their bare alias (unit-04 `@04` pattern — the `@05` suffix
// makes an accidental RUNTIME import impossible: nothing resolves it).
//
// Test-hook seams (recorded in the unit report under ASSUMPTIONS — the
// builder implements them as declared here, they are the contract the CC-05.8/
// CC-05.9/CC-05.10/CC-05.11 tests drive):
//  - `packWindows` merges segments closer than `mergeGapSec` (default 0.3)
//    BEFORE packing (FR-05.1 puts merge + pack on this pure-function pair).
//  - `transcribe` takes its engine session from injected DI
//    (`opts.createSession`) and its segmentation from `opts.vad` when given
//    (architecture invariant 2: constructor/factory injection, mockable).
//  - `WindowOutput.maxTokensHit` is the decoder max-tokens condition the
//    hallucination guard counts (FR-05.9 third trigger).
//  - `createAsrWorkerHost({ recycleEveryNWindows })` is the forced-recycle test
//    hook for CC-05.9 (FR-05.3 sampling has no in-test source; the mechanism
//    is identical).
//  - `AsrRunResult.validation === 'LANGUAGE_REQUIRED'` is the typed validation
//    result US-05.1 demands BEFORE any message reaches the worker.
//  - `job:done` gains an OPTIONAL `stats` field (numbers/codes only,
//    SECURITY-03) carrying the guard counters — proposed contract change,
//    listed in the unit report; tests assert `stats?.guard` numbers.

declare module '@engine/protocol@05' {
  export type { AsrEvent, AsrRequest, EngineError, EngineErrorCode, JobEvent, MediaEvent, MediaRequest, ModelEvent, Notice, NoticeCode, PcmChunk, PcmSource, RawSegment, VadSegment } from '@engine/protocol'
  export type { Seconds } from '@engine/model'
}

declare module '@engine/model@05' {
  export type { CaptionBlock, Seconds, WordToken } from '@engine/model'
}

declare module '@engine/asr/chunker' {
  import type { Seconds, VadSegment } from '@engine/protocol@05'

  /** One ASR window: the audio range for ONE engine pipeline call. */
  export interface AsrWindow {
    start: Seconds
    end: Seconds
  }

  export interface PackOptions {
    /** Hard window ceiling; default 28 (FR-05.1). Only continuous speech may exceed it. */
    maxWindowSec?: number
    /** Silence padding applied both sides, clamped to the midpoint of the neighbouring silence; default 0.2. */
    padSec?: number
    /** Segments closer than this merge into one (FR-05.1); default 0.3. */
    mergeGapSec?: number
    /** Below this a gap is not silence (Silero min-silence); default 0.35. Gaps ≥ it are the only legal cut points. */
    minSilenceSec?: number
  }

  /**
   * Pure: VadSegment[] → packed ASR windows (FR-05.1). Merge (gap <
   * `mergeGapSec`) then pack consecutive segments into ≤ `maxWindowSec`
   * windows, cutting only inside silence (≥ `minSilenceSec` gap), padding ±
   * `padSec` clamped to the silence midpoint. Deterministic; no I/O.
   */
  export function packWindows(segments: readonly VadSegment[], opts?: PackOptions): AsrWindow[]
}

declare module '@engine/asr/blockize' {
  import type { CaptionBlock, WordToken } from '@engine/model@05'

  /** Engine capability flags from the registry (invariant 7 — never promise what the engine does not emit). */
  export interface BlockizeEngineFlags {
    confidence: boolean
    punctuation: boolean
  }

  export interface BlockizeOptions {
    /** Default 2 (US-1.2.6). */
    maxLines?: number
    /** Per-line character estimate; default 42 (US-1.2.6). */
    maxCharsPerLine?: number
    /** Split at inter-word gaps strictly greater than this; default 0.6. */
    gapSplitSec?: number
    /** Default 0.7 (where word timings allow). */
    minDurationSec?: number
    /** Default 7. */
    maxDurationSec?: number
    /** Start/end padding; default 0.05, clamped to neighbour bounds (US-1.2.6). */
    paddingSec?: number
    /** `confidence` is set when engine has probabilities and block mean word probability < this; default 0.45. */
    lowConfidenceThreshold?: number
    /** Default `{ confidence: false, punctuation: false }`. */
    engineFlags?: BlockizeEngineFlags
  }

  /**
   * Pure word→blocks grouping implementing US-1.2.6 (FR-05.4). Deterministic,
   * exported unchanged for unit-06 reassignment reuse. Input words are sorted,
   * non-overlapping (domain invariant 1).
   */
  export function blockize(words: readonly WordToken[], opts?: BlockizeOptions): CaptionBlock[]
}

declare module '@engine/asr/transcriber' {
  import type { Seconds, Device, EngineError, ModelId, PcmChunk, RawSegment, VadSegment } from '@engine/protocol@05'

  export interface EngineFlags {
    confidence: boolean
    punctuation: boolean
    languageDetect: boolean
  }

  export interface TranscribeSpec {
    modelId: ModelId
    device: Device
    /** BCP-47 primary tag; null = auto-detect when `engineFlags.languageDetect`. */
    language: string | null
    engineFlags: EngineFlags
  }

  /** The per-window engine call options (FR-05.2). The long-form recipe is present ONLY for windows > 28 s. */
  export interface WindowCallOptions {
    return_timestamps: 'word'
    language: string | null
    task: 'transcribe'
    chunk_length_s?: number
    stride_length_s?: number
  }

  export interface WindowOutput {
    /** Engine output with WINDOW-RELATIVE times; the transcriber offsets by the window start (FR-05.2). */
    segments: RawSegment[]
    /** Decoder hit its max-token budget on this window (FR-05.9 trigger 3). */
    maxTokensHit?: boolean
  }

  /** DI seam: the engine adapter in production, a scripted fake in tests. */
  export interface EngineSession {
    transcribeWindow(windowStart: Seconds, windowEnd: Seconds, audio: Float32Array, options: WindowCallOptions): Promise<WindowOutput>
    detectLanguage?(audio: Float32Array): Promise<string>
    dispose?(): void
  }

  /** Guard counters — numbers only, never content (SECURITY-03). */
  export interface GuardStats {
    repeatedNgramDropped: number
    shortWindowDropped: number
    maxTokensDropped: number
  }

  export interface TranscribeGuard {
    /** Speech duration the VAD attributed to this window (seconds). */
    speechSec: number
  }

  export interface TranscribeOptions {
    /** Injected segmentation (worker reuses it for diarization, FR-05.1); omit to let the transcriber run VAD itself. */
    vad?: readonly VadSegment[]
    createSession: () => EngineSession | Promise<EngineSession>
    /** Optional guard override: windows whose VAD speech is below this are text-rejected; default 0.5 (FR-05.9). */
    minGuardedSpeechSec?: number
    /** Optional backpressure ceiling for buffered PCM ahead of the engine; default 30 (FR-05.2). */
    maxBufferedAheadSec?: number
  }

  export interface TranscribeOutcome {
    ok: boolean
    /** Set (and NOTHING else happened — no session created, no window called) when validation fails (US-05.1). */
    validation?: 'LANGUAGE_REQUIRED'
    /** Emitted (kept) segments — sorted by start; guard-dropped windows are absent. */
    segments: RawSegment[]
    /** From `EngineSession.detectLanguage` when `language` was null and the engine detects. */
    detectedLanguage: string | null
    guardStats: GuardStats
    windowsCommitted: number
    cancelled: boolean
    error?: EngineError
  }

  /**
   * Engine-agnostic pipeline (FR-05.2): stream → VAD (injected or module) →
   * packWindows → one engine call per window → absolute-time `job:segments`
   * streamed per completed window (sorted, FR-05.5) → `job:progress` /
   * `job:done` (with numeric guard `stats` — see the proposed protocol
   * addition) via `onEvent`. Greedy, fixed options (FR-05.7 determinism).
   */
  export function transcribe(
    stream: AsyncIterable<PcmChunk>,
    spec: TranscribeSpec,
    opts: TranscribeOptions,
    onEvent: (event: import('@engine/protocol@05').AsrEvent) => void,
  ): Promise<TranscribeOutcome>
}

declare module '@engine/asr/worker-host' {
  import type { Seconds, AsrEvent, AsrRequest, Device, EngineErrorCode, ModelId, Notice, PcmSource, RawSegment, Tier } from '@engine/protocol@05'
  import type { EngineFlags } from '@engine/asr/transcriber'

  /** Worker double seam (the real Worker is message-wrapped; the shared fakes use the same envelope). */
  export interface AsrWorkerLike {
    postMessage(message: AsrRequest, transfer?: Transferable[]): void
    onMessage(listener: (event: AsrEvent) => void): () => void
    terminate(): void
  }

  export interface TierPlan {
    modelId: ModelId
    device: Device
  }

  export interface AsrHostOptions {
    createWorker: () => AsrWorkerLike
    /** Degradation plan (architecture § Degradation tiers). T2 is the mandatory downgrade target. */
    tiers: { T1?: TierPlan; T2: TierPlan }
    initialTier?: Tier
    /**
     * TEST HOOK (CC-05.9): recycle (terminate + respawn + reload + resume)
     * after every N committed windows. Production uses the leak-driven
     * sampling cadence instead; the mechanism is identical (FR-05.3).
     */
    recycleEveryNWindows?: number
    onEvent?: (event: AsrEvent) => void
  }

  export interface TranscribeParams {
    jobId: string
    pcm: PcmSource
    sampleRate: 16000
    language: string | null
    resumeFromSec?: Seconds
    /** Registry flags for the selected model (US-05.1 LANGUAGE_REQUIRED validation). */
    engineFlags: EngineFlags
  }

  export interface AsrRunResult {
    /** Set when the host refused BEFORE posting anything to the worker (US-05.1). */
    validation?: 'LANGUAGE_REQUIRED'
    /** Kept segments — partials are kept on cancel (FR-05.6); late in-flight batches are discarded. */
    segments: RawSegment[]
    cancelled: boolean
    /** True when a single auto-downgrade (T1→T2) occurred this run (US-1.2.7). */
    downgraded: boolean
    /** Number of worker instances spawned (recycle + downgrade observable). */
    workerEpochs: number
    /** Detected language when `language` was null (relayed from the worker; feeds the job:done project update). */
    detectedLanguage?: string | null
    error?: { code: EngineErrorCode; retryable: boolean }
  }

  export interface AsrWorkerHost {
    transcribe(params: TranscribeParams): Promise<AsrRunResult>
    /** FR-05.6: aborts within 2 s; in-flight window results are discarded, emitted partials kept. */
    cancel(jobId: string): Promise<void>
    dispose(): void
  }

  export function createAsrWorkerHost(opts: AsrHostOptions): AsrWorkerHost
}
