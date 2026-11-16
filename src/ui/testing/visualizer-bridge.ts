// Test-only visualizer bridge (unit-107, sixth sibling of the ziptest
// bridges; gate-twin spec is additive per the persistence-bridge precedent).
// App.tsx imports this module ONLY under strict `?ziptest=1` — lazy import,
// out of the initial bundle, nothing self-installs. The scripted-analyser
// double lives behind a LAZY import here so `src/test-support/**` never
// reaches the production graph. SECURITY-03: numbers, booleans, codes and
// scripted test data only — never transcript/caption content.

import { getAppContext } from '../../app/context'
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
  setVisualizerMode(mode: 'spectrum' | 'waveform'): void
  setTintBySpeaker(on: boolean): void
}

export function installVisualizerBridge(): void {
  const { visualizer } = getAppContext()

  const bridge: VisualizerBridge = {
    async ready(): Promise<void> {
      await Promise.resolve()
    },
    getVisualizerState: () => visualizer.getVisualizerState(),
    resetVisualizerDiagnostics: () => visualizer.resetVisualizerDiagnostics(),
    getClockDiagnostics: () => visualizer.getClockDiagnostics(),
    clockControl: (method, arg) => visualizer.clockControl(method, arg),
    async setScriptedBins(db: number[] | null): Promise<void> {
      if (db === null) {
        visualizer.setScriptedAnalyser(null)
        return
      }
      const { createFakeAnalyser } = await import('../../test-support/fake-analyser')
      const analyser = createFakeAnalyser({ fftSize: 4096, sampleRate: 44_100 })
      analyser.setFrequencyBins(db)
      visualizer.setScriptedAnalyser(analyser)
    },
    async setScriptedWaveform(samples: number[] | null): Promise<void> {
      if (samples === null) {
        visualizer.setScriptedAnalyser(null)
        return
      }
      const { createFakeAnalyser } = await import('../../test-support/fake-analyser')
      const analyser = createFakeAnalyser({ fftSize: 4096, sampleRate: 44_100 })
      analyser.setTimeDomain(samples)
      visualizer.setScriptedAnalyser(analyser)
    },
    setMuted: (muted) => visualizer.setMuted(muted),
    readAnalyserEnergy: () => visualizer.readAnalyserEnergy(),
    setVisualizerMode: (mode) => visualizer.setVisualizerMode(mode),
    setTintBySpeaker: (on) => visualizer.setTintBySpeaker(on),
  }

  Object.defineProperty(window, '__zipVisualizerBridge', { value: bridge, configurable: true })
}
