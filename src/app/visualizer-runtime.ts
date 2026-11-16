// unit-107 slice C/D composition: the visualizer runtime — owns the clock
// CHOICE (probe → choosePlaybackPath, FR-107.1), the stage audio graph
// (CC-107.3 gain authority), the visualizer layer mount (CC-107.6), the
// feed/blob plumbing the decoded clock needs, and the numeric diagnostics
// the test bridge exposes. Browser-only (window/fetch/AudioContext), lives
// in the composition root like stage.ts; the UI stays thin and the L2
// suites never import it (they drive the pieces directly over doubles).
//
// SECURITY-03: every diagnostic here is numbers, booleans and codes —
// never transcript/caption content.

import type { MediaAsset } from '../engine/model'
import { createStageAudioGraph } from '../state/services/playback/audio-graph'
import type { StageAudioGraph } from '../state/services/playback/audio-graph'
import { createElementAudioClock } from '../state/services/playback/element-audio-clock'
import { createDecodedMediaClock } from '../state/services/playback/decoded-clock'
import type { DecodedMediaClock } from '../state/services/playback/decoded-clock'
import { choosePlaybackPath } from '../state/services/playback/choose-path'
import { probeElementPlayback } from '../state/services/playback/probe-element'
import type { RouterMediaClock } from '../state/services/playback/router-clock'
import { createVisualizerLayer } from '../ui/canvas/visualizer/visualizer-layer'
import type { VisualizerAnalyser, VisualizerLayer } from '../ui/canvas/visualizer/visualizer-layer'
import type { EditorApp } from '../state/history'
import type { SettingsStore } from '../state/settings'
import type { StageController } from './stage'
import { createWorker } from '../state/services/worker-registry'
// `?worker&url` (not `?url`): compiles the worklet to classic-safe JS —
// `?url` would ship raw TypeScript and addModule would choke on types.
import RingWorkletUrl from '../workers/ring-processor.ts?worker&url'

/** Fixed visualizer base size (design.md 16:9 stage; the L4 pixel scan and
 *  the CC-107.7 goldens pin geometry at this CSS box × DPR). */
export const VISUALIZER_CSS_SIZE = { width: 640, height: 360 } as const

const MIME_BY_CONTAINER: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  mka: 'audio/webm',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  amr: 'audio/amr',
  '3gp': 'audio/3gpp',
  wma: 'audio/x-ms-wma',
}

export interface VisualizerBridgeState {
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
  playbackPath: 'element' | 'decoded' | 'deferred'
  mediaCard: { hasDuration: boolean; hasCodec: boolean; hasSampleRate: boolean; hasChannels: boolean; hasResolution: boolean; hasFps: boolean }
}

export interface ClockDiagnostics {
  kind: 'element' | 'decoded' | 'deferred' | 'none'
  paused: boolean
  currentTime: number
  duration: number
  rate: number
  endedCount: number
}

export interface VisualizerRuntimeDeps {
  settings: SettingsStore
  stage: StageController
  editorApp: EditorApp
  router: RouterMediaClock
  devicePixelRatio(): number
  now(): number
  prefersReducedMotion(): boolean
}

type GraphPathState = 'none' | 'element' | 'decoded'

export interface VisualizerRuntime {
  /** The arbitrator's single rAF loop pumps draws (no second loop). */
  pumpFrame(timeMs: number): void
  mountCanvas(canvas: HTMLCanvasElement | null): void
  onStageElement(element: HTMLMediaElement | null): void
  /** Project/source swap (mediaUrl change or asset swap): full teardown. */
  reset(): void
  getVisualizerState(): VisualizerBridgeState
  getClockDiagnostics(): ClockDiagnostics
  clockControl(method: 'play' | 'pause' | 'seek' | 'setRate' | 'dispose', arg?: number): void
  resetVisualizerDiagnostics(): void
  setScriptedAnalyser(analyser: VisualizerAnalyser | null): void
  setMuted(muted: boolean): void
  readAnalyserEnergy(): number
  setVisualizerMode(mode: 'spectrum' | 'waveform'): void
  setTintBySpeaker(on: boolean): void
  /** FR-107.6: transport/bridge play is gesture-parity — resume the stage AudioContext. */
  resumeForGesture(): void
}

