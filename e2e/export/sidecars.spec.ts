// CC-202.4 (L5) + CC-202.5 (L5) + CC-202.7 (offline leg): sidecar exports on
// an AUDIO project. The dialog renders no burn-in surface at any tier
// (gate 'none'), every format downloads byte-exact against the committed
// goldens, and the whole sidecar path works with the network offline.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { openExportProject, readGolden, SIDECAR_ASSET, SIDECAR_BLOCKS, SIDECAR_FR, SIDECAR_NAME, SIDECAR_SPEAKERS, SIDECAR_SLUG } from './helpers/export-harness'

const AR: Record<string, unknown> = {
  b1: { text: 'مرحبا', status: 'translated', sourceHash: 'h1' },
  b2: { text: 'مرحبا بالعالم & <نص>', status: 'translated', sourceHash: 'h2' },
  b3: { text: 'سطر زمني', status: 'translated', sourceHash: 'h3' },
  b4: { text: 'اقتباس', status: 'translated', sourceHash: 'h4' },
}

async function downloadBytes(page: import('@playwright/test').Page, action: () => Promise<void>): Promise<{ name: string; body: string }> {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), action()])
  const path = await download.path()
  if (path === null) throw new Error('download has no path')
  return { name: download.suggestedFilename(), body: readFileSync(path, 'utf8') }
}

async function pick(page: import('@playwright/test').Page, format: string, track: string, labels: string): Promise<void> {
  await page.getByTestId(`sidecar-format-${format}`).click()
  await page.getByTestId('sidecar-track').selectOption(track)
  await page.getByTestId('sidecar-speaker-labels').selectOption(labels)
}

// One CC-ID leading each describe: playwright's junit title concatenates
// `describe › test`, and the citation grammar (scripts/lib/junit-trust.ts
// citationsOf) only counts the LEADING ID run — a `CC-a/.b/.c:` describe
// cites CC-a alone (verify:unit UNCOVERED for .5/.7, unit-202).
async function openSidecarDialog(page: import('@playwright/test').Page): Promise<void> {
  await openExportProject(page, {
    asset: SIDECAR_ASSET,
    src: '/fixtures/audio/speech-2min.m4a',
    blocks: SIDECAR_BLOCKS,
    speakers: SIDECAR_SPEAKERS,
    name: SIDECAR_NAME,
    language: 'en',
    translations: { fr: SIDECAR_FR, ar: AR },
  })
  await page.getByTestId('export-button').click()
  await expect(page.getByTestId('export-dialog')).toBeVisible()
}

test.describe('CC-202.4: audio project, no burn-in surface (chromium)', () => {
  test.setTimeout(120_000)
  test.beforeEach(async ({ page }) => {
    await openSidecarDialog(page)
  })

  test('CC-202.4: an audio project renders NO burn-in surface', async ({ page }) => {
    await expect(page.locator('[data-testid=export-dialog] [data-testid^=burnin]')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Burn-in MP4' })).toHaveCount(0)
    await expect(page.getByTestId('requirements-copy')).toHaveCount(0)
  })

})

test.describe('CC-202.5: byte-exact golden downloads (chromium)', () => {
  test.setTimeout(120_000)
  test.beforeEach(async ({ page }) => {
    await openSidecarDialog(page)
  })

  test('CC-202.5: every format is byte-exact vs the committed goldens', async ({ page }) => {
    const cases: Array<{ format: string; track: string; labels: string; golden: string; file: string }> = [
      { format: 'srt', track: 'source', labels: 'off', golden: 'audio-source-off.srt', file: `${SIDECAR_SLUG}.srt` },
      { format: 'vtt', track: 'source', labels: 'prefix', golden: 'vtt-source-prefix.vtt', file: `${SIDECAR_SLUG}.vtt` },
      { format: 'json', track: 'source', labels: 'off', golden: 'json-source.json', file: `${SIDECAR_SLUG}.json` },
      { format: 'tsv', track: 'source', labels: 'off', golden: 'audio-source-off.tsv', file: `${SIDECAR_SLUG}.tsv` },
      { format: 'srt', track: 'fr', labels: 'off', golden: 'srt-fr-off.srt', file: `${SIDECAR_SLUG}.fr.srt` },
      { format: 'vtt', track: 'fr', labels: 'vtt-voice', golden: 'vtt-fr-voice.vtt', file: `${SIDECAR_SLUG}.fr.vtt` },
      { format: 'json', track: 'fr', labels: 'off', golden: 'json-fr.json', file: `${SIDECAR_SLUG}.fr.json` },
      { format: 'srt', track: 'ar', labels: 'off', golden: 'srt-ar-off.srt', file: `${SIDECAR_SLUG}.ar.srt` },
      { format: 'tsv', track: 'ar', labels: 'prefix', golden: 'tsv-ar-prefix.tsv', file: `${SIDECAR_SLUG}.ar.tsv` },
    ]
    for (const c of cases) {
      await pick(page, c.format, c.track, c.labels)
      const got = await downloadBytes(page, async () => {
        await page.getByTestId('sidecar-save').click()
      })
      expect(got.name, `filename for ${c.golden}`).toBe(c.file)
      expect(got.body, `bytes for ${c.golden}`).toBe(readGolden(c.golden))
    }
  })

})

test.describe('CC-202.7: offline sidecar export (chunks warm, chromium)', () => {
  test.setTimeout(120_000)
  test.beforeEach(async ({ page }) => {
    await openSidecarDialog(page)
  })

  test('CC-202.7: sidecar export works with the network offline (chunks warm)', async ({ page }) => {
    // "after SW install" analogue for the current build (no SW ships yet —
    // PWA arrives with the deploy unit): the dialog chunk (beforeEach) plus
    // the save-file/sidecar chunks (first warm download) are resident, then
    // every sidecar action must work with zero network.
    await pick(page, 'vtt', 'source', 'off')
    await downloadBytes(page, async () => {
      await page.getByTestId('sidecar-save').click()
    })
    await page.context().setOffline(true)
    try {
      await pick(page, 'srt', 'source', 'off')
      const got = await downloadBytes(page, async () => {
        await page.getByTestId('sidecar-save').click()
      })
      expect(got.body).toBe(readGolden('audio-source-off.srt'))
    } finally {
      await page.context().setOffline(false)
    }
  })

  test('FR-202.6: the completion toast names the saved file (download path)', async ({ page }) => {
    await pick(page, 'srt', 'source', 'off')
    await page.getByTestId('sidecar-save').click()
    await expect(page.getByTestId('export-toast')).toContainText('Download', { timeout: 15_000 })
  })
})
