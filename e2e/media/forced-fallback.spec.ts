import {
  HARNESS_ORIGIN,
  HARNESS_PAGE,
  routeFixtures,
} from './helpers/media'
// CC-04.10 (L4, Chromium): the ffmpeg fallback path is taken for a fixture the
// browser CAN decode natively, when the capability probe is stubbed to report
// the native decoder as unsupported — `decode:support { path: 'ffmpeg' }` +
// `FFMPEG_FALLBACK` notice + the same 16 kHz mono chunk contract, and the
// post-decode capability matrix reports ffmpeg for that container/codec.
import { expect, test } from '@playwright/test'

test.describe('CC-04.10: forced ffmpeg fallback (stubbed capability probe)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  // Specs run against the Playwright webServer (build + preview on 4310,
  // vite.config.ts `publicDir: fixtures`); the harness page is prebuilt into
  // that public dir by `pnpm build:harness` so the same URL works under
  // preview and in CI.
  test.use({ baseURL: HARNESS_ORIGIN })

  test.beforeEach(async ({ page, baseURL }) => {
    await routeFixtures(page, baseURL)
    await page.goto(HARNESS_PAGE)
    await page.waitForFunction(
        () => (globalThis as Record<string, unknown>).__zipscribeMediaHarnessReady === true,
        { timeout: 30_000 },
      )
  })

  test('CC-04.10: a dual-supported file decoded with a stubbed probe emits the ffmpeg path', async ({ page }) => {
    // `fmt-30s.alac.m4a` is a fallback-set file; `fmt-30s.wav` is the
    // dual-supported control: Chromium CAN decode it natively (CC-04.2), so
    // only a stubbed probe can send it down the fallback — and it is PCM, the
    // one dual-supported container the declared FILM stand-in decodes
    // (ALAC-in-M4A is FILM_ALAC_UNSUPPORTED until the real ffmpeg core is
    // self-hosted, unit-04D).
    const result = (await page.evaluate(async () => {
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeFile(url: string, options: unknown): Promise<{ events: { t: string; path?: string; notice?: string; code?: string }[]; chunks: { startSec: number; samples: number[] }[] }> } }).__zipscribeMediaHarness
      const native = await harness.decodeFile('fixtures/audio/fmt-30s.wav', { forcedPath: 'webcodecs' })
      const fallback = await harness.decodeFile('fixtures/audio/fmt-30s.wav', { forcedPath: 'ffmpeg', ffmpegMode: 'film' })
      return { native, fallback }
    })) as {
      native: { events: { t: string; path?: string }[]; chunks: { samples: number[] }[] }
      fallback: { events: { t: string; path?: string; notice?: string; code?: string }[]; chunks: { startSec: number; samples: number[] }[] }
    }
    expect(result.native.events.find((event) => event.t === 'decode:support')?.path, 'control: native path exists').toBe('webcodecs')
    expect(result.fallback.events.find((event) => event.t === 'decode:support')?.path, 'stubbed probe forces ffmpeg').toBe('ffmpeg')
    expect(result.fallback.events.filter((event) => event.t === 'notice').map((event) => event.notice)).toContain('FFMPEG_FALLBACK')
    expect(result.fallback.events.some((event) => event.t === 'job:error')).toBe(false)
    expect(result.fallback.chunks.length).toBeGreaterThan(0)
    expect(result.fallback.chunks.every((chunk) => chunk.samples.length <= 16000)).toBe(true)
    expect(Math.abs(result.fallback.chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0) / 16000 - 30)).toBeLessThanOrEqual(1)
  })
})