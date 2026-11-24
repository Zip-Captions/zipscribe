// Intent completion suite — caption-translation (CC-I4.1/.3/.4/.5/.7, L5,
// chromium first-class + one webkit tier; sibling doctrine of
// e2e/intent/caption-studio-ui.spec.ts: the REAL app on the built bundle
// (baseURL 4310), no network, mocked built-in Translator/LanguageDetector via
// the sanctioned addInitScript inject seam (same scripted-API shape the
// unit-302 workspace spec installs — the built-in APIs are Chrome-internal,
// the adapter contract is unit-tested; NOTHING of the session/plan/track/
// apply path is stubbed). SECURITY-03: only counts, lengths, codes and
// synthetic fixture ids cross the page boundary; the `failed` status is
// session-recorded through the real failure path, never seeded.
//
// Byte-equal reload doctrine (FR-303.4): where journey state round-trips
// (translated/failed tracks; edited/stale entries) the persistence bridge
// flushes, `exportProjectFile(id)` is captured, `page.reload()` runs, the
// capture repeats — the two JSON strings must compare byte-equal (mirrors the
// caption-studio-ui.spec.ts header doctrine).
//
// Helper imports: the unit-202/301/302 export machinery (openExportProject,
// readGolden, TAXI/EXPORT/SIDECAR fixtures, ffmpeg scratch helpers) comes from
// ../export/helpers/export-harness — no reimplementation of the golden
// compare or the burn-in sampling. Spec-local glue (boot with the scripted
// APIs, picker flow, badges, snapshot helpers) follows the sibling intent
// doctrine: caption-studio-ui.spec.ts likewise inlines its boot/mockTranscribe/
// snapshot helpers, and helpers living INSIDE other spec files cannot be
// imported without re-registering those specs' tests into this file.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { cleanScratch, EXPORT_BLOCKS, extractFrame, mediaInfo, openExportProject, readGolden, SAMPLE_TIMES, scratchPath, SIDECAR_ASSET, SIDECAR_BLOCKS, SIDECAR_FR, SIDECAR_NAME, SIDECAR_SLUG, SIDECAR_SPEAKERS, TAXI_ASSET, TAXI_DURATION } from '../export/helpers/export-harness'

// — scripted built-in APIs (the unit-301/302 inject seam) --------------------
// Deterministic `lang:text` mapping plus an honest failure path: any source
// text containing one of the poison markers makes translate() throw, the
// chrome-translator adapter wraps it as TRANSLATE_FAILED (retryable), and the
// REAL session burns its MAX_ATTEMPTS budget and records the entry `failed`
// with empty text. Only numbers/codes are expected to leave the page.
interface EditorBridgeShape {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  seedBlocks(blocks: readonly unknown[], speakers: readonly unknown[]): void
  setProjectLanguage(language: string): void
  seedTranslation(language: string, entries: Record<string, unknown>): void
  setView(mode: 'source' | 'translation' | 'split', language?: string): void
  getTranslationEntryCount(language: string): number
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { blockCount: number; viewMode: string; activeLanguage: string | null }
}
interface PersistenceBridgeShape {
  saveNow(reason: 'idle' | 'manual' | 'hidden'): Promise<'saved' | 'not-dirty' | 'failed'>
  listProjects(): Promise<Array<{ id: string }>>
  exportProjectFile(id: string): Promise<string | null>
}
interface StyleBridgeShape {
  renderOverlayPng(frame: Record<string, unknown>, dpr?: number): Promise<string>
  ensureDefaultFonts(): Promise<void>
}
interface EntryJson {
  text: string
  status: string
  sourceHash: string
}
interface ProjectJson {
  blocks: Array<{ id: string; text: string }>
  translations?: Array<{ language: string; entries: Record<string, EntryJson> }>
  style?: Record<string, unknown>
}

const RUN_SRC = '/fixtures/audio/speech-2min.m4a'
const SPEAKERS = [{ id: 'SPK_1', label: 'Speaker 1', color: '#4c8dff' }]

// Committed unit-202 Arabic sidecar entries (the export-harness mirrors the
// pure serializer golden source; drift breaks the golden compare below — the
// same verbatim re-declaration pattern as e2e/export/sidecars.spec.ts and
// e2e/translate/workspace.spec.ts).
const AR: Record<string, unknown> = {
  b1: { text: 'مرحبا', status: 'translated', sourceHash: 'h1' },
  b2: { text: 'مرحبا بالعالم & <نص>', status: 'translated', sourceHash: 'h2' },
  b3: { text: 'سطر زمني', status: 'translated', sourceHash: 'h3' },
  b4: { text: 'اقتباس', status: 'translated', sourceHash: 'h4' },
}

const pad3 = (i: number): string => String(i).padStart(3, '0')
const POISON_FR = 'poisonfr'
const POISON_ES = 'poisones'
const T1_COUNT = 200
const T1_FR_FAIL_INDEX = 7
const T1_ES_FAIL_INDEX = 141

