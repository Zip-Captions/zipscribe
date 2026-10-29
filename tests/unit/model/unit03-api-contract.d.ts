// Unit-03 FROZEN API CONTRACT — test-author-owned ambient module declarations.
//
// The RED-phase suite of unit-03 (Model Manager & Registry) imports the
// production modules `src/engine/model/{registry,capability,cache,manager}.ts`
// through the `@engine/...` specifiers (vite/vitest alias → `src/engine/...`).
// The modules do not exist yet — that is the point: the tests import them and
// fail at *runtime* (missing module/exports), while `pnpm typecheck` types the
// tests against the declarations below. The builder must export exactly these
// names/shapes; the runtime assertions (not these types) are the acceptance
// gate. `tsconfig.node.json` intentionally carries NO `paths` mapping for
// `@engine/*`, so these declarations keep shadowing the specifiers even after
// implementation — this file is the frozen contract, kept byte-stable by the
// builder.
//
// `@engine/protocol` is declared here as a structural mirror of
// `src/engine/protocol.ts` (which cannot be pulled into the `tsconfig.node.json`
// program because it references the DOM `MessagePort` type). The mirror is
// token-faithful to `.ai-dlc/knowledge/architecture.md` § Worker protocol; the
// real protocol.ts stays the source of truth at runtime (type-only imports are
// erased, so the tests never load it under Node).

declare module '@engine/protocol' {
  export type Tier = 'T1' | 'T2' | 'T3' | 'T4'
  export type Device = 'webgpu' | 'wasm'
  export type ModelId = string

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
  }

  export type NoticeCode = 'TIER_DOWNGRADE' | 'MULTI_TRACK' | 'FFMPEG_FALLBACK' | 'WORKER_RECYCLED' | 'OFFLINE_MODEL_MISSING' | 'PLAYBACK_STALL' | 'PREVIEW_UNSUPPORTED'

  export interface Notice {
    code: NoticeCode
    params?: Record<string, string | number>
  }

  export type ModelEvent =
    | { t: 'model:confirm-required'; model: ModelId; bytes: number }
    | { t: 'model:progress'; model: ModelId; phase: 'download' | 'compile'; received: number; total?: number }
    | { t: 'model:ready'; model: ModelId; device: Device }
    | { t: 'model:error'; model: ModelId; error: EngineError }

  export type ModelManagerEvent = ModelEvent | { t: 'notice'; jobId?: string; notice: Notice }

  /**
   * Rejection value carried by manager/cache rejections: an Error (or Error-
   * like) exposing `error: EngineError`. Tests assert `rejection.error.code`.
   */
  export interface ModelFailure {
    error: EngineError
  }
}

declare module '@engine/model/registry' {
  import type { Device, Tier } from '@engine/protocol'

  export type EngineKind = 'transformers-whisper' | 'sherpa-wasm' | 'cactus-whistle'

  export type TimestampMode = 'word-native' | 'word-derived' | 'segment' | 'none'

  export interface ModelFile {
    path: string
    sha256: string
    bytes: number
  }

  export interface ModelSpec {
    id: string
    engine: EngineKind
    /** HF repo id (or `spaces/<owner>/<name>`), never fetched at runtime. */
    repo: string
    /** 40-hex pinned commit SHA — URLs are always `resolve/<revision>/...`, never `main`. */
    revision: string
    files: ModelFile[]
    /** transformers.js per-module dtype recipe, e.g. `{ encoder_model: 'fp32', decoder_model_merged: 'q4' }`. */
    dtypeRecipe?: Record<string, string>
    approxBytes: number
    /** Supported BCP-47 primary tags; `['*']` = multilingual (languageDetect decides). */
    languages: string[]
    punctuation: boolean
    confidence: boolean
    languageDetect: boolean
    timestampMode: TimestampMode
    license: string
    attribution?: string
    tierHint: Tier
    /** Same-origin paths (`/wasm/...`, `/sherpa/...`) fetched by `ensureOffline` alongside the model. */
    runtimeWasm: string[]
    enOnly: boolean
    /** FR-03.3 gate: selector refuses this model when `deviceMemGB !== null && deviceMemGB < minDeviceMemGB`. */
    minDeviceMemGB?: number
    /** HF `device` the row was measured on (provenance from the spike table). */
    deviceHint?: Device
  }

  export const ENGINE_KINDS: EngineKind[]

  /** Registry rows keyed by `ModelId` (registry key = `id`). */
  export const MODEL_REGISTRY: Record<string, ModelSpec>

  /** Spike recommendation (unit-02 CC-02.11): T1 whisper-base, T2 sherpa-zipformer, T3 whistle. */
  export const TIER_DEFAULT_MODEL: Record<'T1' | 'T2' | 'T3', string>

  export function getModel(id: string): ModelSpec | undefined

  /** `https://huggingface.co/<repo>/resolve/<revision>/<path>` — never `resolve/main/`. */
  export function modelFileUrl(spec: ModelSpec, file: ModelFile): string
}

