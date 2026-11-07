// CC-102.2 (L1): SyncArbitrator over the injected fake MediaClock + manual
// rAF driver — NO timers (conventions § determinism). Proves the arbitrator
// half of the criterion in-process (the Playwright half with a real <video>
// lives in `e2e/editor/playback-sync.spec.ts`): single clock ownership
// (FR-102.3 — every read goes through the clock, exactly one seek per
// request), playhead delivery within ONE frame of a seek, loop wrap within
// ±33 ms of the loop start, dt·rate sampling, scrub-release without a
// double-seek (US-2.1.5).
import { describe, expect, test } from 'vitest'
import { createSyncArbitrator } from '@state/services/playback/arbitrator'
import { createFakeRafs } from './helpers/fake-rafs'
import { createFakeMediaClock } from './helpers/fake-media-clock'

const LOOP_TOLERANCE = 0.033

function setup(options: { duration?: number } = {}) {
  const rafs = createFakeRafs()
  const clock = createFakeMediaClock(rafs, options.duration ?? 60)
  const received: number[] = []
  const arbitrator = createSyncArbitrator({ clock, rafs, onPlayhead: (t) => received.push(t) })
  return { rafs, clock, received, arbitrator }
}

describe('CC-102.2 / FR-102.3: clock ownership and rAF sampling', () => {
  test('FR-102.3: play() proxies one clock.play; rAF samples advance the playhead by dt', () => {
    const { clock, received, arbitrator, rafs } = setup()
    arbitrator.play()
    expect(clock.playCalls, 'exactly one play on the element clock').toBe(1)
    expect(arbitrator.playing).toBe(true)

    rafs.frame(16)
    rafs.frame(16)
    rafs.frame(16)
    const last = received[received.length - 1]
    expect(last, 'playhead advanced with the clock (three 16 ms frames)').toBeCloseTo(0.048, 3)
    expect(received.length, 'one sample per flushed frame').toBeGreaterThanOrEqual(3)
  })

  test('FR-102.3: pause() proxies one clock.pause and freezes the playhead', () => {
    const { clock, received, arbitrator, rafs } = setup()
    arbitrator.play()
    rafs.frame(16)
    arbitrator.pause()
    expect(clock.pauseCalls).toBe(1)
    const frozen = arbitrator.playhead
    rafs.frame(16)
    rafs.frame(16)
    expect(arbitrator.playhead, 'paused: no advance').toBe(frozen)
    void received
  })

  test('FR-102.3: rate assignment proxies clock.setRate and the playhead follows the (rate-scaled) clock', () => {
    const { clock, arbitrator, rafs } = setup()
    arbitrator.play()
    arbitrator.rate = 2
    expect(clock.rateCalls).toContain(2)
    rafs.frame(16)
    expect(arbitrator.playhead, 'fake element advanced 2× during the frame; arbitrator follows the clock, never re-derives').toBeCloseTo(0.032, 3)
  })
})

describe('CC-102.2 / US-2.1.5: seek, loop, scrub', () => {
  test('CC-102.2: after a seek the playhead is the target within ≤ 1 frame', () => {
    const { clock, received, arbitrator, rafs } = setup()
    arbitrator.play()
    rafs.frame(16)
    const before = rafs.framesFlushed()

    arbitrator.seek(30)
    expect(clock.seekCalls, 'exactly one MediaClock.seek per request (no double-seek)').toBe(1)
    expect(clock.seekTargets).toEqual([30])
    expect(received[received.length - 1], 'subscribers are notified synchronously on seek').toBeCloseTo(30, 6)

    rafs.frame(16)
    expect(rafs.framesFlushed() - before, 'a single frame elapsed').toBe(1)
    const latest = received[received.length - 1]
    expect(latest, 'still at the seek target within the first frame (≤ 1 frame)').toBeDefined()
    expect(Math.abs((latest ?? 0) - 30), 'sampled value within one frame of the target').toBeLessThanOrEqual(0.016 + 1e-6)
  })

  test('CC-102.2: paused seek still updates the playhead (one frame or immediately)', () => {
    const { clock, arbitrator, rafs } = setup()
    arbitrator.seek(12)
    expect(clock.seekTargets).toEqual([12])
    expect(arbitrator.playhead).toBeCloseTo(12, 6)
    rafs.frame(16)
    expect(arbitrator.playhead, 'paused playhead stays put').toBeCloseTo(12, 6)
  })

  test('CC-102.2: loop region wraps b → a within ±33 ms', () => {
    const { clock, arbitrator, rafs } = setup()
    arbitrator.setLoop([10, 12])
    expect(arbitrator.loop).toEqual([10, 12])
    clock.setRawTime(11.99)
    arbitrator.play()

    rafs.frame(30) // clock → 12.02, past the loop end → wrap
    const wrapped = arbitrator.playhead
    expect(wrapped, 'playhead wrapped before the loop start').toBeLessThan(11)
    expect(Math.abs(wrapped - 10), `wrap lands within ±33 ms of loop start (measured ${wrapped})`).toBeLessThanOrEqual(LOOP_TOLERANCE)

    rafs.frame(30)
    expect(arbitrator.playhead, 'playback continues from the wrapped position').toBeGreaterThan(wrapped)
  })

  test('CC-102.2: clearLoop stops the wrap', () => {
    const { clock, arbitrator, rafs } = setup()
    arbitrator.setLoop([10, 12])
    clock.setRawTime(11.99)
    arbitrator.play()
    arbitrator.setLoop(null)
    rafs.frame(30)
    expect(arbitrator.playhead, 'no wrap without a loop region').toBeCloseTo(12.02, 3)
  })

  test('US-2.1.5: scrub-release resumes at the scrub position with NO extra seek', () => {
    const { clock, arbitrator, rafs } = setup()
    arbitrator.play()
    rafs.frame(16)

    arbitrator.beginScrub()
    const seeksBefore = clock.seekCalls
    arbitrator.scrubTo(20)
    arbitrator.scrubTo(20.5)
    arbitrator.endScrub()

    expect(clock.seekCalls - seeksBefore, 'each scrubTo seeks once; the RELEASE adds no further seek (no double-seek)').toBe(2)
    expect(arbitrator.playhead).toBeCloseTo(20.5, 6)
    expect(arbitrator.playing, 'pre-scrub play state resumes on release').toBe(true)
    rafs.frame(16)
    expect(arbitrator.playhead, 'playback continues from the scrub position').toBeGreaterThan(20.5)
  })

  test('US-2.1.5: scrub while PAUSED stays paused on release', () => {
    const { clock, arbitrator } = setup()
    arbitrator.beginScrub()
    arbitrator.scrubTo(5)
    arbitrator.endScrub()
    expect(arbitrator.playing, 'a paused scrub does not start playback').toBe(false)
    expect(clock.pauseCalls, 'release on a paused scrub posts no spurious play/pause churn beyond pause').toBeLessThanOrEqual(1)
  })

  test('CC-102.2: subscribe returns an unsubscribe; disposed arbitrator stops the loop', () => {
    const { arbitrator, rafs, received } = setup()
    const off = arbitrator.subscribe(() => undefined)
    arbitrator.play()
    rafs.frame(16)
    const mid = received.length
    off()
    expect(() => arbitrator.dispose()).not.toThrow()
    rafs.frame(16)
    expect(received.length, 'no samples after unsubscribe/dispose').toBe(mid)
  })
})
