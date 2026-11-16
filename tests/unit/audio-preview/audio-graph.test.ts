// CC-107.3 / FR-107.4 / FR-107.6 (L2, doubles): the stage audio graph —
// the unit-107 Risks clause ("Analyser on MediaElementAudioSourceNode
// reroutes element audio — volume/mute must act on a GainNode, not the
// element (tested)"): element connect flips muted=false + volume=1 ONCE and
// routes source → gain → analyser → destination; setMuted drives ONLY the
// gain node; the analyser is configured 4096/0.75; the AudioContext is lazy
// (FR-107.6); the decoded tail routes the worklet node through the same
// gain + analyser; dispose closes everything.
import { describe, expect, test } from 'vitest'
import { createFakeAudioContextHarness, flushPorts } from './helpers/fake-webaudio'

const GRAPH_MODULE = '@state/services/playback/audio-graph'
type GraphModule = typeof import('@state/services/playback/audio-graph')

const load = async (): Promise<GraphModule> => (await import(/* @vite-ignore */ GRAPH_MODULE)) as unknown as GraphModule

function fakeElement(): HTMLMediaElement {
  return { muted: true, volume: 0.5 } as unknown as HTMLMediaElement
}

describe('CC-107.3: stage audio graph (gain-node authority)', () => {
  test('CC-107.3: connectElement unmutes the element ONCE and chains source → gain → analyser → destination', async () => {
    const mod = await load()
    const harness = createFakeAudioContextHarness()
    const graph = mod.createStageAudioGraph({ audioContextFactory: harness.factory })
    const element = fakeElement()
    graph.connectElement(element)
    await flushPorts()
    expect(element.muted, 'element muted=false — the graph capture is post-volume, a muted element feeds silence').toBe(false)
    expect(element.volume).toBe(1)
    expect(graph.path()).toBe('element')
    const chain = harness.connections
    const sourceLink = chain.find((c) => c.from === 'media-element-source' && c.to === 'gain')
    const gainToAnalyser = chain.find((c) => c.from === 'gain' && c.to === 'analyser')
    const analyserToDest = chain.find((c) => c.from === 'analyser' && c.to === 'destination')
    expect(sourceLink, 'MediaElementAudioSourceNode → GainNode').toBeDefined()
    expect(gainToAnalyser, 'GainNode → AnalyserNode').toBeDefined()
    expect(analyserToDest, 'AnalyserNode → destination').toBeDefined()
    graph.dispose()
  })

  test('CC-107.3: setMuted acts on the GainNode ONLY — the element keeps volume 1 / unmuted', async () => {
    const mod = await load()
    const harness = createFakeAudioContextHarness()
    const graph = mod.createStageAudioGraph({ audioContextFactory: harness.factory })
    const element = fakeElement()
    graph.connectElement(element)
    await flushPorts()
    graph.setMuted(true)
    expect(graph.muted).toBe(true)
    const gain = harness.contexts[0]!.nodes.find((n) => n.kind === 'gain') as unknown as { gain: { value: number } }
    expect(gain.gain.value, 'mute is a gain value, never an element property').toBe(0)
    expect(element.muted, 'element stays audible to the graph').toBe(false)
    expect(element.volume).toBe(1)
    graph.setMuted(false)
    expect(gain.gain.value).toBe(1)
    graph.dispose()
  })

  test('CC-107.3: the analyser is configured fftSize 4096 / smoothing 0.75 (FR-107.4)', async () => {
    const mod = await load()
    const harness = createFakeAudioContextHarness()
    const graph = mod.createStageAudioGraph({ audioContextFactory: harness.factory })
    graph.connectElement(fakeElement())
    await flushPorts()
    const analyser = graph.analyser() as unknown as { fftSize: number; smoothingTimeConstant: number } | null
    expect(analyser).not.toBeNull()
    expect(analyser!.fftSize).toBe(4096)
    expect(analyser!.smoothingTimeConstant).toBeCloseTo(0.75, 6)
    graph.dispose()
  })

  test('FR-107.6: the AudioContext is lazy and its state is observable (no silent failure)', async () => {
    const mod = await load()
    const harness = createFakeAudioContextHarness()
    const graph = mod.createStageAudioGraph({ audioContextFactory: harness.factory })
    expect(harness.contexts.length, 'no context before ensureContext').toBe(0)
    expect(graph.contextState()).toBe('none')
    expect(graph.analyser()).toBeNull()
    const ctx = graph.ensureContext()
    expect(ctx).toBeDefined()
    expect(harness.contexts.length).toBe(1)
    expect(graph.contextState()).toBe('suspended') // double starts suspended
    await graph.ensureContext().resume()
    expect(graph.contextState()).toBe('running')
    graph.dispose()
    expect(graph.contextState()).toBe('closed')
  })

  test('CC-107.3: the decoded tail routes worklet → gain → analyser → destination', async () => {
    const mod = await load()
    const harness = createFakeAudioContextHarness()
    const graph = mod.createStageAudioGraph({ audioContextFactory: harness.factory })
    graph.ensureContext()
    await flushPorts()
    // Fabricate a worklet node through the fake context.
    const ctx = harness.contexts[0] as unknown as { createWorkletNode(name: string, options: unknown): unknown }
    const node = ctx.createWorkletNode('zipscribe-ring', {}) as { kind: string }
    graph.connectDecodedSource(node as unknown as AudioNode)
    await flushPorts()
    expect(graph.path()).toBe('decoded')
    const link = harness.connections.find((c) => c.from === 'worklet' && c.to === 'gain')
    expect(link, 'AudioWorkletNode → GainNode').toBeDefined()
    graph.dispose()
  })

  test('CC-107.3: double dispose is safe', async () => {
    const mod = await load()
    const harness = createFakeAudioContextHarness()
    const graph = mod.createStageAudioGraph({ audioContextFactory: harness.factory })
    graph.connectElement(fakeElement())
    await flushPorts()
    graph.dispose()
    expect(() => {
      graph.dispose()
    }).not.toThrow()
    expect(graph.contextState()).toBe('closed')
  })
})