export function createVisualizerRuntime(deps: VisualizerRuntimeDeps): VisualizerRuntime {
  let canvas: HTMLCanvasElement | null = null
  let layer: VisualizerLayer | null = null
  let graph: StageAudioGraph | null = null
  let graphPathState: GraphPathState = 'none'
  let decodedClock: DecodedMediaClock | null = null
  let scripted: VisualizerAnalyser | null = null
  let playbackPath: 'element' | 'decoded' | 'deferred' = 'deferred'
  let clockKind: 'element' | 'decoded' | 'deferred' | 'none' = 'none'
  let muted = false
  let rate = 1
  let endedCount = 0
  // Path-agnostic ended tally (router forwards to whichever clock is active).
  deps.router.onEnded(() => {
    endedCount += 1
  })
  let lastFrameAtMs: number | null = null
  let blobCache: { url: string; promise: Promise<Blob> } | null = null
  let sharedContext: AudioContext | null = null
  let probeToken = 0

  const audioContextFactory = (): AudioContext => {
    sharedContext ??= new AudioContext()
    return sharedContext
  }

  const currentAsset = (): MediaAsset | null => deps.editorApp.project.getState().project?.asset ?? null

  const currentUrl = (): string | null => deps.stage.getMediaSource()

  const blobForCurrentSource = async (): Promise<Blob> => {
    const url = currentUrl()
    if (url === null) throw new Error('NO_MEDIA_SOURCE')
    if (blobCache !== null && blobCache.url === url) return blobCache.promise
    // A real File (with the asset's name): the mediabunny adapter type-sniffs
    // by extension before content — a nameless Blob stalls its Input analyze
    // (name never enters logs; SECURITY-03 covers strings, not this plumbing).
    const name = currentAsset()?.name ?? url.split('/').pop() ?? 'media'
    const mime = MIME_BY_CONTAINER[currentAsset()?.container ?? ''] ?? ''
    const promise = fetch(url).then((response) => {
      if (!response.ok) throw new Error('MEDIA_FETCH_FAILED')
      return response.blob().then((blob) => new File([blob], name, { type: mime }))
    })
    blobCache = { url, promise }
    return promise
  }

  const activeBlockColor = (): string | null => {
    const project = deps.editorApp.project.getState().project
    if (project === null) return null
    const playhead = deps.editorApp.arbitrator?.playhead ?? deps.editorApp.editor.getState().playhead
    const block = project.blocks.find((b) => playhead >= b.start && playhead < b.end) ?? null
    if (block === null) return null
    const speaker = project.speakers.find((s) => s.id === block.speakerId) ?? null
    return speaker?.color ?? null
  }

  const readAnalyser = (): VisualizerAnalyser | null => scripted ?? graph?.analyser() ?? null

  const buildLayer = (): void => {
    if (canvas === null) return
    layer = createVisualizerLayer({
      canvas,
      analyser: {
        get fftSize(): number {
          return 4096
        },
        get frequencyBinCount(): number {
          return 2048
        },
        getFloatFrequencyData(bins: Float32Array): void {
          const source = readAnalyser()
          if (source === null) bins.fill(-100)
          else source.getFloatFrequencyData(bins)
        },
        getFloatTimeDomainData(samples: Float32Array): void {
          const source = readAnalyser()
          if (source === null) samples.fill(0)
          else source.getFloatTimeDomainData(samples)
        },
      } satisfies VisualizerAnalyser,
      sampleRate: () => currentAsset()?.sampleRate ?? 44_100,
      getPrefs: () => deps.settings.getState().visualizer,
      getSize: () => ({ ...VISUALIZER_CSS_SIZE }),
      activeSpeakerColor: activeBlockColor,
      devicePixelRatio: () => deps.devicePixelRatio(),
      prefersReducedMotion: () => deps.prefersReducedMotion(),
      now: () => deps.now(),
    })
  }

  const teardownPlayback = (): void => {
    deps.router.attachActive(null)
    decodedClock?.dispose()
    decodedClock = null
    graph?.dispose()
    graph = null
    graphPathState = 'none'
    if (sharedContext !== null) {
      void sharedContext.close().catch(() => undefined)
      sharedContext = null
    }
    playbackPath = 'deferred'
    clockKind = 'none'
    rate = 1
    endedCount = 0
  }

  const buildGraph = (): StageAudioGraph => {
    graph ??= createStageAudioGraph({ audioContextFactory })
    if (muted) graph.setMuted(true)
    return graph
  }

  const decide = async (element: HTMLMediaElement): Promise<void> => {
    const token = ++probeToken
    const asset = currentAsset()
    const url = currentUrl()
    if (asset === null || url === null || asset.kind !== 'audio') return
    playbackPath = 'deferred'
    clockKind = 'deferred'
    const mime = MIME_BY_CONTAINER[asset.container] ?? `audio/${asset.container}`
    const evidence = await probeElementPlayback(url, mime)
    // Stale probe (source/project swapped mid-probe) — drop silently.
    if (token !== probeToken) return
    const path = choosePlaybackPath(asset, evidence)
    if (path === 'element') {
      const stage = buildGraph()
      stage.connectElement(element)
      graphPathState = 'element'
      deps.router.attachActive(createElementAudioClock(element))
      clockKind = 'element'
      playbackPath = 'element'
      return
    }
    const stage = buildGraph()
    const clock = createDecodedMediaClock({
      getBlob: blobForCurrentSource,
      worker: createWorker('media'),
      sampleRate: asset.sampleRate ?? 44_100,
      channels: asset.channels ?? 1,
      duration: asset.duration,
      audioContextFactory,
      workletUrl: RingWorkletUrl,
      onNotice: (code) => {
        deps.stage.markError(code)
      },
      onWorkletNode: (node) => {
        stage.connectDecodedSource(node)
        graphPathState = 'decoded'
      },
    })
    decodedClock = clock
    deps.router.attachActive(clock)
    clockKind = 'decoded'
    playbackPath = 'decoded'
  }

  return {
    pumpFrame(timeMs: number): void {
      if (layer === null) return
      const arbitrator = deps.editorApp.arbitrator
      const playing = arbitrator !== null ? arbitrator.playing : deps.editorApp.editor.getState().playing
      if (!playing) {
        layer.setPlaying(false)
        return
      }
      layer.setPlaying(true)
      layer.draw(arbitrator?.playhead ?? deps.editorApp.editor.getState().playhead)
      lastFrameAtMs = timeMs
    },
    mountCanvas(next: HTMLCanvasElement | null): void {
      if (next === canvas) return
      canvas?.removeAttribute('data-visualizer-mounted')
      canvas = next
      layer?.dispose()
      layer = null
      if (canvas !== null) buildLayer()
    },
    onStageElement(element: HTMLMediaElement | null): void {
      const asset = currentAsset()
      if (element === null || asset === null || asset.kind !== 'audio') {
        probeToken += 1
        return
      }
      void decide(element).catch(() => {
        // Probe/feed failure keeps the element clock as the honest fallback
        // (audible wherever the element can play at all).
        const stage = buildGraph()
        stage.connectElement(element)
        graphPathState = 'element'
        deps.router.attachActive(createElementAudioClock(element))
        clockKind = 'element'
        playbackPath = 'element'
      })
    },
    reset(): void {
      probeToken += 1
      blobCache = null
      teardownPlayback()
      lastFrameAtMs = null
      layer?.dispose()
      layer = null
      buildLayer()
    },
    getVisualizerState(): VisualizerBridgeState {
      const layerState = layer?.state() ?? { framesDrawn: 0, opacity: 1, dpr: deps.devicePixelRatio() }
      const prefs = deps.settings.getState().visualizer
      const card = typeof document === 'undefined' ? null : document.querySelector('[data-testid=media-asset-card]')
      const labels = card === null ? [] : Array.from(card.querySelectorAll('dt')).map((dt) => (dt.textContent ?? '').trim())
      const cardText = card?.textContent ?? ''
      const contextState = graph !== null ? graph.contextState() : decodedClock !== null ? decodedClock.contextState() : 'none'
      return {
        framesDrawn: layerState.framesDrawn,
        lastFrameAtMs,
        playing: deps.editorApp.arbitrator?.playing ?? deps.editorApp.editor.getState().playing,
        opacity: layerState.opacity,
        mode: prefs.mode,
        tinted: prefs.tintBySpeaker,
        dpr: layerState.dpr,
        cssWidth: VISUALIZER_CSS_SIZE.width,
        cssHeight: VISUALIZER_CSS_SIZE.height,
        contextState,
        graphPath: graphPathState,
        underrunCount: decodedClock?.underrunCount ?? 0,
        muted,
        playbackPath,
        mediaCard: {
          hasDuration: labels.includes('Duration'),
          hasCodec: labels.includes('Audio') && !cardText.includes('Audio—'),
          hasSampleRate: labels.includes('Sample rate'),
          hasChannels: labels.includes('Channels'),
          hasResolution: labels.includes('Resolution'),
          hasFps: /fps/i.test(cardText),
        },
      }
    },
    getClockDiagnostics(): ClockDiagnostics {
      // The snapshot() call keeps every currentTime access inside the
      // sanctioned playback zone (CC-102.5); keys arrive by spread.
      const snap = deps.router.snapshot()
      return {
        kind: clockKind,
        ...snap,
        duration: snap.duration > 0 ? snap.duration : (currentAsset()?.duration ?? 0),
        rate,
        endedCount,
      }
    },
    clockControl(method, arg): void {
      // Same transport commands the transport bar dispatches — bridge play is
      // UI play (arbitrator owns playhead/playing; FR-107.6 autoplay honesty
      // via the same gesture-parity AudioContext resume).
      if (method === 'play') {
        void audioContextFactory()
          .resume()
          .catch(() => undefined)
        // Ended-restart convention (media-player parity): at the media end the
        // arbitrator is still "playing" (dt model pins at duration), so a bare
        // transport-play would no-op — seek to 0 first through the arbitrator.
        if (deps.router.atMediaEnd()) {
          deps.editorApp.dispatch('transport-seek', { time: 0 })
        }
        deps.editorApp.dispatch('transport-play', undefined)
      } else if (method === 'pause') {
        deps.editorApp.dispatch('transport-pause', undefined)
      } else if (method === 'seek' && arg !== undefined) {
        deps.editorApp.dispatch('transport-seek', { time: arg })
      } else if (method === 'setRate' && arg !== undefined) {
        rate = arg
        deps.editorApp.dispatch('transport-rate', { rate: arg })
      } else if (method === 'dispose') {
        deps.router.dispose()
      }
    },
    resetVisualizerDiagnostics(): void {
      layer?.dispose()
      buildLayer()
      lastFrameAtMs = null
    },
    setScriptedAnalyser(analyser): void {
      scripted = analyser
    },
    setMuted(next): void {
      muted = next
      graph?.setMuted(next)
    },
    readAnalyserEnergy(): number {
      const analyser = readAnalyser()
      if (analyser === null) return 0
      const bins = new Float32Array(analyser.frequencyBinCount)
      analyser.getFloatFrequencyData(bins)
      let energy = 0
      for (let i = 0; i < bins.length; i++) {
        const db = bins[i] ?? Number.NEGATIVE_INFINITY
        const v = (db + 90) / 80
        if (Number.isFinite(v) && v > energy) energy = v
      }
      return Math.min(1, Math.max(0, energy))
    },
    resumeForGesture(): void {
      void audioContextFactory()
        .resume()
        .catch(() => undefined)
    },
    setVisualizerMode(mode): void {
      deps.settings.setVisualizerPrefs({ mode })
    },
    setTintBySpeaker(on): void {
      deps.settings.setVisualizerPrefs({ tintBySpeaker: on })
    },
  }
}
