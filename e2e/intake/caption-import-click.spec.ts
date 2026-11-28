// unit-112 (L5, chromium, production build): the caption-import CLICK path on
// the real built bundle (baseURL 4310 — `pnpm test:e2e` owns the preview) with
// a REAL `<input type=file>` chooser via setInputFiles. NO test-harness bridge
// seam on any intake leg (unit-304 bridge-banned doctrine — the static
// self-attestation below proves it: forbidden tokens are built
// programmatically so this file stays token-free, and every test title
// lead-cites its criterion through the repo's own `citationsOf`).
//
// Criteria: CC-112.1 (multi-select media+caption), CC-112.2 (caption-add
// control survives media load — the #53 step-2 leg is the control-visible
// assertion BEFORE the chooser), CC-112.3 (Subtitles tab after import),
// CC-112.4 (garbage file → human copy + code only secondary, never silent),
// CC-112.5 (Language field shows the DETECTED language and is settable —
// explicit choice wins), CC-112.6 (Languages section shows the source track,
// no false "Transcribe or set a source language" empty state; `es` appears
// after an Add-as-translation import from a file).
//
// CHROMIUM-ONLY: the detection legs script the built-in Translator /
// LanguageDetector APIs (the unit-301/302 sanctioned addInitScript seam — the
// Chrome-internal APIs are not the thing under test; their adapter contract
// is unit-tested). WebKit lacks those APIs; per the unit-112 spec Risk note
// the chromium project is the sanctioned tier for these legs.
//
// SECURITY-03: no fixture transcript/caption prose ever crosses an assertion,
// a log or a console check — counts, timecode SHAPES, format/encoding tokens,
// language tags, codes and testids only. The console-purity legs read the
// fixture prose into memory and assert its ABSENCE without embedding it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { citationsOf } from '../../scripts/lib/junit-trust'
import { REPO_ROOT } from '../../tests/helpers/repo'

const MP4 = join(REPO_ROOT, 'fixtures', 'speech-2min.mp4')
const SRT = join(REPO_ROOT, 'fixtures', 'captions', 'en-clean-ref.srt')
const GARBAGE_TXT = join(REPO_ROOT, 'fixtures', 'captions', 'garbage.txt')
const GARBAGE_BIN = join(REPO_ROOT, 'fixtures', 'captions', 'undecodable.bin')

/** Never-silent rejection codes (frozen intake contract, intake.ts RejectedFile). */
const REJECTION_CODE = /UNSUPPORTED_TYPE|UNSUPPORTED_CAPTION|IMPORT_INVALID/u

function mediaFile(): { name: string; mimeType: string; buffer: Buffer } {
  return { name: 'speech-2min.mp4', mimeType: 'video/mp4', buffer: readFileSync(MP4) }
}
function captionFile(): { name: string; mimeType: string; buffer: Buffer } {
  return { name: 'en-clean-ref.srt', mimeType: 'application/x-subrip', buffer: readFileSync(SRT) }
}

/** Prose lines of a text fixture, read into memory for ABSENCE assertions
 *  only (SECURITY-03 — the strings never enter the test source or an expect
 *  message; only their count and their absence are asserted). */
function proseLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 12 && /[a-zA-Z]{4}/u.test(line))
}

/** The sanctioned scripted built-ins (unit-301/302 shape, reused verbatim
 *  from the unit-304 journey harness): every detection answers `en`. */
async function installBuiltInApis(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = globalThis as unknown as Record<string, unknown>
    const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
    w.Translator = {
      availability: async () => 'available',
      create: async (init: { targetLanguage: string }) => {
        await delay(8)
        const target = init.targetLanguage
        return { translate: async (text: string) => { await delay(20); return `${target}:${text}` }, destroy() { /* scripted */ } }
      },
    }
    w.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({ detect: async (text: string) => [{ detectedLanguage: 'en', confidence: 0.9, text }], destroy() { /* scripted */ } }),
    }
  })
}

interface Guards {
  offOrigin: string[]
  csp: string[]
}

function attachGuards(page: Page): Guards {
  const guards: Guards = { offOrigin: [], csp: [] }
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname
    if (host !== '127.0.0.1' && host !== 'localhost') guards.offOrigin.push(request.url())
  })
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('Content Security Policy') || (text.includes('content-type') && text.includes('Refused to'))) guards.csp.push(text.slice(0, 200))
  })
  return guards
}

