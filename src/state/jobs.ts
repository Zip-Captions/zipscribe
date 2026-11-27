// Jobs slice — engine-backed job state for the shell (tier chip, popover,
// progress, streaming segments).
//
// Shapes are the unit-101 frozen contract
// (tests/unit/workbench/unit101-api-contract.d.ts § @state/jobs); the canonical
// store shape is unit-102's, which extends — never breaks — these members.
// The engine is the FR-2.0.6 injectable seam: production wires the real
// workers behind `EnginePort`, tests script a double.
//
// SECURITY-03: this slice stores protocol objects verbatim; nothing here ever
// logs or derives strings from segment/caption content.

import { createStore } from 'zustand/vanilla'
import { immer } from 'zustand/middleware/immer'
import type { AsrEvent, AsrRequest, Device, DiarizeRequest, EngineError, MediaEvent, MediaRequest, ModelId, Notice, PcmSource, RawSegment, Tier } from '../engine/protocol'
import { MODEL_REGISTRY, TIER_DEFAULT_MODEL } from '../engine/model/registry'
import { LARGE_DOWNLOAD_CONFIRM_BYTES } from '../engine/model/manager'
import { newJobId } from './ids'
import type { EditorApp } from '@state/history'
import type { TranslationEngine } from '../engine/translate/engine'
import { translateError } from '../engine/translate/engine'
import { createTranslationApplyService } from './services/translation-apply'
import type { RunStats, SessionRunOptions } from '../engine/translate/session'
import type { Project } from '../engine/model'

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
  /**
   * FR-204.2 (unit-204 EXTENDS, optional): live presence of one row's
   * verified cache entries (presence-only — the load path re-hashes). The
   * offline fast-fail preflight consults it (async, before the worker is
   * ever posted to); absent, the preflight falls back to the hydrated
   * `modelOptions` offlineReady flag.
   */
  isOfflineReady?(id: ModelId): Promise<boolean>
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

/** unit-03 `model:confirm-required` gate (> 100 MB) surfaced to the popover. */
export interface PendingModelDownload {
  model: ModelId
  bytes: number
}

/** FR-302.1 (unit-302 EXTENDS, additive): per-language translation job state
 *  for the Languages section (`jobs.translation[lang]`). Codes/numbers only —
 *  never caption/translation text (SECURITY-03). */
export type TranslationStatus = 'idle' | 'downloading' | 'translating' | 'done' | 'partial' | 'cancelled' | 'failed'
export type TranslationAvailability = 'unknown' | 'ready' | 'download' | 'downloading' | 'unavailable'
export interface TranslationJobState {
  language: string
  status: TranslationStatus
  availability: TranslationAvailability
  progress: { done: number; total: number } | null
  error: EngineError | null
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
  /**
   * Extension beyond the frozen minimal shape (unit-102 may keep/extend it):
   * the unit-03 `model:confirm-required` gate the popover renders as the
   * download confirmation — codes/numbers only (SECURITY-03).
   */
  pendingConfirmDownload: PendingModelDownload | null
  /** FR-302.1: per-language translation job state, keyed by BCP-47 target. */
  translation: Record<string, TranslationJobState>
  /** FR-302.1: whether the built-in Translator is usable here — drives the
   *  Languages-section gating copy. Set by `refreshAvailability`. */
  translationSupport: 'unknown' | 'supported' | 'unsupported'
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
  /**
   * FR-108.1 EXTENDS (additive — the frozen unit-101 members are untouched):
   * a raw engine-event tap fired BEFORE the slice folds the event, so
   * state-layer bridges (the stream-commit service) correlate against the
   * same pre-event `running` the slice itself filters on. Protocol objects
   * verbatim — never logged, never content-derived (SECURITY-03).
   */
  onEngineEvent(listener: (event: MediaEvent | AsrEvent) => void): () => void
  setCapability(capability: CapabilitySnapshot): void
  setTierNotice(notice: Notice | null): void
  startTranscribe(options: StartTranscribeOptions): void
  cancel(): void
  /** User accepted the `model:confirm-required` gate → post `confirmDownload` (unit-03). */
  confirmModelDownload(model: ModelId): void
  /** FR-302.1: start/continue a machine translation run for one language (creates the machine track). Resolves with the run stats; rejects with the coded EngineError (SECURITY-03). */
  runTranslation(project: Project, language: string, options?: RunTranslationOptions): Promise<RunStats>
  /** FR-302.1: cancel an in-flight run ≤ 500 ms (completed entries kept). */
  cancelTranslation(language: string): void
  /** FR-302.1: hydrate the picker availability badges (a background probe — never downloads). */
  refreshAvailability(source: string, languages: readonly string[]): Promise<void>
}

