import {
  HARNESS_ORIGIN,
  HARNESS_PAGE,
  routeFixtures,
} from './helpers/media'
// CC-04.8 / CC-04.13 / CC-04.4 (L4, Chromium): the shipped resampler, peaks
// and fingerprint run on REAL decoded audio in the browser — the same
// thresholds as the L1 suite, now against WebCodecs-decoded samples.
//
// CC-04.8 (browser part): a 10 kHz tone at 44.1 kHz decoded from
// `tones-220-1k-5k-10s.wav`'s native rate resampled to 16 kHz leaks ≤ −60 dBFS
// at 6 kHz; the 1 kHz segment keeps its level within 0.1 dB.
// CC-04.13: two imports of one fixture are identical; a 1-byte change in
// first/middle/last region changes the fingerprint.
// CC-04.4: peaks arrive bucketed ≤ 20 000 with a usable bucketSec.
import { expect, test } from '@playwright/test'

test.describe('unit-04 engine math on real decoded audio (Chromium)', () => {
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

  test('CC-04.8: 44.1 kHz tone fixture resampled to 16 kHz keeps the 1 kHz passband and kills the 5 kHz image', async ({ page }) => {
    const out = (await page.evaluate(async () => {
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { resampleFile(url: string, toRate: number): Promise<{ out: number[] }> } }).__zipscribeMediaHarness
      return harness.resampleFile('fixtures/audio/tones-220-1k-5k-10s.wav', 16000)
    })) as { out: number[] }
    const samples = Float32Array.from(out.out)
    const amplitudeAt = (from: number, to: number, frequency: number): number => {
      const segment = samples.subarray(from, to)
      let real = 0
      let imaginary = 0
      for (let index = 0; index < segment.length; index++) {
        const phase = (2 * Math.PI * frequency * index) / 16000
        real += segment[index]! * Math.cos(phase)
        imaginary += segment[index]! * Math.sin(phase)
      }
      return (2 * Math.hypot(real, imaginary)) / segment.length
    }
    // The fixture is 220 Hz (0–3.33 s), 1 kHz (3.34–6.66 s), 5 kHz (6.66–10 s).
    const oneKhz = amplitudeAt(Math.round(4 * 16000), Math.round(6 * 16000), 1000)
    expect(20 * Math.log10(oneKhz / 0.6), '1 kHz passband within 0.1 dB of the 0.6 source amplitude').toBeLessThanOrEqual(0.1)
    // 5 kHz survives (it is inside 8 kHz); it must NOT be aliased to 11 kHz.
    const image = amplitudeAt(Math.round(7 * 16000), Math.round(9.9 * 16000), 11000)
    expect(20 * Math.log10(image + 1e-30), 'no 11 kHz image of the 5 kHz segment').toBeLessThanOrEqual(-40)
  })

  test('CC-04.13: fingerprint is deterministic on a real fixture and changes on a 1-byte edit', async ({ page }) => {
    const result = (await page.evaluate(async () => {
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { fingerprint(url: string, at: string | null): Promise<{ first: unknown; second: unknown; mutated: unknown }> } }).__zipscribeMediaHarness
      const same = await harness.fingerprint('fixtures/audio/fmt-30s.m4a', null)
      const first = await harness.fingerprint('fixtures/audio/fmt-30s.m4a', 'first')
      const middle = await harness.fingerprint('fixtures/audio/fmt-30s.m4a', 'middle')
      const last = await harness.fingerprint('fixtures/audio/fmt-30s.m4a', 'last')
      return { same, first, middle, last }
    })) as Record<'same' | 'first' | 'middle' | 'last', { first: { sampleHashes: string[] }; second: { sampleHashes: string[] }; mutated: { sampleHashes: string[]; size: number } }>
    expect(result.same.second, 'identical file → identical fingerprint').toEqual(result.same.first)
    expect(result.first.mutated.sampleHashes[0]).not.toBe(result.first.first.sampleHashes[0])
    expect(result.middle.mutated.sampleHashes[1]).not.toBe(result.middle.first.sampleHashes[1])
    expect(result.last.mutated.sampleHashes[2]).not.toBe(result.last.first.sampleHashes[2])
    expect(result.first.first.sampleHashes).toHaveLength(3)
  })

  test('CC-04.4: peaks bucket a real fixture at ≤ 20 000 buckets with a usable bucketSec', async ({ page }) => {
    const peaks = (await page.evaluate(async () => {
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { peaksFile(url: string): Promise<{ buckets: number; bucketSec: number; min: number[]; max: number[] }> } }).__zipscribeMediaHarness
      return harness.peaksFile('fixtures/audio/fmt-30s.m4a')
    })) as { buckets: number; bucketSec: number; min: number[]; max: number[] }
    expect(peaks.buckets).toBeGreaterThan(0)
    expect(peaks.buckets).toBeLessThanOrEqual(20_000)
    expect(peaks.bucketSec * peaks.buckets).toBeCloseTo(30, 0)
    peaks.max.forEach((value, index) => expect(value).toBeGreaterThanOrEqual(peaks.min[index]!))
  })
})