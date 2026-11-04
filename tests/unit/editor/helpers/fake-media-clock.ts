// MediaClock double over the manual rAF driver — models an <video> element
// clock: `frame(dtMs)` advances `currentTime` by dt·rate while playing (that
// is what a media element does between samples). Every command the arbitrator
// may issue is recorded so "exactly one seek", "play once" etc. are asserted
// on call COUNTS (numbers only — SECURITY-03 safe).
import type { MediaClock } from '@state/services/playback/media-clock'
import type { FakeRafs } from './fake-rafs'

export interface FakeMediaClock extends MediaClock {
  /** Test-side driver: advances currentTime when playing (dt·rate). */
  frame(dtMs: number): void
  readonly playCalls: number
  readonly pauseCalls: number
  readonly seekCalls: number
  readonly seekTargets: readonly number[]
  readonly rateCalls: readonly number[]
  readonly disposeCalls: number
  /** Move the clock without the rate factor (simulates element-side seek settling). */
  setRawTime(t: number): void
}

export function createFakeMediaClock(rafs: FakeRafs, duration = 121.44, startRate = 1): FakeMediaClock {
  let time = 0
  let rate = startRate
  let paused = true
  let playCalls = 0
  let pauseCalls = 0
  let seekCalls = 0
  let disposeCalls = 0
  const seekTargets: number[] = []
  const rateCalls: number[] = []
  const clock: FakeMediaClock = {
    duration,
    currentTime: () => time,
    get paused() {
      return paused
    },
    get playCalls() {
      return playCalls
    },
    get pauseCalls() {
      return pauseCalls
    },
    get seekCalls() {
      return seekCalls
    },
    get seekTargets() {
      return seekTargets
    },
    get rateCalls() {
      return rateCalls
    },
    get disposeCalls() {
      return disposeCalls
    },
    play: () => {
      paused = false
      playCalls += 1
    },
    pause: () => {
      paused = true
      pauseCalls += 1
    },
    seek: (t) => {
      time = t
      seekCalls += 1
      seekTargets.push(t)
    },
    setRate: (r) => {
      rate = r
      rateCalls.push(r)
    },
    dispose: () => {
      disposeCalls += 1
    },
    frame: (dtMs) => {
      // The element advances while the frame is in flight, and the arbitrator's
      // rAF callback samples the advanced time: advance first, then flush.
      if (!paused) time += (dtMs / 1000) * rate
      rafs.frame(dtMs)
    },
    setRawTime: (t) => {
      time = t
    },
  }
  return clock
}
