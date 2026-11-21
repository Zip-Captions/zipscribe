// CC-302.1 / CC-302.3 (DOM dir) / CC-302.4 (axe) — the translation workspace on
// the PRODUCTION build (baseURL 4310), driven through the sanctioned ziptest
// bridges. The built-in Translator/LanguageDetector are scripted in-page (the
// Chrome-internal APIs are not the thing under test — their adapter contract is
// unit-tested); NOTHING of the session/plan/track/apply path is stubbed, so the
// run really fills rows. SECURITY-03: only protocol objects + numbers cross the
// bridge; scripted translate output is a deterministic `lang:text` transform.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { openExportProject, readGolden, SIDECAR_ASSET, SIDECAR_BLOCKS, SIDECAR_FR, SIDECAR_NAME, SIDECAR_SLUG, SIDECAR_SPEAKERS } from '../export/helpers/export-harness'

const RUN_SRC = '/fixtures/audio/speech-2min.m4a'
const SPEAKERS = [{ id: 'SPK_1', label: 'Speaker 1', color: '#4c8dff' }]
const RUN_BLOCKS = Array.from({ length: 12 }, (_, i) => ({ id: `b${String(i)}`, start: i * 2, end: i * 2 + 1.5, text: `w${String(i)}`, words: [{ text: `w${String(i)}`, start: i * 2, end: i * 2 + 1 }], speakerId: 'SPK_1' }))

// Committed unit-202 Arabic sidecar entries (export-harness mirrors the pure
// serializer golden source; drift breaks the golden compare below).
const AR: Record<string, unknown> = {
  b1: { text: 'مرحبا', status: 'translated', sourceHash: 'h1' },
  b2: { text: 'مرحبا بالعالم & <نص>', status: 'translated', sourceHash: 'h2' },
  b3: { text: 'سطر زمني', status: 'translated', sourceHash: 'h3' },
  b4: { text: 'اقتباس', status: 'translated', sourceHash: 'h4' },
}

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  seedBlocks(blocks: readonly unknown[], speakers: readonly unknown[]): void
  setProjectLanguage(language: string): void
  seedTranslation(language: string, entries: Record<string, unknown>): void
  setView(mode: 'source' | 'translation' | 'split', language?: string): void
  getTranslationEntryCount(language: string): number
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { blockCount: number; viewMode: string; activeLanguage: string | null }
}
interface BridgeProxy {
  openProjectWithMedia(a: unknown, s: string): Promise<void>
  seedBlocks(b: readonly unknown[], sp: readonly unknown[]): Promise<void>
  setProjectLanguage(l: string): Promise<void>
  seedTranslation(l: string, e: Record<string, unknown>): Promise<void>
  setView(m: 'source' | 'translation' | 'split', l?: string): Promise<void>
  getTranslationEntryCount(l: string): Promise<number>
  command(id: string, p?: unknown): Promise<{ code: string } | null>
  getEditorState(): Promise<{ blockCount: number; viewMode: string; activeLanguage: string | null }>
}
const bridge = (page: import('@playwright/test').Page): BridgeProxy => ({
  openProjectWithMedia: (a, s) => page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.openProjectWithMedia(asset, src), [a, s] as const),
  seedBlocks: (blocks, speakers) => page.evaluate(([b, sp]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.seedBlocks(b, sp), [blocks, speakers] as const),
  setProjectLanguage: (l) => page.evaluate((lang) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.setProjectLanguage(lang), l),
  seedTranslation: (l, e) => page.evaluate(([lang, entries]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.seedTranslation(lang, entries), [l, e] as const),
  setView: (m, l) => page.evaluate(([mode, language]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.setView(mode, language), [m, l] as const),
  getTranslationEntryCount: (l) => page.evaluate((lang) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.getTranslationEntryCount(lang), l),
  command: (id, p) => page.evaluate(([commandId, payload]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.command(commandId, payload), [id, p ?? null] as const),
  getEditorState: () => page.evaluate(() => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.getEditorState()),
})

// Install the scripted built-in APIs BEFORE app boot, plus a recorder that
// captures every languages-live announcement (to prove the polite live region
// really announced a percent during the run).
async function boot(page: import('@playwright/test').Page): Promise<void> {
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
    const live: string[] = []
    ;(window as unknown as { __zipLiveAnnouncements: string[] }).__zipLiveAnnouncements = live
    const mo = new MutationObserver(() => {
      const el = document.querySelector('[data-testid="languages-live"]')
      if (el !== null) {
        const t = el.textContent ?? ''
        if (t !== '' && live[live.length - 1] !== t) live.push(t)
      }
    })
    const start = (): void => { mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }) }
    if (document.body !== null) start()
    else document.addEventListener('DOMContentLoaded', start, { once: true })
  })
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: unknown }).__zipEditorBridge), undefined, { timeout: 20_000 })
}

