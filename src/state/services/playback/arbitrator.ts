// SyncArbitrator — one truth for playback position (FR-102.3, US-2.1.5).
//
// Interfaces are frozen by tests/unit/editor/unit102-api-contract.d.ts §
// '@state/services/playback/arbitrator'. Slice B ships the single-rAF-loop
// implementation over the injected MediaClock (element clock in
// `./media-clock.ts`; unit-107 adds the decoded clock) plus the scrub/loop
// behavior proven by tests/unit/editor/arbitrator.test.ts (CC-102.2).
//
// Rules the frozen suites pin: EXACTLY ONE `clock.seek` per seek/scrub request
// (the release never double-seeks); subscribers are notified synchronously on
// `seek`; while playing every flushed frame delivers one sample; paused means
// frozen; the loop region wraps [b → a] on the crossing frame (≤ 33 ms);
// components NEVER read a media element's `currentTime` — this layer is the
// only reader (CC-102.5).
//
// dt-based smoothing: every playing frame models the element's in-flight
// advance (dt·rate, dt from the rAF timestamps); a raw clock read that CHANGED
// since the last sample (real element advance or element-side seek) is
// followed immediately — the clock stays the single truth, dt only fills the
// gap between element deliveries (a backgrounded/throttled element keeps the
// playhead moving for one modeled frame, and `visibilitychange` resyncs).
//
// Background-tab drift (unit-102 Risks): a `visibilitychange` listener
// re-samples on return to foreground so subscribers do not wait for the first
// rAF tick; guarded for non-DOM (node/L1) environments.

import type { Seconds } from '../../../engine/model'
import type { MediaClock } from './media-clock'

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
  /** The element clock's real position. This layer is the sanctioned reader
   *  of `MediaClock.currentTime` (CC-102.5 single-clock-reader guard) — the
   *  e2e bridge reads the element truth through here, never the element. */
  clockTime(): Seconds
  /** Scrub session (US-2.1.5): `scrubTo` seeks (paused, no autoplay); `endScrub` resumes the PRE-scrub play state at the scrub position WITHOUT issuing another `clock.seek` (the release never double-seeks). */
  beginScrub(): void
  scrubTo(t: Seconds): void
  endScrub(): void
  dispose(): void
}

/** Upper bound on one modelled in-flight frame (throttled/backgrounded rAF
 *  must not teleport the playhead; `visibilitychange` resyncs from the clock). */
const MAX_MODELLED_FRAME_MS = 1000

