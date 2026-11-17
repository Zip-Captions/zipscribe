// Unit-107 pinned API contract — the builder brief (audio projects: media
// clocks + visualizer).
//
// Ambient-script doctrine (unit-101…106 precedent — see the header of
// tests/unit/editor/unit102-api-contract.d.ts): suites import not-yet-built
// production modules via the '@state/…', '@engine/…', '@ui/…' path aliases.
// None of the NEW modules exist yet — that is the point: the tests import
// them and fail at RUNTIME (missing module), while `pnpm typecheck` types the
// tests against the declarations below. Ambient `declare module` wins over
// path-alias resolution for aliased specifiers only — relative imports of the
// frozen modules (media-clock.ts, settings.ts) keep their real types.
//
// Frozen files this unit MUST NOT touch (frozen-scan twins keep failing red):
// src/state/services/playback/media-clock.ts,
// src/state/services/playback/arbitrator.ts, src/ui/canvas/overlay.ts,
// src/state/commands/**, the transport-bar/workbench/media-clock/arbitrator
// test files, fixtures/golden/project-canonical-v1.json. EXTENDS blocks below
// merge interfaces additively — every pre-107 suite stays green untouched.
//
// Contract-change provenance (orchestrator PREP, docs/overnight-ledger.md
// § "UNIT-107 PREP"): architecture.md MediaAsset `sampleRate?/channels?` and
// MediaRequest `{t:'decode-playback'}` — model.ts/protocol.ts verbatim
// mirrors are builder slice B (contract-verbatim.test.ts token sync).
//
// SECURITY-03: every bridge payload below is numbers/booleans/codes/canonical
// JSON only — no transcript, caption or audio-derived string crosses.

// ═══════════════════════════════════════════════════════════════════════════
// FR-107.1 — pure clock-path decision
// ═══════════════════════════════════════════════════════════════════════════

declare module '@state/services/playback/choose-path' {
  import type { MediaAsset } from '@engine/model@102'

  /** Result of the ONE muted probe play the composition root performs at
   *  project open (unit-107 US-107.1 Given clause). Data only — the DOM work
   *  lives in './probe-element'. */
  export interface ElementProbeEvidence {
    /** `element.canPlayType(mime)` result; `''` means unsupported. */
    canPlayType: string
    /** The muted probe play started playback before the timeout. */
    probePlaySucceeded: boolean
  }

  export type PlaybackPath = 'element' | 'decoded'

  /**
   * PURE (L1-table-tested, CC-107.1), called ONCE at project open:
   * `asset.kind !== 'audio'` → `'element'` (decoded VIDEO playback is a seed,
   * architecture § Playback & preview); `probe.canPlayType === ''` →
   * `'decoded'`; `!probe.probePlaySucceeded` → `'decoded'`; otherwise
   * `'element'`. Browser capability profiles are TEST INPUT DATA (evidence
   * tables), never a parameter.
   */
  export function choosePlaybackPath(asset: MediaAsset, probe: ElementProbeEvidence): PlaybackPath
}

declare module '@state/services/playback/probe-element' {
  import type { ElementProbeEvidence } from '@state/services/playback/choose-path'

  /**
   * DOM-side probe (composition-root; degradation paths pinned in L1 on a
   * stubbed element, [107-ADJ 10]): creates a
   * detached muted `<audio src=url>`, reads `canPlayType(mime)`, attempts a
   * `play()` resolving within `timeoutMs` (default 1000, [107-ADJ 10]) as
   * `probePlaySucceeded`, tears the element down. Never throws — every
   * failure mode degrades to `{ canPlayType, probePlaySucceeded: false }`.
   */
  export function probeElementPlayback(url: string, mime: string, opts?: { timeoutMs?: number }): Promise<ElementProbeEvidence>
}

// ═══════════════════════════════════════════════════════════════════════════
// FR-107.1/FR-107.2 — element audio clock + decoded clock (unit-102 seam
// swap, media-clock.ts:6 doctrine; EditorAppDeps.mediaClock injection point)
// ═══════════════════════════════════════════════════════════════════════════