async function openPicker(page: import('@playwright/test').Page): Promise<void> {
  const add = page.getByTestId('languages-add')
  await expect(add).toBeEnabled({ timeout: 20_000 })
  if ((await page.getByTestId('languages-picker-item').count()) === 0) await add.click({ force: true })
}

async function addFromPicker(page: import('@playwright/test').Page, language: string, label: string): Promise<void> {
  const add = page.locator(`[data-testid="languages-picker-item"][data-language="${language}"]`).getByTestId('languages-picker-add')
  // Wait for the availability probe to mark it actionable.
  await expect(add).toBeEnabled({ timeout: 20_000 })
  await add.click({ force: true })
  // If a concurrent re-render ate the click, retry once (the row appearing
  // proves the track was added; the run itself completes independently).
  const row = page.getByTestId('languages-row').filter({ has: page.getByText(label) })
  if ((await row.count()) === 0) {
    await expect(add).toBeEnabled({ timeout: 5_000 })
    await add.click({ force: true })
  }
  await expect(row).toBeVisible({ timeout: 10_000 })
}

async function translationTexts(page: import('@playwright/test').Page): Promise<string[]> {
  return page.$$eval('[data-testid="transcript-translation-text"]', (els) => els.map((el) => el.textContent ?? ''))
}

async function badges(page: import('@playwright/test').Page): Promise<string[]> {
  return page.$$eval('[data-testid="transcript-translation-badge"]', (els) => els.map((el) => el.textContent ?? ''))
}

