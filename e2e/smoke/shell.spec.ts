// CC-01.5: Playwright smoke passes on chromium.
//
// Contract: FR-1.0.8 — "Empty workbench shell route (`/` renders header bar +
// empty panels from `ui/shell`) with one Playwright smoke test asserting
// render"; FR-1.0.4 — "chromium project configured; webkit project present but
// `test.skip` by default (enabled per-unit)".
import { expect, test } from '@playwright/test'

test('CC-01.5: the workbench shell renders header bar and empty panels', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('header')).toBeVisible()
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('main').getByRole('region').first()).toBeVisible()
})