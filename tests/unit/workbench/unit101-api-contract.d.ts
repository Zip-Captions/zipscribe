// Unit-101 FROZEN API CONTRACT — test-author-owned ambient module declarations.
//
// The RED-phase suite of unit-101 (Workbench Shell) imports the production
// modules `src/state/{settings,jobs,project}.ts`,
// `src/state/services/intake.ts`, `src/ui/shell/Workbench.tsx` and
// `src/ui/commands/registry.ts` through the `@state/…` / `@ui/…` specifiers
// (vite/vitest alias + tsconfig paths → `src/…`). None of them exist yet —
// that is the point: the tests import them and fail at *runtime* (missing
// module), while `pnpm typecheck` types the tests against the declarations
// below. The builder must export exactly these names/shapes (byte-for-byte);
// the runtime assertions (not these types) are the acceptance gate
// (unit-03/04/05 `@NN` precedent).
//
// Contract types are NOT redefined here: the real `src/engine/protocol.ts` and
// `src/engine/model.ts` are pulled into this (type-only) program and
// re-exported under `@engine/protocol@101` / `@engine/model@101` so no test
// ever imports them by their bare alias (the `@101` suffix makes an
// accidental RUNTIME import impossible: nothing resolves it).
//
// Ownership boundary (intent.md § Boundaries): unit-102 owns the canonical
// store shape; the slices below are the MINIMAL shapes unit-101's shell tests
// drive (jobs {tier, tierNotice, streaming, progress}, settings {panels,
// collapsed, theme}, minimal project view). unit-102 EXTENDS, never breaks,
// these members. `@engine/captions@101` exists solely because unit-07
// (`src/engine/captions`) is not merged — caption intake reaches the UI only
// through the injectable `ImportCaptionsService` seam below; the
// `ImportReport`/`CaptionFormat` declarations are VERBATIM from
// `.ai-dlc/knowledge/architecture.md` § "engine/captions — pure, main-thread"
// and must match when unit-07 lands.
//
// Keyboard rule (conventions § UI conventions): components never bind keys —
// all shortcuts exist as command-registry bindings (unit-105 owns the
// implementation; unit-101 freezes the four bindings its shell needs). The
// project-name inline edit is the only text-editing affordance and lives on
// an `ui/**/editable/**` allowlisted path (design: focus commands never fire
// while editing).
//
// `data-testid` contract (builder must use exactly these ids):
//   shell regions           workbench-shell · panel-sidebar · panel-stage · panel-timeline
//                           (regions carry data-region="sidebar"|"stage"|"timeline" and tabindex="-1";
//                            the stage carries the reserved overlay layer [data-testid=preview-canvas-layer])
//   resize                  resize-handle-sidebar · resize-handle-timeline (role="separator",
//                           aria-orientation vertical|horizontal, aria-valuenow = current px)
//   tabs                    tab-subtitles · tab-media · tab-style (aria-selected; Style tab renders
//                           the "Styling arrives in Intent 3" placeholder behind the feature flag)
//   header                  project-name (input) · tier-chip (GPU|CPU|Limited text) · tier-tooltip
//                           (element carrying the tierNotice-derived copy when tierNotice is set) ·
//                           transcribe-button · export-button
//   transcribe popover      transcribe-popover · transcribe-language-select · transcribe-model-option
//                           (attribute data-model-id = ModelId, contains [data-testid=offline-badge]
//                            when offlineReady) · diarize-toggle · transcribe-start-button
//                           (never disabled for an UNCACHED model — FR-2.0.2) ·
//                           model-download-confirm · model-download-confirm-button
//                           (shown when the engine answers `model:confirm-required`)
//                           existing-captions case: replace-captions-button · align-captions-button
//                           (replace-captions-button replaces transcribe-start-button)
//   status bar              status-bar (role="status" aria-live="polite"; carries progress % while
//                           a job runs; model·tier·cache otherwise)
//   first run / import      drop-zone · sample-clip-button · import-report · toast (rejection copy
//                           carries the reason CODE only — never file names, SECURITY-03)
//   streaming               streaming-segment-row (one per RawSegment in jobs.segments)
//   T4                      blocked-screen · blocked-requirement (≥ 2 requirement rows)

