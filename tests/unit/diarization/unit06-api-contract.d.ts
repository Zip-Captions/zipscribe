// Unit-06 FROZEN API CONTRACT — test-author-owned ambient module declarations
// (unit-05 `unit05-api-contract.d.ts` / unit-07 / unit-102 precedent).
//
// The unit-06 suites import the production modules
// `src/engine/diarize/{clustering,assign,windowing,worker-core}.ts` through the
// `@engine/diarize/...` specifiers (vite/vitest alias → `src/engine/diarize/...`).
// The modules do not exist yet — that is the point: the tests import them and
// fail at *runtime* (missing module — the sanctioned unit-05 RED precedent),
// while `pnpm typecheck` types the tests against the declarations below. The
// builder must export exactly these names/shapes; the runtime assertions (not
// these types) are the acceptance gate. This file is the frozen contract, kept
// byte-stable by the builder (unit-03/04/05/07 precedent).
//
// Path note: `src/state/CONTRACT.md` § speaker-* family (the frozen state seam)
// pins `src/engine/diarize/assign.ts` as the home of `majoritySpeakerId` /
// `reassignWords` VERBATIM (`src/state/commands/deps.ts:14-25` ASSUMPTION).
// The unit-06 spec's Technical Specification writes `engine/diart/...`; the
// frozen state contract wins for the `diarize/` path (higher precedence:
// CONTRACT freeze + deps.ts + orchestrator brief all say `diarize/`). If the
// orchestrator decides `diart/` instead, this d.ts + the suites' specifiers
// re-point in one mechanical pass — the assertions are path-agnostic.
//
// Contract types: `src/engine/model.ts` is pulled into this (type-only)
// program and re-exported under `@engine/model@06` (no bare ambient mirror
// exists for it). `src/engine/protocol.ts` CANNOT be re-exported under
// `@engine/protocol@06` (the frozen unit-03 ambient mirror of that specifier
// shadows it in the tsconfig.node.json program and predates the diarization
// unions; skipLibCheck would hide the gap inside this .d.ts) — so the protocol
// block below is a token-faithful structural mirror copied from
// `src/engine/protocol.ts`, per the unit-03 doctrine. protocol.ts stays the
// runtime source of truth (type-only imports are erased). The `@06` suffix
// makes an accidental RUNTIME import impossible: nothing resolves it.
//
// Test-hook seams (recorded in the unit report under ASSUMPTIONS — the builder
// implements them as declared here; they are the contract the CC-06.x suites
// drive):
//  - `agglomerativeCluster` — agglomerative AVERAGE-LINKAGE on cosine distance
//    (`1 − u·v / (‖u‖·‖v‖)`). Merge condition: linkage ≤ `threshold`. The
//    threshold is the STOP RULE for normal merging (FR-06.1): stop when the
//    minimum inter-cluster linkage exceeds it. `maxSpeakers` (default **6**,
//    FR-06.1) is an UPPER BOUND, never a floor: after the threshold stops
//    merging, if the count still exceeds the cap, continue merging closest
//    pairs until the count EQUALS the cap; when the threshold-driven count is
//    at or below the cap — including 1 — the cap is INERT.
//    Labels are canonical: integers `0 … k−1`, every label used, the FIRST
//    embed's cluster is `0`, and output is deterministic for identical input
//    (CC-06.5 determinism + L4 label canonicalization depend on it). A
//    zero-norm embedding never merges (its distance to everything is 1).
//  - `assignSpeakers` — per-word assignment is the duration-weighted majority
//    of `DiarFrames` overlap over `[word.start, word.end]`; the winner must
//    exceed the runner-up by at least `DIAR_HYSTERESIS_SEC` (0.25 s, FR-06.3)
//    to switch from the PREVIOUS word's speaker — otherwise the previous
//    word's speaker carries over (flap suppression). The first assigned word
//    (no previous) takes the plain majority. Ties (margin 0) carry over. A
//    word with NO overlapping frames keeps whatever `speakerId` it already
//    had. Frame cluster `c` (0-based, `DiarFrames.frames[].speaker`) maps to
//    `word.speakerId = 'SPK_' + (c + 1)`. `block.speakerId` = majority over
//    the block's words using the frozen `majoritySpeakerId` semantics (most
//    occurrences wins, earliest-in-word-order on ties, `speakerId === undefined`
//    words skipped, none at all → the block keeps its existing `speakerId`).
//    A "speaker run" is a maximal contiguous word sequence sharing one
//    non-`undefined` `speakerId`; `undefined` (unassigned) words attach to the
//    preceding run, leading `undefined` words to the following run. A block
//    whose assigned words form ONE run is NOT re-blockized — only
//    `word.speakerId`/`block.speakerId` are rewritten, start/end/text/id
//    preserved. A block whose word speakers form TWO runs is split at the WORD
//    boundary between the runs (never mid-word, domain invariant 1) reusing the
//    unit-05 `blockize` (FR-06.3); blocks not touched by frames pass through
//    unchanged; input is never mutated (pure); the output block ORDER follows
//    the input with split parts inserted in place.
//  - `WordRange = readonly [fromIndex, toIndex]` — INCLUSIVE indices into
//    `block.words` (the UI selects words, not seconds, for `reassign`).
//  - Pure mutation APIs (US-1.3.2/FR-06.3/FR-06.5, project in → project out):
//    every one that ACTUALLY changes something sets `project.speakerSource =
//    'manual'` (invariant 5 — "any manual mutation flips to 'manual'") and NEVER touches `updatedAt` (the
//    command layer stamps that through the injected clock — CONTRACT.md
//    § Commands; pure functions have no clock). `renameSpeaker` never touches
//    ids (invariant 4). `mergeSpeakers(p, a, b)` moves ALL of `b`'s words to
//    `a` and removes speaker `b` (materializing block majorities through
//    `majoritySpeakerId`); `splitSpeaker(p, from, cutTime, newColor)` moves
//    every `from` word with `start ≥ cutTime` to a NEW appended speaker
//    (next free `SPK_<n>` id, label `'Speaker <n>'`, color `newColor`) and
//    re-materializes block majorities. Unknown speaker/block ids: the
//    reducers are total — no-throw no-op on unknown ids (the COMMAND layer,
//    unit-102, owns rejects/codes; the pure API is the golden-tested math).
//  - Palette (FR-06.5): `SPEAKER_PALETTE` — exactly 8 deterministic colors
//    (tests assert 8 · distinct · `#rrggbb` shape · stable across calls, and
//    NEVER a specific hex value); `speakersFromClusters(count)` maps cluster
//    index `i` → `{ id: 'SPK_' + (i+1), label: 'Speaker ' + (i+1), color:
//    SPEAKER_PALETTE[i % 8] }`.
//  - `windowing` (FR-06.2): `embeddingWindows(segments)` — per VAD segment:
//    segments shorter than `minSec` (0.5) expand symmetrically around the
//    segment center to `minSec`, clamped at 0; segments within
//    `[minSec, maxSec]` (3) yield exactly one window equal to the segment;
//    longer segments tile with `maxSec`-long windows at a stride of
//    `maxSec × hopRatio` (50 % hop), and when the last stride window ends
//    before the segment end a final window `[end − maxSec, end]` backfills the
//    tail. Windows never cross segment boundaries; the union covers each
//    segment; output sorted by start; deterministic.
//    `resolveEmbeddingWindows` REUSES a forwarded `vad` (source
//    `'forwarded'`, the scorer is never called) and otherwise runs its own
//    Silero pass over the PCM via the injected `VadScorer` (source
//    `'own-pass'`) — unit-05 `runVad` semantics (512-sample frames @ 16 kHz).
//  - `worker-core` (FR-06.4/FR-06.6): the DI'd heart of `diarize.worker.ts`.
//    `post()` enqueues one `DiarizeRequest` and resolves when the request has
//    produced its terminal event. `onEvent` receives every `DiarizeEvent` in
//    order. `cancel`/`unload` are NOT serialized behind a running `diarize` —
//    they act on the in-flight job cooperatively. Behavior pinned by the suite:
//      * `loadModels` → creates BOTH injected sessions (factories awaited) and
//        emits exactly one `model:ready` per session (echoing the session's
//        own `modelId`/`device` — the adapter supplies `device: 'wasm'` for
//        the segmentation model per discovery: WebGPU-unsupported).
//      * `diarize` BEFORE `loadModels` (or after `unload`) → `job:error` with
//        `code: 'MODEL_UNLOADED'` (taxonomy).
//      * `diarize` happy path → ≥ 1 `job:progress` (per segment batch;
//        processedSec monotonic, ≤ totalSec), then EXACTLY ONE `diar:frames`
//        (frames sorted by start, `start < end`, `speaker` integer, `prob` in
//        [0,1], `speakers` = distinct label count, capped by
//        `request.maxSpeakers` — passed through to `agglomerativeCluster`,
//        default cap 6), then `job:done` (numeric-only `stats`, SECURITY-03).
//        `request.vad` forwarded → used as embedding windows (FR-06.2);
//        absent → own Silero pass via the injected `speechScore`
//        (VadScorer.shape — a 512-sample `scoreWindow`).
//      * A session factory/method rejection → `job:error` with
//        `code: 'DIAR_SESSION_LOST'`. The EngineError is CODE-ONLY:
//        session-provided strings (even an SDK error message) must NEVER be
//        copied into `detail` or logged (SECURITY-03 — enforced with the
//        canary marker + redaction spy).
//      * `cancel` → cooperative stop: exactly one terminal `job:error` with
//        `code: 'CANCELLED'`, no `diar:frames` after it, and the core stops
//        issuing further session calls (a never-resolving call must not hang
//        the cancel path).
//      * `unload` → disposes both sessions; a later `diarize` → `MODEL_UNLOADED`.
//      * Stream `PcmSource`: consumes `PcmChunk` messages on the port; the
//        stream ends when the peer port closes (or sends a null message).
//      * Empty speech (no VAD segments) → `diar:frames { speakers: 0,
//        frames: [] }` + `job:done`.
//      * The core never writes to `console` (redaction-spy enforced).

