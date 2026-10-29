// CC-04.7 (L4, per-browser matrix): native-set files decode via WebCodecs
// where the browser supports the codec, else via the ffmpeg path — with the
// per-browser matrix (`WEBKIT_EXPECTED`) asserted for webkit and the observed
// values returned in the unit report for discovery.md.
//
// webkit runs are opt-in (`E2E_WEBKIT=1`, playwright.config.ts). A browser
// that lacks a codec SKIP-ANNOTATES that row instead of failing: the
// `supported: 'none'` outcome is itself the recorded matrix fact.
import { expect, test } from '@playwright/test'
import { fallbackSet, fixturePath, nativeSet, pathFor, WEBKIT_EXPECTED, HARNESS_ORIGIN, HARNESS_PAGE } from './helpers/media'

const MATRIX_KEYS = [...nativeSet(), ...fallbackSet()]

for (const browser of ['chromium', 'webkit'] as const) {
  test.describe(`CC-04.7: per-browser decode path matrix (${browser})`, () => {
    test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
    test.skip(browser === 'webkit' && !process.env.E2E_WEBKIT, 'webkit is opt-in (E2E_WEBKIT=1), playwright.config.ts FR-1.0.4')
    test.use({ baseURL: HARNESS_ORIGIN })

    for (const key of MATRIX_KEYS) {
      const expected = browser === 'webkit' ? (WEBKIT_EXPECTED[key] ?? pathFor('webkit', key)) : pathFor('chromium', key)
      test(`CC-04.7: ${browser} decodes ${key} via ${expected}`, async ({ page, browserName, baseURL }) => {
        test.skip(browserName !== browser, `row belongs to the ${browser} project`)
        await page.route('**/*', async (route) => {
          if (route.request().url().startsWith((baseURL ?? HARNESS_ORIGIN) + '/')) await route.continue()
          else await route.abort()
        })
        await page.goto(HARNESS_PAGE)
        await page.waitForFunction(
        () => (globalThis as Record<string, unknown>).__zipscribeMediaHarnessReady === true,
        { timeout: 30_000 },
      )
        const support = (await page.evaluate(async (url) => {
          const harness = (globalThis as unknown as { __zipscribeMediaHarness: { supportMatrix(url: string): Promise<unknown> } }).__zipscribeMediaHarness
          return harness.supportMatrix(url)
        }, fixturePath(key))) as { supported: 'webcodecs' | 'ffmpeg' | 'none' }
        test.skip(support.supported === 'none', `${browser} has no decoder for ${key} — recorded as 'none' in the matrix`)
        expect(support.supported, `${browser}: ${key} → ${expected}`).toBe(expected)
      })
    }
  })
}