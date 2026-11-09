// CC-103.5 (L5, chromium): the timeline is operable with the keyboard alone —
// Alt+3 focuses the timeline region, arrows move block focus (registry
// `timeline-focused` gate), Enter selects, S splits at the playhead (one step),
// Ctrl/Cmd+Shift+M merges the adjacent selection, the held-letter chords
// Z+← / C+→ trim the focused edge to the playhead, and ⌘= / ⌘− / ⌘0 zoom.
// Selection SETUP for the merge case uses the frozen pointer selection model
// (click + shift-click — design.md § Block selection model; the merge SHORTCUT
// itself is what is exercised). Block ids/texts are synthetic (SECURITY-03);
// the bridges carry numbers and generated ids only.
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'
import { SAMPLE_SPEAKERS } from '../../tests/unit/editor/helpers/fixture-project'
import { constraintBlocks, mergePairBlocks, timelineBlocks } from '../../tests/unit/timeline/helpers/timeline-fixture'

const SRC = '/fixtures/speech-2min.mp4'

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; blockCount: number; videoReady: boolean }
}
interface TimelineBridge {
  getTimelineState(): { t0: number; pxPerSec: number; focusedBlockId: string | null; selectionAnchorBlockId: string | null; selectionFocusBlockId: string | null; blockCount: number; dragging: boolean; snapEnabled: boolean }
  getBlock(blockId: string): { start: number; end: number; wordCount: number } | null
  timeAtX(x: number): number
  xAtTime(t: number): number
}

async function boot(page: import('@playwright/test').Page, blocks: unknown[]): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean(window.__zipEditorBridge), undefined, { timeout: 20_000 })
  await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src), [MEDIA_ASSET, SRC] as const)
  await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
  await page.evaluate(
    ([b, speakers]) => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('editor bridge gone')
      const reject = bridge.command('captions-import', { blocks: b, speakers, replace: true })
      if (reject !== null) throw new Error(`seed rejected: ${reject.code}`)
    },
    [blocks, SAMPLE_SPEAKERS] as const,
  )
  await page.waitForFunction(() => Boolean(window.__zipTimelineBridge), undefined, { timeout: 20_000 })
}

const tl = (): TimelineBridge => (window as unknown as { __zipTimelineBridge?: TimelineBridge }).__zipTimelineBridge as TimelineBridge

