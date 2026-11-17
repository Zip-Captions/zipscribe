// Test-only visualizer bridge (unit-107, sixth sibling of the ziptest
// bridges; gate-twin spec is additive per the persistence-bridge precedent).
// App.tsx imports this module ONLY under strict `?ziptest=1` — lazy import,
// out of the initial bundle, nothing self-installs. The scripted-analyser
// double lives behind a LAZY import here so `src/test-support/**` never
// reaches the production graph. SECURITY-03: numbers, booleans, codes and
// scripted test data only — never transcript/caption content.

import { getAppContext } from '../../app/context'
import type { FakeAnalyser } from '../../test-support/fake-analyser'
import type { VisualizerBridgeState, ClockDiagnostics } from '../../app/visualizer-runtime'

interface VisualizerBridge {
  ready(): Promise<void>
  getVisualizerState(): VisualizerBridgeState
  resetVisualizerDiagnostics(): void
  getClockDiagnostics(): ClockDiagnostics
  clockControl(method: 'play' | 'pause' | 'seek' | 'setRate' | 'dispose', arg?: number): void
  setScriptedBins(db: number[] | null): void | Promise<void>
  setScriptedWaveform(samples: number[] | null): void | Promise<void>
  setMuted(muted: boolean): void
  readAnalyserEnergy(): number
  readRecentEnergy(windowSamples: number): number
  setVisualizerMode(mode: 'spectrum' | 'waveform'): void
  setTintBySpeaker(on: boolean): void
}

export function installVisualizerBridge(): void {
  const { visualizer } = getAppContext()

  let scripted: FakeAnalyser | null = null

  async function ensureScripted(create: boolean): Promise<typeof scripted> {
    if (scripted === null) {
      if (!create) return null
      const { createFakeAnalyser } = await import('../../test-support/fake-analyser')
      scripted = createFakeAnalyser({ fftSize: 4096, sampleRate: 44_100 })
      visualizer.setScriptedAnalyser(scripted)
    }
    return scripted
  }

  const bridge: VisualizerBridge = {
    async ready(): Promise<void> {
      await Promise.resolve()
    },
    getVisualizerState: () => visualizer.getVisualizerState(),
    resetVisualizerDiagnostics: () => visualizer.resetVisualizerDiagnostics(),
    getClockDiagnostics: () => visualizer.getClockDiagnostics(),
    clockControl: (method, arg) => visualizer.clockControl(method, arg),
    // Per-channel setters over ONE shared fake: clearing one channel must
    // not drop the other (a `setScriptedWaveform(null)` after
    // `setScriptedBins(bins)` used to fall draws back to the LIVE graph
    // analyser — non-deterministic goldens).
    async setScriptedBins(db: number[] | null): Promise<void> {
      const analyser = await ensureScripted(db !== null)
      if (analyser === null) return
      analyser.setFrequencyBins(db ?? new Array<number>(analyser.frequencyBinCount).fill(-100))
    },
    async setScriptedWaveform(samples: number[] | null): Promise<void> {
      const analyser = await ensureScripted(samples !== null)
      if (analyser === null) return
      analyser.setTimeDomain(samples ?? new Array<number>(analyser.fftSize).fill(0))
    },
    setMuted: (muted) => visualizer.setMuted(muted),
    readAnalyserEnergy: () => visualizer.readAnalyserEnergy(),
    readRecentEnergy: (windowSamples) => visualizer.readRecentEnergy(windowSamples),
    setVisualizerMode: (mode) => visualizer.setVisualizerMode(mode),
    setTintBySpeaker: (on) => visualizer.setTintBySpeaker(on),
  }

  Object.defineProperty(window, '__zipVisualizerBridge', { value: bridge, configurable: true })
}