declare module '@engine/protocol@101' {
  export type { AsrEvent, AsrRequest, DiarizeEvent, DiarizeRequest, Device, EngineError, JobEvent, MediaEvent, MediaRequest, ModelId, Notice, NoticeCode, PcmSource, RawSegment, Tier } from '@engine/protocol'
}

declare module '@engine/model@101' {
  export type { CaptionBlock, MediaAsset, Project } from '@engine/model'
}

declare module '@engine/captions@101' {
  /** VERBATIM from architecture.md § engine/captions — do not edit until unit-07 merges, then re-export the real module instead. */
  export type CaptionFormat = 'srt' | 'vtt' | 'sbv' | 'ttml' | 'ass' | 'zipscribe-json'
  export interface ImportReport {
    format: CaptionFormat
    encoding: string
    cues: number
    blocks: number
    detectedLanguage: string | null
    adjustments: { code: 'OVERLAP_CLAMPED' | 'ZERO_DURATION_FIXED' | 'TAGS_STRIPPED' | 'POSITION_DROPPED' | 'STYLE_DROPPED' | 'EMPTY_CUE_DROPPED' | 'CUE_UNMATCHED'; count: number }[]
  }
}

declare module '@state/settings' {
  /** Persisted surface: async so the unit-106 IDB adapter can replace it; tests inject a fake over `createFakeKvStore`. */
  export interface SettingsStorage {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
  }

  export const SETTINGS_STORAGE_KEY: 'zipscribe.settings.workbench'

  /** Minimum panel sizes (US-2.0.1 "minimum panel sizes enforced"); `setPanelSize` clamps, never silently drops. */
  export const MIN_SIDEBAR_PX: number
  export const MIN_TIMELINE_PX: number

  export interface PanelSizes {
    sidebarPx: number
    timelinePx: number
  }

  export interface WorkbenchSettings {
    panels: PanelSizes
    collapsed: { sidebar: boolean; timeline: boolean }
    /** FR-2.0.5: dark default; 'system' follows prefers-color-scheme only when the user never chose. */
    theme: 'dark' | 'light' | 'system'
  }

  export interface SettingsStore {
    getState(): WorkbenchSettings
    subscribe(listener: () => void): () => void
    /** Clamps to MIN_SIDEBAR_PX / MIN_TIMELINE_PX and persists the CLAMPED value. */
    setPanelSize(region: 'sidebar' | 'timeline', px: number): void
    /** Ctrl+Alt+2 / Ctrl+Alt+3 (design.md shortcut table) land here via the command registry. */
    toggleCollapsed(region: 'sidebar' | 'timeline'): void
    setTheme(theme: 'dark' | 'light' | 'system'): void
  }

  /** Hydrates from storage (missing key → defaults; corrupt JSON → defaults, never throws). Persists on every setter. */
  export function createSettingsStore(deps: { storage: SettingsStorage }): Promise<SettingsStore>
}

declare module '@state/jobs' {
  import type { AsrEvent, AsrRequest, Device, DiarizeRequest, EngineError, MediaEvent, MediaRequest, ModelId, Notice, RawSegment, Tier } from '@engine/protocol@101'

  /**
   * FR-2.0.6 injectable fake-engine seam: the app-side adapter over the real
   * workers in production, a scripted double in tests
   * (`tests/unit/workbench/helpers/fake-engine.ts`).
   */
  export interface EnginePort {
    postMedia(request: MediaRequest): void
    postAsr(request: AsrRequest): void
    postDiarize(request: DiarizeRequest): void
    onMediaEvent(listener: (event: MediaEvent) => void): () => void
    onAsrEvent(listener: (event: AsrEvent) => void): () => void
    dispose(): void
  }

  /** Offline-readiness source for the popover badges (Cache API in production, a Set in tests). */
  export interface ModelCachePort {
    listCached(): Promise<ModelId[]>
  }