function t1Blocks(): Array<Record<string, unknown>> {
  return Array.from({ length: T1_COUNT }, (_, i) => {
    const marker = i === T1_FR_FAIL_INDEX ? ` ${POISON_FR}` : i === T1_ES_FAIL_INDEX ? ` ${POISON_ES}` : ''
    const text = `syn${pad3(i)}qx${marker}`
    return { id: `k${pad3(i)}`, start: i * 0.5, end: i * 0.5 + 0.4, text, words: [{ text, start: i * 0.5, end: i * 0.5 + 0.4 }], speakerId: 'SPK_1' }
  })
}

// T3: 12 blocks; b3 carries TWO words so the source split produces two
// non-empty parts (block-split rejects SPLIT_EMPTY_PART otherwise).
const T3_BLOCKS = Array.from({ length: 12 }, (_, i) =>
  i === 3
    ? { id: 'b3', start: 6, end: 7.5, text: 'w3a w3b', words: [{ text: 'w3a', start: 6, end: 6.7 }, { text: 'w3b', start: 6.7, end: 7.5 }], speakerId: 'SPK_1' }
    : { id: `b${String(i)}`, start: i * 2, end: i * 2 + 1.5, text: `w${String(i)}`, words: [{ text: `w${String(i)}`, start: i * 2, end: i * 2 + 1 }], speakerId: 'SPK_1' },
)

function installScriptedApisScript(poison: ReadonlyArray<readonly [string, string]>): string {
  return `(() => {
  const w = globalThis
  const poison = ${JSON.stringify(poison)}
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  w.__zipFakeStats = { calls: {}, throws: {} }
  w.Translator = {
    availability: async () => 'available',
    create: async (init) => {
      await delay(5)
      const target = init.targetLanguage
      return {
        translate: async (text) => {
          await delay(5)
          w.__zipFakeStats.calls[target] = (w.__zipFakeStats.calls[target] ?? 0) + 1
          for (const [t, marker] of poison) {
            if (t === target && typeof text === 'string' && text.includes(marker)) {
              w.__zipFakeStats.throws[t] = (w.__zipFakeStats.throws[t] ?? 0) + 1
              throw new Error('scripted translate failure')
            }
          }
          return target + ':' + text
        },
        destroy() {},
      }
    },
  }
  w.LanguageDetector = {
    availability: async () => 'available',
    create: async () => ({ detect: async (text) => [{ detectedLanguage: 'en', confidence: 0.9, text }], destroy() {} }),
  }
})()`
}

async function bootWithScriptedTranslator(page: import('@playwright/test').Page, poison: ReadonlyArray<readonly [string, string]>): Promise<void> {
  await page.addInitScript(installScriptedApisScript(poison))
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, unknown>
    return w.__zipEditorBridge !== undefined && w.__zipPersistenceBridge !== undefined
  }, undefined, { timeout: 20_000 })
}

const editorProxy = (page: import('@playwright/test').Page) => ({
  openProjectWithMedia: (a: unknown, s: string) => page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge: EditorBridgeShape }).__zipEditorBridge.openProjectWithMedia(asset, src), [a, s] as const),
  seedBlocks: (blocks: readonly unknown[], speakers: readonly unknown[]) => page.evaluate(([b, sp]) => (window as unknown as { __zipEditorBridge: EditorBridgeShape }).__zipEditorBridge.seedBlocks(b, sp), [blocks, speakers] as const),
  setProjectLanguage: (l: string) => page.evaluate((lang) => (window as unknown as { __zipEditorBridge: EditorBridgeShape }).__zipEditorBridge.setProjectLanguage(lang), l),
  seedTranslation: (l: string, e: Record<string, unknown>) => page.evaluate(([lang, entries]) => (window as unknown as { __zipEditorBridge: EditorBridgeShape }).__zipEditorBridge.seedTranslation(lang, entries), [l, e] as const),
  setView: (m: 'source' | 'translation' | 'split', l?: string) => page.evaluate(([mode, language]) => (window as unknown as { __zipEditorBridge: EditorBridgeShape }).__zipEditorBridge.setView(mode, language ?? undefined), [m, l ?? null] as const),
  getTranslationEntryCount: (l: string) => page.evaluate((lang) => (window as unknown as { __zipEditorBridge: EditorBridgeShape }).__zipEditorBridge.getTranslationEntryCount(lang), l),
  command: (id: string, p?: unknown) => page.evaluate(([commandId, payload]) => (window as unknown as { __zipEditorBridge: EditorBridgeShape }).__zipEditorBridge.command(commandId, payload ?? undefined), [id, p ?? null] as const),
  getEditorState: () => page.evaluate(() => (window as unknown as { __zipEditorBridge: EditorBridgeShape }).__zipEditorBridge.getEditorState()),
})

