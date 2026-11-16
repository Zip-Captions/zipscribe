// CC-107.1 / CC-102.5 (L1): the composition-root clock ROUTER — the one
// sanctioned swap indirection the frozen SyncArbitrator holds. Inert-while-
// detached semantics (no active clock ⇒ duration/currentTime 0, paused true,
// every command a safe no-op), gesture-parity hook ordering (onActivePlay
// BEFORE the active clock — FR-107.6 AudioContext resume), command
// forwarding, swap-time onEnded rebinding (old clock unbound, callbacks
// re-registered on the new one, unsubscribe outlives swaps), dispose of the
// active clock, same-clock attach short-circuit, snapshot() built inside the
// sanctioned currentTime home, and the CC-102.5 ended-restart question
// (atMediaEnd: paused + position at/past end − 50 ms) — so the composition
// layer never spells `.currentTime`.
import { describe, expect, test } from 'vitest'
import { createRouterMediaClock } from '@state/services/playback/router-clock'
import type { RouterMediaClock } from '@state/services/playback/router-clock'
import type { MediaClock } from '@state/services/playback/media-clock'

interface FakeClock extends MediaClock {
  readonly log: string[]
  emitEnded(): void
}

function fakeClock(opts: { duration?: number; paused?: boolean; withOnEnded?: boolean; log?: string[] } = {}): FakeClock {
  const log = opts.log ?? []
  const cbs = new Set<() => void>()
  const clock: FakeClock = {
    log,
    duration: opts.duration ?? 10,
    get paused(): boolean {
      return paused
    },
    currentTime: () => {
      log.push('currentTime')
      return time
    },
    play: () => {
      log.push('play')
      paused = false
    },
    pause: () => {
      log.push('pause')
      paused = true
    },
    seek: (t) => {
      log.push(`seek:${String(t)}`)
      time = t
    },
    setRate: (r) => {
      log.push(`rate:${String(r)}`)
    },
    dispose: () => {
      log.push('dispose')
    },
    emitEnded: () => {
      for (const cb of [...cbs]) cb()
    },
  }
  let paused = opts.paused ?? true
  let time = 0
  if (opts.withOnEnded !== false) {
    clock.onEnded = (cb: () => void): (() => void) => {
      cbs.add(cb)
      return () => {
        cbs.delete(cb)
      }
    }
  }
  return clock
}

describe('CC-107.1/CC-102.5: router clock (composition-root swap)', () => {
  test('CC-107.1: inert while detached — safe defaults, every command a no-op', () => {
    const router = createRouterMediaClock()
    expect(router.duration).toBe(0)
    expect(router.currentTime()).toBe(0)
    expect(router.paused).toBe(true)
    expect(router.activeClock).toBeNull()
    expect(() => {
      router.play()
      router.pause()
      router.seek(5)
      router.setRate(2)
      router.dispose()
    }).not.toThrow()
    expect(router.snapshot()).toEqual({ paused: true, currentTime: 0, duration: 0 })
  })

  test('CC-107.1: play() fires the gesture-parity hook BEFORE the active clock', () => {
    const order: string[] = []
    const router = createRouterMediaClock({ onActivePlay: () => order.push('resume') })
    const clock = fakeClock({ log: order })
    router.attachActive(clock)
    router.play()
    expect(order, 'AudioContext resume first, clock second (FR-107.6)').toEqual(['resume', 'play'])
    expect(router.paused).toBe(false)
  })

  test('CC-107.1: pause/seek/setRate/currentTime forward to the active clock', () => {
    const router = createRouterMediaClock()
    const clock = fakeClock()
    router.attachActive(clock)
    router.seek(3.5)
    router.setRate(1.5)
    router.pause()
    expect(clock.log).toContain('seek:3.5')
    expect(clock.log).toContain('rate:1.5')
    expect(clock.log).toContain('pause')
    expect(router.currentTime()).toBe(3.5)
    expect(router.snapshot()).toEqual({ paused: true, currentTime: 3.5, duration: 10 })
    expect(router.duration).toBe(10)
  })

  test('CC-107.1: swap rebinds ended — old clock unbound, callbacks live on the new clock', () => {
    const router: RouterMediaClock = createRouterMediaClock()
    let ended = 0
    const off = router.onEnded(() => {
      ended += 1
    })
    const a = fakeClock()
    const b = fakeClock()
    router.attachActive(a)
    a.emitEnded()
    expect(ended).toBe(1)
    router.attachActive(b)
    a.emitEnded()
    expect(ended, 'old clock no longer bound').toBe(1)
    b.emitEnded()
    expect(ended, 'callbacks re-registered on the new clock').toBe(2)
    // Subscribing AFTER an attach binds immediately.
    router.onEnded(() => {
      ended += 10
    })
    b.emitEnded()
    expect(ended).toBe(13)
    off()
    b.emitEnded()
    expect(ended, 'unsubscribe reaches the active clock too (rebind on unsubscribe)').toBe(23)
  })

  test('CC-107.1: clocks without onEnded (frozen six-plus-dispose) never crash the router', () => {
    const router = createRouterMediaClock()
    let ended = 0
    router.onEnded(() => {
      ended += 1
    })
    const plain = fakeClock({ withOnEnded: false })
    router.attachActive(plain)
    router.attachActive(null)
    router.attachActive(fakeClock())
    expect(ended).toBe(0)
  })

  test('CC-107.1: attachActive short-circuits on the same clock and dispose disposes the active', () => {
    const router = createRouterMediaClock()
    const clock = fakeClock()
    router.attachActive(clock)
    const before = clock.log.length
    router.attachActive(clock)
    expect(clock.log.length, 'same-clock attach is inert').toBe(before)
    expect(router.activeClock).toBe(clock)
    router.dispose()
    expect(clock.log).toContain('dispose')
  })

  test('CC-102.5: atMediaEnd answers the ended-restart question inside the sanctioned zone', () => {
    const router = createRouterMediaClock()
    expect(router.atMediaEnd(), 'no clock ⇒ not at end').toBe(false)
    const clock = fakeClock({ duration: 10, paused: true })
    router.attachActive(clock)
    expect(router.atMediaEnd(), 'position 0 ⇒ not at end').toBe(false)
    router.seek(9.96)
    expect(router.atMediaEnd(), 'within 50 ms of end ⇒ at end').toBe(true)
    router.seek(10.4)
    expect(router.atMediaEnd(), 'past end ⇒ at end').toBe(true)
    router.seek(9.9)
    expect(router.atMediaEnd(), '100 ms short ⇒ not at end').toBe(false)
    router.play()
    expect(router.atMediaEnd(), 'playing ⇒ never at end').toBe(false)
    router.pause()
    router.seek(0)
    const zeroLength = fakeClock({ duration: 0 })
    router.attachActive(zeroLength)
    expect(router.atMediaEnd(), 'zero duration ⇒ never at end').toBe(false)
  })
})
