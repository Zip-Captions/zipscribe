// CC-04.6 (L4, Chromium): `decodeForPlayback` — native-rate PCM from 0 s and
// from a mid-file seek, matching the reference at the source rate
// (correlation ≥ 0.98 lossless).
//
// Fixture: `speech-2min.m4a` (AAC, 16 kHz mono, manifest duration 120 s — an
// m4a twin of `speech-2min.mp4`). Seeks land at 60 s (mid-file). References
// are generated in the page from the same decode at native rate
// (`fixtures/golden/playback-*` cover the 44.1 kHz resample path in the unit
// suite); here the assertion is "playback output == full-rate decode".
import { expect, test } from '@playwright/test'
import {
  HARNESS_ORIGIN,
  HARNESS_PAGE,
  bestAlignment,
  nccOverlap,
  routeFixtures,
} from './helpers/media'

interface PlaybackRecordForTest {
  sampleRate: number
  channels: number
  path: string
  chunks: { startSec: number; samples: number[] }[]
}

test.describe('CC-04.6: native-rate playback decode and seek', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  // Specs run against the Playwright webServer (build + preview on 4310,
  // vite.config.ts `publicDir: fixtures`); the harness page is prebuilt into
  // that public dir by `pnpm build:harness` so the same URL works under
  // preview and in CI.
  test.use({ baseURL: HARNESS_ORIGIN, viewport: { width: 800, height: 600 } })

  test.beforeEach(async ({ page, baseURL }) => {
    await routeFixtures(page, baseURL)
    await page.goto(HARNESS_PAGE)
    await page.waitForFunction(
        () => (globalThis as Record<string, unknown>).__zipscribeMediaHarnessReady === true,
        { timeout: 30_000 },
      )
  })

  test('CC-04.6: from 0 s streams f32 at the source rate (stereo max)', async ({ page }) => {
    const record = (await page.evaluate(async (url) => {
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { playback(url: string, fromSec: number): Promise<unknown> } }).__zipscribeMediaHarness
      return harness.playback(url, 0)
    }, 'fixtures/audio/speech-2min.m4a')) as unknown as PlaybackRecordForTest
    expect(record.path).toBe('webcodecs')
    expect(record.sampleRate).toBe(16000)
    expect(record.channels).toBe(1)
    expect(record.chunks.length).toBeGreaterThan(100)
    const first = record.chunks[0]!
    expect(first.startSec).toBe(0)
    // Interleaved layout: samples.length === frames × channels.
    expect(first.samples.length % record.channels).toBe(0)
  })

  test('CC-04.6: a mid-file seek restarts at 60 s and matches the reference at native rate (corr ≥ 0.98)', async ({ page }) => {
    const { head, seeked } = (await page.evaluate(async (url) => {
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { playback(url: string, fromSec: number): Promise<unknown> } }).__zipscribeMediaHarness
      const head = await harness.playback(url, 0)
      const seeked = await harness.playback(url, 60)
      return { head, seeked }
    }, 'fixtures/audio/speech-2min.m4a')) as unknown as { head: PlaybackRecordForTest; seeked: PlaybackRecordForTest }

    const first = seeked.chunks[0]!
    expect(first.startSec).toBeCloseTo(60, 3)

    const rate = seeked.sampleRate
    const concatenate = (chunks: { samples: number[] }[]): Float32Array => {
      const total = chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0)
      const out = new Float32Array(total)
      let at = 0
      for (const chunk of chunks) {
        out.set(Float32Array.from(chunk.samples), at)
        at += chunk.samples.length
      }
      return out
    }
    // Reference: the full-rate stream from 0 s, sliced at the seek point.
    const full = concatenate(head.chunks)
    const startSample = Math.round(60 * rate) * head.channels
    const window = Math.min(Math.round(5 * rate) * head.channels, full.length - startSample)
    const reference = full.subarray(startSample, startSample + window)
    const actual = concatenate(seeked.chunks).subarray(0, window)
    const alignment = bestAlignment(reference, actual, Math.round(0.05 * rate) * head.channels)
    expect(alignment.corr, `seek 60 s correlation ${alignment.corr.toFixed(4)}`).toBeGreaterThanOrEqual(0.98)
    expect(Math.abs(alignment.offset), 'seek alignment exact to the sample').toBeLessThanOrEqual(head.channels)
    expect(nccOverlap(reference, actual)).toBeGreaterThan(0.98)
  })
})