// CC-204.6 (L5, chromium): the Offline models panel (US-204.3, design.md §
// Offline & install). Reached from the header ⋯ menu, it lists models with
// per-model "Make available offline" / "Remove", a total storage estimate,
// and "Keep data on this device" wired to navigator.storage.persist() — the
// raw result shown HONESTLY (design.md § Integrity: no fake affordances).
// CC-204.6 binds both halves: mocked storage APIs AND one real Chromium run.
//
// Mocked-storage seam (conventions § Testing strategy — mocks browser APIs,
// never our own modules): the app's OWN test-bridge seams for the estimate
// (persistence bridge setEstimate → deps.estimateStorage, the unit-106
// pattern) plus a navigator.storage.persist spy installed on Navigator
// .prototype via addInitScript for the grant/deny result — so "the flow calls
// persist()" is provable and the rendered yes/no is the honest passthrough.
// The ensure flow downloads through the shared e2e/asr route spy (bytes from
// the LOCAL model cache; tests never touch the network).
import { expect, test } from '@playwright/test'
import { assertModelCachePresent, routeAsrNetwork, type NetworkCounters } from '../asr/helpers/asr'
import { attachSecurityGuards, CHILD, CHILD_REASON, openAppWithBridges, PREVIEW_BASE, warmShell } from './helpers/pwa-harness'

const TINY_ID = 'whisper-tiny' // model spec id `whisper-tiny_timestamped@51724429` (src/engine/model/registry.ts)
const UNCACHEABLE_ID = 'whisper-base' // in the registry; `models:fetch` PROVISIONS its bytes (ci-registry row, review r1 finding 2) so the ensure leg can serve them in CI, but that row is `seeding: false` — the panel never imports it into the browser cache on mount, so it stays uncached here

// addInitScript INVOKES the passed function with the argument (Playwright
// serializes the function source — no outer-closure capture, hence the
// one-argument form). Runs BEFORE app boot. Keeps the real StorageManager,
// overrides ONLY persist(), counting calls (window.__zipPersistCalls).
function installPersistSpy(grant: boolean): void {
  const w = window as unknown as Record<string, unknown>
  w.__zipPersistCalls = 0
  const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'storage')
  const original = descriptor?.get
  Object.defineProperty(Navigator.prototype, 'storage', {
    configurable: true,
    // function (not arrow): `this` must stay the navigator INSTANCE — calling
    // the original getter with this=Navigator.prototype throws (illegal
    // invocation) and would reject the app's persist() instead of spying it.
    get: function () {
      const real = (original?.call(this) ?? {}) as object
      return new Proxy(real, {
        get: (target, prop, receiver) => (prop === 'persist' ? async () => {
          w.__zipPersistCalls = (w.__zipPersistCalls as number) + 1
          return grant
        } : Reflect.get(target, prop, receiver)),
      })
    },
  })
}

async function openPanel(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: '⋯' }).click()
  await page.getByRole('menuitem', { name: /offline models/iu }).click()
}

function modelRow(page: import('@playwright/test').Page, needle: string) {
  return page.locator('li, [role=listitem], [data-testid*=model]').filter({ hasText: needle }).first()
}