async function openPicker(page: import('@playwright/test').Page): Promise<void> {
  const add = page.getByTestId('languages-add')
  await expect(add).toBeEnabled({ timeout: 20_000 })
  if ((await page.getByTestId('languages-picker-item').count()) === 0) {
    await add.click({ timeout: 3_000 }).catch(async () => {
      await add.click({ force: true }).catch(() => undefined)
    })
  }
}

async function addFromPicker(page: import('@playwright/test').Page, language: string, label: string): Promise<void> {
  const add = page.locator(`[data-testid="languages-picker-item"][data-language="${language}"]`).getByTestId('languages-picker-add')
  await expect(add).toBeEnabled({ timeout: 20_000 })
  // Real click first (full actionability); if a re-render churn swallows it,
  // retry via the sanctioned force + direct-DOM dispatch (same onClick the
  // user gesture reaches — no synthetic state writes).
  await add.click({ timeout: 3_000 }).catch(async () => {
    await add.click({ force: true }).catch(() => undefined)
  })
  const row = page.getByTestId('languages-row').filter({ has: page.getByText(label) })
  if ((await row.count()) === 0) {
    await expect(add).toBeEnabled({ timeout: 5_000 })
    // Direct DOM dispatch on the SAME button node (React's delegated handler
    // fires exactly as for a user click) — immune to coordinate churn.
    await page.evaluate((lang) => {
      const btn = document.querySelector(`[data-testid="languages-picker-item"][data-language="${lang}"] [data-testid="languages-picker-add"]`) as HTMLButtonElement | null
      btn?.click()
    }, language)
  }
  await expect(row, `languages-row for ${label} appears after picker add (button state: ${JSON.stringify(await page.evaluate((lang) => {
    const btn = document.querySelector(`[data-testid="languages-picker-item"][data-language="${lang}"] [data-testid="languages-picker-add"]`) as HTMLButtonElement | null
    return { present: btn !== null, disabled: btn?.disabled ?? null, offsetParent: btn ? btn.offsetParent !== null : null }
  }, language))})`).toBeVisible({ timeout: 10_000 })
}

async function badges(page: import('@playwright/test').Page): Promise<string[]> {
  return page.$$eval('[data-testid="transcript-translation-badge"]', (els) => els.map((el) => el.textContent ?? ''))
}

async function visibleTranslationRows(page: import('@playwright/test').Page): Promise<Array<{ blockId: string; text: string }>> {
  return page.$$eval('[data-testid="transcript-row"]', (rows) =>
    rows
      .map((row) => ({ blockId: (row as HTMLElement).dataset.blockId ?? '', text: row.querySelector('[data-testid="transcript-translation-text"]')?.textContent ?? null }))
      .filter((r): r is { blockId: string; text: string } => r.text !== null),
  )
}

async function flushAndSnapshot(page: import('@playwright/test').Page): Promise<{ id: string; json: string }> {
  const flushed = await page.evaluate(() => (window as unknown as { __zipPersistenceBridge: PersistenceBridgeShape }).__zipPersistenceBridge.saveNow('manual'))
  expect(['saved', 'not-dirty']).toContain(flushed)
  const id = await page.evaluate(async () => {
    const rows = await (window as unknown as { __zipPersistenceBridge: PersistenceBridgeShape }).__zipPersistenceBridge.listProjects()
    return rows[0]?.id ?? null
  })
  if (id === null) throw new Error('NO_PROJECT_ROW_AFTER_FLUSH')
  const json = await page.evaluate((projectId) => (window as unknown as { __zipPersistenceBridge: PersistenceBridgeShape }).__zipPersistenceBridge.exportProjectFile(projectId), id)
  if (json === null) throw new Error('EXPORT_PROJECT_FILE_NULL')
  return { id, json }
}

async function snapshotAfterReload(page: import('@playwright/test').Page, id: string): Promise<string> {
  await page.reload()
  await page.waitForFunction(() => {
    const w = window as unknown as Record<string, unknown>
    return w.__zipEditorBridge !== undefined && w.__zipPersistenceBridge !== undefined
  }, undefined, { timeout: 20_000 })
  const json = await page.evaluate(async (projectId) => {
    const p = (window as unknown as { __zipPersistenceBridge: PersistenceBridgeShape }).__zipPersistenceBridge
    const rows = await p.listProjects()
    if (!rows.some((row) => row.id === projectId)) throw new Error('PROJECT_ROW_MISSING_AFTER_RELOAD')
    return p.exportProjectFile(projectId)
  }, id)
  if (json === null) throw new Error('EXPORT_PROJECT_FILE_NULL_AFTER_RELOAD')
  return json
}

async function downloadBytes(page: import('@playwright/test').Page, action: () => Promise<void>): Promise<{ name: string; body: string }> {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), action()])
  const path = await download.path()
  if (path === null) throw new Error('download has no path')
  return { name: download.suggestedFilename(), body: readFileSync(path, 'utf8') }
}