declare module '@engine/model/capability' {
  import type { Device, EngineKind, Tier } from '@engine/protocol'

  /**
   * Injected environment for `probeCapabilities` (FR-03.2). Pure with respect
   * to this object — no globals are read. `requestAdapter` mimicking
   * `navigator.gpu.requestAdapter()`: resolves an adapter object (usable),
   * resolves `null` (no adapter) or rejects (request failed) — the latter two
   * both mean "no usable webgpu adapter", never a throw out of the probe.
   */
  export interface CapabilityEnv {
    navigator?:
      | {
          gpu?: { requestAdapter(): Promise<unknown> } | null
          /** `navigator.deviceMemory` in GB — Chromium-only, coarse; null/undefined = not exposed (never blocks). */
          deviceMemory?: number | null
        }
      | null
    wasmSimd: boolean
    audioDecoder: boolean
    audioEncoder: boolean
    videoEncoder: boolean
    online?: boolean
  }

  export interface Capabilities {
    tier: Tier
    webgpuAdapter: boolean
    wasmSimd: boolean
    audioDecoder: boolean
    audioEncoder: boolean
    videoEncoder: boolean
    deviceMemGB: number | null
    online: boolean
    /**
     * Non-empty exactly when `tier === 'T4'` (blocked state, US-1.1.1).
     * Content-free reason codes: `'NO_WEBGPU_AND_NO_WASM_SIMD'`,
     * `'LOW_DEVICE_MEMORY'`.
     */
    reasons: string[]
  }

  export function probeCapabilities(env: CapabilityEnv): Promise<Capabilities>

  export interface TierSelection {
    engine: EngineKind
    /** ModelId — always a key of the active registry. */
    model: string
    tier: Tier
    /** T1 → `'webgpu'`, otherwise `'wasm'` (workers only ever see a Device). */
    device: Device
  }

  export interface TierSelectorOptions {
    /** User model override (FR-03.3) — must be a key of the active registry. */
    userModel?: string
    /** Registry override (DI for tests); defaults to `MODEL_REGISTRY`. */
    registry?: Record<string, import('@engine/model/registry').ModelSpec>
    /** Device-memory gate threshold in GB for `minDeviceMemGB` models (FR-03.3); default 16. */
    largeModelMinDeviceMemGB?: number
  }

  /**
   * Throws `Error` with a message matching `/T4|BLOCKED/` on T4 (blocked state
   * — no model may be selected, so no download can be attempted),
   * `/UNKNOWN_MODEL/` for an unknown override, `/MEMORY/` when the
   * device-memory gate blocks the override. `deviceMemGB === null` never
   * gates (FR-03.2 / architecture: memory gate only when exposed).
   */
  export function tierSelector(caps: Capabilities, opts?: TierSelectorOptions): TierSelection
}

declare module '@engine/model/cache' {
  import type { ModelFailure } from '@engine/protocol'
  import type { ModelSpec } from '@engine/model/registry'

  /** Cache name invariant (FR-03.6 / settings.yml storage). */
  export const MODEL_CACHE_NAME: 'zipscribe-models'

  export interface FetchInit {
    signal?: AbortSignal
  }
  export type FetchImpl = (url: string, init?: FetchInit) => Promise<Response>

  /**
   * Minimal `Cache`-API surface (structurally satisfied by
   * `src/test-support/fake-storage.ts` `createFakeCache()`), keyed by absolute
   * URL. The production implementation wraps `caches.open(MODEL_CACHE_NAME)`.
   */
  export interface CacheLike {
    match(key: string): Promise<Response | undefined>
    put(key: string, body: Uint8Array): Promise<void>
    delete(key: string): Promise<boolean>
  }

  export interface ModelCacheDeps {
    registry?: Record<string, ModelSpec>
    fetchImpl?: FetchImpl
    /** Injected store (tests); defaults to the real Cache API under MODEL_CACHE_NAME. */
    cacheStore?: CacheLike
    /** Base origin for `runtimeWasm` paths (`new URL(path, selfOrigin)`). */
    selfOrigin?: string
    /** `navigator.storage.estimate` (tests stub it over the fake store). */
    storageEstimate?: () => Promise<{ usage: number; quota: number }>
  }

  export interface CachedEntry {
    id: string
    /** Total cached bytes: every model file AND every runtimeWasm entry. */
    bytes: number
    offlineReady: boolean
    /** epoch ms of the last successful SHA-256 verification. */
    verifiedAt: number
  }