  /** Capability probe result as the UI consumes it (codes/strings only — never content, SECURITY-03). */
  export interface CapabilitySnapshot {
    tier: Tier
    /** Blocked reasons (T4). Empty on a working tier. */
    reasons: string[]
  }

  export interface ModelOptionView {
    id: ModelId
    /** Human size label, e.g. '39 MB' (derived from registry `approxBytes`). */
    sizeLabel: string
    offlineReady: boolean
    /** BCP-47 primary tags this model supports ('*' = multilingual auto-detect). */
    languages: readonly string[]
  }

  export type JobKind = 'transcribe' | 'align'

  export interface ActiveJob {
    kind: JobKind
    jobId: string
  }

  export interface JobsState {
    capability: CapabilitySnapshot | null
    /** US-2.0.3: chip tooltip copy source; UI maps `code` → copy (never the code alone as the whole tooltip). */
    tierNotice: Notice | null
    /**
     * Popover model list: derived by the store from the model registry rows
     * (unit-03) with `offlineReady` computed from `modelCache.listCached()`
     * (async — consumers render options as they arrive).
     */
    modelOptions: ModelOptionView[]
    running: ActiveJob | null
    progress: { processedSec: number; totalSec: number } | null
    /** Latest accumulated `job:segments` (sorted by start) — drives the streaming rows + status %. */
    segments: RawSegment[]
    error: EngineError | null
    notices: Notice[]
  }

  export interface StartTranscribeOptions {
    language: string | null
    modelId: ModelId
    diarize: boolean
    /** US-2.0.4: 'replace' overwrites the source track; 'align' keeps imported captions. */
    mode: 'replace' | 'align'
  }

  export interface JobsStore {
    getState(): JobsState
    subscribe(listener: () => void): () => void
    setCapability(capability: CapabilitySnapshot): void
    setTierNotice(notice: Notice | null): void
    startTranscribe(options: StartTranscribeOptions): void
    cancel(): void
  }

  /**
   * Subscribes to the engine at creation: `job:progress`/`job:done`/`job:error`
   * /`notice`/`job:segments` update state per protocol.ts. `startTranscribe`
   * posts `loadModel` ({device: tier==='T1' ? 'webgpu' : 'wasm'}) then
   * `transcribe` (sampleRate 16000, language as given) and — when `diarize` —
   * one `diarize` request with the SAME jobId.
   */
  export function createJobsStore(deps: { engine: EnginePort; modelCache: ModelCachePort }): JobsStore

  export type { Device }
}

declare module '@state/project' {
  import type { CaptionBlock, MediaAsset, Project } from '@engine/model@101'
  import type { CaptionImportResult } from '@state/services/intake'

  /** Minimal shell-side view (unit-102 owns the full slice; it must keep these members). */
  export interface ProjectStore {
    getState(): { project: Project | null }
    subscribe(listener: () => void): () => void
    /**
     * Creates the project from a probed asset; when a caption import came in the
     * same drop, the source track is the IMPORTED blocks (captionOrigin
     * 'imported', transcription 'none') — US-2.0.2 media+captions together.
     */
    createProject(asset: MediaAsset, captionImport?: CaptionImportResult): void
    /** True once ≥ 1 block exists (Export enabled state, FR-2.0.2 — display only in 101). */
    hasBlocks(): boolean
    setProjectName(name: string): void
  }

  export function createProjectStore(deps: { clock: { now(): number } }): ProjectStore

  export type { CaptionBlock }
}

declare module '@state/services/intake' {
  import type { CaptionBlock, MediaAsset } from '@engine/model@101'
  import type { CaptionFormat, ImportReport } from '@engine/captions@101'
  import type { EnginePort, JobsStore } from '@state/jobs'
  import type { ProjectStore } from '@state/project'

  export interface CaptionImportResult {
    report: ImportReport
    blocks: CaptionBlock[]
  }

