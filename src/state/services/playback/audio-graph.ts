// unit-107 (FR-107.4, CC-107.3, FR-107.6): the stage audio graph — the one
// place element and decoded playback meet the analyser the visualizer reads.
// The unit-107 Risks clause is a TESTED invariant (audio-graph.test.ts):
// attaching a MediaElementAudioSourceNode REROUTES element audio through the
// graph, so mute/volume authority moves to a GainNode — the element is
// unmuted to the graph exactly ONCE at connect and never touched again.
// Chain, both tails: source → gain → analyser(4096/0.75) → destination.
// FR-107.6: the AudioContext is LAZY (created on first ensureContext /
// connect — never at construction, never resumed silently; contextState()
// surfaces the real state so "no audio" is observable, not silent).

export type GraphPath = 'element' | 'decoded'

export interface StageAudioGraphDeps {
  audioContextFactory(): AudioContext
}

export interface StageAudioGraph {
  /** Wire an `<audio>`/`<video>` element as the audible source (unmutes it ONCE). */
  connectElement(element: HTMLMediaElement): void
  /** Route a decoded-clock AudioWorkletNode through the same gain + analyser. */
  connectDecodedSource(sourceNode: AudioNode): void
  /** Mute authority: the GainNode ONLY — never an element property (Risks clause). */
  setMuted(muted: boolean): void
  readonly muted: boolean
  /** The visualizer's tap (null before the context exists). */
  analyser(): AnalyserNode | null
  ensureContext(): AudioContext
  contextState(): 'none' | 'suspended' | 'running' | 'closed'
  path(): GraphPath
  dispose(): void
}

const FFT_SIZE = 4096
const SMOOTHING = 0.75

export function createStageAudioGraph(deps: StageAudioGraphDeps): StageAudioGraph {
  let ctx: AudioContext | null = null
  let gain: GainNode | null = null
  let analyserNode: AnalyserNode | null = null
  let elementSource: MediaElementAudioSourceNode | null = null
  let workletSource: AudioNode | null = null
  let elementUnmuted = false
  let muted = false
  let disposed = false
  let activePath: GraphPath | null = null

  const ensureContext = (): AudioContext => {
    if (disposed) throw new Error('stage graph disposed')
    if (ctx !== null) return ctx
    const created = deps.audioContextFactory()
    ctx = created
    const g = created.createGain()
    g.gain.value = muted ? 0 : 1
    const a = created.createAnalyser()
    a.fftSize = FFT_SIZE
    a.smoothingTimeConstant = SMOOTHING
    g.connect(a)
    a.connect(created.destination)
    gain = g
    analyserNode = a
    return created
  }

  return {
    connectElement(element: HTMLMediaElement): void {
      const context = ensureContext()
      // Risks clause: the graph is post-volume, so the element must enter it
      // audible — exactly once, then the GainNode owns mute forever.
      if (!elementUnmuted) {
        element.muted = false
        element.volume = 1
        elementUnmuted = true
      }
      if (elementSource === null) {
        elementSource = context.createMediaElementSource(element)
      }
      elementSource.connect(gain as GainNode)
      workletSource?.disconnect()
      workletSource = null
      activePath = 'element'
    },
    connectDecodedSource(sourceNode: AudioNode): void {
      ensureContext()
      elementSource?.disconnect()
      elementSource = null
      workletSource = sourceNode
      sourceNode.connect(gain as GainNode)
      activePath = 'decoded'
    },
    setMuted(next: boolean): void {
      muted = next
      if (gain !== null) gain.gain.value = next ? 0 : 1
    },
    get muted(): boolean {
      return muted
    },
    analyser(): AnalyserNode | null {
      return disposed ? null : analyserNode
    },
    ensureContext,
    contextState(): 'none' | 'suspended' | 'running' | 'closed' {
      if (disposed) return 'closed'
      if (ctx === null) return 'none'
      // Safari's 'interrupted' behaves as suspended (audio pauses, recoverable).
      return ctx.state === 'interrupted' ? 'suspended' : ctx.state
    },
    path(): GraphPath {
      return activePath ?? 'element'
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      elementSource?.disconnect()
      elementSource = null
      workletSource = null
      gain?.disconnect()
      gain = null
      analyserNode?.disconnect()
      analyserNode = null
      void ctx?.close().catch(() => undefined)
    },
  }
}
