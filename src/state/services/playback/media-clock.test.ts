// Builder L1 (unit-102 slice B, FR-102.3): the element clock is the app's only
// sanctioned `currentTime` reader/writer (CC-102.5) and proxies the frozen
// MediaClock surface onto an <video>/<audio> element. Node-level with a
// structural stub — no jsdom, no timers, no wall clock (conventions § 3).
// The behavioral half (real <video>, seek ≤ 1 frame, loop wrap, Playwright)
// is the CC-102.2 e2e half (slice D playback spec).
import { describe, expect, test } from 'vitest'
import { createElementMediaClock, createDeferredMediaClock } from './media-clock'
import type { MediaClock } from './media-clock'

interface MediaElementStub {
  currentTime: number
  duration: number
  paused: boolean
  playbackRate: number
  playCalls: number
  pauseCalls: number
  rejectNextPlay: boolean
  play(): Promise<void>
  pause(): void
}

function stubElement(start: Partial<MediaElementStub> = {}): MediaElementStub {
  const stub: MediaElementStub = {
    currentTime: 0,
    duration: 121.44,
    paused: true,
    playbackRate: 1,
    playCalls: 0,
    pauseCalls: 0,
    rejectNextPlay: false,
    play() {
      stub.playCalls += 1
      stub.paused = false
      return stub.rejectNextPlay ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve()
    },
    pause() {
      stub.pauseCalls += 1
      stub.paused = true
    },
  }
  return Object.assign(stub, start)
}

function asClock(stub: MediaElementStub): MediaClock {
  return createElementMediaClock(stub as unknown as HTMLMediaElement)
}

describe('FR-102.3 / CC-102.5: element MediaClock over the media element', () => {
  test('currentTime/duration/paused proxy the element (single sanctioned reader)', () => {
    const stub = stubElement({ currentTime: 12.345 })
    const clock = asClock(stub)
    expect(clock.currentTime()).toBe(12.345)
    stub.currentTime = 42
    expect(clock.currentTime(), 'reads are live, never cached (single truth)').toBe(42)
    expect(clock.duration).toBe(121.44)
    expect(clock.paused).toBe(true)
  })

  test('seek writes the element position exactly once per call', () => {
    const stub = stubElement()
    const clock = asClock(stub)
    clock.seek(30)
    expect(stub.currentTime).toBe(30)
    clock.seek(0.5)
    expect(stub.currentTime).toBe(0.5)
  })

  test('play/pause/setRate proxy the element; play() never rejects out of the clock', async () => {
    const stub = stubElement()
    const clock = asClock(stub)
    clock.play()
    expect(stub.playCalls).toBe(1)
    expect(clock.paused, 'clock mirrors the element paused state').toBe(false)
    clock.pause()
    expect(stub.pauseCalls).toBe(1)
    clock.setRate(1.5)
    expect(stub.playbackRate).toBe(1.5)

    stub.rejectNextPlay = true
    clock.play()
    await Promise.resolve() // settle the rejection microtask — an unhandled rejection would fail this test
    expect(stub.playCalls, 'rejection is swallowed here — the stage notice (FR-102.3) owns surfacing').toBe(2)
  })

  test('dispose pauses the element', () => {
    const stub = stubElement()
    const clock = asClock(stub)
    clock.play()
    clock.dispose()
    expect(stub.pauseCalls, 'dispose pauses (element side); the arbitrator cancels rAF').toBe(1)
    expect(clock.paused).toBe(true)
  })
})

describe('FR-102.3 / CC-102.5: deferred element clock (slice C composition root)', () => {
  test('FR-102.3: detached is inert — time 0, paused, controls no-op — but every seek still counts', () => {
    const clock = createDeferredMediaClock()
    expect(clock.currentTime()).toBe(0)
    expect(clock.duration, 'no element yet: 0 duration, no throw').toBe(0)
    expect(clock.paused).toBe(true)
    clock.play()
    clock.pause()
    clock.setRate(2)
    expect(clock.seekCount, 'inert controls are no-ops').toBe(0)
    clock.seek(10)
    clock.seek(20)
    expect(clock.seekCount, 'the single-seek diagnostic counts DETACHED seeks too').toBe(2)
    clock.resetSeekCount()
    expect(clock.seekCount).toBe(0)
  })

  test('FR-102.3: attach swaps the backing element live (arbitrator keeps one clock for its lifetime)', () => {
    const clock = createDeferredMediaClock()
    const first = stubElement({ currentTime: 5, duration: 60 })
    clock.attach(first as unknown as HTMLMediaElement)
    expect(clock.currentTime()).toBe(5)
    expect(clock.duration).toBe(60)
    clock.seek(30)
    expect(first.currentTime, 'attached seek writes the element AND counts').toBe(30)
    expect(clock.seekCount).toBe(1)
    clock.attach(null)
    expect(clock.currentTime(), 'detach returns to inert reads').toBe(0)
    clock.seek(31)
    expect(clock.seekCount, 'seekCount is lifetime-since-open, attached or not').toBe(2)
  })

  test('FR-102.3: play/pause/setRate proxy the attached element; dispose pauses and detaches', () => {
    const stub = stubElement()
    const clock = createDeferredMediaClock()
    clock.attach(stub as unknown as HTMLMediaElement)
    clock.play()
    expect(stub.playCalls).toBe(1)
    expect(clock.paused).toBe(false)
    clock.pause()
    expect(stub.pauseCalls).toBe(1)
    clock.setRate(1.5)
    expect(stub.playbackRate).toBe(1.5)
    clock.dispose()
    expect(stub.pauseCalls).toBe(2)
    expect(clock.currentTime(), 'dispose detaches the element').toBe(0)
  })
})