declare module '@state/services/playback/media-clock' {
  /** unit-107 EXTENDS (merges into the frozen six-plus-dispose interface —
   *  the `_mediaClock` extends-assert in generated/contract-types.ts stays
   *  true). OPTIONAL so every existing implementation and fake typechecks
   *  unchanged. `cb` fires ONCE when the media reaches its duration during
   *  play; `play()` after ended restarts from 0. Returned unsubscribe is
   *  idempotent. */
  export interface MediaClock {
    onEnded?(cb: () => void): () => void
  }
}

declare module '@state/services/playback/element-audio-clock' {
  import type { MediaClock } from '@state/services/playback/media-clock'

  /**
   * Audio-project element clock (US-107.1 first Given): same surface as
   * `createElementMediaClock` (which stays frozen for video) PLUS a real
   * `onEnded` (element `ended` event). Used when choosePlaybackPath says
   * `'element'`; the composition root additionally wires
   * `createElementAudioClock`'s element through the stage audio graph
   * (unmute + MediaElementAudioSourceNode).
   */
  export function createElementAudioClock(element: HTMLMediaElement): MediaClock
}

declare module '@state/services/playback/decoded-clock' {
  import type { MediaClock } from '@state/services/playback/media-clock'

  /** Protocol-shaped chunk the worklet receives (verbatim
   *  `{startSec, samples}` from decodeForPlayback, engine/audio/decode.ts). */
  export interface PlaybackChunk {
    startSec: number
    samples: Float32Array
  }

  export interface DecodedClockDeps {
    /** Project media bytes (composition root: intake blob or object-URL
     *  fetch). Re-fetched is allowed but not required after first decode. */
    getBlob(): Promise<Blob>
    /** DEDICATED media-worker instance (unit-106 probe-worker doctrine —
     *  `createWorker('media')`, never the shared intake channel worker;
     *  terminated by `dispose()`). Speaks the new
     *  `{t:'decode-playback', jobId, file, fromSec, port}` MediaRequest. */
    worker: Worker
    /** Native format — from the probe (the asset fields the orchestrator
     *  PREP added to MediaAsset; the chunks are native-rate interleaved). */
    sampleRate: number
    channels: number
    duration: number
    /** Injectable so L2 drives the clock on doubles (FR-107.6: real code
     *  creates the AudioContext LAZILY on the first `play()` and calls
     *  `resume()`; never at construction). */
    audioContextFactory(): AudioContext
    /** AudioWorklet module URL (vite `?url` of the ring-buffer processor). */
    workletUrl: string
    /** Coded notice sink (SECURITY-03: code strings only). Underrun →
     *  'PLAYBACK_STALL'; auto-resume on refill clears the stall. */
    onNotice?(code: 'PLAYBACK_STALL'): void
    /** Injectable timers (conventions § 3: no bare setTimeout in tests). */
    timers?: { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void }
  }

  export interface DecodedMediaClock extends MediaClock {
    /** Worklet-reported underrun count (CC-107.3 "no underrun in 30 s"). */
    readonly underrunCount: number
    /** AudioContext state as the transport sees it (FR-107.6 — never a
     *  silent failure: 'suspended' while the app believes it is playing must
     *  surface; the composition root turns that into a PLAYBACK_STALL
     *  notice + arbitrator pause). 'none' before the first gesture. */
    contextState(): 'none' | 'suspended' | 'running' | 'closed'
  }

  /**
   * FR-107.2 decoded clock: `AudioWorkletNode` ring buffer (2 s target) fed
   * by MessagePort transfers of native-rate interleaved-f32 chunks from
   * `decodeForPlayback` — NO SharedArrayBuffer, no COOP/COEP. Position =
   * worklet-consumed frames / sampleRate (sample-accurate for the CC-107.4
   * drift legs). Implementation requirements pinned by the L3 contract
   * (element-semantics parity): `play()`/`pause()` flip the `paused` bit
   * SYNCHRONOUSLY (the AudioContext resume is the async part); `seek()`
   * never resumes playback; position messages are ignored while paused;
   * `dispose()` idempotent and inert. `AudioContext.currentTime` is the pacing reference, NOT the
   * playhead truth the arbitrator reads (it uses `currentTime()` = consumed
   * position). `seek(t)`: flush ring + re-issue decode-playback at `fromSec`
   * (seek-to-audible ≤ 250 ms, CC-107.3); `setRate(r)`: worklet read stride
   * (linear interpolation), 0.5–2 supported; `dispose()`: cancel + terminate
   * worker + suspend/close context (idempotent). Underrun → pause +
   * PLAYBACK_STALL, auto-resume when refilled past the re-prime threshold.
   */
  export function createDecodedMediaClock(deps: DecodedClockDeps): DecodedMediaClock
}

