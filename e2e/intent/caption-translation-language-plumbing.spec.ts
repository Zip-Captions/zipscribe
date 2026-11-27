// CC-304.4 (L5, chromium): the #51 language-plumbing journey on the REAL
// built bundle (baseURL 4310, production mode — no test harness of any kind:
// real file-chooser intake of `fixtures/speech-2min.mp4`, real popover clicks,
// the real ASR worker running the tiny model headless on wasm, models served
// from the SHA-256-verified local cache through `routeAsrNetwork` — every
// non-allowlisted origin aborted). The only inject is the sanctioned scripted
// built-in Translator/LanguageDetector via `addInitScript` (the unit-301/302
// seam — Chrome-internal APIs are not the thing under test; their adapter
// contract is unit-tested).
//
// BRIDGE BAN (spec ruling): this file references NO test-harness bridge
// identifiers and imports NOTHING from the UI testing module — the static
// leg below self-parses the file to prove it (forbidden tokens are
// constructed programmatically so the check text itself stays clean) and
// attests every test title lead-cites its criterion via the repo's own
// `citationsOf`.
//
// SECURITY-03: no transcript/caption/translation TEXT crosses an assertion —
// job health is status-bar copy + row/absence counts + the canned badge word
// from design copy; language tags and testids only.
//
// Expected RED (unit-304 pre-implementation): the journey proceeds through
// real intake + real tiny transcription, then the Languages section never
// leaves its empty state — production records no `project.language`, which is
// exactly the #51 gap unit-304's wiring closes.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { citationsOf } from '../../scripts/lib/junit-trust'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { assertModelCachePresent, routeAsrNetwork, type NetworkCounters } from '../asr/helpers/asr'

const PREVIEW_BASE = 'http://127.0.0.1:4310'
const TINY_MODEL_ID = 'whisper-tiny_timestamped@51724429'

function modelCachePresent(): boolean {
  try {
    assertModelCachePresent()
    return true
  } catch {
    return false
  }
}

/** The sanctioned scripted built-ins (unit-301/302 shape): deterministic
 *  `lang:text` transform; codes/numbers never leave the page boundary. */
