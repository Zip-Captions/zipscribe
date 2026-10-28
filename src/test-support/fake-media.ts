// Media element + AnalyserNode doubles (visualizer / playback tests of later
// units). DOM *types* only — the fakes are plain objects, no real media.

export interface FakeMediaElement {
  currentTime: number
  duration: number
  paused: boolean
  playbackRate: number
  play(): void
  pause(): void
}

export function createFakeMediaElement(duration = 0): FakeMediaElement {
  return {
    currentTime: 0,
    duration,
    paused: true,
    playbackRate: 1,
    play() {
      this.paused = false
    },
    pause() {
      this.paused = true
    },
  }
}

export interface FakeAnalyserNode {
  frequencyBinCount: number
  /** Overwritten by tests before each getFloatFrequencyData call. */
  bins: Float32Array
  getFloatFrequencyData(destination: Float32Array): void
}

export function createFakeAnalyserNode(bins: Float32Array = new Float32Array(1024)): FakeAnalyserNode {
  return {
    frequencyBinCount: bins.length,
    bins,
    getFloatFrequencyData(destination: Float32Array): void {
      destination.set(this.bins.subarray(0, destination.length))
    },
  }
}
