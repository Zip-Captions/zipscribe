// CC-202.3 (L5, chromium half): the capability gating matrix. The dialog must
// offer NO broken-but-offered options at any tier: full controls only when
// both encoders exist and the tier is not T4; an absent control is REPLACED
// by a one-line reason; T4 shows the requirements copy and nothing startable;
// sidecars stay offered at every tier. The webkit half (sidecars only when
// AudioEncoder is absent on the real engine) is webkit-export.spec.ts —
// E2E_WEBKIT=1, reference hardware. (unit-201/106 gates-anchor precedent:
// chromium-creditable e2e for every untagged criterion.)
import { expect, test } from '@playwright/test'
import { REQUIREMENTS_COPY } from '../../src/ui/export/export-model'
import { EXPORT_BLOCKS, TAXI_ASSET, openExportProject } from './helpers/export-harness'

async function openTaxiDialog(page: import('@playwright/test').Page): Promise<void> {
  await openExportProject(page, {
    asset: TAXI_ASSET,
    src: '/fixtures/taxi-en-accented-1.mp4',
    blocks: EXPORT_BLOCKS,
    mediaBytes: { path: '/fixtures/taxi-en-accented-1.mp4', type: 'video/mp4' },
  })
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('export-dialog')).toBeVisible()
}

test.describe('CC-202.3: capability gating matrix (chromium)', () => {
  test.setTimeout(60_000)

  test('CC-202.3: real chromium probe → full controls, no reason/requirements note', async ({ page }) => {
    await openTaxiDialog(page)
    await expect(page.getByTestId('burnin-start')).toBeVisible()
    await expect(page.getByTestId('burnin-resolution')).toBeVisible()
    await expect(page.getByTestId('burnin-fps')).toBeVisible()
    await expect(page.getByTestId('burnin-absent-reason')).toHaveCount(0)
    await expect(page.getByTestId('requirements-copy')).toHaveCount(0)
    // ladders descend from the source (320×180@10): never an upscale option
    await expect(page.getByTestId('burnin-resolution')).toContainText('180p')
    await expect(page.getByTestId('burnin-fps')).toContainText('10')
  })

  test('CC-202.3: AudioEncoder absent → control replaced by its reason', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'AudioEncoder', { value: undefined, configurable: true })
    })
    await openTaxiDialog(page)
    await expect(page.getByTestId('burnin-absent-reason')).toContainText('AudioEncoder')
    await expect(page.getByTestId('burnin-start')).toHaveCount(0)
    await expect(page.getByTestId('requirements-copy')).toHaveCount(0)
    await expect(page.getByTestId('sidecar-save')).toBeVisible()
  })

  test('CC-202.3: both encoders absent → reason names VideoEncoder + AudioEncoder', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'AudioEncoder', { value: undefined, configurable: true })
      Object.defineProperty(window, 'VideoEncoder', { value: undefined, configurable: true })
    })
    await openTaxiDialog(page)
    await expect(page.getByTestId('burnin-absent-reason')).toContainText('VideoEncoder + AudioEncoder')
    await expect(page.getByTestId('burnin-start')).toHaveCount(0)
    await expect(page.getByTestId('sidecar-save')).toBeVisible()
  })

  test('CC-202.3: T4 → requirements copy, no startable control, sidecars still offered', async ({ page }) => {
    await page.addInitScript(() => {
      // T4 view without tripping the boot gate (LOW_DEVICE_MEMORY → the
      // "can't run on this device" screen, not the dialog): hang the
      // adapter request so the capability probe is still pending when the
      // dialog opens — exactly the state dialogCapabilities() answers with
      // the conservative T4 requirements view.
      Object.defineProperty(navigator, 'gpu', {
        value: { requestAdapter: () => new Promise<never>(() => {}) },
        configurable: true,
      })
    })
    await openTaxiDialog(page)
    await expect(page.getByTestId('requirements-copy')).toHaveText(REQUIREMENTS_COPY)
    await expect(page.getByTestId('burnin-start')).toHaveCount(0)
    await expect(page.getByTestId('burnin-absent-reason')).toHaveCount(0)
    await expect(page.getByTestId('sidecar-save')).toBeVisible()
  })
})
