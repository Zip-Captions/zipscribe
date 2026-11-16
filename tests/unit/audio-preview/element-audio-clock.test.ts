// CC-107.1 (L1): the ELEMENT audio clock over `<audio>` — the frozen
// unit-102 MediaClock semantics (duration/currentTime/paused/play/pause/
// seek/setRate/dispose) plus the unit-107 EXTENDS member `onEnded` (fires
// once per natural `ended`, idempotent unsubscribe, cleared on dispose) and
// the autoplay-rejection swallow (the stage notice owns the coded failure —
// the clock must never reject into the arbitrator). Fake media element on
// plain EventTarget: no jsdom needed, no timers.
import { describe, expect, test } from 'vitest'
import { createElementAudioClock } from '@state/services/playback/element-audio-clock'

class FakeMediaElement extends EventTarget {
  duration = 12.5
  currentTime = 0
  paused = true
  playbackRate = 1
  pauseCalls = 0
  playImpl: () => Promise<void> = () => {
    this.paused = false
    return Promise.resolve()
  }
  play(): Promise<void> {
    return this.playImpl()
  }
  pause(): void {
    this.pauseCalls += 1
    this.paused = true
  }
  emitEnded(): void {
    this.dispatchEvent(new Event('ended'))
  }
}

describe('CC-107.1: element audio clock (fake <audio>)', () => {
  test('CC-107.1: MediaClock surface is a pass-through of the element', () => {
    const el = new FakeMediaElement()
    const clock = createElementAudioClock(el as unknown as HTMLMediaElement)
    expect(clock.duration).toBe(12.5)
    expect(clock.currentTime()).toBe(0)
    expect(clock.paused).toBe(true)
    clock.seek(4.25)
    expect(el.currentTime).toBe(4.25)
    expect(clock.currentTime()).toBe(4.25)
    clock.setRate(1.75)
    expect(el.playbackRate).toBe(1.75)
    clock.play()
    expect(el.paused).toBe(false)
    expect(clock.paused).toBe(false)
    clock.pause()
    expect(el.paused).toBe(true)
    expect(el.pauseCalls).toBe(1)
  })

  test('CC-107.1: play() swallows the autoplay rejection (no throw, no unhandled rejection)', async () => {
    const el = new FakeMediaElement()
    el.playImpl = () => Promise.reject(new Error('NotAllowedError'))
    const clock = createElementAudioClock(el as unknown as HTMLMediaElement)
    expect(() => {
      clock.play()
    }).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(el.paused).toBe(true)
  })

  test('CC-107.1: onEnded fires once per natural end; unsubscribe is idempotent', () => {
    const el = new FakeMediaElement()
    const clock = createElementAudioClock(el as unknown as HTMLMediaElement)
    let ended = 0
    const off = clock.onEnded?.(() => {
      ended += 1
    })
    expect(off, 'onEnded is implemented on the element clock').toBeTypeOf('function')
    el.emitEnded()
    el.emitEnded()
    expect(ended).toBe(2)
    off?.()
    off?.()
    el.emitEnded()
    expect(ended).toBe(2)
  })

  test('CC-107.1: multiple subscribers all fire; one unsubscribe only removes its own', () => {
    const el = new FakeMediaElement()
    const clock = createElementAudioClock(el as unknown as HTMLMediaElement)
    const hits: string[] = []
    const offA = clock.onEnded?.(() => hits.push('a'))
    clock.onEnded?.(() => hits.push('b'))
    el.emitEnded()
    offA?.()
    el.emitEnded()
    expect(hits).toEqual(['a', 'b', 'b'])
  })

  test('CC-107.1: dispose pauses, detaches the ended listener and clears subscribers', () => {
    const el = new FakeMediaElement()
    const clock = createElementAudioClock(el as unknown as HTMLMediaElement)
    let ended = 0
    clock.onEnded?.(() => {
      ended += 1
    })
    clock.dispose()
    expect(el.pauseCalls).toBe(1)
    el.emitEnded()
    expect(ended).toBe(0)
  })
})