// Burn-in pixel evidence WITHOUT a second SSIM engine: binary-diff masks.
// The burned output must differ from the same encode on the source track
// exactly where the shared renderer says the two tracks' overlays differ
// (bottom caption band), proving the worker rendered the TRANSLATED text.
async function bandMaskOverlap(page: import('@playwright/test').Page, urls: { burnA: string; burnB: string; ovlA: string; ovlB: string; ovlAonly: string }, bandTopFrac: number): Promise<{ burnDiffCount: number; ovlDiffCount: number; ovlTextCount: number; iou: number }> {
  return page.evaluate(
    async ([u, bandTop]) => {
      const load = async (url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> => {
        const img = new Image()
        img.src = url
        await img.decode().catch(() => undefined)
        if (img.width === 0 || img.height === 0) return null
        const c = document.createElement('canvas')
        c.width = 320
        c.height = 180
        const cx = c.getContext('2d')
        if (cx === null) return null
        cx.drawImage(img, 0, 0, 320, 180)
        const d = cx.getImageData(0, 0, 320, 180)
        return { data: d.data, w: 320, h: 180 }
      }
      const A = await load(u.burnA)
      const B = await load(u.burnB)
      const OA = await load(u.ovlA)
      const OB = await load(u.ovlB)
      const OOnly = await load(u.ovlAonly)
      if (A === null || B === null || OA === null || OB === null || OOnly === null) return { burnDiffCount: -1, ovlDiffCount: -1, ovlTextCount: -1, iou: -1 }
      const luma = (im: { data: Uint8ClampedArray }, i: number): number => 0.299 * (im.data[i] ?? 0) + 0.587 * (im.data[i + 1] ?? 0) + 0.114 * (im.data[i + 2] ?? 0)
      const yTop = Math.floor(A.h * bandTop)
      let burnDiffCount = 0
      let ovlDiffCount = 0
      let inter = 0
      let union = 0
      let ovlTextCount = 0
      for (let y = yTop; y < A.h; y++) {
        for (let x = 0; x < A.w; x++) {
          const i = (y * A.w + x) * 4
          const burnDiff = Math.abs(luma(A, i) - luma(B, i)) > 24
          const ovlDiff = Math.abs(luma(OA, i) - luma(OB, i)) > 24
          if (burnDiff) burnDiffCount += 1
          if (ovlDiff) ovlDiffCount += 1
          if (burnDiff || ovlDiff) union += 1
          if (burnDiff && ovlDiff) inter += 1
          if (luma(OOnly, i) > 48) ovlTextCount += 1
        }
      }
      return { burnDiffCount, ovlDiffCount, ovlTextCount, iou: union === 0 ? 0 : inter / union }
    },
    [urls, bandTopFrac] as const,
  )
}

const toDataUrl = (file: string): string => `data:image/png;base64,${readFileSync(file).toString('base64')}`

// — T1 · CC-I4.1 ——————————————————————————————————————————————————————————————

test.describe('CC-I4.1: 200-block en → mocked fr+es run', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')
  test.setTimeout(240_000)

  test('CC-I4.1: 200-block project → mocked Translator fr+es → every block translated-or-failed (honest failed leg per track, never source-as-translation) → both tracks render → reload byte-equal', async ({ page }) => {
    await bootWithScriptedTranslator(page, [['fr', POISON_FR], ['es', POISON_ES]])
    const ed = editorProxy(page)
    await ed.openProjectWithMedia(SIDECAR_ASSET, RUN_SRC)
    await ed.seedBlocks(t1Blocks(), SPEAKERS)
    await ed.setProjectLanguage('en')
    await expect.poll(() => ed.getEditorState().then((s) => s.blockCount), { timeout: 30_000 }).toBe(T1_COUNT)

    await openPicker(page)
    await addFromPicker(page, 'fr', 'French')
    // The run ends PARTIAL on each track: exactly one block crosses the
    // scripted failure path per language (session-recorded `failed`).
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('French') }).getByTestId('languages-status')).toHaveText('Partial', { timeout: 60_000 })
    await openPicker(page)
    await addFromPicker(page, 'es', 'Spanish')
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('Spanish') }).getByTestId('languages-status')).toHaveText('Partial', { timeout: 60_000 })

    await expect.poll(() => ed.getTranslationEntryCount('fr'), { timeout: 30_000 }).toBe(T1_COUNT)
    await expect.poll(() => ed.getTranslationEntryCount('es'), { timeout: 30_000 }).toBe(T1_COUNT)

    const snap = await flushAndSnapshot(page)
    const fakeStats = await page.evaluate(() => (window as unknown as { __zipFakeStats: { calls: Record<string, number>; throws: Record<string, number> } }).__zipFakeStats)
    const project = JSON.parse(snap.json) as ProjectJson
    const sourceById = new Map(project.blocks.map((b) => [b.id, b.text]))
    expect(sourceById.size, 'all 200 source blocks persisted').toBe(T1_COUNT)
    const track = (lang: string): Record<string, EntryJson> => project.translations?.find((t) => t.language === lang)?.entries ?? {}
    for (const lang of ['fr', 'es'] as const) {
      const entries = track(lang)
      const failIndex = lang === 'fr' ? T1_FR_FAIL_INDEX : T1_ES_FAIL_INDEX
      const failedIds: string[] = []
      let translatedCount = 0
      const statusTally: Record<string, number> = {}
      for (const blockId of sourceById.keys()) {
        const entry = entries[blockId]
        statusTally[entry?.status ?? 'missing'] = (statusTally[entry?.status ?? 'missing'] ?? 0) + 1
      }
      for (const blockId of sourceById.keys()) {
        const entry = entries[blockId]
        expect(entry, `${lang} entry exists for ${blockId}`).toBeDefined()
        expect(['translated', 'failed'], `${lang} status for ${blockId} is translated-or-failed`).toContain(entry?.status)
        if (entry?.status === 'failed') {
          failedIds.push(blockId)
          expect(entry?.text, 'failed entries never carry text (no source presented as translation)').toBe('')
          expect(entry?.sourceHash, 'failed entries carry the stale sentinel').toBe('stale')
        } else {
          translatedCount += 1
          const source = sourceById.get(blockId) ?? ''
          expect(entry?.text, `${lang} translated entry is the machine mapping, never the source text`).toBe(`${lang}:${source}`)
          expect(entry?.text === source, 'source text is never presented as a translation').toBe(false)
        }
      }
      expect(translatedCount, `${lang} translated count (tally: ${JSON.stringify(statusTally)}, failedIds: ${JSON.stringify(failedIds)}, fake: ${JSON.stringify(fakeStats)})`).toBe(T1_COUNT - 1)
      expect(failedIds, `${lang} has exactly the poisoned block failed`).toEqual([`k${pad3(failIndex)}`])
    }

    // Both tracks render in the workspace (state-counted fill + visible rows;
    // the virtualized transcript renders the visible slice).
    await ed.setView('translation', 'fr')
    const frRows = await visibleTranslationRows(page)
    expect(frRows.length, 'fr rows render').toBeGreaterThan(0)
    expect(frRows.filter((r) => r.text.startsWith('fr:')).length, 'visible fr rows carry translated text').toBeGreaterThanOrEqual(5)
    expect(frRows.every((r) => r.text === '' || r.text.startsWith('fr:')), 'no visible fr row shows source text').toBe(true)
    await ed.setView('translation', 'es')
    const esRows = await visibleTranslationRows(page)
    expect(esRows.length, 'es rows render').toBeGreaterThan(0)
    expect(esRows.filter((r) => r.text.startsWith('es:')).length, 'visible es rows carry translated text').toBeGreaterThanOrEqual(5)
    expect(esRows.every((r) => r.text === '' || r.text.startsWith('es:')), 'no visible es row shows source text').toBe(true)

    const after = await snapshotAfterReload(page, snap.id)
    expect(after, 'translated+failed state restored byte-equal after reload').toBe(snap.json)
  })
})

