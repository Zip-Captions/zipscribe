// CC-111.1 CC-111.2 CC-111.3 CC-111.4 (L5, chromium, 1440×900): issue #55's
// blocker closed on the PRODUCTION build — merge reachable by the REAL
// documented keys (⌘⇧M / Ctrl+⇧M, design.md § Keyboard shortcuts "Merge
// selected with next block", the frozen registry rows timeline.merge /
// timeline.merge-ctrl at src/ui/commands/registry.ts:81-82 — [RULING]: never
// re-bound by this unit) and pointer paths for split & merge.
//
// Root cause being fixed (characterized, NOT fixed by this suite — test-author
// scope): the handler IS registered (src/ui/timeline/Timeline.tsx:399-404
// registers timeline.merge/timeline.merge-ctrl → controller.mergeSelected, so
// registration scope/mount is fine and the `when: 'not-editing'` gate is open
// after a row click) — but src/ui/timeline/controller.ts:385-400 mergeSelected
// requires a selection spanning EXACTLY TWO ADJACENT blocks
// (`hi - lo !== 1` → CommandReject), while a transcript row click sets
// anchor===focus===block (src/ui/transcript/Transcript.tsx:1097) → the command
// is rejected pre-dispatch, and Timeline.tsx discards the returned
// CommandReject (no notice) — hence "inert": zero mutation, zero feedback.
// The `S`/split path works from the same surface because splitAtPlayhead uses
// the SINGLE focusBlockId (selectionTargetId) — the asymmetry is the bug.
//
// Bridge-light (mirrors e2e/transcript/import-qc-flow.spec.ts + unit-110's
// row-layout.spec.ts): import route = the sanctioned REAL import UI (the
// DataTransfer drop onto [data-testid=workbench-shell] + caption-import
// dialog confirm, exactly the import-qc-flow route) with
// fixtures/captions/en-clean-ref.srt (12 cues). Bridge use is READ-ONLY
// (__zipEditorBridge.openProjectWithMedia/getEditorState,
// __zipTranscriptBridge.getTranscriptState/getBlockTimes/getWordTimings —
// numbers/ids only, SECURITY-03). NO command() bridge seam anywhere in the
// keyboard legs (spec CC-111.1: REAL key events only) — every merge/split
// below fires via page.keyboard.press or a mouse click on the pinned row
// affordances.
//
// FR-111.2 PINNED CONTRACT (same pinning style as unit-110's data-row-state):
// inside every [data-testid=transcript-row]: [data-testid=row-merge-next] and
// [data-testid=row-split-at-playhead] (row-button family, siblings of
// transcript-row-delete); last-row merge DISABLED (aria-disabled="true", not
// hidden) with a non-empty reason tooltip (title or aria-describedby) matching
// /next|last/i; split enabled iff the playhead is STRICTLY inside the block
// (the `S` gate, src/ui/timeline/controller.ts:374-383).
//
// SECURITY-03: assertions are row counts, block ids, timecode TEXT (ui/format
// formatTimecode — never transcript words) and bridge numbers; zero fixture
// strings in assertions or messages. Determinism: fixed viewport/DPR, no
// sleeps-as-assertions (toHaveCount/poll), servers owned by the runner.
//
// RED today, honestly: ⌘⇧M/Ctrl+⇧M leave the row count UNCHANGED (inert
// handler — CC-111.1 legs red at the count assertion) and the affordances do
// not exist (CC-111.2/.3 legs red at the locator/toHaveCount on
// row-merge-next / row-split-at-playhead). The import + select prerequisites
// are asserted non-vacuously (12 rows, ts-row-selected) BEFORE the red
// assertions, so a red leg means merge/split failed — never "the app never
// loaded".
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'
import { formatTimecode } from '../../src/ui/format'

const SRC = '/fixtures/speech-2min.mp4'
const SRT = Array.from(readFileSync('fixtures/captions/en-clean-ref.srt'))
const CUES = 12

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

interface TranscriptBridge {
  getTranscriptState(): { totalRows: number }
  getBlockTimes(blockId: string): { start: number; end: number } | null
  getWordTimings(blockId: string): Array<{ timing: string; start: number; end: number }> | null
}

