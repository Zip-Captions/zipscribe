// ADVERSARY (unit-204, category: denylist bypass attempts) — FR-204.2:
// "`navigateFallback: '/index.html'`, denylist `/wasm/`, `/assets/` (assets
// fail loudly instead of returning HTML)". A shell return on an /assets/ or
// /wasm/ navigate-mode miss is the exact corruption this denylist exists to
// prevent (a hashed chunk silently served as HTML poisons the worker /
// mediabunny loader in the hardest-to-debug way).
//
// Two probes isolate the SERVICE WORKER (the component FR-204.2 constrains):
//   1. ONLINE: the miss must not be answered from the SW —
//      `response.fromServiceWorker()` must be false on a denylisted path
//      (any HTML the environment still answers then comes from the static
//      server, not from the unit's Workbox configuration).
//   2. OFFLINE (the decisive leg — vite-pwa doctrine for excluded routes:
//      "requesting a page on navigateFallbackDenylist you will get `No
//      internet connection`", https://vite-pwa-org.netlify.app/workbox/generate-sw):
//      with the network off, a denylisted navigation must FAIL — the cached
//      shell appearing there is the violation. A control offline navigation
//      to '/' proves offline mode really engaged before reading the verdict.
import { expect, test } from '@playwright/test'
import { CHILD, CHILD_REASON, PREVIEW_BASE, warmShell } from './helpers/pwa-harness'

const DENIED = ['/assets/no-such-chunk-adversarial.js', '/assets/no-such-chunk-adversarial.js?v=7&import=1', '/wasm/ort-wasm-simd-threaded.adversarial.wasm']

test.describe('FR-204.2 (adversary): navigate-mode denylist — /assets/ and /wasm/ never served by the SW (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test('online: the SW never answers a denylisted navigate-mode miss (fromServiceWorker false)', async ({ page }) => {
    test.setTimeout(120_000)
    await warmShell(page)
    for (const path of DENIED) {
      const response = await page.goto(`${PREVIEW_BASE}${path}`)
      expect(response, `${path} reached the network layer`).not.toBeNull()
      const body = await response!.text()
      const servedBySw = response!.fromServiceWorker()
      expect(servedBySw, `FR-204.2: the generated SW must not answer the denylisted path ${path} — the shell came back fromServiceWorker`).toBe(false)
      // Whatever the static server says, the SW did not turn the miss into
      // its precached shell. (The shell HTML would also carry the doctype —
      // assert that only for SW-origin responses to stay honest about which
      // component this criterion binds.)
      void body
    }
  })

  test('offline: a denylisted navigation FAILS LOUDLY — the cached shell is never returned (FR-204.2 "fail loudly")', async ({ page, context }) => {
    test.setTimeout(180_000)
    await warmShell(page)
    await context.setOffline(true)
    // Control first: offline '/' must still boot the app from the SW cache —
    // if this fails, the offline mode itself did not engage and the verdicts
    // below would be meaningless.
    const control = await page.goto(`${PREVIEW_BASE}/`)
    expect(control?.status(), 'offline shell still loads (control for the denylist verdicts)').toBe(200)
    expect(control?.fromServiceWorker(), 'the control answer comes from the SW cache').toBe(true)
    await expect(page.getByTestId('workbench-shell')).toBeVisible({ timeout: 20_000 })

    for (const path of DENIED) {
      const outcome = await page.goto(`${PREVIEW_BASE}${path}`, { waitUntil: 'domcontentloaded' }).then((response) => (response === null ? 'null-response' : `status-${response.status()} sw:${response.fromServiceWorker()}`)).catch(() => 'network-error')
      expect(outcome, `FR-204.2: offline navigation to the denylisted ${path} must NOT serve the app shell — expected a network failure, got ${outcome}`).toMatch(/network-error|null-response/)
    }
    await context.setOffline(false)
  })
})
