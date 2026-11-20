// CC-202.3 (L5, webkit = view/export tier): the dialog's burn-in offer must
// match the ENCODER REALITY — no broken-but-offered option. On WebKit builds
// without WebCodecs AudioEncoder (the FR-202.2 case), sidecars only.
// Runs under E2E_WEBKIT=1 (the webkit project is skipped by default, FR-1.0.4).
import { expect, test } from '@playwright/test'
import { openExportProject, TAXI_ASSET, EXPORT_BLOCKS } from './helpers/export-harness'

test.describe('CC-202.3: capability-gated export (webkit)', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'webkit export tier — run under E2E_WEBKIT=1')
  test.setTimeout(120_000)

  test('burn-in controls exist exactly when BOTH encoders do; sidecars always work', async ({ page }) => {
    await openExportProject(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: EXPORT_BLOCKS,
    })
    const encoders = await page.evaluate(() => ({
      video: typeof (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder === 'function',
      audio: typeof (globalThis as unknown as { AudioEncoder?: unknown }).AudioEncoder === 'function',
    }))
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()

    const start = page.getByTestId('burnin-start')
    if (encoders.video && encoders.audio) {
      await expect(start).toBeVisible()
    } else {
      await expect(start).toHaveCount(0)
      // an honest line explains why, in one of the two absent shapes
      const explained = (await page.getByTestId('burnin-absent-reason').count()) + (await page.getByTestId('requirements-copy').count())
      expect(explained).toBe(1)
    }

    // sidecars are offered and work regardless of encoder presence
    await expect(page.getByTestId('sidecar-save')).toBeVisible()
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByTestId('sidecar-save').click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.srt$/)
    await expect(page.getByTestId('export-toast')).toContainText('Download', { timeout: 15_000 })
  })
})