// Contract types for the parts the unit-03 mirror does not carry (the
// diarization/media unions) are declared STRUCTURALLY below — the sanctioned
// unit-03 doctrine ("a structural mirror of src/engine/protocol.ts, which
// cannot be pulled into the tsconfig.node.json program because it references
// the DOM MessagePort type"; skipLibCheck would silently swallow a failed
// re-export inside a .d.ts). Token-faithful copies; protocol.ts stays the
// runtime source of truth (type-only imports are erased).

declare module '@engine/protocol@06' {
  import type { MediaAsset, WordToken } from '@engine/model@06'
  import type { Seconds } from '@engine/model@06'

  export type Device = 'webgpu' | 'wasm'
  export type ModelId = string

  export interface PcmChunk {
    startSec: Seconds
    samples: Float32Array
  } // 16 kHz mono f32, 1 s batches, transferable

  export type PcmSource = { kind: 'transfer'; buffer: ArrayBuffer } | { kind: 'stream'; port: MessagePort } // stream mandatory for long media

  export interface VadSegment {
    start: Seconds
    end: Seconds
  }

  export interface RawSegment {
    start: Seconds
    end: Seconds
    text: string
    words: WordToken[]
    probability?: number
  }

  export interface DiarFrames {
    speakers: number
    frames: { start: Seconds; end: Seconds; speaker: number; prob: number }[]
  }

