// SyncArbitrator — one truth for playback position (FR-102.3, US-2.1.5).
//
// Interfaces are frozen by tests/unit/editor/unit102-api-contract.d.ts §
// '@state/services/playback/arbitrator'. Slice A ships the seam TYPES only
// (the editor store, command registry and app composition build against them);
// the single-rAF-loop implementation (`createSyncArbitrator`) lands in
// unit-102 slice B together with the element MediaClock and the scrub/loop
// behavior suite (tests/unit/editor/arbitrator.test.ts, CC-102.2).

import type { Seconds } from '../../../engine/model'

/** Manual animation-frame driver: `request` queues a callback (timestamp in ms, monotonic from the injected clock), `frame(dtMs)` advances the clock and flushes the queue — no timers anywhere (conventions § 3). */
export interface RafDriver {
  request(cb: (timeMs: number) => void): number
  cancel(id: number): void
  /** Test-side driver: advances time by dtMs and runs the pending callbacks once. */
  frame(dtMs: number): void
}

/** A single rAF loop samples `clock.currentTime()` with dt-based smoothing; seeks take effect within ONE frame (subscriber notified synchronously on `seek`, then every frame while playing); during a loop region the playhead wraps `[b → a]`. */
export interface SyncArbitrator {
  subscribe(cb: (playhead: Seconds) => void): () => void
  /** Proxies EXACTLY ONE `clock.seek` per call (no double-seek); notifies subscribers synchronously; keeps playing state across the seek. */
  seek(t: Seconds): void
  setLoop(region: [Seconds, Seconds] | null): void
  /** Playback rate: assignment proxies `clock.setRate` and takes effect on the next sample. `1` default. */
  rate: number
  play(): void
  pause(): void
  readonly playing: boolean
  readonly loop: [Seconds, Seconds] | null
  readonly playhead: Seconds
  /** Scrub session (US-2.1.5): `scrubTo` seeks (paused, no autoplay); `endScrub` resumes the PRE-scrub play state at the scrub position WITHOUT issuing another `clock.seek` (the release never double-seeks). */
  beginScrub(): void
  scrubTo(t: Seconds): void
  endScrub(): void
  dispose(): void
}