// — T3 · CC-I4.3 ——————————————————————————————————————————————————————————————

test.describe('CC-I4.3: edited translation + source split → stale', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')
  test.setTimeout(180_000)

  test('CC-I4.3: edit a translation → edited; split its source block → affected entries stale per invariant 10 → reload byte-equal', async ({ page }) => {
    await bootWithScriptedTranslator(page, [])
    const ed = editorProxy(page)
    await ed.openProjectWithMedia(SIDECAR_ASSET, RUN_SRC)
    await ed.seedBlocks(T3_BLOCKS, SPEAKERS)
    await ed.setProjectLanguage('en')
    await expect.poll(() => ed.getEditorState().then((s) => s.blockCount), { timeout: 30_000 }).toBe(12)

    await openPicker(page)
    await addFromPicker(page, 'fr', 'French')
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('French') }).getByTestId('languages-status')).toHaveText('Complete', { timeout: 30_000 })
    await expect.poll(() => ed.getTranslationEntryCount('fr'), { timeout: 15_000 }).toBe(12)
    await ed.setView('translation', 'fr')

    // Edit the b3 translation → `edited`.
    expect(await ed.command('translation-edit-entry', { language: 'fr', blockId: 'b3', text: 'fr:manually reviewed' })).toBeNull()
    await expect.poll(() => badges(page), { timeout: 10_000 }).toContain('Edited')

    const before = await flushAndSnapshot(page)
    const beforeProject = JSON.parse(before.json) as ProjectJson
    const beforeEntry = beforeProject.translations?.find((t) => t.language === 'fr')?.entries['b3']
    expect(beforeEntry?.status, 'edited entry persisted').toBe('edited')
    const stampedHash = beforeEntry?.sourceHash ?? ''
    expect(stampedHash.length, 'edited entry keeps the hash it was reviewed against').toBeGreaterThan(0)

    // Split the SOURCE block of that translation (two-word b3 → two parts).
    expect(await ed.command('block-split', { blockId: 'b3', at: 6.75 })).toBeNull()
    await expect.poll(() => ed.getEditorState().then((s) => s.blockCount), { timeout: 10_000 }).toBe(13)

    const after = await flushAndSnapshot(page)
    const afterProject = JSON.parse(after.json) as ProjectJson
    const ids = afterProject.blocks.map((b) => b.id)
    const newId = ids.find((id) => !T3_BLOCKS.some((b) => b.id === id)) ?? ''
    expect(newId.length, 'split created exactly one new block id').toBeGreaterThan(0)
    const entries = afterProject.translations?.find((t) => t.language === 'fr')?.entries ?? {}
    // Invariant 10: the entry stays on the FIRST part un-re-stamped (its hash
    // no longer matches the changed part text ⇒ derived stale) ...
    expect(entries['b3'], 'first part keeps the entry').toEqual(beforeEntry)
    // ... and the second part gets an EMPTY stale entry (sentinel hash).
    expect(entries[newId], 'second part gets the empty stale entry').toEqual({ text: '', status: 'translated', sourceHash: 'stale' })
    expect(entries['b2'], 'unaffected entries untouched by the split').toBeDefined()

    // UI derivation: the two affected rows surface Stale (and the previous
    // Edited badge has flipped — staleness outranks it), others do not.
    const afterBadges = await badges(page)
    expect(afterBadges.filter((b) => b === 'Stale').length, 'both split parts read stale').toBeGreaterThanOrEqual(2)
    expect(afterBadges.includes('Edited'), 'the edited entry now reads stale, not edited').toBe(false)
    await expect(page.getByTestId('transcript-mark-reviewed')).toHaveCount(2)

    const reloaded = await snapshotAfterReload(page, after.id)
    expect(reloaded, 'edited+stale state restored byte-equal after reload').toBe(after.json)
  })
})