async function loadMediaViaFirstRunChooser(page: Page): Promise<void> {
  await expect(page.getByTestId('drop-zone'), 'production first-run screen').toBeVisible({ timeout: 20_000 })
  await page.getByTestId('media-intake-button').setInputFiles(mediaFile())
  await expect(page.getByTestId('drop-zone'), 'the real probe → createProject path ran').toBeHidden({ timeout: 60_000 })
  await expect(page.getByTestId('panel-sidebar')).toBeVisible({ timeout: 20_000 })
}

async function openCaptionDialog(page: Page): Promise<void> {
  await page.getByTestId('tab-media').click()
  await expect(page.getByTestId('media-asset-card'), 'the Media tab asset card is mounted (precondition)').toBeVisible({ timeout: 20_000 })
  const control = page.getByTestId('media-caption-add')
  await expect(control, 'a caption-add affordance survives media load on the Media tab (#53 step-2)').toBeVisible({ timeout: 20_000 })
  await expect(control.locator('input[type=file][multiple]'), 'the affordance owns its hidden multiple input (MediaIntakeButton containment contract)').toHaveCount(1)
  await control.setInputFiles(captionFile())
  await expect(page.getByTestId('caption-import-dialog'), 'the click path opens the SAME dialog as drag-and-drop').toBeVisible({ timeout: 20_000 })
}

