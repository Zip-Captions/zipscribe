// CC-101.2 (L5, chromium): first-run drop zone on the production build —
// dropping fixture media creates the workbench; the "Try a sample clip"
// action requests the app-served `/samples/speech-2min.mp4` (the builder
// copies fixtures/speech-2min.mp4 into public/samples/ at BUILD) and the app
// NEVER fetches from `/fixtures/` — the fixtures tree is test-server
// furniture (spec-routed, e2e/media/helpers/media.ts doctrine), not an app
// asset. Media+captions together renders the import report through the
// unit-07 intake seam (faked via the ziptest bridge until 07 merges).
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { CAPTION_VTT_TEXT, CANNED_IMPORT_RESULT } from '../../tests/unit/workbench/helpers/fake-engine'

async function dropOntoZone(page: import('@playwright/test').Page, files: { name: string; type: string; base64: string }[]): Promise<void> {
  await page.evaluate(async (payload) => {
    const zone = document.querySelector('[data-testid=drop-zone]')
    if (!zone) throw new Error('drop-zone missing — CC-101.2 not built yet')
    const dataTransfer = new DataTransfer()
    for (const file of payload) {
      const binary = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0))
      dataTransfer.items.add(new File([binary], file.name, { type: file.type }))
    }
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  }, files)
}

function fixtureBase64(name: string): string {
  return readFileSync(join(REPO_ROOT, 'fixtures', name)).toString('base64')
}

test.describe('CC-101.2: import drop zone and sample clip', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-101.2: dropping a fixture media file on the first-run drop zone creates the workbench', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await expect(page.getByTestId('drop-zone'), 'centered drop zone is the first-run screen (US-2.0.2)').toBeVisible({ timeout: 10_000 })
    await dropOntoZone(page, [{ name: 'speech-2min.mp4', type: 'video/mp4', base64: fixtureBase64('speech-2min.mp4') }])
    await expect(page.getByTestId('panel-sidebar'), 'probed media creates the project (probe runs on the real media worker)').toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('drop-zone')).toBeHidden()
  })

  test('CC-101.2: the sample-clip action serves /samples/speech-2min.mp4 and the app never fetches /fixtures/', async ({ page }) => {
    test.setTimeout(90_000)
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))
    await page.goto('/')
    await expect(page.getByTestId('drop-zone')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('sample-clip-button').click({ timeout: 5_000 })
    await expect
      .poll(() => requested.some((url) => url.includes('/samples/speech-2min.mp4')), { timeout: 10_000, message: 'sample clip must be requested from the build-copied /samples/ path' })
      .toBe(true)
    expect(requested.some((url) => url.includes('/fixtures/')), 'the fixtures directory is never served to the app').toBe(false)
  })

  test('CC-101.2: media + caption dropped together shows the import report (intake seam) and keeps Transcribe available', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/?ziptest=1')
    await page.waitForFunction(() => Boolean(window.__zipWorkbenchBridge), undefined, { timeout: 20_000 })
    await page.evaluate((result) => window.__zipWorkbenchBridge?.setCaptionImportOverride(result), CANNED_IMPORT_RESULT)
    await dropOntoZone(page, [
      { name: 'speech-2min.mp4', type: 'video/mp4', base64: fixtureBase64('speech-2min.mp4') },
      { name: 'vendor.vtt', type: 'text/vtt', base64: Buffer.from(CAPTION_VTT_TEXT, 'utf8').toString('base64') },
    ])
    const report = page.getByTestId('import-report')
    await expect(report, 'ImportReport surfaces cues/blocks counts + adjustment codes (US-2.0.2)').toBeVisible({ timeout: 20_000 })
    await expect(report).toContainText('42')
    await expect(report).toContainText('OVERLAP_CLAMPED')
    await expect(page.getByTestId('transcribe-button'), 'Transcribe stays available after an imported track').toBeVisible()
  })
})
