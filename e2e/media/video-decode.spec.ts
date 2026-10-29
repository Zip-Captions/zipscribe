// CC-04.1 (L4, Chromium): every unit-01 video fixture decodes to spec —
// `media:probed.asset.duration` matches the manifest (±10 ms), `kind:'video'`,
// audio codec reported, and the 16 kHz mono PCM stream covers the duration.
import { expect, test } from '@playwright/test'
import { fixturePath, loadManifest, videoSet, HARNESS_ORIGIN, HARNESS_PAGE } from './helpers/media'

test.describe('CC-04.1: video corpus decodes to spec', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  // Specs run against the Playwright webServer (build + preview on 4310,
  // vite.config.ts `publicDir: fixtures`); the harness page is prebuilt into
  // that public dir by `pnpm build:harness` so the same URL works under
  // preview and in CI.
  test.use({ baseURL: HARNESS_ORIGIN })
  test.setTimeout(180_000)

  for (const key of videoSet()) {
    const entry = loadManifest().files[key]!
    test(`CC-04.1: ${key.replace('../', '')} decodes to spec (duration ±10 ms)`, async ({ page, baseURL }) => {
      await page.route('**/*', async (route) => {
        if (route.request().url().startsWith(baseURL + '/')) await route.continue()
        else await route.abort()
      })
      await page.goto(HARNESS_PAGE)
      await page.waitForFunction(
        () => (globalThis as Record<string, unknown>).__zipscribeMediaHarnessReady === true,
        { timeout: 30_000 },
      )

      const result = (await page.evaluate(async (url) => {
        const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeFile(url: string): Promise<unknown> } }).__zipscribeMediaHarness
        return harness.decodeFile(url)
      }, fixturePath(key))) as {
        events: { t: string; path?: string; asset?: { duration: number; kind: string; audioCodec: string | null; videoCodec: string | null } }[]
        chunks: { samples: number[] }[]
        live: number
      }
      const asset = result.events.find((event) => event.t === 'media:probed')?.asset
      expect(asset, 'media:probed published').toBeDefined()
      expect(asset!.kind, 'video track exists → kind is video').toBe('video')
      expect(asset!.videoCodec, 'video codec reported').toBeTruthy()
      expect(asset!.audioCodec, 'audio codec reported').toBeTruthy()
      expect(Math.abs(asset!.duration - entry.duration), `duration ${asset!.duration} vs ${entry.duration}`).toBeLessThanOrEqual(0.01)
      expect(result.events.find((event) => event.t === 'decode:support')?.path).toBe(entry.expectedPath)
      const covered = result.chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0) / 16000
      expect(Math.abs(covered - entry.duration)).toBeLessThanOrEqual(1.5)
      expect(result.live, 'no decoder survives').toBe(0)
    })
  }
})