// CC-04.4 / CC-04.5 (L4, Chromium): audio-only probe and the unsupported-file
// path — `asset.kind = 'audio'` with zero video dimensions for every audio
// fixture (cover-art containers included), correct codec/sample-rate/channels,
// and `not-audio.mp3` → `UNSUPPORTED_MEDIA` with no asset/project.
import { expect, test } from '@playwright/test'
import {
  HARNESS_ORIGIN,
  HARNESS_PAGE,
  fallbackSet,
  fixturePath,
  loadManifest,
  nativeSet,
  routeFixtures,
} from './helpers/media'

const AUDIO_FIXTURES = [...nativeSet(), ...fallbackSet()]

test.describe('CC-04.4: audio-only probe and CC-04.5: unsupported media', () => {
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

  for (const key of AUDIO_FIXTURES) {
    const manifest = loadManifest().files[key]
    test(`CC-04.4: ${key} probes as audio with zero video dimensions`, async ({ page }) => {
      const asset = (await page.evaluate(
        async ({ url, forcedPath }) => {
          const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeFile(url: string, options: unknown): Promise<{ events: { t: string; asset?: unknown }[] }> } }).__zipscribeMediaHarness
          const result = await harness.decodeFile(url, { forcedPath, ffmpegMode: 'film' })
          return result.events.find((event) => event.t === 'media:probed')?.asset ?? null
        },
        { url: fixturePath(key), forcedPath: manifest?.expectedPath === 'ffmpeg' ? ('ffmpeg' as const) : undefined },
      )) as {
        kind: string
        width: number
        height: number
        fps: number
        audioCodec: string | null
        videoCodec: string | null
        container: string
        duration: number
      } | null
      expect(asset, 'media:probed published an asset').not.toBeNull()
      expect(asset!.kind).toBe('audio')
      expect(asset!.width).toBe(0)
      expect(asset!.height).toBe(0)
      expect(asset!.fps).toBe(0)
      expect(asset!.videoCodec).toBeNull()
      expect(asset!.audioCodec, 'audio codec reported').toBeTruthy()
      expect(asset!.container, 'container reported').toBeTruthy()
      expect(asset!.duration).toBeGreaterThan(0)
    })
  }

  test('CC-04.4: cover-art MP3/M4A (id3/itunes art) still probe as audio, not video', async ({ page }) => {
    // `fmt-30s.mp3` and `fmt-30s.m4a` are the matrix members that carry
    // attached art/tags; the assertion above already covers them, this test
    // names the requirement explicitly.
    for (const key of ['fmt-30s.mp3', 'fmt-30s.m4a']) {
      const asset = (await page.evaluate(async (url) => {
        const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeFile(url: string, options: unknown): Promise<{ events: { t: string; asset?: { kind: string; width: number; height: number } }[] }> } }).__zipscribeMediaHarness
        const result = await harness.decodeFile(url, {})
        return result.events.find((event) => event.t === 'media:probed')?.asset ?? null
      }, fixturePath(key))) as { kind: string; width: number; height: number } | null
      expect(asset?.kind, key).toBe('audio')
      expect(asset?.width).toBe(0)
      expect(asset?.height).toBe(0)
    }
  })

  test('CC-04.5: not-audio.mp3 → UNSUPPORTED_MEDIA and no asset/project', async ({ page }) => {
    const result = (await page.evaluate(async (url) => {
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeFile(url: string, options: unknown): Promise<{ events: { t: string; code?: string; asset?: unknown }[] }> } }).__zipscribeMediaHarness
      return harness.decodeFile(url, {})
    }, 'fixtures/audio/not-audio.mp3')) as { events: { t: string; code?: string; asset?: unknown }[] }
    const error = result.events.find((event) => event.t === 'job:error')
    expect(error?.code).toBe('UNSUPPORTED_MEDIA')
    expect(result.events.some((event) => event.t === 'media:probed'), 'no project/asset is created').toBe(false)
    expect(result.events.some((event) => event.t === 'decode:support'), 'no decoder path is chosen').toBe(false)
    expect(result.events.some((event) => event.t === 'job:done')).toBe(false)
  })
})