test.describe('CC-302.1: mocked-API translation workspace (chromium)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.setTimeout(180_000)

  test('CC-302.1: add fr + es → progress → rows fill → edit → stale after source edit → retranslate stale', async ({ page }) => {
    await boot(page)
    await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.openProjectWithMedia(asset, src), [SIDECAR_ASSET, RUN_SRC] as const)
    await page.evaluate(([blocks, speakers]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.seedBlocks(blocks, speakers), [RUN_BLOCKS, SPEAKERS] as const)
    await page.evaluate(() => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.setProjectLanguage('en'))
    await expect.poll(() => bridge(page).getEditorState().then((s) => s.blockCount), { timeout: 30_000 }).toBe(RUN_BLOCKS.length)

    await openPicker(page)
    await addFromPicker(page, 'fr', 'French')
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('French') }).getByTestId('languages-status')).toHaveText('Complete', { timeout: 30_000 })
    await openPicker(page)
    await addFromPicker(page, 'es', 'Spanish')
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('Spanish') }).getByTestId('languages-status')).toHaveText('Complete', { timeout: 30_000 })

    // The polite live region really announced a percentage at some point.
    const announcements = await page.evaluate(() => (window as unknown as { __zipLiveAnnouncements: string[] }).__zipLiveAnnouncements)
    expect(announcements.some((a) => /%/.test(a)), `live region announced percent (saw: ${announcements.join(' | ')})`).toBe(true)

    // Rows fill in the active language (deterministic scripted `fr:` mapping).
    // All 12 entries land (asserted through state — the virtualized transcript
    // only renders the visible slice), and the visible rows carry that text.
    await expect.poll(() => bridge(page).getTranslationEntryCount('fr'), { timeout: 15_000 }).toBe(RUN_BLOCKS.length)
    await expect.poll(() => bridge(page).getTranslationEntryCount('es'), { timeout: 15_000 }).toBe(RUN_BLOCKS.length)
    await bridge(page).setView('translation', 'fr')
    const frTexts = await translationTexts(page)
    expect(frTexts.length, 'visible translation rows render').toBeGreaterThan(0)
    expect(frTexts.every((t) => /^fr:w\d+$/.test(t)), `visible fr rows filled (sample: ${frTexts[0] ?? 'none'})`).toBe(true)

    // Edit one → Edited badge.
    expect(await bridge(page).command('translation-edit-entry', { language: 'fr', blockId: 'b0', text: 'fr:edited' })).toBeNull()
    await expect.poll(() => badges(page), { timeout: 10_000 }).toContain('Edited')

    // Edit a source block → that entry flips to Stale.
    expect(await bridge(page).command('block-edit-text', { blockId: 'b5', text: 'w5 CHANGED' })).toBeNull()
    await expect.poll(() => badges(page), { timeout: 10_000 }).toContain('Stale')

    // Retranslate stale → only the stale entry changes, and it is no longer stale.
    await page.getByTestId('languages-row').filter({ has: page.getByText('French') }).getByTestId('languages-retranslate-stale').click()
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('French') }).getByTestId('languages-status')).toHaveText('Complete', { timeout: 25_000 })
    await expect.poll(() => translationTexts(page).then((t) => t[5]), { timeout: 15_000 }).toBe('fr:w5 CHANGED')
    const after = await badges(page)
    expect(after.includes('Stale'), 'no stale rows remain').toBe(false)
  })

  test('CC-302.1: export all languages writes one byte-exact sidecar per track', async ({ page }) => {
    await openExportProject(page, {
      asset: SIDECAR_ASSET,
      src: RUN_SRC,
      blocks: SIDECAR_BLOCKS,
      speakers: SIDECAR_SPEAKERS,
      name: SIDECAR_NAME,
      language: 'en',
      translations: { fr: SIDECAR_FR, ar: AR },
    })
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()
    await page.getByTestId('sidecar-format-srt').click()
    await page.getByTestId('sidecar-speaker-labels').selectOption('off')

    const downloads: { name: string; body: string }[] = []
    page.on('download', (download) => {
      void download.path().then((p) => {
        if (p !== null) downloads.push({ name: download.suggestedFilename(), body: readFileSync(p, 'utf8') })
      })
    })
    await page.getByTestId('sidecar-all').click()
    await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(3)

    const byName = Object.fromEntries(downloads.map((d) => [d.name, d.body]))
    expect(byName[`${SIDECAR_SLUG}.srt`], 'source track bytes').toBe(readGolden('srt-source-off.srt'))
    expect(byName[`${SIDECAR_SLUG}.fr.srt`], 'fr track bytes').toBe(readGolden('srt-fr-off.srt'))
    expect(byName[`${SIDECAR_SLUG}.ar.srt`], 'ar track bytes').toBe(readGolden('srt-ar-off.srt'))
  })
})

test.describe('CC-302.3 + CC-302.4: RTL DOM direction and axe (chromium)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.setTimeout(180_000)

  test('CC-302.3: an Arabic track renders RTL (DOM dir/lang) in the transcript', async ({ page }) => {
    await boot(page)
    await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.openProjectWithMedia(asset, src), [SIDECAR_ASSET, RUN_SRC] as const)
    await page.evaluate(([blocks, speakers]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.seedBlocks(blocks, speakers), [SIDECAR_BLOCKS, SPEAKERS] as const)
    await page.evaluate(() => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.setProjectLanguage('en'))
    await page.evaluate(([entries]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.seedTranslation('ar', entries), [AR] as const)
    await bridge(page).setView('split', 'ar')
    const nodes = await page.locator('[data-testid="transcript-translation-text"]').all()
    expect(nodes.length, 'arabic rows render').toBeGreaterThan(0)
    for (const node of nodes) {
      await expect(node).toHaveAttribute('dir', 'rtl')
      await expect(node).toHaveAttribute('lang', 'ar')
    }
  })

  test('CC-302.4: axe reports 0 critical violations on the Languages section and side-by-side view', async ({ page }) => {
    const { AxeBuilder } = await import('@axe-core/playwright')
    await openExportProject(page, {
      asset: SIDECAR_ASSET,
      src: RUN_SRC,
      blocks: SIDECAR_BLOCKS,
      speakers: SIDECAR_SPEAKERS,
      name: SIDECAR_NAME,
      language: 'en',
      translations: { fr: SIDECAR_FR, ar: AR },
    })
    await bridge(page).setView('split', 'fr')
    const results = await new AxeBuilder({ page }).include('#tabpanel-subtitles').include('[data-testid="panel-sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const critical = results.violations.filter((v) => v.impact === 'critical')
    expect(critical.map((v) => `${v.id}: ${v.description}`), '0 critical in Languages + side-by-side views').toEqual([])
  })
})

// CC-302.2 on the default runner: Playwright's Chromium build ships without the
// built-in Translator/LanguageDetector too, so honest gating is exercised here
// (the webkit-specific spec in webkit-gating.spec.ts covers the literal webkit
// tier under E2E_WEBKIT=1).
test.describe('CC-302.2: unsupported-browser gating (chromium, no built-in APIs)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.setTimeout(120_000)

  async function seed(page: import('@playwright/test').Page): Promise<void> {
    // Chromium ships a (non-functional here) built-in Translator, so honestly
    // emulate an unsupported browser by removing the APIs the adapter probes.
    await page.addInitScript(() => {
      const w = globalThis as unknown as Record<string, unknown>
      delete w.Translator
      delete w.LanguageDetector
    })
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
    await expect(page.getByTestId('languages-add')).toBeDisabled()
    await expect(page.getByTestId('languages-picker-item')).toHaveCount(0)
  })

  test('CC-302.2: import translation file creates an imported track', async ({ page }) => {
    await seed(page)
    await expect(page.getByTestId('languages-gating')).toBeVisible({ timeout: 20_000 })
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 })
    await page.getByTestId('languages-import').click()
    const chooser = await chooserPromise
    await chooser.setFiles('fixtures/captions/simple.srt')
    await expect(page.getByTestId('caption-import-dialog')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('caption-import-use-translation').click()
    await page.getByTestId('caption-import-target-language').fill('es')
    await page.getByTestId('caption-import-confirm').click()
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('Spanish') })).toBeVisible({ timeout: 10_000 })
  })

  test('CC-302.2: add empty track (translate manually) creates a manual track', async ({ page }) => {
    await seed(page)
    await expect(page.getByTestId('languages-gating')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('languages-manual').click()
    await expect(page.getByTestId('languages-row')).toHaveCount(1, { timeout: 10_000 })
  })
})