  export type EngineErrorCode =
    | 'MODEL_UNLOADED'
    | 'CACHE_CORRUPT'
    | 'NETWORK'
    | 'QUOTA_EXCEEDED'
    | 'GPU_OOM'
    | 'SESSION_LOST'
    | 'DECODE_STALL'
    | 'DIAR_SESSION_LOST'
    | 'UNSUPPORTED_MEDIA'
    | 'FFMPEG_REQUIRED'
    | 'ENCODER_UNSUPPORTED'
    | 'CANCELLED'
    | 'ENGINE_INTERNAL'

  export interface EngineError {
    code: EngineErrorCode
    retryable: boolean
    detail?: string
  } // detail: codes/numbers only — NEVER content (SECURITY-03)

  export type NoticeCode = 'TIER_DOWNGRADE' | 'MULTI_TRACK' | 'FFMPEG_FALLBACK' | 'WORKER_RECYCLED' | 'OFFLINE_MODEL_MISSING' | 'PLAYBACK_STALL' | 'PREVIEW_UNSUPPORTED'

  export interface Notice {
    code: NoticeCode
    params?: Record<string, string | number>
  }

  export interface GuardStats {
    repeatedNgramDropped?: number
    shortSpeechDropped?: number
    maxTokensFlagged?: number
  }
  export interface JobStats {
    guard?: GuardStats
    language?: string
  }
  export type JobEvent =
    | { t: 'job:progress'; jobId: string; processedSec: number; totalSec: number }
    | { t: 'job:done'; jobId: string; stats?: JobStats }
    | { t: 'job:error'; jobId: string; error: EngineError }
    | { t: 'notice'; jobId?: string; notice: Notice }

