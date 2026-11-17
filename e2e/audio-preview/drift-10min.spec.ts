// CC-107.4 (L5, `drift` project, [RQ] — reference hardware only): the
// 10-minute wall-clock integrity legs. Each clock plays a click track
// (40 ms 1 kHz burst every 100 ms, 600 s) end to end:
//   • end position within 20 ms of 600 s;
//   • in-page analyser-energy sampling sees ≥ 5900 audible bursts with a
//     max inter-burst gap ≤ 150 ms (dropouts would starve the burst train);
//   • |playhead − clockTime| ≤ 20 ms sampled every 5 s (arbitrator mirror).
// Excluded from the chromium project (playwright.config testIgnore); spawned
// only by scripts/qualify.ts under ZIPSCRIBE_QUALIFY_DRIFT=1. The click
// tracks are `pnpm fixtures --perf` artifacts (gitignored) — absent ⇒ skip
// with reason, recorded as uncovered by qualify (memory-tier doctrine).
import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { bridge, CLICK_AIFF, CLICK_WAV, editor, openAudioProject } from './helpers/bridge'

const CLICK_FILES = [join(REPO_ROOT, 'fixtures/audio/click-track-10min.wav'), join(REPO_ROOT, 'fixtures/audio/click-track-10min.aiff')]

interface Sampler {
  bursts: number
  maxGapMs: number
  firstBurstAtMs: number | null
  lastBurstAtMs: number | null
  energySamples: number
}

interface SamplerState {
  bursts: number
  maxGapMs: number
  firstBurstAtMs: number | null
  lastBurstAtMs: number | null
  energySamples: number
  active: boolean
  prev: boolean
  lastActive: number | null
}

async function runDriftLeg(
  page: import('@playwright/test').Page,
  fixture: { asset: Record<string, unknown>; src: string },
  expectedPath: 'element' | 'decoded',
): Promise<{ endPosition: number; maxMirrorGapMs: number; sampler: Sampler; underrunCount: number }> {
  await openAudioProject(page, fixture)
  const b = bridge(page)
  expect((await b.state()).playbackPath, `expected the ${expectedPath} path for this click track`).toBe(expectedPath)

  // In-page burst sampler: 20 ms polling of a SHORT time-domain window
  // (256 samples ≈ 5.8/16 ms at 44.1k/16k — shorter than the 60 ms click
  // gap; the 4096-bin smoothed spectrum cannot resolve the gap, [107-ADJ
  // 11]), rising/falling edges at 0.02 (bursts are ~0.3-0.7 RMS, inter-click
  // samples are exact zeros) — numbers only (SECURITY-03).
  await page.evaluate(() => {
    const w = window as unknown as {
      __zipDriftSampler?: { bursts: number; maxGapMs: number; firstBurstAtMs: number | null; lastBurstAtMs: number | null; energySamples: number; active: boolean; prev: boolean; lastActive: number | null }
      __zipVisualizerBridge?: { readRecentEnergy: (windowSamples: number) => number }
      __zipDriftSamplerStop?: () => void
    }
    const s: SamplerState = (w.__zipDriftSampler = { bursts: 0, maxGapMs: 0, firstBurstAtMs: null, lastBurstAtMs: null, energySamples: 0, active: false, prev: false, lastActive: null })
    const started = performance.now()
    const tick = (): void => {
      const energy = w.__zipVisualizerBridge!.readRecentEnergy(256)
      const now = performance.now() - started
      s.energySamples += 1
      const on = energy > 0.02
      if (on && !s.prev) {
        s.bursts += 1
        if (s.firstBurstAtMs === null) s.firstBurstAtMs = now
        if (s.lastActive !== null) s.maxGapMs = Math.max(s.maxGapMs, now - s.lastActive)
      }
      if (on) s.lastActive = now
      s.lastBurstAtMs = on ? now : s.lastBurstAtMs
      s.prev = on
    }
    const id = window.setInterval(tick, 20)
    w.__zipDriftSamplerStop = () => {
      window.clearInterval(id)
    }
  })

  // Mirror-gap sampler: |playhead − clockTime| every 5 s (node-side poll).
  let maxMirrorGap = 0
  const deadline = Date.now() + 13 * 60_000
  await b.control('seek', 0)
  await b.control('play')
  // A transient stall that the clock's own recovery heals (underrun →
  // re-fetch → primed, [107-ADJ 15]) must not abort the leg — only a
  // pause that does NOT resolve within 20 s is a real stall.
  let pausedSince = 0
  while (Date.now() < deadline) {
    const [diag, ed] = await Promise.all([b.clock(), editor(page).state()])
    if (!diag.paused) {
      pausedSince = 0
      maxMirrorGap = Math.max(maxMirrorGap, Math.abs(ed.playhead - diag.currentTime) * 1000)
      await page.waitForTimeout(5_000)
    } else if (pausedSince === 0) {
      pausedSince = Date.now()
      await page.waitForTimeout(2_000)
    } else if (Date.now() - pausedSince > 20_000) {
      break
    } else {
      await page.waitForTimeout(2_000)
    }
  }
  await page.evaluate(() => {
    const w = window as unknown as { __zipDriftSamplerStop?: () => void }
    w.__zipDriftSamplerStop?.()
  })
  const raw = await page.evaluate(() => (window as unknown as { __zipDriftSampler?: Record<string, unknown> }).__zipDriftSampler)
  const sampler: Sampler = {
    bursts: Number(raw?.['bursts'] ?? 0),
    maxGapMs: Number(raw?.['maxGapMs'] ?? 0),
    firstBurstAtMs: raw?.['firstBurstAtMs'] === null || raw?.['firstBurstAtMs'] === undefined ? null : Number(raw['firstBurstAtMs']),
    lastBurstAtMs: raw?.['lastBurstAtMs'] === null || raw?.['lastBurstAtMs'] === undefined ? null : Number(raw['lastBurstAtMs']),
    energySamples: Number(raw?.['energySamples'] ?? 0),
  }
  const diag = await b.clock()
  const state = await b.state()
  console.info(`drift leg ${expectedPath}: ` + JSON.stringify({ endPosition: diag.currentTime, paused: diag.paused, underrunCount: state.underrunCount, bursts: sampler.bursts, maxGapMs: sampler.maxGapMs, energySamples: sampler.energySamples, maxMirrorGapMs: maxMirrorGap }))
  return { endPosition: diag.currentTime, maxMirrorGapMs: maxMirrorGap, sampler, underrunCount: state.underrunCount }
}

