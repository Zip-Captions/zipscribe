// CC-110.6 (L5, chromium): the #52 first-run posture on the production
// build — fresh (unedited) ASR-like output shows NO wall of issues: the panel
// is a collapsed count badge; the user toggle reveals the list; an item whose
// block was edited since transcription is distinguished from raw-ASR items.
// The engine stays frozen (byte-pin: tests/unit/transcript/qc-engine-frozen-
// anchor.test.ts) — this spec asserts DOM posture only: test ids, attributes,
// classes and NUMBERS. No transcript strings in assertions/artifacts
// (SECURITY-03); the seed text is synthetic.
//
// Bridge-light: __zipEditorBridge (openProjectWithMedia/command) +
// __zipTranscriptBridge (getTranscriptState → issueCount) — existing seams
// only; edits run through the frozen word-dblclick editor (the same real
// input path import-qc-flow.spec.ts uses).
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'

const SRC = '/fixtures/speech-2min.mp4'
const LONG_DEFECT_SEED = 60

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

interface TranscriptBridge {
  getTranscriptState(): { issueCount: number; totalRows: number }
}

async function seedIssuesProject(page: import('@playwright/test').Page): Promise<number> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
  await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src), [MEDIA_ASSET, SRC] as const)
  await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
  await page.click('[data-testid=tab-subtitles]')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge), undefined, { timeout: 20_000 })
  // Two blocks trip CPS_HIGH + LINE_TOO_LONG on RAW output (60/55 chars in
  // 1 s — rules cpsMax 20 / lineCharsMax 42); the rest are clean (≤ 42 chars,
  // ≥ 0.7 s, gaps ≥ 0.3 s). Synthetic words only.
  await page.evaluate(
    ([longA, longB]) => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('editor bridge missing')
      const blocks: unknown[] = [
        { id: 'blk_i0', start: 0.5, end: 1.5, speakerId: 'SPK_1', text: 'q'.repeat(longA), words: [{ text: 'q'.repeat(longA), start: 0.5, end: 1.5 }] },
        { id: 'blk_i1', start: 2, end: 3, speakerId: 'SPK_1', text: 'z'.repeat(longB), words: [{ text: 'z'.repeat(longB), start: 2, end: 3 }] },
      ]
      for (let i = 0; i < 24; i++) {
        const start = 3.6 + i * 1.3
        blocks.push({ id: `blk_c${i}`, start, end: start + 1, speakerId: 'SPK_1', text: `clean${i}`, words: [{ text: `clean${i}`, start, end: start + 1 }] })
      }
      const reject = bridge.command('captions-import', { blocks, replace: true })
      if (reject !== null) throw new Error(`captions-import rejected: ${reject.code}`)
    },
    [LONG_DEFECT_SEED, 55] as const,
  )
  const state = await page.evaluate(() => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getTranscriptState())
  if (state === undefined) throw new Error('transcript bridge missing')
  return state.issueCount
}

async function toggleName(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const toggle = document.querySelector('[data-testid=transcript-issues-toggle]')
    if (toggle === null) throw new Error('issues toggle missing')
    return toggle.getAttribute('aria-label') ?? toggle.textContent ?? ''
  })
}

async function editBlockText(page: import('@playwright/test').Page, blockId: string, text: string): Promise<void> {
  const row = page.locator(`[data-testid=transcript-row][data-block-id=${blockId}]`)
  await row.locator('[data-testid=transcript-word]').first().dblclick()
  await expect(page.getByTestId('transcript-editor')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test.describe('CC-110.6: Issues panel — collapsed count-badge default · user toggle · raw vs edited de-emphasis', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

  test('CC-110.6: fresh unedited output is collapsed with the count in the badge; the toggle reveals the list', async ({ page }) => {
    test.setTimeout(90_000)
    const issueCount = await seedIssuesProject(page)
    expect(issueCount, 'the seeded project genuinely trips the frozen QC rules (non-vacuity)').toBeGreaterThanOrEqual(4)

    const toggle = page.getByTestId('transcript-issues-toggle')
    await expect(toggle, 'a toggle control exists for the issues panel').toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await toggleName(page), 'the badge carries the TRUE issue count').toContain(String(issueCount))

    const list = page.getByTestId('transcript-issues')
    await expect(list, 'raw-ASR issues are NOT a first-run wall — collapsed by default (#52)').toBeHidden()
    // The frozen row-filter chip keeps its shape (import-qc-flow.spec.ts:98).
    await expect(page.getByTestId('transcript-issue-filter')).toContainText('Issues')

    await toggle.click()
    await expect(list, 'the user toggle expands the list').toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const items = await page.getByTestId('transcript-issue').count()
    expect(items, 'items render when expanded').toBeGreaterThan(0)
    expect(items, 'the DOM stays bounded at MAX_ISSUE_ITEMS (50)').toBeLessThanOrEqual(50)

    await toggle.click()
    await expect(list, 'the user toggle collapses again').toBeHidden()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('CC-110.6: an item on a block edited since transcription is distinguished from raw-ASR items (and revealed)', async ({ page }) => {
    test.setTimeout(90_000)
    await seedIssuesProject(page)
    const list = page.getByTestId('transcript-issues')
    await expect(list, 'collapsed before any edit').toBeHidden()

    // Edit blk_i0 through the frozen editor path; its QC issue SURVIVES the
    // edit (61 chars in 1 s ⇒ still CPS_HIGH + LINE_TOO_LONG).
    await editBlockText(page, 'blk_i0', 'q'.repeat(LONG_DEFECT_SEED) + '!')

    // Frozen contract (import-qc-flow.spec.ts:102): the actionable item is
    // reachable without a manual expand — the list is revealed by the edit.
    await expect(list, 'an edited (actionable) issue reveals the list without a toggle').toBeVisible()

    const shape = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid=transcript-issue]')).map((el) => ({
        blockId: el.getAttribute('data-block-id') ?? '',
        origin: el.getAttribute('data-issue-origin') ?? '',
        classes: (el.getAttribute('class') ?? '')
          .split(/\s+/u)
          .filter((c) => c !== '')
          .sort()
          .join(' '),
      })),
    )
    const edited = shape.filter((i) => i.blockId === 'blk_i0')
    const raw = shape.filter((i) => i.blockId === 'blk_i1')
    expect(edited.length, 'the edited block still carries issues').toBeGreaterThan(0)
    expect(raw.length, 'the untouched block still carries raw issues').toBeGreaterThan(0)
    expect(edited.every((i) => i.origin === 'edited'), 'post-edit items are marked edited').toBe(true)
    expect(raw.every((i) => i.origin === 'raw'), 'unedited items are marked raw').toBe(true)
    const rawClass = raw[0]?.classes ?? ''
    const editedClass = edited[0]?.classes ?? ''
    expect(rawClass.length + editedClass.length, 'items expose class lists').toBeGreaterThan(0)
    expect(editedClass, 'raw and edited items are visually distinguished (class-level; styling values never asserted)').not.toBe(rawClass)
  })
})
