// CC-107.2 (L5, chromium): the decoded Web-Audio clock on formats the element
// cannot play — fmt-30s.aiff (pcm_s16be) and fmt-30s.wma (wmav2) both take
// the DECODED path (worker decode → AudioWorklet pull). Same shared contract
// as the element/fake legs (clock-contract-lib parity), plus the decoded
// clauses: seek-to-audible ≤ 250 ms (from-seek-to-heard) and zero underruns
// across a full 30 s playback. CC-107.3 (L5): decoded-path gain authority —
// muting is the GainNode only, proven by the POST-gain AnalyserNode going
// silent and back.
import { expect, test } from '@playwright/test'
import { runClockContract, type ArbitratorContractHandle, type ClockContractHandle } from '../../tests/unit/audio-preview/clock-contract-lib'
import { AIFF_DECODED, WMA_DECODED, bridge, editor, openAudioProject } from './helpers/bridge'

test.describe('CC-107.2: decoded clock (chromium, WebCodecs/ffmpeg-decoded formats)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-107.2: the shared clock contract holds for the real decoded clock (AIFF)', async ({ page }) => {
    test.setTimeout(120_000)
    await openAudioProject(page, AIFF_DECODED)
    const b = bridge(page)
    expect((await b.state()).playbackPath, 'AIFF is element-unsupported → decoded path').toBe('decoded')

    const clock: ClockContractHandle = {
      kind: 'decoded',
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

  test('CC-107.2: the shared clock contract holds for the ffmpeg-path decoded clock (WMA)', async ({ page }) => {
    test.setTimeout(180_000)
    await openAudioProject(page, WMA_DECODED)
    const b = bridge(page)
    expect((await b.state()).playbackPath, 'WMA is element-unsupported → decoded path').toBe('decoded')

    const clock: ClockContractHandle = {
      kind: 'decoded',
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

  test('CC-107.2: seek-to-audible ≤ 250 ms — from seek+play to consumption audibly past the target (AIFF)', async ({ page }) => {
    test.setTimeout(90_000)
    await openAudioProject(page, AIFF_DECODED)
    const b = bridge(page)

    // Warm the decode first so the measurement excludes first-decode latency:
    // play from 0 until the post-gain analyser reports energy, then pause.
    await b.control('play')
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { readAnalyserEnergy: () => number } }).__zipVisualizerBridge!.readAnalyserEnergy() > 0, undefined, { timeout: 15_000 })
    await b.control('pause')
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getClockDiagnostics: () => { paused: boolean } } }).__zipVisualizerBridge!.getClockDiagnostics().paused === true, undefined, { timeout: 5_000 })

    const elapsed = await page.evaluate(async (target) => {
      const w = window as unknown as { __zipVisualizerBridge?: { clockControl: (m: string, a?: number) => void; getClockDiagnostics: () => { currentTime: number }; getVisualizerState: () => { underrunCount: number } } }
      const b = w.__zipVisualizerBridge!
      const baseUnderruns = b.getVisualizerState().underrunCount
      b.clockControl('seek', target)
      b.clockControl('play')
      const t0 = performance.now()
      const deadline = t0 + 5_000
      while (performance.now() < deadline) {
        if (b.getClockDiagnostics().currentTime >= target + 0.1 && b.getVisualizerState().underrunCount === baseUnderruns) {
          return performance.now() - t0
        }
        await new Promise((r) => setTimeout(r, 10))
      }
      return -1
    }, 12)
    expect(elapsed, 'consumption never passed the seek target without underrun').toBeGreaterThanOrEqual(0)
    expect(elapsed, 'seek-to-audible exceeds 250 ms (FR-107.3: from-seek-to-heard)').toBeLessThanOrEqual(250)
    await b.control('pause')
  })

  test('CC-107.2: zero underruns across a full 30 s decoded playback (AIFF)', async ({ page }) => {
    test.setTimeout(120_000)
    await openAudioProject(page, AIFF_DECODED)
    const b = bridge(page)
    await b.control('seek', 0)
    await b.control('play')
    await page
      .waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getClockDiagnostics: () => { currentTime: number } } }).__zipVisualizerBridge!.getClockDiagnostics().currentTime >= 29.4, undefined, { timeout: 45_000 })
      .catch(() => {
        throw new Error('decoded playback stalled before 29.4 s — not a full 30 s run (coverage of the underrun clause would be vacuous)')
      })
    await b.control('pause')
    const state = await b.state()
    expect(state.underrunCount, `underruns during 30 s decoded playback (measured ${String(state.underrunCount)})`).toBe(0)
  })

  test('CC-107.3: decoded-path gain authority — setMuted silences the POST-gain analyser, unmute restores it (element untouched)', async ({ page }) => {
    test.setTimeout(90_000)
    await openAudioProject(page, AIFF_DECODED)
    const b = bridge(page)
    await b.control('seek', 1)
    await b.control('play')
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { readAnalyserEnergy: () => number } }).__zipVisualizerBridge!.readAnalyserEnergy() > 0, undefined, { timeout: 15_000 })
    const loud = await b.energy()
    expect(loud, 'analyser (post-gain) reports energy while playing unmuted').toBeGreaterThan(0)

    await b.setMuted(true)
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { readAnalyserEnergy: () => number } }).__zipVisualizerBridge!.readAnalyserEnergy() === 0, undefined, { timeout: 3_000 }).catch(() => {
      throw new Error('analyser still carries energy while muted — the AnalyserNode is not downstream of the GainNode (CC-107.3 graph shape)')
    })
    expect((await b.state()).graphPath, 'no element on the decoded path — muting cannot be element-based').toBe('decoded')

    await b.setMuted(false)
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { readAnalyserEnergy: () => number } }).__zipVisualizerBridge!.readAnalyserEnergy() > 0, undefined, { timeout: 3_000 })
    expect(await b.energy(), 'energy returns after unmute').toBeGreaterThan(0)
    await b.control('pause')
  })
})