async function bootAndImport(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
  await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src), [MEDIA_ASSET, SRC] as const)
  await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
  await page.click('[data-testid=tab-subtitles]')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge), undefined, { timeout: 20_000 })
  // Sanctioned import route (e2e/transcript/import-qc-flow.spec.ts): real
  // DataTransfer drop on the shell + dialog confirm (replace semantics).
  await page.evaluate(
    ([bytes]) => {
      const file = new File([new Uint8Array(bytes)], 'en-clean-ref.srt', { type: 'application/x-subrip' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const shell = document.querySelector('[data-testid=workbench-shell]')
      if (shell === null) throw new Error('workbench shell missing')
      shell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    },
    [SRT] as const,
  )
  await expect(page.getByTestId('caption-import-dialog'), 'import dialog opens on the sanctioned drop').toBeVisible({ timeout: 15_000 })
  await page.getByTestId('caption-import-confirm').click()
  const rows = page.locator('[data-testid=transcript-row]')
  await expect(rows, 'fixture import lands 12 blocks (non-vacuity)').toHaveCount(CUES)
  expect(await totalRows(page), 'store agrees: 12 rows').toBe(CUES)
}

async function totalRows(page: import('@playwright/test').Page): Promise<number> {
  return (await page.evaluate(() => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getTranscriptState().totalRows)) ?? -1
}

async function blockTimes(page: import('@playwright/test').Page, blockId: string): Promise<{ start: number; end: number }> {
  const times = await page.evaluate((id) => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getBlockTimes(id), blockId)
  if (times === null || times === undefined) throw new Error(`bridge has no block ${blockId}`)
  return times
}

async function wordStart(page: import('@playwright/test').Page, blockId: string, index: number): Promise<number> {
  const words = await page.evaluate((id) => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getWordTimings(id), blockId)
  const word = words?.[index]
  if (word === undefined) throw new Error(`block ${blockId} has no word ${index}`)
  return word.start
}

/** Byte-stable DOM snapshot: row count + timecode text sequence (SECURITY-03:
 *  timecodes/counts only). Rows are first DESELECTED (Escape →
 *  transcript.deselect) so every timecode slot renders its formatTimecode
 *  text rather than a TimecodeInput editor. */
async function snapshot(page: import('@playwright/test').Page): Promise<{ count: number; timecodes: string[] }> {
  await page.keyboard.press('Escape')
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid=transcript-row]'))
    const timecodes = rows.map((row) => row.querySelector('[data-testid=transcript-row-timecode]')?.textContent ?? '')
    return { count: rows.length, timecodes }
  })
}

async function rowBlockId(page: import('@playwright/test').Page, index: number): Promise<string> {
  const id = await page.locator('[data-testid=transcript-row]').nth(index).getAttribute('data-block-id')
  if (id === null) throw new Error(`row ${index} has no data-block-id`)
  return id
}

async function selectRowText(page: import('@playwright/test').Page, index: number): Promise<void> {
  const row = page.locator('[data-testid=transcript-row]').nth(index)
  await row.locator('[data-testid=transcript-row-text]').click()
  await expect(row, `row ${index} selected (ts-row-selected)`).toHaveClass(/ts-row-selected/)
}

async function pollPlayhead(page: import('@playwright/test').Page, seconds: number): Promise<void> {
  await expect
    .poll(async () => (await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().playhead)) ?? -1, { message: 'word click landed the playhead (transport-seek)' })
    .toBe(seconds)
}