async function installBuiltInApis(page: import('@playwright/test').Page): Promise<void> {
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

test.describe('CC-304.4: language plumbing is user-reachable on the production bundle (chromium)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-304.4: static self-attestation — this spec is bridge-free and every title lead-cites CC-304.4', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    // Forbidden token built programmatically so THIS file stays token-free.
    const harnessGlobalPrefix = ['__', 'zip'].join('')
    const uiTestingModule = ['src', 'ui', 'testing'].join('/')
    expect(source, 'the journey spec references no test-harness bridge identifiers').not.toContain(harnessGlobalPrefix)
    expect(source, 'the journey spec imports nothing from the UI testing module').not.toContain(uiTestingModule)

    const titles = [...source.matchAll(/\btest\(\s*(['"])([^'"]+)\1/gu)].map((match) => match[2] ?? '')
    expect(titles.length, 'the spec declares its tests').toBeGreaterThanOrEqual(2)
    for (const title of titles) {
      expect(citationsOf(title), `title lead-cites its criterion: ${title.slice(0, 48)}…`).toContain('CC-304.4')
    }
  })

  test('CC-304.4: real intake → Auto-detect tiny transcription records the language — the Languages section becomes user-reachable', async ({ page }) => {
    test.skip(!modelCachePresent(), 'model cache missing — run `pnpm models:fetch` (setup step, never at test time)')
    test.setTimeout(420_000)
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeAsrNetwork(page, PREVIEW_BASE, counters)
    await installBuiltInApis(page)
    await page.goto('/')
    await expect(page.getByTestId('drop-zone'), 'production first-run screen').toBeVisible({ timeout: 20_000 })

    // Real file-chooser intake (the same owner-input contract the unit-109
    // picker spec drives — hidden input INSIDE the labelled button).
    const bytes = readFileSync(join(REPO_ROOT, 'fixtures', 'speech-2min.mp4'))
    await page.getByTestId('media-intake-button').setInputFiles({ name: 'speech-2min.mp4', mimeType: 'video/mp4', buffer: bytes })
    await expect(page.getByTestId('drop-zone'), 'the real probe → createProject path ran').toBeHidden({ timeout: 60_000 })

    await page.getByTestId('tab-subtitles').click()
    const languages = page.locator('section[aria-label=Languages]')
    await expect(languages, 'Languages section renders (Subtitles tab)').toBeVisible({ timeout: 20_000 })
    await expect(languages, 'no source language yet — honest empty state (US-304.1 Given)').toContainText('Transcribe or set a source language', { timeout: 20_000 })
    await expect(page.getByTestId('languages-add'), 'Add language is gated behind a source language').toHaveCount(0)

    // Real popover interaction: choose the tiny model, keep Auto-detect (the
    // user never names a language — the engine must).
    await page.getByTestId('transcribe-button').click()
    await expect(page.getByTestId('transcribe-popover')).toBeVisible({ timeout: 10_000 })
    await page.locator(`[data-testid=transcribe-model-option][data-model-id="${TINY_MODEL_ID}"]`).click()
    await page.getByTestId('transcribe-language-select').selectOption('')
    await page.getByTestId('transcribe-start-button').click()
    const confirm = page.getByTestId('model-download-confirm-button')
    if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) await confirm.click()

    // Real worker, real model bytes from the local cache — job health via
    // status copy + counts only (SECURITY-03).
    await expect(page.getByTestId('status-bar'), 'the tiny job really runs').toContainText('transcribing', { timeout: 30_000 })
    await expect(page.getByTestId('status-bar'), 'the tiny job completes').toContainText(/no model/, { timeout: 300_000 })
    await expect(page.getByTestId('job-error'), 'no coded engine error surfaced').toHaveCount(0)
    await expect(page.locator('[data-testid=transcript-row]'), 'the run produced caption blocks').not.toHaveCount(0, { timeout: 30_000 })
    expect(counters.blocked, 'the run touched no non-allowlisted origin').toEqual([])
    expect(counters.modelHost, 'the model was served through the cache-served model-host route').toBeGreaterThan(0)

    // THE criterion (#51): Auto-detect completion records the language, so
    // the Languages section leaves its empty state without any further user
    // action. Pre-implementation this is the honest RED.
    await expect(languages, 'CC-304.4: an Auto-detect run makes the Languages section reachable').not.toContainText('Transcribe or set a source language', { timeout: 15_000 })
    await expect(page.getByTestId('languages-add'), 'Add language now reachable').toBeVisible({ timeout: 15_000 })

    // And the recorded language really drives translation: Add Spanish, the
    // scripted built-in fills the track (status Complete), and the transcript
    // view cycle shows the canned Machine-translated badge. No translated
    // TEXT is ever asserted (SECURITY-03).
    await page.getByTestId('languages-add').click()
    await expect(page.getByTestId('languages-status')).toHaveCount(0)
    const esItem = page.locator('[data-testid=languages-picker-item][data-language=es]')
    await expect(esItem, 'the picker lists Spanish').toBeVisible({ timeout: 10_000 })
    await esItem.getByTestId('languages-picker-add').click()
    const esRow = page.locator('[data-testid=languages-row][data-language=es]')
    await expect(esRow, 'the Spanish track appears').toBeVisible({ timeout: 30_000 })
    await expect(esRow.getByTestId('languages-status'), 'the scripted run completed the track').toHaveText('Complete', { timeout: 120_000 })

    await page.keyboard.press('ControlOrMeta+Shift+L')
    await expect(page.getByTestId('transcript-translation-badge').first(), 'the view cycle surfaces the translated track (canned copy — SECURITY-03)').toBeVisible({ timeout: 15_000 })
  })
})