// — T4 · CC-I4.4 ——————————————————————————————————————————————————————————————

test.describe('CC-I4.4: per-language export + translation burn-in', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')
  test.afterAll(cleanScratch)

  test('CC-I4.4: per-language SRT/VTT/JSON sidecars are byte-exact vs the committed goldens, incl. the RTL Arabic set', async ({ page }) => {
    test.setTimeout(180_000)
    await openExportProject(page, {
      asset: SIDECAR_ASSET,
      src: RUN_SRC,
      blocks: SIDECAR_BLOCKS,
      speakers: SIDECAR_SPEAKERS,
      name: SIDECAR_NAME,
      language: 'en',
      translations: { fr: SIDECAR_FR },
    })
    // The blessed golden blesses the ar track as origin 'manual' (the L1
    // sidecar fixture) — build it through the SAME command the UI manual-add
    // button dispatches, so the JSON byte-compare exercises the manual-track
    // serialization, not an accidental machine origin.
    const ed = editorProxy(page)
    expect(await ed.command('translation-add-track', { language: 'ar', origin: 'manual' })).toBeNull()
    await ed.seedTranslation('ar', AR)
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()

    const cases: Array<{ format: string; track: string; golden: string; file: string }> = [
      { format: 'srt', track: 'fr', golden: 'srt-fr-off.srt', file: `${SIDECAR_SLUG}.fr.srt` },
      { format: 'srt', track: 'ar', golden: 'srt-ar-off.srt', file: `${SIDECAR_SLUG}.ar.srt` },
      { format: 'vtt', track: 'fr', golden: 'vtt-fr-off.vtt', file: `${SIDECAR_SLUG}.fr.vtt` },
      { format: 'vtt', track: 'ar', golden: 'vtt-ar-off.vtt', file: `${SIDECAR_SLUG}.ar.vtt` },
      { format: 'json', track: 'fr', golden: 'json-fr.json', file: `${SIDECAR_SLUG}.fr.json` },
      { format: 'json', track: 'ar', golden: 'json-ar.json', file: `${SIDECAR_SLUG}.ar.json` },
    ]
    for (const c of cases) {
      await page.getByTestId(`sidecar-format-${c.format}`).click()
      await page.getByTestId('sidecar-track').selectOption(c.track)
      await page.getByTestId('sidecar-speaker-labels').selectOption('off')
      const got = await downloadBytes(page, async () => {
        await page.getByTestId('sidecar-save').click()
      })
      expect(got.name, `filename for ${c.golden}`).toBe(c.file)
      expect(got.body, `bytes for ${c.golden}`).toBe(readGolden(c.golden))
    }
  })

  test('CC-I4.4: burn-in of a translation track renders the translated text (fr vs source track, shared-renderer mask agreement)', async ({ page }) => {
    test.setTimeout(300_000)
    const frEntries: Record<string, unknown> = {}
    const frTextById = new Map<string, string>()
    for (const block of EXPORT_BLOCKS) {
      const frText = `bonjour mot${block.id.slice(-1)} sous-titre`
      frEntries[block.id] = { text: frText, status: 'translated', sourceHash: 'h' }
      frTextById.set(block.id, frText)
    }
    await openExportProject(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: EXPORT_BLOCKS,
      mediaBytes: { path: '/fixtures/taxi-en-accented-1.mp4', type: 'video/mp4' },
      translations: { fr: frEntries },
    })
    await page.waitForFunction(() => (window as unknown as { __zipPersistenceBridge?: unknown }).__zipPersistenceBridge !== undefined, undefined, { timeout: 20_000 })
    // One accepted command guarantees the dirty bit the snapshot flush needs.
    expect(await editorProxy(page).command('project-rename', { name: 'intent4 burn-in journey' })).toBeNull()
    const snap = await flushAndSnapshot(page)
    const style = ((JSON.parse(snap.json) as ProjectJson).style ?? {}) as Record<string, unknown>

    const dialog = page.getByTestId('export-dialog')
    await page.getByTestId('export-button').click()
    await expect(dialog).toBeVisible()
    await page.getByTestId('burnin-track').selectOption('fr')
    let downloadPromise = page.waitForEvent('download', { timeout: 240_000 })
    await page.getByTestId('burnin-start').click()
    await expect(page.getByTestId('export-progress')).toBeVisible()
    const frDownload = await downloadPromise
    const outFr = scratchPath('burn-fr.mp4')
    await frDownload.saveAs(outFr)
    if (await dialog.isVisible().catch(() => false)) await page.getByTestId('export-close').click()
    await page.getByTestId('export-button').click()
    await expect(dialog).toBeVisible()
    await page.getByTestId('burnin-track').selectOption('source')
    downloadPromise = page.waitForEvent('download', { timeout: 240_000 })
    await page.getByTestId('burnin-start').click()
    const srcDownload = await downloadPromise
    const outSrc = scratchPath('burn-src.mp4')
    await srcDownload.saveAs(outSrc)

    for (const [file, label] of [
      [outFr, 'fr'],
      [outSrc, 'source'],
    ] as const) {
      const info = mediaInfo(file)
      expect(Math.abs(info.durationSec - 29.888), `${label} burn-in duration ${String(info.durationSec)}`).toBeLessThanOrEqual(1)
      expect(info.hasVideo, `${label} burn-in carries video`).toBe(true)
    }

    await page.waitForFunction(() => (window as unknown as { __zipStyleTest?: unknown }).__zipStyleTest !== undefined, undefined, { timeout: 15_000 })
    await page.evaluate(async () => {
      await (window as unknown as { __zipStyleTest: StyleBridgeShape }).__zipStyleTest.ensureDefaultFonts()
      await document.fonts.ready
    })
    const renderOverlay = (blockIndex: number, track: 'fr' | 'source'): Promise<string> => {
      const block = EXPORT_BLOCKS[blockIndex]
      if (block === undefined) throw new Error('NO_SAMPLE_BLOCK')
      const text = track === 'fr' ? frTextById.get(block.id) ?? block.text : block.text
      const frame = { blocks: [{ ...block, text, words: [] }], time: SAMPLE_TIMES[blockIndex] ?? 0, style, track, width: 320, height: 180 }
      return page.evaluate(async ([f]) => await (window as unknown as { __zipStyleTest: StyleBridgeShape }).__zipStyleTest.renderOverlayPng(f, 1), [frame] as const)
    }

    for (const sample of [0, 4]) {
      const t = SAMPLE_TIMES[sample] ?? 0
      const frameFrPath = scratchPath(`burn-fr-${String(sample)}.png`)
      const frameSrcPath = scratchPath(`burn-src-${String(sample)}.png`)
      extractFrame(outFr, t, frameFrPath)
      extractFrame(outSrc, t, frameSrcPath)
      const ovlFr = await renderOverlay(sample, 'fr')
      const ovlSrc = await renderOverlay(sample, 'source')
      const stats = await bandMaskOverlap(page, { burnA: toDataUrl(frameFrPath), burnB: toDataUrl(frameSrcPath), ovlA: ovlFr, ovlB: ovlSrc, ovlAonly: ovlFr }, 0.5)
      expect(stats.ovlTextCount, `shared renderer paints the fr overlay at t=${String(t)}s`).toBeGreaterThanOrEqual(100)
      expect(stats.ovlDiffCount, `fr and source overlays genuinely differ at t=${String(t)}s`).toBeGreaterThanOrEqual(100)
      expect(stats.burnDiffCount, `the burned fr output differs from the source burn-in at t=${String(t)}s (track selection honored)`).toBeGreaterThanOrEqual(150)
      expect(stats.iou, `the burned difference sits where the fr overlay says the text goes at t=${String(t)}s (IoU)`).toBeGreaterThanOrEqual(0.3)
    }
  })
})

