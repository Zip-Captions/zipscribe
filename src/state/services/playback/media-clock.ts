// MediaClock — the single time source behind the playhead (FR-102.3,
// architecture § Playback & preview). Type seam frozen by
// tests/unit/editor/unit102-api-contract.d.ts §
// '@state/services/playback/media-clock'; the element-clock implementation and
// its `currentTime` reads live under this directory ONLY (CC-102.5 lint +
// contract scan). unit-107 adds the decoded AudioContext clock behind the same
// interface (composition-root swap, `EditorAppDeps.mediaClock`).

import type { Seconds } from '../../../engine/model'

/** ONLY the SyncArbitrator reads `currentTime` — components never touch a media element's `currentTime`. */
export interface MediaClock {
  readonly duration: Seconds
  currentTime(): Seconds
  readonly paused: boolean
  play(): void
  pause(): void
  /** Applies the seek immediately (a single element seek per call). */
  seek(t: Seconds): void
  setRate(rate: number): void
  dispose(): void
}

/**
 * Element clock over `<video>`/`<audio>` (FR-102.3): the ONLY sanctioned
 * `currentTime` reader/writer in the app (CC-102.5). `play()` swallows the
 * autoplay-rejection rejection — unplayable-codec and autoplay policy surface
 * as the coded `stage-notice` (PREVIEW_UNSUPPORTED/PLAYBACK_STALL, FR-102.3)
 * at the stage layer, which probes `canPlayType` and element `error`; editing
 * and transcription stay functional while shown.
 */
export function createElementMediaClock(element: HTMLMediaElement): MediaClock {
  return {
    get duration(): Seconds {
      return element.duration
    },
    currentTime: () => element.currentTime,
    get paused(): boolean {
      return element.paused
    },
    play: () => {
      void element.play().catch(() => undefined)
    },
    pause: () => {
      element.pause()
    },
    seek: (t: Seconds) => {
      element.currentTime = t
    },
    setRate: (rate: number) => {
      element.playbackRate = rate
    },
    dispose: () => {
      element.pause()
    },
  }
}