export function createSyncArbitrator(deps: { clock: MediaClock; rafs: RafDriver; /** Optional sink — the editor store's setPlayhead. */ onPlayhead?: (playhead: Seconds) => void }): SyncArbitrator {
  const { clock, rafs, onPlayhead } = deps
  const subscribers = new Set<(playhead: Seconds) => void>()

  let playhead: Seconds = clock.currentTime()
  let lastRaw: Seconds = playhead
  let playing = false
  let rate = 1
  let loop: [Seconds, Seconds] | null = null
  let scrubbing = false
  let wasPlayingBeforeScrub = false
  let disposed = false
  // The frozen `RafDriver` has no `now()`; the test fake supplies one (the dt
  // window then opens at construction). Self-anchoring adapters (no `now()`)
  // anchor the window at the first observed frame.
  const driverNow = (rafs as Partial<{ now(): number }>).now
  let lastFrameMs: number | null = typeof driverNow === 'function' ? driverNow.call(rafs) : null
  let lastDtSec = 0
  let rafId = rafs.request(onFrame)

  function deliver(t: Seconds): void {
    playhead = t
    for (const cb of [...subscribers]) cb(t)
    onPlayhead?.(t)
  }

  function sample(): void {
    if (!playing || disposed) return
    const raw = clock.currentTime()
    let next = playhead
    // CS.3 (unit-102 adversary): a DETACHED deferred clock reports inert 0
    // (media-clock.test.ts freezes that read) — that is an ABSENCE of truth,
    // not a seek to 0. While playing, duration 0 + time 0 + a non-zero last
    // delivered time is the deferred-detach signature: hold the last emitted
    // playhead (the dt model keeps it advancing) instead of regressing it.
    const detachedIdle = raw === 0 && lastRaw !== 0 && clock.duration === 0
    if (!detachedIdle && raw !== lastRaw) {
      // The element delivered a new time (real advance or element-side seek):
      // follow the clock — never re-derive what the clock says.
      next = raw
      lastRaw = raw
    }
    // In-flight dt·rate advance (the element keeps moving between deliveries).
    next += lastDtSec * rate
    // CS.2 (unit-102 adversary): one-truth bound — while the element sits
    // pinned at its duration (an <video> stops at `ended`) dt-modeling may
    // not extrapolate the playhead past the media end (rate > 0 forward).
    const duration = clock.duration
    if (rate > 0 && Number.isFinite(duration) && duration > 0 && next > duration && raw <= duration) next = duration
    const region = loop
    if (region !== null && playhead < region[1] && next >= region[1]) {
      // Crossing detection uses the last DELIVERED playhead: an explicit seek
      // past the loop end is honored (not re-wrapped); playback crossing [b]
      // wraps to [a] within one frame (≤ 33 ms, CC-102.2).
      clock.seek(region[0])
      lastRaw = region[0]
      deliver(region[0])
      return
    }
    deliver(next)
  }

  function onFrame(timeMs: number): void {
    if (disposed) return
    rafId = rafs.request(onFrame)
    const dtMs = lastFrameMs === null ? 0 : Math.min(Math.max(0, timeMs - lastFrameMs), MAX_MODELLED_FRAME_MS)
    lastFrameMs = timeMs
    lastDtSec = dtMs / 1000
    sample()
  }

  const onVisibility = (): void => {
    // Background-tab rAF throttling: resync immediately on return to
    // foreground instead of waiting for the first frame tick.
    sample()
  }
  const hasDocument = typeof document !== 'undefined' && typeof document.addEventListener === 'function'
  if (hasDocument) document.addEventListener('visibilitychange', onVisibility)

  return {
    subscribe(cb) {
      subscribers.add(cb)
      return () => {
        subscribers.delete(cb)
      }
    },
    seek(t) {
      // EXACTLY one clock.seek per request (single-seek rule, US-2.1.5).
      clock.seek(t)
      lastRaw = t
      deliver(t)
    },
    setLoop(region) {
      // CS.7 (unit-102 adversary): the documented wrap is [b → a]; an
      // inverted region (b ≤ a) makes that meaningless and must never
      // fabricate a forward seek — honestly rejected, the region stays
      // exactly as it was (the command layer rejects these too with
      // LOOP_RANGE_INVALID; this is the direct-call last line of defense).
      if (region !== null && !(region[1] > region[0])) return
      loop = region === null ? null : [region[0], region[1]]
    },
    get rate() {
      return rate
    },
    set rate(value: number) {
      if (value === rate) return
      rate = value
      clock.setRate(value)
    },
    play() {
      if (playing || disposed) return
      playing = true
      clock.play()
    },
    pause() {
      if (!playing) return
      playing = false
      clock.pause()
    },
    get playing() {
      return playing
    },
    get loop() {
      return loop
    },
    get playhead() {
      return playhead
    },
    clockTime() {
      return clock.currentTime()
    },
    beginScrub() {
      if (scrubbing) return
      scrubbing = true
      wasPlayingBeforeScrub = playing
      if (playing) {
        playing = false
        clock.pause()
      }
    },
    scrubTo(t) {
      // One seek per move; no autoplay — the release owns the play resume.
      clock.seek(t)
      lastRaw = t
      deliver(t)
    },
    endScrub() {
      if (!scrubbing) return
      scrubbing = false
      if (wasPlayingBeforeScrub) {
        // Resume at the scrub position WITHOUT another clock.seek (US-2.1.5).
        playing = true
        clock.play()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      playing = false
      subscribers.clear()
      rafs.cancel(rafId)
      if (hasDocument) document.removeEventListener('visibilitychange', onVisibility)
      clock.dispose()
    },
  }
}
