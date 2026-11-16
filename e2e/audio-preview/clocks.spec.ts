// CC-107.2 (L5, chromium): the ONE MediaClock contract runs against the REAL
// element-audio clock (silence-10s.wav → element path) through
// __zipVisualizerBridge — the same `runClockContract` the vitest suite drives
// against the fake (clock-contract-lib parity: three clocks, one contract).
// FR-107.6 honesty probe included: chromium's autoplay policy must not leave
// the AudioContext suspended on a bridge-driven play (Playwright launches
// chromium with --autoplay-policy=no-user-gesture-required; if that ever
// changes, this probe fails FIRST and the fallback is a trusted click on the
// transport button — adjudicate then, do not loosen the gate).
import { expect, test } from '@playwright/test'
import { runClockContract, type ArbitratorContractHandle, type ClockContractHandle } from '../../tests/unit/audio-preview/clock-contract-lib'
import { bridge, editor, openAudioProject, WAV_ELEMENT } from './helpers/bridge'

test.describe('CC-107.2: element audio clock contract (real element, chromium)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test.beforeEach(async ({ page }) => {
    await openAudioProject(page, WAV_ELEMENT)
  })

  test('CC-107.2: the shared clock contract holds for the real element-audio clock', async ({ page }) => {
    test.setTimeout(120_000)
    const b = bridge(page)
    const precondition = await b.state()
    expect(precondition.playbackPath, 'wav is element-supported → element path').toBe('element')

    const clock: ClockContractHandle = {
      kind: 'element',
      play: () => b.control('play'),
      pause: () => b.control('pause'),
      seek: (t) => b.control('seek', t),
      setRate: (r) => b.control('setRate', r),
      time: async () => (await b.clock()).currentTime,
      duration: async () => (await b.clock()).duration,
      paused: async () => (await b.clock()).paused,
      endedCount: async () => (await b.clock()).endedCount,
      wait: (ms) => page.waitForTimeout(ms),
      dispose: () => b.control('dispose'),
    }
    const ed = editor(page)
    const arbitrator: ArbitratorContractHandle = {
      command: async (id, payload) => ed.command(id, payload),
      playhead: async () => (await ed.state()).playhead,
      playing: async () => (await ed.state()).playing,
      wait: (ms) => page.waitForTimeout(ms),
    }
    const violations = await runClockContract(clock, arbitrator)
    expect(violations, 'MediaClock contract violations').toEqual([])
  })

  test('CC-107.3: autoplay-policy probe — bridge-driven play reaches a running AudioContext and live analyser energy', async ({ page }) => {
    const b = bridge(page)
    await b.control('seek', 0.5)
    await b.control('play')
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getVisualizerState: () => { contextState: string } } }).__zipVisualizerBridge?.getVisualizerState().contextState === 'running', undefined, { timeout: 5_000 }).catch(() => {
      // Fail with the actionable message rather than a bare timeout — the
      // fallback (trusted click) is an adjudication decision, never an
      // in-spec workaround.
      throw new Error('AudioContext never reached running from a bridge-driven play — chromium autoplay policy changed; adjudicate (trusted-click transport interaction) per the spec header')
    })
    const state = await b.state()
    expect(state.playing).toBe(true)
    expect(state.graphPath).toBe('element')
    await b.control('pause')
  })

  test('CC-107.3: element-path gain authority — muting is gain-only; the <audio> element stays unmuted at volume 1', async ({ page }) => {
    const b = bridge(page)
    await b.control('play')
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getVisualizerState: () => { playing: boolean } } }).__zipVisualizerBridge?.getVisualizerState().playing === true, undefined, { timeout: 5_000 })

    let el = await page.evaluate(() => {
      const a = document.querySelector('audio[data-testid=stage-video]') as HTMLAudioElement | null
      return a ? { muted: a.muted, volume: a.volume } : null
    })
    expect(el, 'stage <audio> element exists on the element path').not.toBeNull()
    expect(el!.muted, 'element muted flag must stay false (gain authority) ').toBe(false)
    expect(el!.volume, 'element volume must stay 1 (gain authority)').toBe(1)

    await b.setMuted(true)
    expect((await b.state()).muted, 'bridge reports muted').toBe(true)
    el = await page.evaluate(() => {
      const a = document.querySelector('audio[data-testid=stage-video]') as HTMLAudioElement | null
      return a ? { muted: a.muted, volume: a.volume } : null
    })
    expect(el!.muted, 'setMuted must NOT touch element.muted').toBe(false)
    expect(el!.volume, 'setMuted must NOT touch element.volume').toBe(1)

    await b.setMuted(false)
    expect((await b.state()).muted).toBe(false)
    await b.control('pause')
  })
})
