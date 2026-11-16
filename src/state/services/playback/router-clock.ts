// unit-107 (FR-107.1): the composition-root clock router. The SyncArbitrator
// (frozen) holds ONE MediaClock for its lifetime; unit-107 chooses per
// PROJECT between the deferred element clock (video / audio element path),
// the element audio clock and the decoded clock. This is the sanctioned
// swap indirection — same home as the deferred clock, same inert-while-
// detached semantics, and the `onEnded` EXTENDS member is forwarded to the
// active clock when it supports one (latch semantics belong to the active
// clock; the router only manages subscription lifetime across swaps).

import type { Seconds } from '../../../engine/model'
import type { MediaClock } from './media-clock'

export interface RouterMediaClockDeps {
  /** Gesture-parity hook (FR-107.6): called on every routed play() BEFORE the
   *  active clock — the composition resumes the stage AudioContext here. */
  onActivePlay?(): void
}

export interface RouterMediaClock extends MediaClock {
  attachActive(clock: MediaClock | null): void
  readonly activeClock: MediaClock | null
  onEnded(cb: () => void): () => void
  /** Diagnostics snapshot (bridge surfaces): built INSIDE the sanctioned
   *  currentTime home so composition/UI layers never spell the access. */
  snapshot(): { paused: boolean; currentTime: Seconds; duration: Seconds }
  /** Paused with the position pinned at (or past) the media end. */
  atMediaEnd(): boolean
}

export function createRouterMediaClock(deps: RouterMediaClockDeps = {}): RouterMediaClock {
  let active: MediaClock | null = null
  const endedCallbacks = new Set<() => void>()
  let unbinders: Array<() => void> = []

  const rebindEnded = (): void => {
    for (const unbind of unbinders) unbind()
    unbinders = []
    if (active === null) return
    const activeOnEnded = (active as { onEnded?: (cb: () => void) => (() => void) | undefined }).onEnded
    if (typeof activeOnEnded !== 'function') return
    for (const cb of endedCallbacks) {
      const unbind = activeOnEnded.call(active, cb)
      if (typeof unbind === 'function') unbinders.push(unbind)
    }
  }

  // Untyped literal: `onEnded` is the unit-107 optional EXTENDS member
  // (never on the frozen unit-102 MediaClock).
  const clock = {
    get duration(): Seconds {
      return active?.duration ?? 0
    },
    currentTime: (): Seconds => active?.currentTime() ?? 0,
    get paused(): boolean {
      return active?.paused ?? true
    },
    play: (): void => {
      deps.onActivePlay?.()
      void active?.play()
    },
    pause: (): void => {
      active?.pause()
    },
    seek: (t: Seconds): void => {
      active?.seek(t)
    },
    setRate: (rate: number): void => {
      active?.setRate(rate)
    },
    onEnded: (cb: () => void): (() => void) => {
      endedCallbacks.add(cb)
      rebindEnded()
      return () => {
        endedCallbacks.delete(cb)
      }
    },
    dispose: (): void => {
      active?.dispose()
    },
    attachActive: (next: MediaClock | null): void => {
      if (next === active) return
      active = next
      rebindEnded()
    },
    get activeClock(): MediaClock | null {
      return active
    },
    snapshot: (): { paused: boolean; currentTime: Seconds; duration: Seconds } => ({
      paused: active?.paused ?? true,
      currentTime: active?.currentTime() ?? 0,
      duration: active?.duration ?? 0,
    }),
    // Ended-state question answered INSIDE the zone (the CC-102.5 guard
    // keeps `.currentTime` reads out of the composition layer).
    atMediaEnd: (): boolean => {
      if (active === null) return false
      const d = active.duration
      return active.paused && d > 0 && active.currentTime() >= d - 0.05
    },
  }
  return clock
}