async function garbageRejectionLeg(page: Page, path: string, name: string, mimeType: string): Promise<void> {
  const consoleTexts: string[] = []
  page.on('console', (msg) => consoleTexts.push(msg.text()))

  await page.goto('/')
  await expect(page.getByTestId('drop-zone')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('media-intake-button').setInputFiles([mediaFile(), { name, mimeType, buffer: readFileSync(path) }])

  await expect(page.getByTestId('drop-zone'), 'the rejection never takes the sibling media down (IN.2)').toBeHidden({ timeout: 60_000 })
  const toast = page.getByTestId('toast')
  await expect(toast, 'the rejection is announced — never silent (CC-101.2 doctrine)').toBeVisible({ timeout: 20_000 })
  await expect(toast, 'it is an alert for assistive tech').toHaveAttribute('role', 'alert')

  const primary = toast.getByTestId('toast-primary')
  await expect(primary, 'the toast carries a human-worded primary line (#65 acceptance shape)').toBeVisible({ timeout: 10_000 })
  const primaryText = (await primary.textContent()) ?? ''
  expect(primaryText.trim().length, 'the primary line is real copy, not a bare token').toBeGreaterThan(10)
  expect(REJECTION_CODE.test(primaryText), 'the CODE is not in the primary line').toBe(false)

  const detail = toast.getByTestId('toast-detail')
  await expect(detail, 'the secondary detail line carries the frozen reason CODE').toBeVisible({ timeout: 10_000 })
  await expect(detail, 'a frozen never-silent code is shown (intake contract)').toContainText(REJECTION_CODE)

  await expect(page.locator('[data-testid=transcript-row]'), 'the garbage file imported NOTHING').toHaveCount(0)

  for (const line of proseLines(path)) {
    expect(consoleTexts.some((text) => text.includes(line)), 'file content never reaches the console (SECURITY-03)').toBe(false)
  }
}

test.describe('unit-112: caption import by click + import language (chromium, production bundle)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-112.1, CC-112.2, CC-112.3, CC-112.4, CC-112.5, CC-112.6, CC-112.7: static self-attestation — this spec is bridge-free and every title lead-cites its criterion', () => {
    const source = readFileSync(new URL(import.meta.url), 'utf8')
    // Forbidden tokens built programmatically so THIS file stays token-free.
    const harnessGlobalPrefix = ['__', 'zip'].join('')
    const uiTestingModule = ['src', 'ui', 'testing'].join('/')
    expect(source, 'the click-path spec references no test-harness bridge identifiers').not.toContain(harnessGlobalPrefix)
    expect(source, 'the click-path spec imports nothing from the UI testing module').not.toContain(uiTestingModule)

    const titles = [...source.matchAll(/\btest\(\s*(['"])([^'"]+)\1/gu)].map((match) => match[2] ?? '')
    expect(titles.length, 'the spec declares its tests').toBeGreaterThanOrEqual(8)
    for (const title of titles) {
      const cites = citationsOf(title)
      expect(cites.length, `title lead-cites a criterion: ${title.slice(0, 60)}…`).toBeGreaterThan(0)
      for (const cite of cites) expect(cite, `every cited ID belongs to unit-112: ${title.slice(0, 60)}…`).toMatch(/^CC-112\.\d$/u)
    }
  })

  test('CC-112.1: multi-select Choose file… with mp4+srt loads media AND imports the 12-cue caption — no UNSUPPORTED_CAPTION, no silent loss', async ({ page }) => {
    test.setTimeout(180_000)
    const guards = attachGuards(page)
    const consoleTexts: string[] = []
    page.on('console', (msg) => consoleTexts.push(msg.text()))

    await page.goto('/')
    await expect(page.getByTestId('drop-zone'), 'production first-run screen').toBeVisible({ timeout: 20_000 })
    await page.getByTestId('media-intake-button').setInputFiles([mediaFile(), captionFile()])

    await expect(page.getByTestId('drop-zone'), 'the media leg of the multi-select loaded').toBeHidden({ timeout: 60_000 })
    await expect(page.getByTestId('panel-sidebar')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('toast'), 'the caption was NOT rejected (no UNSUPPORTED_CAPTION)').toHaveCount(0, { timeout: 15_000 })

    const report = page.getByTestId('import-report')
    await expect(report, 'the intake caption import reports through the CC-101.2 banner').toBeVisible({ timeout: 20_000 })
    await expect(report, '12 cues + 12 blocks (numbers only — SECURITY-03)').toContainText('12 cues')
    await expect(report, 'format is the content-sniff truth').toContainText('srt')

    const rows = page.locator('[data-testid=transcript-row]')
    await expect(rows, 'the 12-cue caption is visible as 12 rows on the Subtitles tab').toHaveCount(12, { timeout: 20_000 })
    const firstTimecode = (await rows.first().locator('[data-testid=transcript-row-timecode]').textContent()) ?? ''
    expect(firstTimecode, 'the first row carries a real timecode (non-vacuity)').toMatch(/^\d{2}:\d{2}\.\d$/u)
    const timecodes = await rows.locator('[data-testid=transcript-row-timecode]').allTextContents()
    expect(new Set(timecodes).size, '12 DISTINCT timecodes — the rows are not vacuous clones').toBe(12)
    expect(await page.getByTestId('tab-subtitles').getAttribute('aria-selected'), 'rows are on the Subtitles tab').toBe('true')

    expect(guards.offOrigin, 'no off-origin request was made').toEqual([])
    expect(guards.csp, 'no CSP violation on the built output').toEqual([])
    for (const line of proseLines(SRT)) {
      expect(consoleTexts.some((text) => text.includes(line)), 'caption prose never reaches the console (SECURITY-03)').toBe(false)
    }
  })

  test('CC-112.2: the caption-add control is still there after media loads; picking the .srt opens the import dialog and lands 12 rows', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/')
    await loadMediaViaFirstRunChooser(page)

    await openCaptionDialog(page)
    await expect(page.getByTestId('caption-import-report-format')).toHaveText('srt')
    await expect(page.getByTestId('caption-import-report-cues')).toHaveText('12')
    await expect(page.getByTestId('caption-import-report-blocks')).toHaveText('12')

    await page.getByTestId('caption-import-confirm').click()
    await expect(page.getByTestId('caption-import-dialog')).toBeHidden({ timeout: 15_000 })
    await page.getByTestId('tab-subtitles').click()
    await expect(page.locator('[data-testid=transcript-row][data-block-id=blk-1]'), 'the port-normalized first row').toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid=transcript-row][data-block-id=blk-12]'), 'the port-normalized twelfth row').toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid=transcript-row]'), 'exactly 12 rows').toHaveCount(12)
  })

  test('CC-112.3: after a successful click-path import the sidebar lands on the Subtitles tab (imported rows visible)', async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto('/')
    await loadMediaViaFirstRunChooser(page)

    await openCaptionDialog(page)
    await expect(page.getByTestId('tab-media').first(), 'precondition: the user is on the Media tab when importing').toBeVisible()
    await page.getByTestId('caption-import-confirm').click()
    await expect(page.getByTestId('caption-import-dialog')).toBeHidden({ timeout: 15_000 })

    await expect(page.getByTestId('tab-subtitles'), 'the sidebar lands on Subtitles after a successful import (#53)').toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
    await expect(page.getByTestId('panel-sidebar').locator('[data-testid=transcript-row]').first(), 'the imported rows are visible without any further click').toBeVisible({ timeout: 15_000 })
  })

  test('CC-112.4: a prose text file on the click path is rejected with human copy and the code only in a secondary detail line — never silent', async ({ page }) => {
    test.setTimeout(180_000)
    await garbageRejectionLeg(page, GARBAGE_TXT, 'garbage.txt', 'text/plain')
  })

  test('CC-112.4: undecodable bytes on the click path get the same never-silent human rejection', async ({ page }) => {
    test.setTimeout(180_000)
    await garbageRejectionLeg(page, GARBAGE_BIN, 'undecodable.bin', 'application/octet-stream')
  })

  test('CC-112.5: the Import dialog shows the DETECTED language for the en fixture and the field is not permanently disabled', async ({ page }) => {
    test.setTimeout(180_000)
    await installBuiltInApis(page)
    await page.goto('/')
    await loadMediaViaFirstRunChooser(page)
    await openCaptionDialog(page)

    const field = page.getByTestId('caption-import-language')
    await expect(field, 'the Language field is settable — not permanently disabled (US-07.2 / #54)').toBeEnabled({ timeout: 15_000 })
    await expect(field, 'the detected language is VISIBLE (scripted detector answers en for the English fixture)').toHaveValue('en', { timeout: 15_000 })
  })

  test('CC-112.5: an explicitly typed language wins over detection at confirm (project language follows the user)', async ({ page }) => {
    test.setTimeout(180_000)
    await installBuiltInApis(page)
    await page.goto('/')
    await loadMediaViaFirstRunChooser(page)
    await openCaptionDialog(page)

    const field = page.getByTestId('caption-import-language')
    await expect(field, 'precondition: the field is settable (the #54 gap)').toBeEnabled({ timeout: 15_000 })
    await expect(field, 'precondition: detection pre-filled the field').toHaveValue('en', { timeout: 15_000 })
    await field.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('fr')
    await expect(field, 'the user edit sticks (explicit choice)').toHaveValue('fr')

    await page.getByTestId('caption-import-confirm').click()
    await expect(page.getByTestId('caption-import-dialog')).toBeHidden({ timeout: 15_000 })

    const languages = page.locator('section[aria-label=Languages]')
    await expect(languages).toBeVisible({ timeout: 15_000 })
    await expect(languages.getByTestId('languages-source'), 'the TYPED language persisted — explicit choice beats detection (US-301.4 doctrine)').toHaveAttribute('data-language', 'fr', { timeout: 15_000 })
  })

  test('CC-112.6: after a click-path import the Languages section shows the source language — not the transcribe-only empty state', async ({ page }) => {
    test.setTimeout(180_000)
    await installBuiltInApis(page)
    await page.goto('/')
    await loadMediaViaFirstRunChooser(page)
    await openCaptionDialog(page)
    await page.getByTestId('caption-import-confirm').click()
    await expect(page.getByTestId('caption-import-dialog')).toBeHidden({ timeout: 15_000 })

    const languages = page.locator('section[aria-label=Languages]')
    await expect(languages, 'the Languages section is mounted on the Subtitles tab').toBeVisible({ timeout: 15_000 })
    await expect(languages, 'the section no longer contradicts the project (no false empty state, #54)').not.toContainText('Transcribe or set a source language', { timeout: 15_000 })
    await expect(languages.getByTestId('languages-source'), 'the source track (detected en) renders as a language').toHaveAttribute('data-language', 'en', { timeout: 15_000 })
    await expect(page.getByTestId('languages-add'), 'the Add-language affordance is reachable').toBeVisible({ timeout: 15_000 })
  })

  test('CC-112.6: an Add-as-translation import from a file lists the es track in the Languages section (the #54 probe shape)', async ({ page }) => {
    test.setTimeout(240_000)
    await installBuiltInApis(page)
    await page.goto('/')
    await loadMediaViaFirstRunChooser(page)

    // Step 1 — the source import (12 rows), same dialog.
    await openCaptionDialog(page)
    await page.getByTestId('caption-import-confirm').click()
    await expect(page.getByTestId('caption-import-dialog')).toBeHidden({ timeout: 15_000 })

    // Step 2 — same file again, Add as translation, target `es`
    // (mirrors the #54 puppeteer probe: target language field + confirm).
    await openCaptionDialog(page)
    await page.getByTestId('caption-import-use-translation').click()
    await page.getByTestId('caption-import-target-language').fill('es')
    await page.getByTestId('caption-import-confirm').click()
    await expect(page.getByTestId('caption-import-dialog'), 'the matched translation import closes cleanly').toBeHidden({ timeout: 15_000 })

    const esRow = page.locator('section[aria-label=Languages] [data-testid=languages-row][data-language=es]')
    await expect(esRow, 'the Languages section lists the imported es track — parity with what the Export dialog already reports (#54)').toBeVisible({ timeout: 15_000 })
  })
})