  export type ModelEvent =
    | { t: 'model:confirm-required'; model: ModelId; bytes: number }
    | { t: 'model:progress'; model: ModelId; phase: 'download' | 'compile'; received: number; total?: number }
    | { t: 'model:ready'; model: ModelId; device: Device }
    | { t: 'model:error'; model: ModelId; error: EngineError }

  export type MediaRequest = { t: 'probe'; jobId: string; file: File } | { t: 'decode'; jobId: string; file: File; ports: MessagePort[] } | { t: 'cancel'; jobId: string }

  export type MediaEvent =
    | JobEvent
    | { t: 'media:probed'; jobId: string; asset: MediaAsset }
    | { t: 'peaks:chunk'; jobId: string; firstBucket: number; min: Float32Array; max: Float32Array }
    | { t: 'decode:support'; jobId: string; path: 'webcodecs' | 'ffmpeg' }

  export type DiarizeRequest = { t: 'loadModels' } | { t: 'diarize'; jobId: string; pcm: PcmSource; sampleRate: 16000; vad?: VadSegment[]; maxSpeakers?: number } | { t: 'cancel'; jobId: string } | { t: 'unload' }

  export type DiarizeEvent = JobEvent | ModelEvent | { t: 'diar:frames'; jobId: string; frames: DiarFrames }
}

declare module '@engine/model@06' {
  export type { CaptionBlock, Project, Seconds, Speaker, WordToken } from '@engine/model'
}

declare module '@engine/diarize/clustering' {
  export function agglomerativeCluster(embeds: Float32Array[], opts: { threshold?: number; maxSpeakers?: number }): number[]
}

declare module '@engine/diarize/assign' {
  import type { CaptionBlock, Project, Seconds, Speaker, WordToken } from '@engine/model@06'
  import type { DiarFrames } from '@engine/protocol@06'

  /** Inclusive index range into `block.words` (the frozen reassign seam). */
  export type WordRange = readonly [fromIndex: number, toIndex: number]

  /** FR-06.3 word-time majority hysteresis (seconds). */
  export const DIAR_HYSTERESIS_SEC: number

  /** FR-06.5: exactly 8 deterministic palette colors (`#rrggbb`). */
  export const SPEAKER_PALETTE: readonly string[]

  /** FR-06.5/US-1.3.2: cluster index → durable `SPK_<n>` + `Speaker N` + palette color. */
  export function speakersFromClusters(count: number): Speaker[]

  /** FR-06.3: word-time majority + 0.25 s hysteresis → block majorities + boundary-snapped splits (unit-05 blockize reuse, never mid-word). Pure. */
  export function assignSpeakers(blocks: CaptionBlock[], frames: DiarFrames): CaptionBlock[]

  /** US-1.3.2 (engine half, frozen by deps.ts): most occurrences wins, earliest-in-word-order on ties, `undefined` skipped, none → fallback. Pure. */
  export function majoritySpeakerId(words: readonly WordToken[], fallback: string): string