test.describe('CC-204.6: Offline models panel — ensure/remove/persist (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test.beforeEach(() => {
    test.skip(!modelCacheReady(), 'model cache missing — run `pnpm models:fetch` (setup step)')
  })

  test('CC-204.6: panel lists models with sizes and a total estimate (mocked storage API)', async ({ page, context }) => {
    test.setTimeout(90_000)
    attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await openAppWithBridges(page)
    // The app's own estimate seam (unit-106 pattern): the panel must render
    // whatever navigator.storage.estimate reports — 12,345,678 B here.
    await page.evaluate(() => (window as unknown as { __zipPersistenceBridge?: { setEstimate(e: { usage: number; quota: number }): void } }).__zipPersistenceBridge?.setEstimate({ usage: 12_345_678, quota: 10_000_000_000 }))
    await openPanel(page)
    await expect(page.getByText(new RegExp(TINY_ID, 'iu')), 'cached models are listed').toBeVisible()
    await expect(page.getByText(new RegExp(UNCACHEABLE_ID, 'iu')), 'registry models are listed even when uncached').toBeVisible()
    await expect(page.locator('body'), 'per-model size / total estimate render as human-readable storage').toContainText(/\d+(\.\d+)?\s?(KB|MB|GB|KiB|MiB|GiB)/iu)
  })

  test('CC-204.6: ensure/remove flows — Make available offline downloads, Remove evicts', async ({ page, context }) => {
    test.setTimeout(180_000)
    const audit = attachSecurityGuards(context, page)
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeAsrNetwork(page, PREVIEW_BASE, counters)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await openAppWithBridges(page)
    await openPanel(page)

    const tinyRow = modelRow(page, TINY_ID)
    const baseRow = modelRow(page, UNCACHEABLE_ID)
    // Seeded state: tiny is in the local model cache → offered "Remove";
    // base is not → offered "Make available offline" (US-204.3).
    await expect(tinyRow.getByRole('button', { name: /remove/iu }), 'cached model offers Remove').toBeVisible({ timeout: 10_000 })
    const ensureButton = baseRow.getByRole('button', { name: /make available offline/iu })
    await expect(ensureButton, 'uncached model offers Make available offline').toBeVisible({ timeout: 10_000 })

    await ensureButton.click()
    await expect(baseRow.getByRole('button', { name: /remove/iu }), 'the model becomes offline-ready (cached) after ensure').toBeVisible({ timeout: 120_000 })
    expect(counters.modelHost, 'ensure fetched through the (cache-served) model-host route').toBeGreaterThan(0)

    await baseRow.getByRole('button', { name: /remove/iu }).click()
    await expect(baseRow.getByRole('button', { name: /make available offline/iu }), 'Remove evicts the model from the cache').toBeVisible({ timeout: 30_000 })
    expect(audit.external, 'the panel touched no non-allowlisted host').toEqual([])
  })

  test('CC-204.6: Keep data on this device shows a granted persist() honestly (mocked storage API)', async ({ page, context }) => {
    test.setTimeout(90_000)
    await context.addInitScript(installPersistSpy, true)
    attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await openAppWithBridges(page)
    await openPanel(page)
    const keep = page.getByRole('button', { name: /keep data on this device/iu })
    await expect(keep, 'US-204.3: the persist affordance exists').toBeVisible()
    await keep.click()
    await expect(page.locator('body'), 'a granted:true persist renders as an honest yes').toContainText(/granted:\s*yes/iu)
    expect(await page.evaluate(() => (window as unknown as { __zipPersistCalls: number }).__zipPersistCalls), 'the flow calls navigator.storage.persist()').toBeGreaterThan(0)
  })

  test('CC-204.6: persist denial renders honestly — never a fake yes (mocked storage API)', async ({ page, context }) => {
    test.setTimeout(90_000)
    await context.addInitScript(installPersistSpy, false)
    attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await openAppWithBridges(page)
    await openPanel(page)
    await page.getByRole('button', { name: /keep data on this device/iu }).click()
    await expect(page.locator('body'), 'design.md: the raw persist() result is shown honestly').toContainText(/granted:\s*no/iu)
    await expect(page.locator('body'), 'a denial must not also claim persistence').not.toContainText(/granted:\s*yes/iu)
  })

  test('CC-204.6: real Chromium run — panel state matches the real navigator.storage.persisted()', async ({ page, context }) => {
    test.setTimeout(90_000)
    attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await openAppWithBridges(page)
    await openPanel(page)
    const keep = page.getByRole('button', { name: /keep data on this device/iu })
    await keep.click() // real user gesture → real persist() (no stubs anywhere)
    const persisted = await page.evaluate(async () => navigator.storage.persisted())
    const body = page.locator('body')
    if (persisted) {
      await expect(body, 'real persist() granted → panel shows yes').toContainText(/granted:\s*yes/iu)
    } else {
      await expect(body, 'real persist() denied → panel shows no, never a fake yes').toContainText(/granted:\s*no/iu)
    }
  })
})

function modelCacheReady(): boolean {
  try {
    assertModelCachePresent()
    return true
  } catch {
    return false
  }
}
