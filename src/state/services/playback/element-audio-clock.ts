// unit-107 (FR-107.1): the ELEMENT audio clock — same sanctioned
// `currentTime` home as the frozen media-clock.ts (CC-102.5 lint zone), same
// pass-through semantics (the SyncArbitrator owns the dt mirror), plus the
// unit-107 optional `onEnded` (element `ended` event) the decoded clock also
// implements. `createElementMediaClock` (video) stays frozen next door.

import type { Seconds } from '../../../engine/model'
import type { MediaClock } from './media-clock'

/**
 * Element clock over `<audio>` (US-107.1 element path). `play()` swallows the
 * autoplay rejection (the stage notice owns the coded failure, FR-102.3/
 * FR-107.6 parity); `play()` after ended restarts from 0 (media-element
 * semantics). `onEnded(cb)` fires ONCE per natural end; the returned
 * unsubscribe is idempotent.
 */
export function createElementAudioClock(element: HTMLMediaElement): MediaClock {
  const endedCallbacks = new Set<() => void>()
  const handleEnded = (): void => {
    for (const cb of [...endedCallbacks]) cb()
  }
  element.addEventListener('ended', handleEnded)
  // Untyped literal: `onEnded` is the unit-107 optional EXTENDS member
  // (tests/unit/audio-preview/unit107-api-contract.d.ts), not on the frozen
  // unit-102 MediaClock interface.
  const clock = {
    get duration(): Seconds {
      return element.duration
    },
    currentTime: (): Seconds => element.currentTime,
    get paused(): boolean {
      return element.paused
    },
    play: (): void => {
      void element.play().catch(() => undefined)
    },
    pause: (): void => {
      element.pause()
    },
    seek: (t: Seconds): void => {
      element.currentTime = t
    },
    setRate: (rate: number): void => {
      element.playbackRate = rate
    },
    onEnded: (cb: () => void): (() => void) => {
      endedCallbacks.add(cb)
      return () => {
        endedCallbacks.delete(cb)
      }
    },
    dispose: (): void => {
      element.pause()
      element.removeEventListener('ended', handleEnded)
      endedCallbacks.clear()
    },
  }
  return clock
}
