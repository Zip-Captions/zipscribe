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

/**
 * Deferred element clock (slice C composition root): the app composes the
 * SyncArbitrator ONCE at boot, while the stage `<video>` element exists only
 * after a project opens — this clock is the placeholder-to-element swap the
 * composition root performs via `attach`. Detached behavior is inert
 * (`currentTime` 0, controls no-ops) EXCEPT `seek` still counts: the bridge's
 * single-seek diagnostics ("`seekCount` = total MediaClock.seek invocations
 * since open") count every seek command the arbitrator proxied, attached or
 * not. Stays under this directory — the only sanctioned `currentTime` home
 * (CC-102.5).
 */
export interface DeferredMediaClock extends MediaClock {
  /** Swap the backing element (null detaches; the arbitrator keeps one clock for its lifetime). */
  attach(element: HTMLMediaElement | null): void
  /** Total `seek()` invocations (diagnostic number only — SECURITY-03). */
  readonly seekCount: number
  resetSeekCount(): void
}

export function createDeferredMediaClock(): DeferredMediaClock {
  let element: HTMLMediaElement | null = null
  let seekCount = 0
  return {
    get duration(): Seconds {
      return element?.duration ?? 0
    },
    currentTime: () => element?.currentTime ?? 0,
    get paused(): boolean {
      return element?.paused ?? true
    },
    play: () => {
      void element?.play().catch(() => undefined)
    },
    pause: () => {
      element?.pause()
    },
    seek: (t: Seconds) => {
      seekCount += 1
      if (element !== null) element.currentTime = t
    },
    setRate: (rate: number) => {
      if (element !== null) element.playbackRate = rate
    },
    dispose: () => {
      element?.pause()
      element = null
    },
    attach: (next: HTMLMediaElement | null) => {
      element = next
    },
    get seekCount(): number {
      return seekCount
    },
    resetSeekCount: () => {
      seekCount = 0
    },
  }
}
