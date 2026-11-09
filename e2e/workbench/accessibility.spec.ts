// CC-101.5 (L5, chromium): axe scan on the shell (0 critical/serious) +
// keyboard-only region focus on the PRODUCTION build. The axe scan runs in
// Playwright per the device policy (axe-core stays out of jsdom suites); the
// project is seeded through the ziptest bridge so the scan covers the
// populated shell, not only the empty state.
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'

async function seededShell(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean(window.__zipWorkbenchBridge), undefined, { timeout: 20_000 })
  await page.evaluate((asset) => window.__zipWorkbenchBridge?.openProject(asset), MEDIA_ASSET)
  await expect(page.getByTestId('panel-sidebar')).toBeVisible({ timeout: 10_000 })
}

test.describe('CC-101.5: axe clean + keyboard-only region focus', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-101.5: axe reports 0 critical/serious violations on the shell', async ({ page }) => {
    test.setTimeout(120_000)
    // DYNAMIC import: `@axe-core/playwright` is an approved devDep not yet
    // installed — a static import would fail SPEC COLLECTION (even for the
    // gates-scaffold child run, whose tests are all `test.skip`ped below),
    // breaking the existing `pnpm test:e2e` gate. Deferred to the test body:
    // the intended GREENFIELD RED lands here as an unresolved import until the
    // builder installs the package (unit-05 fast-check precedent).
    const { AxeBuilder } = await import('@axe-core/playwright')
    await seededShell(page)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const blocking = results.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    expect(blocking.map((violation) => `${violation.id}: ${violation.description}`), 'intent exit gate pre-figured: 0 critical/serious on shell views').toEqual([])
  })

  test('CC-101.5: Alt+1/2/3 focus the regions keyboard-only on the built app', async ({ page }) => {
    test.setTimeout(90_000)
    await seededShell(page)
    const activeRegion = () => page.evaluate(() => (document.activeElement instanceof Element ? document.activeElement.getAttribute('data-region') : null))
    await page.keyboard.press('Alt+1')
    await expect.poll(activeRegion, { timeout: 5_000, message: 'Alt+1 focuses the sidebar region' }).toBe('sidebar')
    await page.keyboard.press('Alt+2')
    await expect.poll(activeRegion, { timeout: 5_000, message: 'Alt+2 focuses the preview stage' }).toBe('stage')
    await page.keyboard.press('Alt+3')
    await expect.poll(activeRegion, { timeout: 5_000, message: 'Alt+3 focuses the timeline' }).toBe('timeline')
  })
})
