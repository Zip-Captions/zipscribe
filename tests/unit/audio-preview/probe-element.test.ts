// @vitest-environment jsdom
// CC-107.1 (L1): the DOM-side element probe's degradation paths on a stubbed
// `<audio>` — the honesty clause (canPlayType is necessary but NOT
// sufficient: 'probably' + a rejected play() still yields
// probePlaySucceeded: false), the timeout degradation, the 'error' event,
// both success evidence paths ('playing' event OR play() resolution with
// motion), and the always-teardown clause. The DECISION table is pure and
// pinned separately in choose-path.test.ts (CC-107.1); the chromium column
// anchor is e2e (clocks.spec.ts). [107-ADJ 10]: default budget is 1 s;
// suites here pass explicit short timeoutMs so the timeout leg stays fast.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { probeElementPlayback } from '@state/services/playback/probe-element'

type PlayMode = 'never-settles' | 'rejects' | 'resolves-still' | 'resolves-moving'

class FakeProbeElement extends EventTarget {
  muted = false
  preload = ''
  src = ''
  currentTime = 0
  paused = true
  playMode: PlayMode = 'never-settles'
  canPlayTypeReturn = ''
  teardown: { removedSrc: boolean; loads: number } = { removedSrc: false, loads: 0 }
  removeAttribute(name: string): void {
    if (name === 'src') {
      this.teardown.removedSrc = true
      this.src = ''
    }
  }
  load(): void {
    this.teardown.loads += 1
  }
  canPlayType(_mime: string): string {
    return this.canPlayTypeReturn
  }
  play(): Promise<void> {
    switch (this.playMode) {
      case 'rejects':
        return Promise.reject(new Error('NotAllowedError'))
      case 'resolves-still':
        return Promise.resolve()
      case 'resolves-moving':
        this.currentTime = 0.02
        this.paused = false
        return Promise.resolve()
      case 'never-settles':
        return new Promise<void>(() => undefined)
    }
  }
  emitPlaying(): void {
    this.dispatchEvent(new Event('playing'))
  }
  emitError(): void {
    this.dispatchEvent(new Event('error'))
  }
}

let queue: FakeProbeElement[] = []
let realCreateElement: typeof document.createElement

beforeEach(() => {
  queue = []
  realCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
    if (tagName === 'audio') {
      const fake = queue.shift() ?? new FakeProbeElement()
      return fake as unknown as HTMLAudioElement
    }
    return realCreateElement(tagName, options)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function probe(mode: PlayMode, opts: { canPlayType?: string; emit?: (el: FakeProbeElement) => void; timeoutMs?: number } = {}): Promise<{ evidence: { canPlayType: string; probePlaySucceeded: boolean }; el: FakeProbeElement }> {
  // Pre-created element: playMode must be configured BEFORE the probe's
  // synchronous play() call (the probe runs the attempt inside the Promise
  // constructor — configuring after the call would race it).
  const el = new FakeProbeElement()
  el.playMode = mode
  el.canPlayTypeReturn = opts.canPlayType ?? ''
  queue.push(el)
  // Call first (listeners attach synchronously inside the Promise
  // constructor), THEN drive events, then await.
  const pending = probeElementPlayback('blob:fixture-audio', 'audio/wav', { timeoutMs: opts.timeoutMs ?? 20 })
  if (opts.emit !== undefined) opts.emit(el)
  const evidence = await pending
  return { evidence, el }
}

describe('CC-107.1: element probe (stubbed <audio>)', () => {
  test('CC-107.1: probe sets muted + preload=auto and src, and ALWAYS tears the element down', async () => {
    const { el } = await probe('rejects', { canPlayType: 'probably' })
    expect(el.muted, 'probe play is muted (no audible blip, no autoplay gesture needed)').toBe(true)
    expect(el.preload).toBe('auto')
    expect(el.teardown.removedSrc, 'src removed on settle').toBe(true)
    expect(el.teardown.loads, 'load() called on settle (teardown)').toBeGreaterThan(0)
  })

  test('CC-107.1: honesty clause — canPlayType "probably" with a rejected play() degrades to false', async () => {
    const { evidence } = await probe('rejects', { canPlayType: 'probably' })
    expect(evidence).toEqual({ canPlayType: 'probably', probePlaySucceeded: false })
  })

  test('CC-107.1: the "playing" event is success evidence with canPlayType forwarded', async () => {
    const { evidence } = await probe('never-settles', { canPlayType: 'maybe', emit: (el) => el.emitPlaying() })
    expect(evidence).toEqual({ canPlayType: 'maybe', probePlaySucceeded: true })
  })

  test('CC-107.1: play() resolving with motion (currentTime > 0) is success evidence', async () => {
    const { evidence } = await probe('resolves-moving', { canPlayType: 'probably' })
    expect(evidence.probePlaySucceeded).toBe(true)
  })

  test('CC-107.1: play() resolving without motion is NOT success — the timeout decides false', async () => {
    const { evidence } = await probe('resolves-still', { canPlayType: 'probably' })
    expect(evidence).toEqual({ canPlayType: 'probably', probePlaySucceeded: false })
  })

  test('CC-107.1: an "error" event degrades to false before the timeout', async () => {
    const { evidence } = await probe('never-settles', { canPlayType: 'probably', emit: (el) => el.emitError() })
    expect(evidence.probePlaySucceeded).toBe(false)
  })

  test('CC-107.1: unsupported type — silent probe times out to false with the empty canPlayType', async () => {
    const started = Date.now()
    const { evidence } = await probe('never-settles', { canPlayType: '', timeoutMs: 30 })
    expect(evidence).toEqual({ canPlayType: '', probePlaySucceeded: false })
    expect(Date.now() - started, 'the timeout leg waited out the budget').toBeGreaterThanOrEqual(25)
  })

  test('CC-107.1: the probe never throws on any failure mode', async () => {
    await expect(probeElementPlayback('blob:x', 'audio/zzz', { timeoutMs: 15 })).resolves.toEqual({ canPlayType: '', probePlaySucceeded: false })
  })
})