  export interface ModelCache {
    /**
     * Fetch every `files[].path` (via `modelFileUrl`) AND every `runtimeWasm`
     * path, verify each against the registry SHA-256, cache on success only
     * (no partial entries on failure — CC-03.5). Rejects with `ModelFailure`
     * (`NETWORK` on fetch failure, `CACHE_CORRUPT` on SHA mismatch).
     */
    ensureOffline(id: string, opts?: { signal?: AbortSignal }): Promise<void>
    /** One entry per registry row; `offlineReady` = every URL cached and verified. */
    listCached(): Promise<CachedEntry[]>
    /** Deletes the model's file entries AND its runtimeWasm entries. */
    removeCached(id: string): Promise<void>
    /** Verified read path: bytes on hit, `undefined` on miss, rejects `ModelFailure` `CACHE_CORRUPT` (after evicting the corrupt entry) on SHA mismatch. */
    matchCached(url: string, sha256: string): Promise<Uint8Array | undefined>
    putCached(url: string, bytes: Uint8Array): Promise<void>
    deleteCached(url: string): Promise<void>
    storageEstimate(): Promise<{ usage: number; quota: number }>
  }

  export function createModelCache(deps: ModelCacheDeps): ModelCache

  export function sha256Hex(bytes: Uint8Array): Promise<string>
}

declare module '@engine/model/manager' {
  import type { Device, EngineError, ModelFailure, ModelManagerEvent } from '@engine/protocol'
  import type { Capabilities, TierSelection } from '@engine/model/capability'
  import type { ModelCache } from '@engine/model/cache'
  import type { EngineKind, ModelSpec } from '@engine/model/registry'

  /** > 100 MB confirmation gate (zip-captions catalog convention, US-1.1.4). */
  export const LARGE_DOWNLOAD_CONFIRM_BYTES: 100_000_000

  export interface AdapterLoadInput {
    spec: ModelSpec
    device: Device
    /** Verified model bytes keyed by `ModelFile.path`. */
    files: Record<string, Uint8Array>
    signal: AbortSignal
  }

  /** Engine SDK glue injected at the manager seam (fake in tests). */
  export interface EngineAdapter {
    load(input: AdapterLoadInput): Promise<void>
    invoke(method: string, payload?: unknown): Promise<unknown>
    unload(): Promise<void>
  }

  export type AdapterFactory = (spec: ModelSpec) => EngineAdapter | Promise<EngineAdapter>

  export interface ModelManagerDeps {
    registry?: Record<string, ModelSpec>
    fetchImpl: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>
    cache: ModelCache
    /** One factory per EngineKind the manager must serve (FR-03.5 seam). */
    adapters: Partial<Record<EngineKind, AdapterFactory>>
    /** Main-thread capability source (`probeCapabilities` in production). */
    capabilities: () => Promise<Capabilities>
    emit?: (event: ModelManagerEvent) => void
    /** Offline probe; default `globalThis.navigator?.onLine ?? true`. */
    online?: () => boolean
    largeDownloadConfirmBytes?: number
  }

  export interface LoadOptions {
    device?: Device
    /** Pre-confirmed > 100 MB download (skips the confirm-required gate). */
    confirmed?: boolean
  }

  export interface ModelManager {
    /**
     * Single-flight per model id (CC-03.6): concurrent calls share ONE fetch
     * sequence. Emits `model:progress` (phase `download` then `compile`) then
     * `model:ready` (device per caps.tier / opts.device). Gate semantics:
     * - T4 caps → rejects `ModelFailure` (`ENGINE_INTERNAL`), ZERO fetches
     *   attempted (CC-03.2 blocked state — reasons come from `capabilities`).
     * - offline (`online()` false) + not fully cached → emits
     *   `{ t: 'notice', notice: { code: 'OFFLINE_MODEL_MISSING' } }` and
     *   rejects `ModelFailure` (`NETWORK`) immediately — no fetch attempted
     *   (CC-03.3 / US-03.1; 1 s budget asserted in the Playwright spec).
     * - `approxBytes > largeDownloadConfirmBytes` (default 100 MB) → emits
     *   `model:confirm-required` and fetches nothing until `confirmDownload`
     *   (CC-03.7).
     * - corrupt cache entry → emits `model:error` `CACHE_CORRUPT`, evicts,
     *   re-downloads that file exactly ONCE; a second mismatch surfaces the
     *   error (rejects `ModelFailure` `CACHE_CORRUPT`) with no further fetches.
     * - fetch failure → `model:error` `NETWORK` `retryable: true`; no partial
     *   cache entry for the failed file (CC-03.5).
     */
    loadModel(id: string, opts?: LoadOptions): Promise<void>
    confirmDownload(id: string): void
    /** Aborts the in-flight load; loadModel rejects `ModelFailure` `CANCELLED`. */
    cancelLoad(): void
    /**
     * Unloads the engine (adapter `unload()`); afterwards `getAdapter` rejects
     * `ModelFailure` with code `MODEL_UNLOADED` (CC-03.6). `loadModel` again
     * reloads (from cache when present).
     */
    unload(): Promise<void>
    getAdapter(id: string): Promise<EngineAdapter>
    /** The tier selection actually used for the last/current load. */
    currentSelection(): TierSelection | undefined
  }

  export function createModelManager(deps: ModelManagerDeps): ModelManager

  export type { EngineError, ModelFailure }
}
