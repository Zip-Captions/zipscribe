// MediaClock — the single time source behind the playhead (FR-102.3,
// architecture § Playback & preview). Type seam frozen by
// tests/unit/editor/unit102-api-contract.d.ts §
// '@state/services/playback/media-clock'; the element-clock implementation and
// its `currentTime` reads live under this directory ONLY (CC-102.5 lint +
// contract scan). Slice B (unit-102) ships the `<video>`/`<audio>` element
// clock; unit-107 adds the decoded AudioContext clock.

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
