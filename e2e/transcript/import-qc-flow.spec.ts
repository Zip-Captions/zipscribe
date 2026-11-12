// CC-104.7 (L5, chromium): the imported-caption flow end to end with the
// scripted ASR worker — drop `fixtures/captions/vendor.srt` on the open
// project → import REPORT (srt / windows-1252 / 2 cues / 2 blocks /
// TAGS_STRIPPED×1, the frozen golden numbers) → confirm replaces the source
// (one undo step) → a long-text edit raises CPS_HIGH, listed in "Issues (n)"
// → jump via transcript-issue moves the playhead to the block → retime +0.5 s
// (media NEVER moves: clockTime + seekCount untouched) → fix the edit →
// "Align to audio" runs the scripted align job (injectAsrEvent drives
// job:segments/job:done; no network) and aligned words lose their
// 'estimated' state. EVERY step: exactly one undo step (bridge getHistory
// counters — numbers only, SECURITY-03).
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'

const SRC = '/fixtures/speech-2min.mp4'
const SRT = Array.from(readFileSync('fixtures/captions/vendor.srt'))
const DEFECT_TEXT = 'x'.repeat(50)

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

interface TranscriptBridge {
  getTranscriptState(): { issueCount: number; runningJobKind: 'transcribe' | 'align' | null; runningJobId: string | null; totalRows: number }
  getHistory(): { undoCount: number; redoCount: number }
  getWordTimings(blockId: string): Array<{ timing: string; start: number; end: number }> | null
  getBlockTimes(blockId: string): { start: number; end: number } | null
}