test.describe('CC-107.4: 10-minute wall-clock drift legs (reference hardware)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.skip(!CLICK_FILES.every(existsSync), 'click tracks are generated perf fixtures (`pnpm fixtures --perf`) — reference-hardware [RQ] gate, see the unit report')

  test('CC-107.4: element clock holds 600 s of wall-clock playback within 20 ms with an intact click train', async ({ page }) => {
    test.setTimeout(15 * 60_000)
    const r = await runDriftLeg(page, CLICK_WAV, 'element')
    expect(Math.abs(r.endPosition - 600), `element end position ${String(r.endPosition)} s vs 600 s`).toBeLessThanOrEqual(0.02)
    expect(r.sampler.energySamples, 'sampler really ran for the full leg').toBeGreaterThan(20_000)
    expect(r.sampler.bursts, `burst count ${String(r.sampler.bursts)} — ≥ 5900 audible bursts required`).toBeGreaterThanOrEqual(5_900)
    expect(r.sampler.maxGapMs, `max inter-burst gap ${String(r.sampler.maxGapMs)} ms — ≤ 150 ms required`).toBeLessThanOrEqual(150)
    // Silence must not hide in the tail edge: bursts ≥ 5900 alone would
    // pass with the last ~10 s silent. The final click must be HEARD.
    expect(r.sampler.lastBurstAtMs ?? -1, 'click train still audible at the tail (last burst ≥ 590 s)').toBeGreaterThanOrEqual(590_000)
    expect(r.maxMirrorGapMs, `max |playhead − clockTime| ${String(r.maxMirrorGapMs)} ms — ≤ 20 ms required`).toBeLessThanOrEqual(20)
    expect(r.underrunCount, 'element path reports no worklet underruns (decoded-only counter — constant 0 here by construction)').toBe(0)
  })

  test('CC-107.4: decoded clock holds 600 s of wall-clock playback within 20 ms with an intact click train', async ({ page }) => {
    test.setTimeout(15 * 60_000)
    const r = await runDriftLeg(page, CLICK_AIFF, 'decoded')
    expect(Math.abs(r.endPosition - 600), `decoded end position ${String(r.endPosition)} s vs 600 s (sample-exact clock)`).toBeLessThanOrEqual(0.02)
    expect(r.sampler.energySamples, 'sampler really ran for the full leg').toBeGreaterThan(20_000)
    expect(r.sampler.bursts, `burst count ${String(r.sampler.bursts)} — ≥ 5900 audible bursts required`).toBeGreaterThanOrEqual(5_900)
    expect(r.sampler.maxGapMs, `max inter-burst gap ${String(r.sampler.maxGapMs)} ms — ≤ 150 ms required`).toBeLessThanOrEqual(150)
    expect(r.sampler.lastBurstAtMs ?? -1, 'click train still audible at the tail (last burst ≥ 590 s)').toBeGreaterThanOrEqual(590_000)
    expect(r.maxMirrorGapMs, `max |playhead − clockTime| ${String(r.maxMirrorGapMs)} ms — ≤ 20 ms required`).toBeLessThanOrEqual(20)
    expect(r.underrunCount, `decoded underruns during 10 min (measured ${String(r.underrunCount)})`).toBe(0)
  })
})
