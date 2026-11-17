// Shared scripted MediaClock (conventions § Mocks and fakes): the unit-107
// L3 clock contract (CC-107.2) runs its FAKE leg against this — a scriptable
// MediaClock whose advance the test drives explicitly (no timers, no wall
// time: conventions § 3). Semantics mirror the real clocks the contract pins:
// paused-by-default, rate-scaled scripted advance, ended → paused + clamped
// time + single onEnded fire, play-after-ended restarts from 0, seek counts.

import type { MediaClock } from '@state/services/playback/media-clock'

export interface FakeMediaClock extends MediaClock {
  /** Drive scripted advance (advances only while playing, rate-scaled;
   *  crossing duration fires the ended transition). */
  advance(ms: number): void
  /** Force the ended transition at the next advance (or immediately). */
  fireEnded(): void
  readonly seekCount: number
  readonly rate: number
  readonly endedCount: number
}

export function createFakeMediaClock(opts: { duration: number; startAt?: number }): FakeMediaClock {
  const duration = opts.duration
  let time = opts.startAt ?? 0
  let paused = true
  let rate = 1
  let seekCount = 0
  let endedCount = 0
  let endedFired = false
  let forced = false
  let disposed = false
  const endedCallbacks = new Set<() => void>()

  function fireEnd(): void {
    if (endedFired) return
    endedFired = true
    endedCount += 1
    paused = true
    time = duration
    for (const cb of [...endedCallbacks]) cb()
  }

  const clock = {
    get duration(): number {
      return duration
    },
    currentTime: () => time,
    get paused(): boolean {
      return paused || disposed
    },
    play: () => {
      if (disposed) return
      if (endedFired || time >= duration) {
        // Ended → restart from 0 (element semantics).
        time = 0
        endedFired = false
        forced = false
      }
      paused = false
    },
    pause: () => {
      paused = true
    },
    seek: (t: number) => {
      seekCount += 1
      time = Math.max(0, Math.min(t, duration))
      if (time < duration) endedFired = false
    },
    setRate: (r: number) => {
      rate = r
    },
    onEnded: (cb: () => void) => {
      endedCallbacks.add(cb)
      return () => {
        endedCallbacks.delete(cb)
      }
    },
    dispose: () => {
      disposed = true
      paused = true
    },
    advance: (ms: number) => {
      if (disposed || paused) return
      time += (ms / 1000) * rate
      if (forced || time >= duration) fireEnd()
    },
    fireEnded: () => {
      forced = true
      if (paused) fireEnd()
    },
    get seekCount(): number {
      return seekCount
    },
    get rate(): number {
      return rate
    },
    get endedCount(): number {
      return endedCount
    },
  }
  // The onEnded member rides the unit-107 contract (tests/unit/audio-preview/
  // unit107-api-contract.d.ts); the object literal is left unannotated so the
  // extra member does not trip excess-property checking against the frozen
  // unit-102 MediaClock type.
  return clock
}