// — T6 · CC-I4.7 ——————————————————————————————————————————————————————————————

test.describe('CC-I4.7: console redaction across a translate journey', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')
  test.setTimeout(180_000)

  test('CC-I4.7: whole journey — captured console + pageerror carry zero caption/translation text, codes and counts only', async ({ page }) => {
    const captured: Array<{ kind: string; line: string }> = []
    const pending: Array<Promise<void>> = []
    page.on('console', (msg) => {
      pending.push(
        Promise.all(msg.args().map((arg) => arg.jsonValue().catch(() => '<unserializable>')))
          .then((values) => {
            captured.push({ kind: `console.${msg.type()}`, line: values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v) ?? '')).join(' ') })
          })
          .catch(() => undefined),
      )
    })
    page.on('pageerror', (err) => {
      captured.push({ kind: 'pageerror', line: `${err.name} ${String(err.message ?? '')}` })
    })

    await bootWithScriptedTranslator(page, [['fr', POISON_FR]])
    const ed = editorProxy(page)
    const blocks = Array.from({ length: 24 }, (_, i) => ({ id: `k${pad3(i)}`, start: i, end: i + 0.9, text: `syn${pad3(i)}qx${i === 5 ? ` ${POISON_FR}` : ''}`, words: [{ text: `syn${pad3(i)}qx${i === 5 ? ` ${POISON_FR}` : ''}`, start: i, end: i + 0.9 }], speakerId: 'SPK_1' }))
    await ed.openProjectWithMedia(SIDECAR_ASSET, RUN_SRC)
    await ed.seedBlocks(blocks, SPEAKERS)
    await ed.setProjectLanguage('en')
    await expect.poll(() => ed.getEditorState().then((s) => s.blockCount), { timeout: 30_000 }).toBe(24)
    await openPicker(page)
    await addFromPicker(page, 'fr', 'French')
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('French') }).getByTestId('languages-status')).toHaveText('Partial', { timeout: 60_000 })
    await ed.setView('translation', 'fr')
    const editedText = 'manually reviewed token'
    expect(await ed.command('translation-edit-entry', { language: 'fr', blockId: 'k003', text: editedText })).toBeNull()
    await expect.poll(() => badges(page), { timeout: 10_000 }).toContain('Edited')
    // A second failed pass (re-run over the still-failing block) — another
    // coded warn is expected on the channel.
    await page.getByTestId('languages-row').filter({ has: page.getByText('French') }).getByTestId('languages-retranslate-stale').click()
    await page.waitForTimeout(1500)

    await Promise.allSettled(pending)
    const tokens: string[] = []
    for (const block of blocks) {
      const text = typeof block.text === 'string' ? block.text : ''
      tokens.push(text, `fr:${text}`)
    }
    tokens.push(editedText)
    const leaks = captured.filter((entry) => tokens.some((token) => entry.line.includes(token)))
    const channelCounts = Object.entries(captured.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {})).map(([k, v]) => `${k}:${String(v)}`)
    expect(leaks.length, `SECURITY-03: captured channel output must contain ZERO caption/translation text (channels observed: ${channelCounts.join(', ')})`).toBe(0)
    // Codes-and-counts side of the same criterion: the failed run DID surface
    // (aggregated warn with the engine code), and it surfaced as a code.
    expect(captured.some((e) => e.line.includes('TRANSLATE_FAILED')), 'failure surfaces as codes/counts only').toBe(true)
  })
})

