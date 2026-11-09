// Browser rAF driver (slice C composition root): the production `RafDriver`
// adapter over `requestAnimationFrame` for the SyncArbitrator's single loop.
// Lives in the composition root (NOT `src/state/**`) — it is DOM glue the
// tests never import (they inject their own manual driver); the arbitrator
// self-anchors its dt window at the first frame because this driver exposes
// no `now()` (frozen contract: the driver's `frame(dtMs)` is the TEST-side
// surface — calling it in a browser is a wiring bug, hence the throw).

import type { RafDriver } from '../state/services/playback/arbitrator'

export function createBrowserRafDriver(): RafDriver {
  let nextId = 1
  const rafIds = new Map<number, number>()
  return {
    request: (cb: (timeMs: number) => void): number => {
      const id = nextId++
      const rafId = requestAnimationFrame((timeMs) => {
        rafIds.delete(id)
        cb(timeMs)
      })
      rafIds.set(id, rafId)
      return id
    },
    cancel: (id: number): void => {
      const rafId = rafIds.get(id)
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId)
        rafIds.delete(id)
      }
    },
    frame: (): void => {
      throw new Error('RAF_FRAME_TEST_ONLY')
    },
  }
}
