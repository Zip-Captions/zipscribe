// Scripted AnalyserNode double (unit-107 Technical Specification): the
// visualizer L2/L4 legs and the deterministic goldens (CC-107.7) drive a
// FIXED frequency/time-domain frame instead of a live audio graph. Call
// counters pin "spectrum mode reads frequency data, waveform reads time
// domain" and the paused zero-frame rule. Mirrors the real AnalyserNode read
// surface (getFloatFrequencyData / getFloatTimeDomainData copy INTO the
// caller's array, fftSize/frequencyBinCount shape).

export interface FakeAnalyser {
  readonly fftSize: number
  readonly frequencyBinCount: number
  getFloatFrequencyData(bins: Float32Array): void
  getFloatTimeDomainData(samples: Float32Array): void
  setFrequencyBins(db: number[]): void
  setTimeDomain(samples: number[]): void
  readonly frequencyCalls: number
  readonly timeDomainCalls: number
}

export function createFakeAnalyser(opts?: { fftSize?: number; sampleRate?: number }): FakeAnalyser {
  const fftSize = opts?.fftSize ?? 4096
  const binCount = fftSize / 2
  let freq = new Float32Array(binCount).fill(-100)
  let wave = new Float32Array(binCount)
  let frequencyCalls = 0
  let timeDomainCalls = 0
  return {
    fftSize,
    frequencyBinCount: binCount,
    getFloatFrequencyData(bins: Float32Array): void {
      frequencyCalls += 1
      bins.set(freq.subarray(0, Math.min(bins.length, freq.length)))
    },
    getFloatTimeDomainData(samples: Float32Array): void {
      timeDomainCalls += 1
      samples.set(wave.subarray(0, Math.min(samples.length, wave.length)))
    },
    setFrequencyBins(db: number[]): void {
      freq = Float32Array.from(db)
    },
    setTimeDomain(samples: number[]): void {
      wave = Float32Array.from(samples)
    },
    get frequencyCalls(): number {
      return frequencyCalls
    },
    get timeDomainCalls(): number {
      return timeDomainCalls
    },
  }
}