// — T5 · CC-I4.5 (webkit tier) —————————————————————————————————————————————————

test.describe('CC-I4.5: unsupported-browser gating journey (webkit)', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'webkit tier — run under E2E_WEBKIT=1 (FR-1.0.4 default-skip)')
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')
  test.setTimeout(180_000)

  test('CC-I4.5: webkit journey — translation actions absent with the explanatory note; import + manual translation still work', async ({ page }) => {
    await openExportProject(page, {
      asset: SIDECAR_ASSET,
      src: RUN_SRC,
      blocks: SIDECAR_BLOCKS,
      speakers: SIDECAR_SPEAKERS,
      name: SIDECAR_NAME,
      language: 'en',
    })
    // Translation actions are absent, with the explanatory note.
    await expect(page.getByTestId('languages-gating')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('languages-gating')).toContainText('On-device translation needs Chrome or Edge on desktop.')
    await expect(page.getByTestId('languages-add'), 'the machine-translation entry point is absent').toBeDisabled()
    await expect(page.getByTestId('languages-picker-item')).toHaveCount(0)

    // Escape hatch 1: importing a translation file still works.
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 })
    await page.getByTestId('languages-import').click()
    const chooser = await chooserPromise
    await chooser.setFiles('fixtures/captions/simple.srt')
    await expect(page.getByTestId('caption-import-dialog')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('caption-import-use-translation').click()
    await page.getByTestId('caption-import-target-language').fill('es')
    await page.getByTestId('caption-import-confirm').click()
    await expect(page.getByTestId('languages-row').filter({ has: page.getByText('Spanish') })).toBeVisible({ timeout: 10_000 })

    // Escape hatch 2: adding an empty manual track still works.
    await page.getByTestId('languages-manual').click()
    await expect(page.getByTestId('languages-row')).toHaveCount(2, { timeout: 10_000 })
  })
})