// ═══════════════════════════════════════════════════════════════════════════
// FR-107.4/FR-107.6 + unit-107 Risks — the stage audio graph (THE one
// AudioContext per stage)
// ═══════════════════════════════════════════════════════════════════════════

declare module '@state/services/playback/audio-graph' {
  /**
   * Owns the app's ONE AudioContext per stage (FR-107.6): created lazily on
   * the first user play gesture, `resume()`d there; AnalyserNode
   * `fftSize: 4096`, `smoothingTimeConstant: 0.75`.
   *
   * Element path (Risks § Analyser-on-MediaElementAudioSourceNode):
   * `connectElement` sets `element.muted = false` + `element.volume = 1` ONCE
   * at connect (the WebAudio capture is post-volume — a muted element feeds
   * the graph SILENCE) and routes
   * MediaElementAudioSourceNode → GainNode → AnalyserNode → destination.
   * Volume/mute act on the GAIN NODE ONLY — never back on the element
   * (tested; the frozen `muted: true` initial attribute is replaced by graph
   * authority). Decoded path: AudioWorkletNode ring → GainNode →
   * AnalyserNode → destination (the decoded clock owns its worklet; the
   * graph owns the tail).
   */
  export interface StageAudioGraph {
    /** Lazy-create + `resume()` (call inside the user gesture). */
    ensureContext(): AudioContext
    /** The graph's analyser (context exists after first ensureContext). */
    analyser(): AnalyserNode | null
    contextState(): 'none' | 'suspended' | 'running' | 'closed'
    /** Element-path attach (element clock projects only). */
    connectElement(element: HTMLMediaElement): void
    /** Decoded-path tail: route the clock's worklet node through gain+analyser. */
    connectDecodedSource(node: AudioNode): void
    /** GainNode authority (Risks): muted ⇒ gain 0, restore ⇒ gain 1. */
    setMuted(muted: boolean): void
    readonly muted: boolean
    /** Which path is currently connected ('none' before any connect). */
    path(): 'none' | 'element' | 'decoded'
    dispose(): void
  }

  export function createStageAudioGraph(deps: { audioContextFactory?: () => AudioContext }): StageAudioGraph
}

// ═══════════════════════════════════════════════════════════════════════════
// FR-107.3 — pure visual math (ALL of it lives here; engine purity: no DOM
// globals, Float32Array only)
// ═══════════════════════════════════════════════════════════════════════════

declare module '@engine/audio/spectrum' {
  export interface SpectrumLineOptions {
    sampleRate: number
    /** AnalyserNode fftSize (bins = fftSize/2). */
    fftSize: number
    width: number
    height: number
    /** Default 30. */
    minHz?: number
    /** Default `min(16000, sampleRate / 2)`. */
    maxHz?: number
    /** Default -90. */
    minDb?: number
    /** Default -10. */
    maxDb?: number
    /** Default 0.5 → output point count `floor(width * pointsPerPx) + 1`. */
    pointsPerPx?: number
  }