export interface RunTranslationOptions {
  /** 'stale' re-translates stale entries (US-302.2); default only missing/failed. */
  mode?: 'missing' | 'stale'
  /** Transcript viewport — visible-first ordering (US-302.1). */
  visibleIds?: ReadonlySet<string>
}

/** Registry default for a tier (unit-02 CC-02.11 spike recommendation); T4/unknown → the T1 row. */
export function defaultModelForTier(tier: Tier | null | undefined): ModelId {
  return TIER_DEFAULT_MODEL[tier === 'T1' || tier === 'T2' || tier === 'T3' ? tier : 'T1']
}

const INITIAL_STATE: JobsState = {
  capability: null,
  tierNotice: null,
  modelOptions: [],
  running: null,
  progress: null,
  segments: [],
  error: null,
  notices: [],
  pendingConfirmDownload: null,
  translation: {},
  translationSupport: 'unknown',
}

function sizeLabel(approxBytes: number): string {
  if (approxBytes >= 1_000_000_000) return `${(approxBytes / 1_000_000_000).toFixed(1)} GB`
  if (approxBytes >= 1_000_000) return `${Math.round(approxBytes / 1_000_000)} MB`
  return `${approxBytes} B`
}

// FR-108.2 (unit-108): the real stream. With the composition root's
// `mediaSource` dep wired, startTranscribe posts `transcribe` with a
// MessagePort stream source and follows (after the blob resolves) with a
// `decode` request carrying the tee ports — the media worker's decode tee
// (protocol.ts) delivers 16 kHz PcmChunks to the ASR (and diarize) workers.
// WITHOUT the dep (every frozen jsdom/node suite, the ziptest harness) the
// frozen contract's empty transfer buffer is posted byte-identically.
function placeholderPcm(): PcmSource {
  return { kind: 'transfer', buffer: new ArrayBuffer(0) }
}

function sortByStart(segments: RawSegment[]): RawSegment[] {
  return [...segments].sort((a, b) => a.start - b.start)
}

/**
 * Subscribes to the engine at creation: `job:progress`/`job:done`/`job:error`
 * /`notice`/`job:segments` update state per protocol.ts. `startTranscribe`
 * posts `loadModel` ({device: tier==='T1' ? 'webgpu' : 'wasm'}) then
 * `transcribe` (sampleRate 16000, language as given) and — when `diarize` —
 * one `diarize` request with the SAME jobId.
 */