  /**
   * UNIT-07 SEAM: caption-file intake. Tests inject a fake importer returning a
   * canned `ImportReport`; the real implementation lands with unit-07
   * (`importCaptions`). The UI must never import `engine/captions` directly.
   */
  export interface ImportCaptionsService {
    /** Content sniff + extension (US-2.0.2); null = not a caption file we accept. */
    sniff(file: File): Promise<CaptionFormat | null>
    importCaptions(file: File): Promise<CaptionImportResult>
  }

  export interface RejectedFile {
    /** Extension + MIME summary — NOT the file name (SECURITY-03: the toast shows codes, not user strings). */
    reason: 'UNSUPPORTED_TYPE' | 'UNSUPPORTED_CAPTION'
  }

  export interface IntakeOutcome {
    /** A `probe` MediaRequest was posted for each accepted media file. */
    mediaPosted: number
    importedCaptions: CaptionImportResult[]
    rejected: RejectedFile[]
  }

  export interface IntakeService {
    /** Classifies every dropped file — nothing is silently dropped (CC-101.2). */
    handleFiles(files: readonly File[]): Promise<IntakeOutcome>
    /** US-2.0.2: fetches SAMPLE_CLIP_URL, wraps a File, runs it through handleFiles. */
    loadSample(): Promise<void>
  }

  /** App-served sample copied from fixtures at BUILD time — fixtures/ itself is never served (CC-101.2). */
  export const SAMPLE_CLIP_URL: '/samples/speech-2min.mp4'

  export function createIntakeService(deps: { engine: EnginePort; jobs: JobsStore; project: ProjectStore; importService: ImportCaptionsService }): IntakeService
}

declare module '@ui/shell/Workbench' {
  import type { ReactNode } from 'react'
  import type { JobsStore } from '@state/jobs'
  import type { SettingsStore } from '@state/settings'
  import type { ProjectStore } from '@state/project'
  import type { IntakeService } from '@state/services/intake'

  export interface WorkbenchProps {
    jobs: JobsStore
    settings: SettingsStore
    project: ProjectStore
    intake: IntakeService
  }

  /**
   * The populated shell: header (project name / tier chip / Transcribe / Export),
   * tabbed sidebar (Subtitles mount point, Media asset card, Style placeholder),
   * preview stage with reserved canvas layer, empty timeline region, status bar,
   * drop zone / empty state. Thin render layer — all behavior flows through the
   * injected stores/services (no business logic in components).
   */
  export function Workbench(props: WorkbenchProps): ReactNode
}

declare module '@ui/commands/registry' {
  export interface CommandBinding {
    id: string
    /** Normalized chord, e.g. 'Alt+1', 'Ctrl+Alt+2' (design.md shortcut table format). */
    keys: string
    /** Never fire while a text-editing path (project-name input) has focus. */
    when?: 'not-editing'
  }

  export function getCommandBindings(): readonly CommandBinding[]
  /** No-op-safe: unknown ids throw; `when: 'not-editing'` bindings are skipped while editing. */
  export function dispatchCommand(id: string): void
}

/**
 * E2E-only injection bridge (FR-2.0.6 / CC-101.1 CLS): wired by the builder
 * when `location.search` contains `ziptest=1`, dispatching into the SAME
 * receivers the EnginePort fake uses. Production users never set the flag;
 * the bridge is lazily imported (bundle budget). Declared via interface
 * merging (this file is an ambient script — top-level `declare global` is not
 * allowed there, unit-05 precedent).
 */
interface Window {
  __zipWorkbenchBridge?: {
    injectMediaEvent(event: import('@engine/protocol@101').MediaEvent): void
    injectAsrEvent(event: import('@engine/protocol@101').AsrEvent): void
    /** e2e fake for the unit-07 seam (US-2.0.2 both-drops report display); null restores the real service. */
    setCaptionImportOverride(result: import('@state/services/intake').CaptionImportResult | null): void
    /** Test-only project seeding through the same intake path a probe reply takes (CLS/keyboard walkthroughs run without a real probe). */
    openProject(asset: import('@engine/model@101').MediaAsset): void
  }
}
