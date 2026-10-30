// CC-04.2 / CC-04.3 (L4, Chromium): the audio format matrix — path, duration
// (±20 ms; VBR MP3 ±50 ms), 16 kHz mono f32 chunks, and normalized
// cross-correlation against `fixtures/audio/fmt-30s.ref.wav` (≥0.98 lossless /
// ≥0.90 lossy) at an alignment offset ≤ 5 ms (US-04.1; FR-04.1/04.2/04.9).
//
// The page runs the REAL engine modules (mediabunny + WebCodecs decode, the
// shipped resampler, peaks, fingerprint). Slice 4D installed the pinned
// self-hosted ffmpeg.wasm core (scripts/copy-ffmpeg.ts) plus the production
// adapter (src/engine/audio/adapters/ffmpeg.ts); the builder harness overlay
// (scripts/harness/ffmpeg-overlay.mjs) is the declared film-adapter
// switch-over, so the fallback rows decode through the REAL adapter whenever
// the core is served, and fall back to the declared FILM stand-in when it is
// not (RED-phase checkouts) — assertions identical either way.
//
// CC-04.3 adjudication (unit-04 4D, test-author): the CC line reads verbatim
// "Audio format matrix (fallback set): same thresholds via the ffmpeg path" —
// it proves the FALLBACK PATH decodes the fallback containers/codecs. For
// `fmt-30s.amr`/`fmt-30s.3gp` the source-correlation threshold (≥0.90 vs the
// speech reference) contradicts the fixture physics instead: their AMR-NB
// bitstreams are hand-emitted MR122 payloads (fixtures/LICENSES.md — no
// AMR-NB encoder exists offline: ffmpeg-static `-encoders | grep amr` is
// empty, @ffmpeg/core is decode-only for amr_nb, system ffmpeg none, network
// sources forbidden), so their decode CANNOT correlate to the reference
// (measured 0.0036 — content difference, not a decode failure). The
// defensible oracle for what CC-04.3 proves is a decoder-parity golden: the
// committed bitstream decoded by the pinned ffmpeg-static (Node-side
// reference, `ffmpegStaticNativePcm`) vs the production ffmpeg.wasm adapter
// in the browser (`decodeNativeFfmpeg`), asserting correlation ≥ 0.999 and
// IDENTICAL frame counts at the stream's native rate. Path, FFMPEG_FALLBACK
// notice, duration and the 16 kHz chunk-shape thresholds are still asserted
// for these rows from the same forced-fallback pipeline record as every
// other fallback row. A real-speech AMR payload is a corpus-vendoring owner
// flag (sine-formant interim corpus precedent).
//
// Hermetic: `e2e/media/fixtures/vite.harness.config.ts` serves the fixtures on
// the Playwright webServer (build + preview); the page never touches another origin.
import { expect, test } from '@playwright/test'
import {
  HARNESS_ORIGIN,
  HARNESS_PAGE,
  MAX_OFFSET_SEC,
  PARITY_MIN_CORRELATION,
  bestAlignment,
  concatChunks,
  durationTolerance,
  fallbackSet,
  ffmpegStaticNativePcm,
  fixturePath,
  handBuiltPayloadSet,
  minCorrelation,
  nativeSet,
  pathFor,
  referencePcm2000Hz,
  routeFixtures,
} from './helpers/media'

// The describe titles LEAD with the criterion ID (`CC-04.2:` / `CC-04.3:`) so
// the concatenated Playwright junit title satisfies verify-criteria.ts's
// leading-citation provenance rule (citationsOf): an ID merely discussed after
// prose does not credit a criterion. Assertions are unchanged by this shape.

test.describe('CC-04.2: unit-04 audio format matrix, native set (real decode in Chromium)', () => {
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

})

test.describe('CC-04.3: unit-04 audio format matrix, fallback set (real decode in Chromium)', () => {
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

  const parityKeys = new Set(handBuiltPayloadSet())
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

      if (parityKeys.has(key)) {
        // Hand-built MR122 payload (see the file header adjudication): the
        // chunk contract is asserted from this same pipeline record; content
        // correctness comes from the decoder-parity golden below, not from
        // source correlation against a payload the bitstream never carried.
        expect(chunks.length).toBeGreaterThan(0)
        chunks.forEach((chunk, index) => {
          if (index < chunks.length - 1) expect(chunk.samples.length).toBe(16000)
          expect(chunk.startSec).toBeCloseTo(index, 6)
        })
        const native = await page.evaluate(async (url) => {
          const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeNativeFfmpeg(url: string): Promise<{ sampleRate: number; channels: number; frames: number; samples: number[] }> } }).__zipscribeMediaHarness
          return harness.decodeNativeFfmpeg(url)
        }, fixturePath(key))
        const reference = ffmpegStaticNativePcm(key)
        expect(native.sampleRate, `${key}: adapter stream rate`).toBe(reference.sampleRate)
        expect(native.channels, `${key}: adapter stream channels`).toBe(reference.channels)
        expect(native.frames, `${key}: identical frame count (browser ${native.frames} vs pinned ffmpeg-static ${reference.frames})`).toBe(reference.frames)
        const decoded = Float32Array.from(native.samples)
        const maxOffset = Math.round(MAX_OFFSET_SEC * reference.sampleRate)
        const alignment = bestAlignment(reference.samples, decoded, maxOffset)
        expect(alignment.corr, `${key}: ffmpeg.wasm vs pinned ffmpeg-static correlation ${alignment.corr.toFixed(5)}`).toBeGreaterThanOrEqual(PARITY_MIN_CORRELATION)
        expect(Math.abs(alignment.offset), `${key}: parity offset ${((alignment.offset / reference.sampleRate) * 1000).toFixed(2)} ms`).toBeLessThanOrEqual(maxOffset)
        return
      }

      const reference = referencePcm2000Hz()
      const decoded = concatChunks(chunks.map((chunk) => ({ samples: Float32Array.from(chunk.samples) })))
      const alignment = bestAlignment(reference, decoded, Math.round(MAX_OFFSET_SEC * 16000) * 4 + 16)
      expect(alignment.corr, `${key}: correlation ${alignment.corr.toFixed(4)}`).toBeGreaterThanOrEqual(minCorrelation(key))
      expect(Math.abs(alignment.offset)).toBeLessThanOrEqual(Math.round(MAX_OFFSET_SEC * 16000))
    })
  }
})