export function createJobsStore(deps: {
  engine: EnginePort
  modelCache: ModelCachePort
  mediaSource?: () => Promise<File>
  warmModelCache?: (modelId: string) => void
  translation?: { editorApp: EditorApp; engine: TranslationEngine }
  /**
   * unit-304 (FR-304.1, #51): the job-output seam `project.language` rides —
   * the SAME `EditorApp` the transcribe-commit/translation services use.
   * `applyWithoutHistory` only (M6/#66 ruling: job artifacts never enter the
   * undo chain), never a command. Absent (frozen harnesses without an editor
   * app), the language plumbing is inert. Defaults to `translation.editorApp`.
   */
  editorApp?: EditorApp
}): JobsStore {
  const store = createStore<JobsState>()(immer(() => structuredClone(INITIAL_STATE)))

  // The one editor-app the language plumbing writes through (the top-level
  // dep wins; the translation wiring shares the same instance in production).
  const editorApp = deps.editorApp ?? deps.translation?.editorApp ?? null

  /** Record `project.language` as JOB OUTPUT (the transcribe-commit seam —
   *  no history step, no undo surprise; M6/#66 ruling). */
  function recordProjectLanguage(language: string): void {
    if (editorApp === null) return
    editorApp.applyWithoutHistory((draft) => {
      if (draft.project !== null) draft.project.language = language
    })
  }

  // FR-302.1: one apply service (unit-301) + a per-language cancel registry.
  // The apply service adds the machine track and folds session batches as JOB
  // OUTPUT (applyWithoutHistory) — entries are never undo steps. The engine is
  // phase-wrapped so the `ensurePair`/`translate` seams drive the status badge
  // (downloading vs translating) at the moment each actually runs.
  const translationService = deps.translation === undefined ? null : createTranslationApplyService({ ...deps.translation, engine: phaseEngine(deps.translation.engine, setTranslationPhase) })
  const translationControllers = new Map<string, AbortController>()

  function setTranslationPhase(language: string, status: TranslationStatus): void {
    store.setState((state) => {
      const slot = state.translation[language]
      if (slot !== undefined) slot.status = status
    })
  }

  // jobId of the most recent startTranscribe, sticky across done/cancel. The
  // streaming/error correlation below filters by it once the store has ever
  // started a job; before the first start the slice folds events verbatim
  // (frozen L1 `job:segments accumulate` + L2 streaming pins).
  let lastStartedJobId: string | null = null

  // unit-304 (CC-304.2): jobId of the last start dispatched in AUTO-DETECT
  // (no explicit language). A `job:done` stores `stats.language` as job
  // output only when the jobId-correlation AND this Auto-detect tag both
  // match — foreign/superseded jobIds never store (the existing done-filter
  // doctrine), and an explicit selection is never overwritten by detection.
  let autoDetectJobId: string | null = null

  /**
   * Review r1 (finding 3): models whose > 100 MB `model:confirm-required`
   * gate the USER accepted this page session (via `confirmModelDownload`).
   * This is the main-thread record of that acceptance only — the worker's
   * `preConfirmed` set (src/workers/asr.worker.ts) stays the SINGLE gate
   * owner for the load path; the FR-204.2 warm consults this so it never
   * fetches gated bytes ahead of an acceptance.
   */
  const confirmedDownloads = new Set<ModelId>()

  /** Warm deferred at dispatch because the confirm gate had not resolved
   *  yet (uncached > 100 MB, no acceptance on record); released by the user's
   *  own `confirmModelDownload`, or by the gate owner's completed load
   *  (`model:ready` — the load path already moved the bytes through the
   *  develop streaming profile, so the warm only MATERIALIZES the verified
   *  cache — "used once → offline-ready", never pre-empts the gate). */
  const deferredWarms = new Set<ModelId>()

  /** FR-204.2 warm disposition (review r1, finding 3): a run warms the ONE
   *  verified cache only when (a) the row is NOT already offline-ready —
   *  `ensureOffline` fetches+re-verifies the FULL row every call, so an
   *  ungated warm re-downloaded every cached model on every run — and
   *  (b) the row is small, or carries an acceptance / completed gate-owner
   *  load. Uncached + > 100 MB + unconfirmed → DEFER (zero warm bytes before
   *  `model:confirm-required` resolves — unit-03 on the transcribe path). */
  async function warmDisposition(modelId: ModelId): Promise<'warm' | 'cached' | 'defer'> {
    if (deps.warmModelCache === undefined) return 'cached'
    const spec = MODEL_REGISTRY[modelId]
    if (spec === undefined) return 'cached'
    try {
      if ((await deps.modelCache.isOfflineReady?.(modelId)) === true) return 'cached'
    } catch {
      // Presence unknown — the confirm-cost gate below still holds.
    }
    return spec.approxBytes <= LARGE_DOWNLOAD_CONFIRM_BYTES || confirmedDownloads.has(modelId) ? 'warm' : 'defer'
  }

  /** Release a warm deferred for `modelId`. Triggered only by an authorized
   *  gate resolution — the user's `confirmModelDownload`, or the gate owner's
   *  completed load (`model:ready`) — so the confirm threshold is NOT
   *  re-imposed here; only the presence short-circuit still applies (a
   *  row that became offline-ready in the meantime never re-fetches). */
  function releaseDeferredWarm(modelId: ModelId): void {
    if (!deferredWarms.delete(modelId)) return
    if (deps.warmModelCache === undefined || MODEL_REGISTRY[modelId] === undefined) return
    void (async () => {
      try {
        if ((await deps.modelCache.isOfflineReady?.(modelId)) === true) return
      } catch {
        // Presence unknown — the gate already resolved; warm.
      }
      deps.warmModelCache?.(modelId)
    })()
  }

  // FR-108.2: the decode job riding each transcribe job (media-worker tee).
  // Tracked so cancel/displacement stops the decode alongside the ASR job.
  const decodeJobIdByJobId = new Map<string, string>()

  /**
   * FR-108.2: open the stream tee for a job: one MessageChannel for the ASR
   * consumer and (when diarize) a second for the diarize consumer; port1s go
   * to the media worker's `decode` tee (own decode jobId — its progress/done
   * never correlates with the running ASR job), port2s ride the worker
   * requests. The `transcribe` post happens immediately (the worker buffers
   * chunks until decode delivers them); `decode` follows the blob resolution.
   * Returns the stream sources to post, or null without the mediaSource dep
   * (frozen placeholder path).
   */
  function openPcmStream(jobId: string, diarize: boolean): { asr: PcmSource; diarizePcm: PcmSource } | null {
    if (deps.mediaSource === undefined) return null
    const asrChannel = new MessageChannel()
    const ports: MessagePort[] = [asrChannel.port1]
    let diarizePcm: PcmSource = placeholderPcm()
    if (diarize) {
      const diarizeChannel = new MessageChannel()
      ports.push(diarizeChannel.port1)
      diarizePcm = { kind: 'stream', port: diarizeChannel.port2 }
    }
    const decodeJobId = newJobId()
    decodeJobIdByJobId.set(jobId, decodeJobId)
    void deps
      .mediaSource()
      .then((file) => {
        deps.engine.postMedia({ t: 'decode', jobId: decodeJobId, file, ports })
      })
      .catch(() => {
        // No preview blob (relink pending): the stream simply never delivers —
        // the job stays cancellable, nothing logs (SECURITY-03).
      })
    return { asr: { kind: 'stream', port: asrChannel.port2 }, diarizePcm }
  }

  function cancelDecodeFor(jobId: string): void {
    const decodeJobId = decodeJobIdByJobId.get(jobId)
    if (decodeJobId === undefined) return
    decodeJobIdByJobId.delete(jobId)
    deps.engine.postMedia({ t: 'cancel', jobId: decodeJobId })
  }

  // FR-108.1: raw-event taps (the stream-commit bridge) — notified BEFORE the
  // fold so they correlate on the same pre-event `running` the slice uses.
  const engineTaps: ((event: MediaEvent | AsrEvent) => void)[] = []

  const handleEvent = (event: MediaEvent | AsrEvent): void => {
    for (const tap of [...engineTaps]) tap(event)
    switch (event.t) {
      case 'job:progress':
        store.setState((state) => {
          // MAJOR-1 (review R2): correlate by the running jobId exactly as
          // job:segments (:198), job:error and job:done do — a stale or late
          // progress event from an orphaned/finished job must never overwrite
          // the displayed %. Before the store ever started a job there is no
          // correlation target to filter against (frozen pre-start progress
          // pins fold verbatim — same never-started exception as segments).
          if (lastStartedJobId !== null && state.running?.jobId !== event.jobId) return
          state.progress = { processedSec: event.processedSec, totalSec: event.totalSec }
        })
        return
      case 'job:done': {
        // unit-304 (CC-304.2): an Auto-detect run's reported language rides
        // in as JOB OUTPUT. Correlation is EXACTLY the running-jobId filter
        // the handler already applies — a foreign jobId (stale worker flush)
        // or a superseded job's late done matches neither `running` nor the
        // Auto-detect tag and stores nothing; `stats.language` absent stores
        // nothing (the engine never spoke). An explicit-start job is not
        // Auto-detect-tagged, so its differing detection never overwrites.
        const detected = store.getState().running?.jobId === event.jobId && autoDetectJobId === event.jobId ? (event.stats?.language ?? null) : null
        store.setState((state) => {
          if (state.running?.jobId === event.jobId) state.running = null
        })
        if (detected !== null) recordProjectLanguage(detected)
        return
      }
      case 'job:error':
        store.setState((state) => {
          // SM.3 (adversary adjudication): only the running job may own the
          // error slot — a stale job:error from an orphaned job is ignored
          // exactly like job:done already filters by jobId. With no job
          // running the error still records (contract: job:error updates
          // state — the late error-after-done pin, SM.5).
          if (state.running !== null && state.running.jobId !== event.jobId) return
          state.error = event.error
          if (state.running?.jobId === event.jobId) state.running = null
        })
        return
      case 'notice':
        store.setState((state) => {
          state.notices.push(event.notice)
        })
        return
      case 'job:segments':
        store.setState((state) => {
          // SM.1/SM.2 (adversary adjudication): correlate by jobId exactly as
          // job:done/job:error do — a foreign jobId (stale worker flush) or a
          // late flush of a replaced/cancelled job must never contaminate the
          // streaming rows. Before the store ever started a job there is no
          // correlation target to filter against (frozen accumulate/streaming
          // pins fold verbatim).
          if (lastStartedJobId !== null && state.running?.jobId !== event.jobId) return
          state.segments = sortByStart([...state.segments, ...event.segments])
        })
        return
      case 'model:confirm-required':
        // unit-03 > 100 MB gate — the popover renders the confirmation
        // (FR-2.0.2: never a disabled Start for an uncached model).
        store.setState((state) => {
          state.pendingConfirmDownload = { model: event.model, bytes: event.bytes }
        })
        return
      case 'model:ready':
        // Review r1 (finding 3): the gate-owner load for this model COMPLETED
        // (the worker already moved the bytes on develop's streaming profile)
        // — a warm deferred at dispatch materializes the verified cache now
        // ("used once → offline-ready"). State unchanged; model:* events
        // otherwise stay owned by the popover/intake slices (default case).
        releaseDeferredWarm(event.model)
        return
      default:
        // media:probed / peaks:chunk / decode:support / vad:segments /
        // model:* are consumed by the intake seam and the popover (unit-102
        // owns their slices) — the jobs slice ignores them here.
        return
    }
  }

  deps.engine.onMediaEvent(handleEvent)
  deps.engine.onAsrEvent(handleEvent)

  void deps.modelCache.listCached().then((cached) => {
    const cachedSet = new Set(cached)
    const options: ModelOptionView[] = Object.values(MODEL_REGISTRY).map((spec) => ({
      id: spec.id,
      sizeLabel: sizeLabel(spec.approxBytes),
      offlineReady: cachedSet.has(spec.id),
      languages: spec.languages,
    }))
    store.setState((state) => {
      // Immer's draft widens `readonly string[]` to mutable; the view object
      // is freshly built per hydration, so the widening is inert.
      state.modelOptions = options as typeof state.modelOptions
    })
  })

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    onEngineEvent(listener: (event: MediaEvent | AsrEvent) => void): () => void {
      engineTaps.push(listener)
      return () => {
        const index = engineTaps.indexOf(listener)
        if (index >= 0) engineTaps.splice(index, 1)
      }
    },
    setCapability(capability: CapabilitySnapshot): void {
      store.setState((state) => {
        state.capability = capability
      })
    },
    setTierNotice(notice: Notice | null): void {
      store.setState((state) => {
        state.tierNotice = notice
      })
    },
    startTranscribe(options: StartTranscribeOptions): void {
      const displaced = store.getState().running
      const jobId = newJobId()
      const device: Device = store.getState().capability?.tier === 'T1' ? 'webgpu' : 'wasm'
      lastStartedJobId = jobId
      autoDetectJobId = options.language === null ? jobId : null
      store.setState((state) => {
        state.running = { kind: options.mode === 'align' ? 'align' : 'transcribe', jobId }
        state.segments = []
        state.progress = null
        state.error = null
        state.pendingConfirmDownload = null
      })
      // CC-304.1 (#51): an explicit Language selection is recorded at Start —
      // before any worker event — through the job-output seam (applyWithout-
      // History, the transcribe-commit pattern). Never an undoable command.
      if (options.language !== null) recordProjectLanguage(options.language)
      if (displaced !== null) {
        // SM.4 (adversary adjudication, FR-2.0.6): a displaced job must not
        // keep running on the worker uncancellable — post the same cancel
        // triple cancel() posts before replacing the running job.
        deps.engine.postAsr({ t: 'cancel', jobId: displaced.jobId })
        deps.engine.postDiarize({ t: 'cancel', jobId: displaced.jobId })
        deps.engine.postMedia({ t: 'cancel', jobId: displaced.jobId })
        cancelDecodeFor(displaced.jobId)
      }
      const postJob = (): void => {
        deps.engine.postAsr({ t: 'loadModel', model: options.modelId, device })
        // FR-108.2: stream pcm when the composition root wired a media source;
        // the frozen placeholder transfer otherwise.
        const stream = openPcmStream(jobId, options.diarize)
        deps.engine.postAsr({ t: 'transcribe', jobId, pcm: stream?.asr ?? placeholderPcm(), sampleRate: 16000, language: options.language })
        if (options.diarize) {
          deps.engine.postDiarize({ t: 'diarize', jobId, pcm: stream?.diarizePcm ?? placeholderPcm(), sampleRate: 16000 })
        }
      }
      // FR-204.2 (unit-204 EXTENDS): offline + model NOT cached →
      // OFFLINE_MODEL_MISSING notice + coded NETWORK fast-fail BEFORE the
      // worker is ever posted to (domain App lifecycle: "never a hang"; no
      // spinner, no fetch attempt — the worker never sees this job). Offline
      // + cached, and every online run, take the byte-identical path.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const preflight: Promise<boolean> =
          deps.modelCache.isOfflineReady !== undefined
            ? deps.modelCache.isOfflineReady(options.modelId).catch(() => false)
            : Promise.resolve(store.getState().modelOptions.find((option) => option.id === options.modelId)?.offlineReady ?? true)
        void preflight.then((ready) => {
          if (ready) {
            postJob()
            return
          }
          store.setState((state) => {
            state.notices.push({ code: 'OFFLINE_MODEL_MISSING', params: { model: options.modelId } })
            if (state.running !== null && state.running.jobId !== jobId) return
            state.error = { code: 'NETWORK', retryable: true, detail: 'offline_model_missing' }
            if (state.running?.jobId === jobId) state.running = null
          })
        })
        return
      }
      // FR-204.2 "used once → offline-ready" (unit-204): the ONLINE real-lane
      // dispatch warms the ONE verified cache on the main thread (fetch +
      // verify + all-or-nothing put) so a model used once is offline-ready —
      // without materializing model bytes on the worker heap (the worker
      // keeps develop's streaming profile; CC-05.2 memory gate). Review r1
      // (finding 3): the warm is eligibility-gated — cached rows are never
      // re-fetched, and an uncached > 100 MB row DEFERS until the gate
      // resolves (confirm or completed gate-owner load); `postJob` never
      // waits on any of it.
      void warmDisposition(options.modelId).then((disposition) => {
        if (disposition === 'warm') {
          deferredWarms.delete(options.modelId)
          deps.warmModelCache?.(options.modelId)
        } else if (disposition === 'defer') {
          deferredWarms.add(options.modelId)
        }
      })
      postJob()
    },
    cancel(): void {
      const running = store.getState().running
      if (running === null) return
      deps.engine.postAsr({ t: 'cancel', jobId: running.jobId })
      deps.engine.postDiarize({ t: 'cancel', jobId: running.jobId })
      deps.engine.postMedia({ t: 'cancel', jobId: running.jobId })
      cancelDecodeFor(running.jobId)
      store.setState((state) => {
        state.running = null
      })
    },
    confirmModelDownload(model: ModelId): void {
      // Review r1 (finding 3): record the user's acceptance of the > 100 MB
      // gate for this session (the worker's `preConfirmed` stays the load
      // gate owner) and release any warm this run deferred on it.
      confirmedDownloads.add(model)
      releaseDeferredWarm(model)
      deps.engine.postAsr({ t: 'confirmDownload', model })
      store.setState((state) => {
        state.pendingConfirmDownload = null
      })
    },
    async runTranslation(project, language, options = {}): Promise<RunStats> {
      if (translationService === null) throw translateError('PAIR_UNAVAILABLE', false, 'TRANSLATION_NOT_WIRED')
      const engine = deps.translation?.engine
      if (engine === undefined) throw translateError('PAIR_UNAVAILABLE', false, 'TRANSLATION_NOT_WIRED')
      const gate = engine.isAvailable()
      if (!gate.available) {
        const error: EngineError = { code: 'PAIR_UNAVAILABLE', retryable: false, detail: `ENGINE:${gate.reason ?? 'unavailable'}` }
        store.setState((state) => {
          state.translation[language] = { language, status: 'failed', availability: 'unavailable', progress: null, error }
        })
        throw translateError('PAIR_UNAVAILABLE', false, `ENGINE:${gate.reason ?? 'unavailable'}`)
      }
      const controller = new AbortController()
      translationControllers.set(language, controller)
      store.setState((state) => {
        state.translation[language] = { language, status: 'downloading', availability: 'ready', progress: null, error: null }
      })
      const sessionOptions: SessionRunOptions = {
        retranslateStale: options.mode === 'stale',
        signal: controller.signal,
        onProgress: (done, total) => {
          store.setState((state) => {
            const slot = state.translation[language]
            if (slot === undefined) return
            slot.status = 'translating'
            slot.progress = { done, total }
          })
        },
        ...(options.visibleIds === undefined ? {} : { visibleIds: options.visibleIds }),
      }
      try {
        const stats = await translationService.run(project, language, sessionOptions)
        const cancelled = stats.cancelled || controller.signal.aborted
        store.setState((state) => {
          const slot = state.translation[language]
          if (slot === undefined) return
          slot.status = cancelled ? 'cancelled' : stats.failed > 0 ? 'partial' : 'done'
          if (stats.planned > 0 && slot.progress === null) slot.progress = { done: stats.translated, total: stats.planned }
        })
        return stats
      } catch (error) {
        const engineError = asEngineError(error)
        store.setState((state) => {
          state.translation[language] = { language, status: 'failed', availability: 'unavailable', progress: null, error: engineError }
        })
        throw error
      } finally {
        translationControllers.delete(language)
      }
    },
    cancelTranslation(language): void {
      translationControllers.get(language)?.abort()
    },
    async refreshAvailability(source, languages): Promise<void> {
      const engine = deps.translation?.engine
      const supported = engine !== undefined && engine.isAvailable().available
      store.setState((state) => {
        state.translationSupport = engine === undefined ? 'unknown' : supported ? 'supported' : 'unsupported'
      })
      if (!supported || engine === undefined) {
        // Gating path: no built-in Translator — every picker option is honest
        // "Unavailable" and the section renders the gating copy instead.
        store.setState((state) => {
          for (const target of languages) {
            const slot = state.translation[target]
            if (slot === undefined) state.translation[target] = { language: target, status: 'idle', availability: 'unavailable', progress: null, error: null }
            else slot.availability = 'unavailable'
          }
        })
        return
      }
      const results = await Promise.all(
        languages.map(async (target) => {
          const availability = await engine.availability(source, target)
          const badge: TranslationAvailability =
            availability === 'available' ? 'ready' : availability === 'downloadable' || availability === 'downloading' ? 'download' : availability === 'unavailable' ? 'unavailable' : 'unknown'
          return { target, badge }
        }),
      )
      store.setState((state) => {
        for (const { target, badge } of results) {
          const slot = state.translation[target]
          if (slot === undefined) state.translation[target] = { language: target, status: 'idle', availability: badge, progress: null, error: null }
          else slot.availability = badge
        }
      })
    },
  }
}