test.describe('CC-103.5: keyboard-only timeline operation', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-103.5: Alt+3 → arrows focus blocks → Enter selects; the live region announces', async ({ page }) => {
    test.setTimeout(120_000)
    await boot(page, timelineBlocks())
    await page.keyboard.press('Alt+3')
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-region') === 'timeline', undefined, { timeout: 10_000 })
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => tl().getTimelineState().focusedBlockId === 'blk_v1', undefined, { timeout: 5_000 })
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => tl().getTimelineState().focusedBlockId === 'blk_v2', undefined, { timeout: 5_000 })
    await page.keyboard.press('ArrowLeft')
    await page.waitForFunction(() => tl().getTimelineState().focusedBlockId === 'blk_v1', undefined, { timeout: 5_000 })
    await expect(page.locator('[data-testid=timeline-live]'), 'FR-103.7 announcement of the focused block').toContainText('Speaker 1', { timeout: 5_000 })
    await expect(page.locator('[data-testid=timeline-live]')).toContainText('alpha beta gamma')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => tl().getTimelineState().selectionFocusBlockId === 'blk_v1', undefined, { timeout: 5_000 })
    const s = await page.evaluate(() => tl().getTimelineState())
    expect(s.selectionAnchorBlockId, 'Enter makes the focused block the whole selection').toBe('blk_v1')
  })

  test('CC-103.5: S splits the focused block at the playhead in one step', async ({ page }) => {
    test.setTimeout(120_000)
    await boot(page, timelineBlocks())
    await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.command('transport-seek', { time: 1.0 }))
    await page.keyboard.press('Alt+3')
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => tl().getTimelineState().focusedBlockId === 'blk_v1', undefined, { timeout: 5_000 })
    const before = await page.evaluate(() => tl().getTimelineState().blockCount)
    expect(before).toBe(5)
    await page.keyboard.press('s')
    await page.waitForFunction(() => tl().getTimelineState().blockCount === 6, undefined, { timeout: 5_000 })
    const state = await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState())
    expect(state?.blockCount, 'non-vacuity: a real split happened').toBe(6)
  })

  test('CC-103.5: Ctrl+Shift+M merges two adjacent selected blocks', async ({ page }) => {
    test.setTimeout(120_000)
    await boot(page, [...mergePairBlocks(), { id: 'blk_extra', start: 6.0, end: 7.0, text: 'extra tail', words: [{ text: 'extra', start: 6.0, end: 6.4 }, { text: 'tail', start: 6.5, end: 7.0 }], speakerId: 'SPK_2' }])
    const canvas = page.locator('[data-testid=timeline-canvas]')
    const box = await canvas.boundingBox()
    if (box === null) throw new Error('canvas has no box')
    const xOf = async (t: number): Promise<number> => page.evaluate((time) => tl().xAtTime(time), t)
    await canvas.click({ position: { x: await xOf(1.5), y: box.height * 0.6 } })
    await page.waitForFunction(() => tl().getTimelineState().selectionFocusBlockId === 'blk_m1', undefined, { timeout: 5_000 })
    await canvas.click({ position: { x: await xOf(2.5), y: box.height * 0.6 }, modifiers: ['Shift'] })
    await page.waitForFunction(() => tl().getTimelineState().selectionFocusBlockId === 'blk_m2', undefined, { timeout: 5_000 })
    await page.keyboard.press('Control+Shift+M')
    await page.waitForFunction(() => tl().getTimelineState().blockCount === 2, undefined, { timeout: 5_000 })
    const merged = await page.evaluate(() => tl().getBlock('blk_m1'))
    expect(merged, 'the merged block survives under a known id').not.toBeNull()
    expect(merged?.wordCount, 'words concatenated (US-2.2.3)').toBe(4)
  })

  test('CC-103.5: held-letter chords Z+← / C+→ trim the focused edge to the playhead', async ({ page }) => {
    test.setTimeout(120_000)
    await boot(page, constraintBlocks())
    await page.keyboard.press('Alt+3')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => tl().getTimelineState().focusedBlockId === 'blk_mid', undefined, { timeout: 5_000 })
    // Z+← : focused block start → playhead.
    await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.command('transport-seek', { time: 4.0 }))
    await page.keyboard.down('z')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.up('z')
    await page.waitForFunction(() => (tl().getBlock('blk_mid')?.start ?? -1) === 4.0, undefined, { timeout: 5_000 })
    const focusedAfterZ = await page.evaluate(() => tl().getTimelineState().focusedBlockId)
    expect(focusedAfterZ, 'the chord trimmed — it did NOT fall through to focus-prev').toBe('blk_mid')
    // C+→ : focused block end → playhead (the explicit numeric target dispatches as-is).
    await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.command('transport-seek', { time: 4.55 }))
    await page.keyboard.down('c')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up('c')
    await page.waitForFunction(() => (tl().getBlock('blk_mid')?.end ?? -1) === 4.55, undefined, { timeout: 5_000 })
    const trimmed = await page.evaluate(() => tl().getBlock('blk_mid'))
    expect(trimmed?.wordCount, 'all three words survive, re-derived (frozen reducer)').toBe(3)
  })

  test('CC-103.5: ⌘= / ⌘− / ⌘0 zoom the viewport', async ({ page }) => {
    test.setTimeout(120_000)
    await boot(page, timelineBlocks())
    await page.keyboard.press('Alt+3')
    const initial = await page.evaluate(() => tl().getTimelineState())
    await page.keyboard.press('Meta+=')
    await page.waitForFunction((px) => tl().getTimelineState().pxPerSec > px, initial.pxPerSec, { timeout: 5_000 })
    const zoomedIn = await page.evaluate(() => tl().getTimelineState())
    expect(zoomedIn.pxPerSec, '⌘= zoomed in').toBeGreaterThan(initial.pxPerSec)
    await page.keyboard.press('Meta+-')
    await page.keyboard.press('Meta+-')
    await page.waitForFunction((px) => tl().getTimelineState().pxPerSec < px, initial.pxPerSec, { timeout: 5_000 })
    expect((await page.evaluate(() => tl().getTimelineState())).pxPerSec, '⌘− zoomed out below the start').toBeLessThan(initial.pxPerSec)
    await page.keyboard.press('Meta+0')
    await page.waitForFunction(() => tl().getTimelineState().t0 === 0, undefined, { timeout: 5_000 })
    expect((await page.evaluate(() => tl().getTimelineState())).pxPerSec, '⌘0 fit shows the whole project (14 s at 800 px ≤ fit)').toBeLessThanOrEqual(800 / 14 + 0.01)
  })
})
