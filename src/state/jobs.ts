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
import { MODEL_REGISTRY } from '../engine/model/registry'
import { newJobId } from './ids'

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

const INITIAL_STATE: JobsState = {
  capability: null,
  tierNotice: null,
  modelOptions: [],
  running: null,
  progress: null,
  segments: [],
  error: null,
  notices: [],
}

function sizeLabel(approxBytes: number): string {
  if (approxBytes >= 1_000_000_000) return `${(approxBytes / 1_000_000_000).toFixed(1)} GB`
  if (approxBytes >= 1_000_000) return `${Math.round(approxBytes / 1_000_000)} MB`
  return `${approxBytes} B`
}

// Transcribe/diarize PCM arrives from the media worker's decode tee once the
// app wiring lands (worker-registry + pcm-broker); the frozen contract's
// startTranscribe posts loadModel → transcribe directly, so the request is
// typed with an empty transfer buffer. Follow-up: real stream plumbing.
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
export function createJobsStore(deps: { engine: EnginePort; modelCache: ModelCachePort }): JobsStore {
  const store = createStore<JobsState>()(immer(() => structuredClone(INITIAL_STATE)))

  const handleEvent = (event: MediaEvent | AsrEvent): void => {
    switch (event.t) {
      case 'job:progress':
        store.setState((state) => {
          state.progress = { processedSec: event.processedSec, totalSec: event.totalSec }
        })
        return
      case 'job:done':
        store.setState((state) => {
          if (state.running?.jobId === event.jobId) state.running = null
        })
        return
      case 'job:error':
        store.setState((state) => {
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
          state.segments = sortByStart([...state.segments, ...event.segments])
        })
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
      const jobId = newJobId()
      const device: Device = store.getState().capability?.tier === 'T1' ? 'webgpu' : 'wasm'
      store.setState((state) => {
        state.running = { kind: options.mode === 'align' ? 'align' : 'transcribe', jobId }
        state.segments = []
        state.progress = null
        state.error = null
      })
      deps.engine.postAsr({ t: 'loadModel', model: options.modelId, device })
      deps.engine.postAsr({ t: 'transcribe', jobId, pcm: placeholderPcm(), sampleRate: 16000, language: options.language })
      if (options.diarize) {
        deps.engine.postDiarize({ t: 'diarize', jobId, pcm: placeholderPcm(), sampleRate: 16000 })
      }
    },
    cancel(): void {
      const running = store.getState().running
      if (running === null) return
      deps.engine.postAsr({ t: 'cancel', jobId: running.jobId })
      deps.engine.postDiarize({ t: 'cancel', jobId: running.jobId })
      deps.engine.postMedia({ t: 'cancel', jobId: running.jobId })
      store.setState((state) => {
        state.running = null
      })
    },
  }
}

export type { Device }
