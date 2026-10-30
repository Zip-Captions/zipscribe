// Adversary round unit-04 — anti-fabrication oracles over the harness boundary.
//
// The frozen harness and the builder-owned overlay both sit BETWEEN the specs
// and the engine: `decodeStreaming` reports a `{ chunks, duration }` summary
// with no retained bytes (a tampered counter is invisible), and the overlay
// owns the `forcedPath: 'ffmpeg'` rows end-to-end (events + chunks). These
// specs cross-check each mediated claim against an unmediated path:
//   • streaming vs one-shot chunk agreement through the same engine,
//   • the overlay's ffmpeg rows against the browser's OWN native decode
//     (normalized cross-correlation), independent of any manifest expectation.
import {
  HARNESS_ORIGIN,
  HARNESS_PAGE,
  bestAlignment,
  concatChunks,
  routeFixtures,
} from './helpers/media'
import { expect, test } from '@playwright/test'

interface DecodeResult {
  events: { t: string; path?: string; asset?: { duration?: number } }[]
  chunks: { startSec: number; samples: number[] }[]
}

test.describe('adversary[adv-unit04]: harness-boundary anti-fabrication', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'child runs: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: HARNESS_ORIGIN })

  test.beforeEach(async ({ page, baseURL }) => {
    await routeFixtures(page, baseURL)
    await page.goto(HARNESS_PAGE)
    await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeMediaHarnessReady === true, { timeout: 30_000 })
  })

  async function decode(page: import('@playwright/test').Page, url: string, options: unknown): Promise<DecodeResult> {
    return page.evaluate(
      ([u, o]) => (globalThis as unknown as { __zipscribeMediaHarness: { decodeFile(x: string, y: unknown): Promise<DecodeResult> } }).__zipscribeMediaHarness.decodeFile(u, o),
      [url, options] as const,
    )
  }

  test('decodeStreaming chunk count agrees with the unmediated one-shot decode', async ({ page }) => {
    const oneShot = await decode(page, 'fixtures/audio/fmt-30s.wav', { forcedPath: 'webcodecs' })
    const streamed = await page.evaluate(async (u) => (globalThis as unknown as { __zipscribeMediaHarness: { decodeStreaming(x: string): Promise<{ chunks: number; duration: number }> } }).__zipscribeMediaHarness.decodeStreaming(u), 'fixtures/audio/fmt-30s.wav')
    expect(oneShot.chunks.length, 'one-shot decode of the 30 s fixture yields ~30 chunks').toBeGreaterThanOrEqual(29)
    expect(streamed.chunks, 'the streaming summary reports the SAME chunk count as the one-shot decode of the same file').toBeGreaterThanOrEqual(oneShot.chunks.length - 1)
    expect(streamed.chunks, 'no chunk inflation beyond the one-shot baseline + slop').toBeLessThanOrEqual(oneShot.chunks.length + 1)
    expect(streamed.duration, 'the streaming summary duration agrees with the probe').toBeGreaterThanOrEqual(29)
  })

  test('the overlay-mediated ffmpeg path decodes to the browser-native audio (cross-correlation)', async ({ page }) => {
    const native = await decode(page, 'fixtures/audio/fmt-30s.wav', { forcedPath: 'webcodecs' })
    let fallback: DecodeResult
    try {
      fallback = await decode(page, 'fixtures/audio/fmt-30s.wav', { forcedPath: 'ffmpeg', ffmpegMode: 'real' })
    } catch (error) {
      test.skip((error as { code?: string }).code === 'FFMPEG_CORE_UNAVAILABLE', 'pinned ffmpeg core absent in this environment')
      throw error
    }
    expect(fallback.events.some((e) => e.t === 'decode:support' && e.path === 'ffmpeg'), 'the fallback row declares the ffmpeg path').toBe(true)
    const asF32 = (chunks: { samples: number[] }[]) => chunks.map((c) => ({ samples: Float32Array.from(c.samples) }))
    const alignment = bestAlignment(concatChunks(asF32(native.chunks)), concatChunks(asF32(fallback.chunks)), 48_000)
    expect(alignment.corr, `overlay ffmpeg-vs-native normalized cross-correlation ${alignment.corr.toFixed(4)}`).toBeGreaterThanOrEqual(0.98)
  })
})