// CC-302.5 (L5, chromium): the unit's end-to-end gate — one integrated pass
// through the built translation workspace (add language → run fills rows → RTL
// review → inline edit), proving the whole surface is wired in the production
// build (the same flows the unit-302 PR ships and CI exercises).
test.describe('CC-302.5: translation workspace e2e integration (chromium)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.setTimeout(180_000)

  test('CC-302.5: add language → rows fill → RTL review → inline edit, in the built app', async ({ page }) => {
    await boot(page)
    await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.openProjectWithMedia(asset, src), [SIDECAR_ASSET, RUN_SRC] as const)
    await page.evaluate(([blocks, speakers]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.seedBlocks(blocks, speakers), [RUN_BLOCKS, SPEAKERS] as const)
    await page.evaluate(() => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.setProjectLanguage('en'))
    await expect.poll(() => bridge(page).getEditorState().then((s) => s.blockCount), { timeout: 30_000 }).toBe(RUN_BLOCKS.length)

    // Add language → run fills every entry.
    await openPicker(page)
    await addFromPicker(page, 'fr', 'French')
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('French') }).getByTestId('languages-status')).toHaveText('Complete', { timeout: 30_000 })
    await expect.poll(() => bridge(page).getTranslationEntryCount('fr'), { timeout: 15_000 }).toBe(RUN_BLOCKS.length)

    // RTL review: an Arabic track renders with dir/lang on the active language.
    const arEntries: Record<string, unknown> = {}
    for (let i = 0; i < RUN_BLOCKS.length; i++) arEntries[`b${String(i)}`] = { text: `نص ${String(i)}`, status: 'translated', sourceHash: 'reviewed' }
    await bridge(page).seedTranslation('ar', arEntries)
    await bridge(page).setView('translation', 'ar')
    const arNodes = await page.locator('[data-testid="transcript-translation-text"]').all()
    expect(arNodes.length, 'arabic rows render').toBeGreaterThan(0)
    for (const node of arNodes) {
      await expect(node).toHaveAttribute('dir', 'rtl')
      await expect(node).toHaveAttribute('lang', 'ar')
    }

    // Inline edit: an edited entry surfaces the Edited badge.
    await bridge(page).setView('translation', 'fr')
    expect(await bridge(page).command('translation-edit-entry', { language: 'fr', blockId: 'b0', text: 'fr:edited' })).toBeNull()
    await expect.poll(() => badges(page), { timeout: 10_000 }).toContain('Edited')
  })
})