  /**
   * `AnalyserNode.getFloatFrequencyData` bins → polyline as flat x,y pairs
   * (Float32Array of length `2 * (floor(width * pointsPerPx) + 1)`),
   * log-frequency x (minHz → 0, maxHz → width), dB y occupying the middle
   * 60% of `height` (captions keep their safe area, design.md § Audio
   * projects): y maps dB `minDb..maxDb` → `height*0.8 .. height*0.2`.
   * Per output point: max-pool the bins covering ±½ output-point of
   * frequency, clamp dB to [minDb, maxDb]; NaN/−Infinity bins → minDb.
   * Output is finite everywhere (CC-107.5 property test: length + bounds for
   * arbitrary finite-or-NaN inputs, positive dimensions).
   */
  export function toSpectrumLine(bins: Float32Array, options: SpectrumLineOptions): Float32Array

  /**
   * `getFloatTimeDomainData` samples → time-domain oscilloscope x,y pairs
   * (same length rule as toSpectrumLine): x linear across width, sample i
   * maps through the window start; amplitude −1..1 → `height*0.8 ..
   * height*0.2`; NaN/−Infinity samples → center line (`height/2`).
   */
  export function toWaveformLine(samples: Float32Array, options: { width: number; height: number; pointsPerPx?: number; startSec?: number; durationSec?: number }): Float32Array

  /** Log-frequency x position of `hz` under the toSpectrumLine mapping
   *  (exported so the L4 pixel-scan spec shares ONE truth with the renderer). */
  export function spectrumX(hz: number, options: { width: number; minHz?: number; maxHz?: number }): number
}

// ═══════════════════════════════════════════════════════════════════════════
// FR-107.4 — visualizer layer (arbitrator-sample driven; NO own rAF — the
// transport-bar frozen test pins ONE rAF loop app-wide)
// ═══════════════════════════════════════════════════════════════════════════

declare module '@ui/canvas/visualizer/visualizer-layer' {
  import type { Seconds } from '@engine/model@102'

  /** Scripted/deterministic analyser double surface (src/test-support/
   *  fake-analyser.ts satisfies it; the real AnalyserNode satisfies it). */
  export interface VisualizerAnalyser {
    readonly fftSize: number
    readonly frequencyBinCount: number
    getFloatFrequencyData(bins: Float32Array): void
    getFloatTimeDomainData(samples: Float32Array): void
  }

  export interface VisualizerPrefs {
    mode: 'spectrum' | 'waveform'
    /** Default true (design.md § Audio projects). */
    tintBySpeaker: boolean
  }

  export interface VisualizerLayerDeps {
    canvas: HTMLCanvasElement
    analyser: VisualizerAnalyser
    sampleRate(): number
    getPrefs(): VisualizerPrefs
    /** CSS box of the 16:9 stage slot (default: canvas parent client box). */
    getSize?: () => { width: number; height: number }
    /** Active block's speaker colour ('Tint by speaker'), null ⇒ default. */
    activeSpeakerColor(): string | null
    /** Default `window.devicePixelRatio` — injectable for DPR-2 goldens. */
    devicePixelRatio?: () => number
    /** Default matchesMedia('(prefers-reduced-motion: reduce)') — injectable. */
    prefersReducedMotion?: () => boolean
    now?: () => number
  }

  export interface VisualizerState {
    framesDrawn: number
    lastFrameAtMs: number | null
    playing: boolean
    /** Frozen-frame opacity while paused (design.md: last frame at 0.4). */
    opacity: number
    dpr: number
    cssWidth: number
    cssHeight: number
  }

  export interface VisualizerLayer {
    /** Called by the composition root from `arbitrator.subscribe` while
     *  playing. Draws spectrum or waveform per prefs (Catmull-Rom 2 px line
     *  in `--waveform-active`, 10% fill beneath, DPR-scaled). While paused
     *  this is a NO-OP (0 frames — CC-107.6) — the last frame stays at 40%
     *  opacity. With prefers-reduced-motion:reduce, consecutive draws are
     *  ≥ 250 ms apart (≤ 4 Hz). */
    draw(playhead: Seconds): void
    /** Play/pause transitions (freeze + opacity policy). */
    setPlaying(playing: boolean): void
    resetDiagnostics(): void
    state(): VisualizerState
    dispose(): void
  }