async function historyUndoCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const b = (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge
    if (!b) throw new Error('transcript bridge missing')
    return b.getHistory().undoCount
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

test.describe('CC-104.7: vendor.srt drop → report → confirm → QC jump → retime +0.5 → align; one undo per step', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-104.7: full imported-caption flow with scripted align, each step exactly one undo step', async ({ page }) => {
    test.setTimeout(120_000)
    const consoleTexts: string[] = []
    page.on('console', (msg) => consoleTexts.push(msg.text()))

    await page.goto('/?ziptest=1')
    await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
    await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src), [MEDIA_ASSET, SRC] as const)
    await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
    await page.click('[data-testid=tab-subtitles]')
    await page.waitForFunction(() => Boolean((window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge), undefined, { timeout: 20_000 })
    const undoBase = await historyUndoCount(page)

    // 1 · Drop vendor.srt on the shell (real Chromium DataTransfer).
    await page.evaluate(
      ([bytes]) => {
        const file = new File([new Uint8Array(bytes)], 'vendor.srt', { type: 'application/x-subrip' })
        const dt = new DataTransfer()
        dt.items.add(file)
        const shell = document.querySelector('[data-testid=workbench-shell]')
        if (shell === null) throw new Error('workbench shell missing')
        shell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      },
      [SRT] as const,
    )

    // 2 · Import report — frozen golden numbers (fixtures/golden/captions/vendor.srt.expected.json).
    const dialog = page.getByTestId('caption-import-dialog')
    await expect(dialog, 'import dialog opens on drop over an open project').toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('caption-import-report-format')).toHaveText('srt')
    await expect(page.getByTestId('caption-import-report-encoding')).toHaveText('windows-1252')
    await expect(page.getByTestId('caption-import-report-cues')).toHaveText('2')
    await expect(page.getByTestId('caption-import-report-blocks')).toHaveText('2')
    await expect(page.locator('[data-testid=caption-import-report-adjustment][data-code=TAGS_STRIPPED]'), 'the <i> tag was stripped (1)').toContainText('1')

    // 3 · Confirm — one undo step, rows replace the source.
    await page.getByTestId('caption-import-confirm').click()
    await expect(page.locator('[data-testid=transcript-row][data-block-id=blk-1]')).toBeVisible()
    await expect(page.locator('[data-testid=transcript-row][data-block-id=blk-2]')).toBeVisible()
    expect(await historyUndoCount(page), 'import = one undo step').toBe(undoBase + 1)

    // 4 · CPS_HIGH defect → listed in the Issues filter.
    await editBlockText(page, 'blk-1', DEFECT_TEXT)
    expect(await historyUndoCount(page), 'defect edit = one undo step').toBe(undoBase + 2)
    await expect(page.getByTestId('transcript-issue-filter'), 'Issues (n) chip counts the CPS_HIGH issue').toContainText('Issues')
    await expect(page.locator('[data-testid=transcript-issue-dot]').first(), 'row-level issue dot').toBeVisible()

    // 5 · Jump via the issue row: playhead lands on the block (no history step).
    await page.getByTestId('transcript-issue').first().click()
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().playhead)) ?? -1, { message: 'jump moves the playhead to the issue block' })
      .toBeGreaterThanOrEqual(0.4)
    expect(await historyUndoCount(page), 'the jump is UI-only — no history step').toBe(undoBase + 2)

    // 6 · Retime +0.5 s — blocks shift, the MEDIA never moves.
    const clockBefore = await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState())
    await page.getByTestId('transcript-retime-tool').click()
    await expect(page.getByTestId('retime-dialog')).toBeVisible()
    await page.getByTestId('retime-offset').fill('0.5')
    await page.getByTestId('retime-apply').click()
    await page.waitForFunction(
      () => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getBlockTimes('blk-1')?.start === 0.5,
      undefined,
      { timeout: 10_000 },
    )
    const times = await page.evaluate(() => {
      const b = (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge
      return { a: b?.getBlockTimes('blk-1'), c: b?.getBlockTimes('blk-2') }
    })
    expect(times.a).toEqual({ start: 0.5, end: 2.5 })
    expect(times.c).toEqual({ start: 3.5, end: 5.2 })
    const clockAfter = await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState())
    expect(clockAfter?.seekCount, 'retime never seeks the media (invariant 9)').toBe(clockBefore?.seekCount)
    expect(clockAfter?.clockTime, 'media clock untouched by retime').toBe(clockBefore?.clockTime)
    expect(await historyUndoCount(page), 'retime = one undo step').toBe(undoBase + 3)

    // 7 · Fix the defect edit — issues clear, one undo step.
    await editBlockText(page, 'blk-1', 'Café au lait')
    expect(await historyUndoCount(page), 'fix edit = one undo step').toBe(undoBase + 4)
    await expect(page.locator('[data-testid=transcript-issue-dot]'), 'CPS_HIGH cleared').toHaveCount(0)

    // 8 · Align to audio — scripted ASR job (no network), then aligned words.
    await page.getByTestId('transcript-align-audio').click()
    await page.waitForFunction(() => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getTranscriptState().runningJobKind === 'align', undefined, { timeout: 15_000 })
    const rawJobId = await page.evaluate(() => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getTranscriptState().runningJobId)
    if (rawJobId === null || rawJobId === undefined) throw new Error('align job never started')
    const jobId = rawJobId
    await page.evaluate(
      ([id]) => {
        const b = window as unknown as { __zipWorkbenchBridge?: { injectAsrEvent(event: { t: string; jobId: string; segments?: unknown[] }): void } }
        if (!b.__zipWorkbenchBridge) throw new Error('workbench bridge missing')
        const w = (text: string, start: number, end: number) => ({ text, start, end })
        b.__zipWorkbenchBridge.injectAsrEvent({
          t: 'job:segments',
          jobId: id,
          segments: [
            { start: 0.6, end: 2.45, text: 'Café au lait', words: [w('Café', 0.6, 1.1), w('au', 1.25, 1.8), w('lait', 2.05, 2.45)] },
            { start: 3.6, end: 4.9, text: 'Two now', words: [w('Two', 3.6, 4.1), w('now', 4.5, 4.9)] },
          ],
        })
        b.__zipWorkbenchBridge.injectAsrEvent({ t: 'job:done', jobId: id })
      },
      [jobId] as const,
    )
    await page.waitForFunction(
      () => {
        const b = (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge
        const t1 = b?.getWordTimings('blk-1')
        return t1 !== null && t1 !== undefined && t1.length === 3 && t1.every((x) => x.timing === 'aligned')
      },
      undefined,
      { timeout: 15_000 },
    )
    const t2 = await page.evaluate(() => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getWordTimings('blk-2'))
    expect(t2?.map((x) => x.timing), 'matched words aligned; unmatched keep the estimated state').toEqual(['aligned', 'estimated', 'estimated', 'aligned'])
    expect(await historyUndoCount(page), 'align apply = ONE undo step').toBe(undoBase + 5)

    // SECURITY-03: no transcript content in the console.
    expect(consoleTexts.filter((t) => t.includes('Café au lait') || t.includes(DEFECT_TEXT)), 'transcript content never logged').toHaveLength(0)
  })
})