test.describe('CC-111.1–CC-111.4: merge reachable by the real keys; pointer merge/split; undo/redo exactness', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

  test('CC-111.1: ⌘⇧M then Ctrl+⇧M merge the selected row with its next — real key events, union timing, exactly one fewer row', async ({ page }) => {
    test.setTimeout(120_000)
    await bootAndImport(page)
    const rows = page.locator('[data-testid=transcript-row]')

    // Meta path: row 1 (blk-2) merged into blk-3 — union = (blk-2.start, blk-3.end).
    const left = await blockTimes(page, 'blk-2')
    const right = await blockTimes(page, 'blk-3')
    await selectRowText(page, 1)
    await page.keyboard.press('Meta+Shift+KeyM')
    await expect(rows, 'real ⌘⇧M removes EXACTLY one row (today RED: inert mergeSelected rejects the single-block selection — controller.ts:395 hi-lo!==1)').toHaveCount(CUES - 1)
    expect(await totalRows(page)).toBe(CUES - 1)
    const merged = await blockTimes(page, 'blk-2')
    expect([merged.start, merged.end], 'joined block timing = union, byte-exact (left id kept, block-merge doctrine)').toEqual([left.start, right.end])
    await expect(page.locator('[data-testid=transcript-row][data-block-id=blk-3]'), 'the right block is gone').toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(rows.nth(1).locator('[data-testid=transcript-row-timecode]'), 'timecode TEXT shows the union start (formatTimecode, no content strings)').toHaveText(formatTimecode(left.start))

    // Ctrl path: row 4 of the 11 (blk-6) merged into blk-7 — same contract.
    const ctrlLeft = await blockTimes(page, 'blk-6')
    const ctrlRight = await blockTimes(page, 'blk-7')
    await selectRowText(page, 4)
    await page.keyboard.press('Control+Shift+KeyM')
    await expect(rows, 'real Ctrl+⇧M removes exactly one more row').toHaveCount(CUES - 2)
    const ctrlMerged = await blockTimes(page, 'blk-6')
    expect([ctrlMerged.start, ctrlMerged.end], 'Ctrl spelling rides the same block-merge command').toEqual([ctrlLeft.start, ctrlRight.end])
  })

  test('CC-111.2: pointer merge — row-merge-next does the identical merge; last row DISABLED (not hidden) with reason tooltip', async ({ page }) => {
    test.setTimeout(120_000)
    await bootAndImport(page)
    const rows = page.locator('[data-testid=transcript-row]')

    const left = await blockTimes(page, 'blk-1')
    const right = await blockTimes(page, 'blk-2')
    await selectRowText(page, 0)
    const mergeButton = rows.nth(0).getByTestId('row-merge-next')
    await expect(mergeButton, 'pinned FR-111.2 contract: row-merge-next inside the row (today RED: affordance missing)').toBeVisible()
    await mergeButton.click()
    await expect(rows, 'pointer merge removes exactly one row — identical result to the keyboard path').toHaveCount(CUES - 1)
    const merged = await blockTimes(page, 'blk-1')
    expect([merged.start, merged.end], 'pointer merge timing = union, byte-exact').toEqual([left.start, right.end])

    // Last row: merge affordance present, DISABLED, reason tooltip — never hidden.
    const lastRow = rows.last()
    const lastMerge = lastRow.getByTestId('row-merge-next')
    await expect(lastMerge, 'last row keeps the affordance (disabled, not hidden)').toHaveCount(1)
    await expect(lastMerge).toHaveAttribute('aria-disabled', 'true')
    const tooltip = await lastMerge.evaluate((el) => {
      const title = el.getAttribute('title') ?? ''
      if (title.trim() !== '') return title
      const describedBy = el.getAttribute('aria-describedby') ?? ''
      return describedBy
        .split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    })
    expect(tooltip.trim(), 'disabled merge carries a tooltip').not.toBe('')
    expect(tooltip, 'tooltip names the no-next-block reason').toMatch(/next|last/iu)
  })

  test('CC-111.3: pointer split at the playhead (row-split-at-playhead) gives exact halves; the S keyboard path stays intact (regression)', async ({ page }) => {
    test.setTimeout(120_000)
    await bootAndImport(page)
    const rows = page.locator('[data-testid=transcript-row]')

    // Gating (pointer-only): playhead at 0 sits outside blk-1 (starts 0.120)
    // → the affordance is disabled, mirroring the `S` strict-inside gate.
    const splitAffordance = rows.nth(0).getByTestId('row-split-at-playhead')
    await expect(splitAffordance, 'pinned FR-111.2 contract: row-split-at-playhead inside the row (today RED: affordance missing)').toBeVisible()
    await expect(splitAffordance, 'playhead outside the block → disabled (S-gate parity)').toHaveAttribute('aria-disabled', 'true')

    // Mouse-only seek INTO the block: click blk-1's SECOND word (its start is
    // strictly inside the span), then the affordance runs the same
    // block-split command the S key rides.
    await selectRowText(page, 0)
    const at = await wordStart(page, 'blk-1', 1)
    await rows.nth(0).locator('[data-testid=transcript-word]').nth(1).click()
    await pollPlayhead(page, at)
    await expect(splitAffordance, 'playhead strictly inside → enabled (not aria-disabled)').not.toHaveAttribute('aria-disabled', 'true')
    await splitAffordance.click()
    await expect(rows, 'pointer split adds exactly one row').toHaveCount(CUES + 1)
    const first = await blockTimes(page, 'blk-1')
    expect([first.start, first.end], 'first half ends exactly at the playhead').toEqual([0.12, at])
    const secondId = await rowBlockId(page, 1)
    expect(secondId, 'second half is a NEW block id').not.toBe('blk-1')
    const second = await blockTimes(page, secondId)
    expect([second.start, second.end], 'second half starts exactly at the playhead, keeps the tail').toEqual([at, 8.509])

    // Regression: the keyboard `S` path (already shipped, issue #55: "Split by
    // S works") still splits from the transcript surface.
    const sRowId = await rowBlockId(page, 4)
    const sTimes = await blockTimes(page, sRowId)
    const sAt = await wordStart(page, sRowId, 1)
    await rows.nth(4).locator('[data-testid=transcript-word]').nth(1).click()
    await pollPlayhead(page, sAt)
    await page.keyboard.press('s')
    await expect(rows, 'S keyboard path unaffected').toHaveCount(CUES + 2)
    const sFirst = await blockTimes(page, sRowId)
    expect([sFirst.start, sFirst.end], 'S split times exact (regression)').toEqual([sTimes.start, sAt])
    const sSecondId = await page.evaluate((index) => document.querySelectorAll<HTMLElement>('[data-testid=transcript-row]')[index]?.getAttribute('data-block-id') ?? '', 5)
    if (sSecondId === '') throw new Error('S split produced no second row')
    const sSecond = await blockTimes(page, sSecondId)
    expect([sSecond.start, sSecond.end], 'S second half exact').toEqual([sAt, sTimes.end])
  })

  test('CC-111.4: keyboard merge — ⌘Z/⇧⌘Z restore row counts + timecode sequence byte-stable', async ({ page }) => {
    test.setTimeout(120_000)
    await bootAndImport(page)
    const rows = page.locator('[data-testid=transcript-row]')
    const before = await snapshot(page)
    expect(before.count, 'non-vacuity: 12 rows before the merge').toBe(CUES)

    await selectRowText(page, 2)
    await page.keyboard.press('Meta+Shift+KeyM')
    await expect(rows, 'merge happened (prerequisite for the undo leg)').toHaveCount(CUES - 1)
    const after = await snapshot(page)
    expect(after.count).toBe(CUES - 1)

    await page.keyboard.press('ControlOrMeta+Z')
    await expect(rows, 'undo restores the exact pair (rows)').toHaveCount(CUES)
    expect(await snapshot(page), 'undo is BYTE-STABLE on the timecode sequence').toEqual(before)

    await page.keyboard.press('ControlOrMeta+Shift+Z')
    await expect(rows, 'redo returns to the merged state').toHaveCount(CUES - 1)
    expect(await snapshot(page), 'redo is BYTE-STABLE on the timecode sequence').toEqual(after)
  })

  test('CC-111.4: pointer merge — ⌘Z/⇧⌘Z byte-stable on counts + timecodes', async ({ page }) => {
    test.setTimeout(120_000)
    await bootAndImport(page)
    const rows = page.locator('[data-testid=transcript-row]')
    const before = await snapshot(page)
    expect(before.count).toBe(CUES)

    await selectRowText(page, 0)
    await rows.nth(0).getByTestId('row-merge-next').click()
    await expect(rows, 'pointer merge happened (prerequisite)').toHaveCount(CUES - 1)
    const after = await snapshot(page)

    await page.keyboard.press('ControlOrMeta+Z')
    await expect(rows).toHaveCount(CUES)
    expect(await snapshot(page), 'pointer-merge undo: byte-stable timecode sequence').toEqual(before)

    await page.keyboard.press('ControlOrMeta+Shift+Z')
    await expect(rows).toHaveCount(CUES - 1)
    expect(await snapshot(page), 'pointer-merge redo: byte-stable timecode sequence').toEqual(after)
  })

  test('CC-111.4: pointer split — ⌘Z/⇧⌘Z byte-stable on counts + timecodes', async ({ page }) => {
    test.setTimeout(120_000)
    await bootAndImport(page)
    const rows = page.locator('[data-testid=transcript-row]')
    const before = await snapshot(page)
    expect(before.count).toBe(CUES)

    await selectRowText(page, 0)
    const at = await wordStart(page, 'blk-1', 1)
    await rows.nth(0).locator('[data-testid=transcript-word]').nth(1).click()
    await pollPlayhead(page, at)
    await rows.nth(0).getByTestId('row-split-at-playhead').click()
    await expect(rows, 'pointer split happened (prerequisite)').toHaveCount(CUES + 1)
    const after = await snapshot(page)

    await page.keyboard.press('ControlOrMeta+Z')
    await expect(rows).toHaveCount(CUES)
    expect(await snapshot(page), 'pointer-split undo: byte-stable timecode sequence').toEqual(before)

    await page.keyboard.press('ControlOrMeta+Shift+Z')
    await expect(rows).toHaveCount(CUES + 1)
    expect(await snapshot(page), 'pointer-split redo: byte-stable timecode sequence').toEqual(after)
  })
})