  /** US-1.3.2 (engine half, frozen by deps.ts): `from → to` word move, everything else passed through untouched. Pure. */
  export function reassignWords(words: readonly WordToken[], fromSpeakerId: string, toSpeakerId: string): WordToken[]

  export function renameSpeaker(project: Project, speakerId: string, label: string): Project
  export function reassign(project: Project, blockId: string, wordRange: WordRange, toSpeakerId: string): Project
  export function mergeSpeakers(project: Project, a: string, b: string): Project
  export function splitSpeaker(project: Project, from: string, cutTime: Seconds, newColor: string): Project
}

declare module '@engine/diarize/windowing' {
  import type { PcmChunk, VadSegment } from '@engine/protocol@06'
  import type { Seconds } from '@engine/model@06'
  import type { VadScorer } from '@engine/asr/vad'

  export interface EmbeddingWindow {
    start: Seconds
    end: Seconds
  }

  export interface WindowingOptions {
    /** Default 0.5 (FR-06.2). */
    minSec?: number
    /** Default 3 (FR-06.2). */
    maxSec?: number
    /** Default 0.5 (FR-06.2: 50 % hop on long segments). */
    hopRatio?: number
  }

  export const EMBED_WINDOW_MIN_SEC: number
  export const EMBED_WINDOW_MAX_SEC: number
  export const EMBED_WINDOW_HOP_RATIO: number

  /** FR-06.2: VAD segments → embedding windows (min 0.5 s, max 3 s, 50 % hop). Pure. */
  export function embeddingWindows(segments: readonly VadSegment[], opts?: WindowingOptions): EmbeddingWindow[]

  /** FR-06.2 reuse-vs-own-pass selection: a forwarded `vad` wins (scorer untouched); otherwise the own Silero pass runs through the injected scorer. */
  export function resolveEmbeddingWindows(input: {
    vad?: VadSegment[]
    pcm: AsyncIterable<PcmChunk>
    scorer: VadScorer
    opts?: WindowingOptions & { threshold?: number; minSpeechSec?: number; minSilenceSec?: number }
  }): Promise<{ windows: EmbeddingWindow[]; source: 'forwarded' | 'own-pass' }>
}

declare module '@engine/diarize/worker-core' {
  import type { DiarFrames, DiarizeEvent, DiarizeRequest } from '@engine/protocol@06'
  import type { Device, ModelId } from '@engine/protocol@06'
  import type { Seconds } from '@engine/model@06'

  /** One post-processed active-speaker run from the pyannote segmentation (frame-classification + post_process_speaker_diarization equivalent). */
  export interface SegmentationRun {
    start: Seconds
    end: Seconds
    speaker: number
    prob: number
  }

  export interface DiarizeSegmentationSession {
    readonly modelId: ModelId
    readonly device: Device
    segment(samples: Float32Array, startSec: Seconds): Promise<SegmentationRun[]>
    dispose(): void | Promise<void>
  }

  export interface DiarizeEmbeddingSession {
    readonly modelId: ModelId
    readonly device: Device
    embed(samples: Float32Array): Promise<Float32Array>
    dispose(): void | Promise<void>
  }

  export interface DiarizeWorkerCoreDeps {
    createSegmentationSession(): Promise<DiarizeSegmentationSession> | DiarizeSegmentationSession
    createEmbeddingSession(): Promise<DiarizeEmbeddingSession> | DiarizeEmbeddingSession
    /** FR-06.2 own-Silero-pass scorer (unit-05 VadScorer shape: one 512-sample frame → speech probability). */
    speechScore?(frame: Float32Array): number | Promise<number>
  }

  export interface DiarizeWorkerCore {
    post(request: DiarizeRequest): Promise<void>
    onEvent(listener: (event: DiarizeEvent) => void): () => void
    dispose(): void
  }

  export function createDiarizeWorkerCore(deps: DiarizeWorkerCoreDeps): DiarizeWorkerCore
}