/** One apply service per jobs store (the unit-301 FR-301.5 bridge): the
 *  machine track add + the job-output application run through it, so the
 *  history rules (entries are NOT undo steps) hold at the source. */
function asEngineError(error: unknown): EngineError {
  if (error instanceof Object && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    const e = error as { code: string; retryable?: boolean; detail?: string }
    return { code: e.code as EngineError['code'], retryable: e.retryable ?? false, ...(e.detail === undefined ? {} : { detail: e.detail }) }
  }
  return { code: 'ENGINE_INTERNAL', retryable: true }
}

/** FR-302.1: pass-through engine wrapper whose `ensurePair`/`translate` seams
 *  drive the per-language status badge (download vs translate) at the moment
 *  each runs. No text crosses this boundary (SECURITY-03). */
function phaseEngine(raw: TranslationEngine, onPhase: (language: string, status: TranslationStatus) => void): TranslationEngine {
  return {
    isAvailable: () => raw.isAvailable(),
    availability: (source, target) => raw.availability(source, target),
    ensurePair: (source, target, options) => {
      onPhase(target, 'downloading')
      return raw.ensurePair(source, target, options)
    },
    translate: (source, target, text, signal) => {
      onPhase(target, 'translating')
      return raw.translate(source, target, text, signal)
    },
    detectLanguage: (text) => raw.detectLanguage(text),
    dispose: () => raw.dispose(),
  }
}

export type { Device }
