// CC-04.2 / CC-04.3 (L4, Chromium): the audio format matrix — path, duration
// (±20 ms; VBR MP3 ±50 ms), 16 kHz mono f32 chunks, and normalized
// cross-correlation against `fixtures/audio/fmt-30s.ref.wav` (≥0.98 lossless /
// ≥0.90 lossy) at an alignment offset ≤ 5 ms (US-04.1; FR-04.1/04.2/04.9).
//
// The page runs the REAL engine modules (mediabunny + WebCodecs decode, the
// shipped resampler, peaks, fingerprint). The only stand-in is the ffmpeg.wasm
// core for the fallback matrix (declared in `fixtures/film-adapter.ts` — the
// dependency is not installed until the builder wires it; see the unit report).
//
// Hermetic: `e2e/media/fixtures/vite.harness.config.ts` serves the fixtures on
// the Playwright webServer (build + preview); the page never touches another origin.
import { expect, test } from '@playwright/test'
import {
  bestAlignment,
  concatChunks,
  durationTolerance,
  fallbackSet,
  fixturePath,
  MAX_OFFSET_SEC,
  minCorrelation,
  nativeSet,
  pathFor,
  referencePcm2000Hz,
  HARNESS_ORIGIN,
  HARNESS_PAGE,
} from './helpers/media'

test.describe('unit-04 audio format matrix (real decode in Chromium)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  // Specs run against the Playwright webServer (build + preview on 4310,
  // vite.config.ts `publicDir: fixtures`); the harness page is prebuilt into
  // that public dir by `pnpm build:harness` so the same URL works under
  // preview and in CI.
  test.use({ baseURL: HARNESS_ORIGIN })

  test.beforeEach(async ({ page, baseURL }) => {
    // Everything comes from the one webServer origin; anything else is a bug.
    await page.route('**/*', async (route) => {
      const url = route.request().url()
      if (url.startsWith(baseURL + '/')) {
        await route.continue()
        return
      }
      await route.abort()
    })
    await page.goto(HARNESS_PAGE)
    await page.waitForFunction(
        () => (globalThis as Record<string, unknown>).__zipscribeMediaHarnessReady === true,
        { timeout: 30_000 },
      )
  })

  for (const key of nativeSet()) {
    test(`CC-04.2: ${key} decodes via the ${pathFor('chromium', key)} path to spec`, async ({ page }) => {
      const record = await page.evaluate(async (url) => {
        const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeFile(url: string): Promise<unknown> } }).__zipscribeMediaHarness
        return harness.decodeFile(url)
      }, fixturePath(key))
      const { events, chunks, live } = record as unknown as {
        events: { t: string; path?: string; code?: string; asset?: { duration: number; kind: string; width: number; height: number; audioCodec: string | null } }[]
        chunks: { startSec: number; samples: number[] }[]
        live: number
      }
      const support = events.find((event) => event.t === 'decode:support')
      expect(support?.path, `manifest expectedPath for ${key}`).toBe(pathFor('chromium', key))
      expect(events.some((event) => event.t === 'job:error'), JSON.stringify(events.filter((event) => event.t === 'job:error'))).toBe(false)
      expect(events.at(-1)?.t).toBe('job:done')
      expect(live, 'no decoder survives job:done').toBe(0)

      const asset = events.find((event) => event.t === 'media:probed')?.asset
      expect(asset?.kind).toBe('audio')
      expect(Math.abs((asset?.duration ?? 0) - 30), `duration ${asset?.duration}`).toBeLessThanOrEqual(durationTolerance(key))

      // 16 kHz mono f32, 1 s chunks.
      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach((chunk, index) => {
        if (index < chunks.length - 1) expect(chunk.samples.length).toBe(16000)
        expect(chunk.startSec).toBeCloseTo(index, 6)
      })

      const reference = referencePcm2000Hz()
      const decoded = concatChunks(chunks.map((chunk) => ({ samples: Float32Array.from(chunk.samples) })))
      const maxOffset = Math.round(MAX_OFFSET_SEC * 16000) * 4 + 16 // search beyond the ceiling, assert the ceiling
      const alignment = bestAlignment(reference, decoded, maxOffset)
      expect(alignment.corr, `${key}: normalized cross-correlation ${alignment.corr.toFixed(4)}`).toBeGreaterThanOrEqual(minCorrelation(key))
      expect(Math.abs(alignment.offset), `${key}: alignment offset ${((alignment.offset / 16000) * 1000).toFixed(2)} ms`).toBeLessThanOrEqual(Math.round(MAX_OFFSET_SEC * 16000))
    })
  }

  for (const key of fallbackSet()) {
    test(`CC-04.3: ${key} decodes via the ffmpeg path to spec`, async ({ page }) => {
      const record = await page.evaluate(async (url) => {
        const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeFile(url: string, options: unknown): Promise<unknown> } }).__zipscribeMediaHarness
        return harness.decodeFile(url, { forcedPath: 'ffmpeg', ffmpegMode: 'film' })
      }, fixturePath(key))
      const { events, chunks, live } = record as unknown as {
        events: { t: string; path?: string; code?: string; notice?: string; asset?: { duration: number; kind: string } }[]
        chunks: { startSec: number; samples: number[] }[]
        live: number
      }
      expect(events.find((event) => event.t === 'decode:support')?.path).toBe('ffmpeg')
      expect(events.filter((event) => event.t === 'notice').map((event) => event.notice)).toContain('FFMPEG_FALLBACK')
      expect(events.some((event) => event.t === 'job:error'), JSON.stringify(events.filter((event) => event.t === 'job:error'))).toBe(false)
      expect(live).toBe(0)
      const asset = events.find((event) => event.t === 'media:probed')?.asset
      expect(Math.abs((asset?.duration ?? 0) - 30)).toBeLessThanOrEqual(durationTolerance(key))
      const reference = referencePcm2000Hz()
      const decoded = concatChunks(chunks.map((chunk) => ({ samples: Float32Array.from(chunk.samples) })))
      const alignment = bestAlignment(reference, decoded, Math.round(MAX_OFFSET_SEC * 16000) * 4 + 16)
      expect(alignment.corr, `${key}: correlation ${alignment.corr.toFixed(4)}`).toBeGreaterThanOrEqual(minCorrelation(key))
      expect(Math.abs(alignment.offset)).toBeLessThanOrEqual(Math.round(MAX_OFFSET_SEC * 16000))
    })
  }
})
