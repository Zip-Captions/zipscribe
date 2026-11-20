// CC-302.2 (L5, webkit = view/export tier): honest gating when the browser
// cannot translate. No built-in Translator on WebKit → the Languages section
// shows the gating copy, every machine-translation control is disabled, and the
// two escape hatches (import a translation file, add an empty manual track)
// still work. Runs under E2E_WEBKIT=1 (the webkit project is skipped by
// default, FR-1.0.4) — same doctrine as e2e/export/webkit-export.spec.ts.
import { expect, test } from '@playwright/test'
import { openExportProject, SIDECAR_ASSET, SIDECAR_BLOCKS, SIDECAR_NAME, SIDECAR_SPEAKERS } from '../export/helpers/export-harness'

const RUN_SRC = '/fixtures/audio/speech-2min.m4a'
const CAPTION_FILE = 'fixtures/captions/simple.srt'

test.describe('CC-302.2: unsupported-browser gating (webkit)', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'webkit gating tier — run under E2E_WEBKIT=1')
  test.setTimeout(120_000)

  async function seed(page: import('@playwright/test').Page): Promise<void> {
    await openExportProject(page, {
      asset: SIDECAR_ASSET,
      src: RUN_SRC,
      blocks: SIDECAR_BLOCKS,
      speakers: SIDECAR_SPEAKERS,
      name: SIDECAR_NAME,
      language: 'en',
    })
  }

  test('CC-302.2: gating copy shows and no machine-translation command is enabled', async ({ page }) => {
    await seed(page)
    await expect(page.getByTestId('languages-gating')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('languages-gating')).toContainText('On-device translation needs Chrome or Edge on desktop.')
    // The only machine-translation entry point is disabled on an unsupported browser.
    await expect(page.getByTestId('languages-add')).toBeDisabled()
    await expect(page.getByTestId('languages-picker-item')).toHaveCount(0)
  })

  test('CC-302.2: import translation file creates an imported track', async ({ page }) => {
    await seed(page)
    await expect(page.getByTestId('languages-gating')).toBeVisible({ timeout: 20_000 })
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 })
    await page.getByTestId('languages-import').click()
    const chooser = await chooserPromise
    await chooser.setFiles(CAPTION_FILE)
    await expect(page.getByTestId('caption-import-dialog')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('caption-import-use-translation').click()
    await page.getByTestId('caption-import-target-language').fill('es')
    await page.getByTestId('caption-import-confirm').click()
    // The imported track now renders in the Languages list.
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('Spanish') })).toBeVisible({ timeout: 10_000 })
  })

  test('CC-302.2: add empty track (translate manually) creates a manual track', async ({ page }) => {
    await seed(page)
    await expect(page.getByTestId('languages-gating')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('languages-manual').click()
    await expect(page.getByTestId('languages-row')).toHaveCount(1, { timeout: 10_000 })
  })
})
