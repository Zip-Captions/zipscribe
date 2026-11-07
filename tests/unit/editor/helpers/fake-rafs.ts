// Manual rAF driver (conventions § 3 — no timers in node tests). Mirrors the
// `RafDriver` seam frozen in `unit102-api-contract.d.ts` §
// '@state/services/playback/arbitrator': `frame(dtMs)` advances the driver
// clock and flushes pending callbacks exactly once (one frame).
export interface FakeRafs {
  request(cb: (timeMs: number) => void): number
  cancel(id: number): void
  /** Advances the driver clock by dtMs and runs all currently-queued callbacks. */
  frame(dtMs: number): void
  /** Frames requested but not yet run. */
  pending(): number
  /** Driver clock value in ms (the timestamp handed to callbacks). */
  now(): number
  /** Total frames flushed since construction — sampler for "≤ 1 frame" assertions. */
  framesFlushed(): number
}

export function createFakeRafs(startMs = 0): FakeRafs {
  let clockMs = startMs
  let nextId = 1
  let flushed = 0
  const queue = new Map<number, (timeMs: number) => void>()
  return {
    request: (cb) => {
      const id = nextId++
      queue.set(id, cb)
      return id
    },
    cancel: (id) => {
      queue.delete(id)
    },
    frame: (dtMs) => {
      clockMs += dtMs
      flushed += 1
      const due = [...queue.entries()]
      queue.clear()
      for (const [, cb] of due) cb(clockMs)
    },
    pending: () => queue.size,
    now: () => clockMs,
    framesFlushed: () => flushed,
  }
}
