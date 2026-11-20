// Progress pacing for burn-in (CC-202.2 requirement: ≥ 1 Hz job:progress).
// Pure, injectable — the worker wires `emit` to postMessage; the L1 test
// drives it with a fake clock. SECURITY-03: numbers only.
export interface ProgressPacer {
  /** Feed monotonic processed seconds; emits at most every `intervalMs`
   *  (always emits the first and the final/100 % update). */
  update(processedSec: number): void
  /** Force a final 100 % emission if none was made at full duration. */
  finish(): void
}

export function createProgressPacer(totalSec: number, emit: (processedSec: number, totalSec: number) => void, now: () => number = () => Date.now(), intervalMs = 900): ProgressPacer {
  let lastEmit = -Infinity
  let lastValue = -1
  let emittedFinal = false
  const fire = (v: number): void => {
    lastValue = v
    emittedFinal = v >= totalSec
    emit(Math.min(v, totalSec), totalSec)
    lastEmit = now()
  }
  return {
    update(processedSec) {
      const v = Math.max(0, processedSec)
      if (v <= lastValue) return
      if (v >= totalSec) {
        if (!emittedFinal) fire(totalSec)
        return
      }
      if (now() - lastEmit >= intervalMs || lastValue < 0) fire(v)
    },
    finish() {
      if (!emittedFinal && totalSec > 0) fire(totalSec)
    },
  }
}