  /**
   * Mount obligation (e2e/golden contract): the composition root renders
   * this layer's canvas inside `[data-testid=stage-visualizer-slot]` with
   * `data-testid="visualizer-canvas"`, `aria-hidden="true"`, and NO tabindex
   * (CC-107.9 — decorative, never a tab stop). It precedes the overlay
   * canvas in paint order (overlay stacks above — CC-107.6 z-order clause).
   * Deterministic render contract for the CC-107.7 goldens: pure function of
   * (scripted bins/waveform, prefs, size, dpr, opacity, active color) —
   * no time-derived input reaches pixels except the throttling decision.
   */
  export function createVisualizerLayer(deps: VisualizerLayerDeps): VisualizerLayer
}

// ═══════════════════════════════════════════════════════════════════════════
// FR-107.5 — settings EXTENDS (persisted blob, NOT in project history)
// ═══════════════════════════════════════════════════════════════════════════

declare module '@state/settings' {
  import type { VisualizerPrefs } from '@ui/canvas/visualizer/visualizer-layer'

  export interface WorkbenchSettings {
    visualizer: VisualizerPrefs
  }

  export interface SettingsStore {
    setVisualizerPrefs(prefs: Partial<VisualizerPrefs>): void
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test-support fakes (shared — src/test-support/, conventions § Mocks and
// fakes; both are exercised by the L3 contract suite)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// L3/L4 clock contract — runner-neutral shared suite library (REAL file,
// tests/unit/audio-preview/clock-contract-lib.ts — NOT ambient): vitest
// drives it against the fake clock, the chromium spec against the real
// element/decoded clocks through the bridge. One contract, three clocks.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// e2e visualizer bridge — src/ui/testing/visualizer-bridge.ts, installed by
// App.tsx ONLY under strict `?ziptest=1 === '1'` (sixth bridge; gate-twin
// spec additive per persistence-bridge precedent). SECURITY-03: numbers,
// booleans, codes, and scripted test data only.
// ═══════════════════════════════════════════════════════════════════════════

interface Window {
  __zipVisualizerBridge?: {
    ready(): Promise<void>
    getVisualizerState(): {
      framesDrawn: number
      lastFrameAtMs: number | null
      playing: boolean
      opacity: number
      mode: 'spectrum' | 'waveform'
      tinted: boolean
      dpr: number
      cssWidth: number
      cssHeight: number
      contextState: 'none' | 'suspended' | 'running' | 'closed'
      graphPath: 'none' | 'element' | 'decoded'
      underrunCount: number
      muted: boolean
      /** Chosen path for the CURRENT project ('deferred' = video/no choice). */
      playbackPath: 'element' | 'decoded' | 'deferred'
      /** MediaTab audio fields as RENDERED (no transcript text — codec labels
       *  and numbers only). */
      mediaCard: { hasDuration: boolean; hasCodec: boolean; hasSampleRate: boolean; hasChannels: boolean; hasResolution: boolean; hasFps: boolean }
    }
    resetVisualizerDiagnostics(): void
    /** Current active clock (element-audio or decoded) — diagnostics only. */
    getClockDiagnostics(): { kind: 'element' | 'decoded' | 'deferred' | 'none'; paused: boolean; currentTime: number; duration: number; rate: number; endedCount: number }
    /** Direct clock control (BYPASSES the arbitrator — the L3 contract
     *  exercises the clock surface itself). Unknown method → throws. */
    clockControl(method: 'play' | 'pause' | 'seek' | 'setRate' | 'dispose', arg?: number): void
    /** Deterministic visualizer input for goldens/pixel scans. Numbers only. */
    setScriptedBins(db: number[] | null): void
    setScriptedWaveform(samples: number[] | null): void
    setMuted(muted: boolean): void
    /** Aggregate live-analyser energy (sum of bin dB above −50) — the drift
     *  leg's click-burst sampler polls THIS in-page (numbers only). */
    readAnalyserEnergy(): number
    /** [107-ADJ 11] time-domain RMS over the most recent windowSamples. */
    readRecentEnergy(windowSamples: number): number
    /** Corner-menu toggles (same effect as the buttons). */
    setVisualizerMode(mode: 'spectrum' | 'waveform'): void
    setTintBySpeaker(on: boolean): void
  }
}
