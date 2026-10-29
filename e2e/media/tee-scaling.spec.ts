import { HARNESS_ORIGIN, HARNESS_PAGE } from './helpers/media'
// CC-04.12 (L4, Chromium): two-port tee — ASR and diarize ports receive
// byte-identical chunk sequences through the production `teePcm`; a stalled
// consumer pauses decode at the bounded queue of 30 chunks instead of
// buffering without limit (FR-04.1).
import { expect, test } from '@playwright/test'

test.describe('CC-04.12: tee and backpressure', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  // Specs run against the Playwright webServer (build + preview on 4310,
  // vite.config.ts `publicDir: fixtures`); the harness page is prebuilt into
  // that public dir by `pnpm build:harness` so the same URL works under
  // preview and in CI.
  test.use({ baseURL: HARNESS_ORIGIN })
  test.setTimeout(180_000)

  test.beforeEach(async ({ page, baseURL }) => {
    await page.route('**/*', async (route) => {
      if (route.request().url().startsWith(baseURL + '/')) await route.continue()
      else await route.abort()
    })
    await page.goto(HARNESS_PAGE)
    await page.waitForFunction(
        () => (globalThis as Record<string, unknown>).__zipscribeMediaHarnessReady === true,
        { timeout: 30_000 },
      )
  })

  test('CC-04.12: two ports receive byte-identical chunk sequences (one consumer slower)', async ({ page }) => {
    const result = (await page.evaluate(async (url) => {
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeTee(url: string, delays: [number, number]): Promise<unknown> } }).__zipscribeMediaHarness
      return harness.decodeTee(url, [0, 5])
    }, 'fixtures/audio/speech-2min.m4a')) as {
      first: { startSec: number; samples: number[] }[]
      second: { startSec: number; samples: number[] }[]
      identical: boolean
      events: { t: string }[]
    }
    expect(result.first.length, 'ASR port got chunks').toBeGreaterThan(100)
    expect(result.second.length).toBe(result.first.length)
    expect(result.identical, 'every chunk is byte-identical across ports').toBe(true)
    expect(result.first.map((chunk) => chunk.startSec)).toEqual(result.second.map((chunk) => chunk.startSec))
    expect(result.events.filter((event) => event.t === 'job:done')).toHaveLength(1)
  })

  test('CC-04.12: a stalled consumer pauses decode at 30 buffered chunks', async ({ page }) => {
    const result = (await page.evaluate(async (url) => {
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeStalled(url: string): Promise<unknown> } }).__zipscribeMediaHarness
      return harness.decodeStalled(url)
    }, 'fixtures/audio/fmt-30s.m4a')) as {
      fast: unknown[]
      stalledAt: { pendingPorts: number; chunks: number } | null
      limit: number
      live: number
    }
    expect(result.limit, 'queue bound is 30 chunks per port').toBe(30)
    expect(result.stalledAt, 'decode reports the stalled port (does not finish buffering 30 s)').not.toBeNull()
    expect(result.stalledAt!.chunks).toBeLessThanOrEqual(31)
    expect(result.stalledAt!.pendingPorts).toBe(1)
    expect(result.fast.length, 'the fast consumer never runs away past the bound').toBeLessThanOrEqual(31)
    expect(result.live, 'cancel after the stall leaves zero decoders').toBe(0)
  })
})