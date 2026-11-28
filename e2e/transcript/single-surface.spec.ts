// CC-110.8 (L5, chromium): SINGLE transcript surface — the #52 dual-mount
// (unit-101 TranscriptPane + unit-104 Transcript mounted together in the
// same tabpanel, Workbench.tsx:948–966) collapses to ONE list at a time, and
// streaming keeps its rows VISIBLE in that same surface.
//
// Frozen-nuance record (unit-110 brief — NO frozen test was edited):
//   • tests/unit/workbench/workbench-shell.test.tsx:109 and
//     e2e/workbench/layout.spec.ts:50–55 pin `streaming-segment-row` rows
//     RENDERING during a streaming job — both only in STREAMING state;
//     neither requires the TranscriptPane list to be mounted WHILE the real
//     transcript is on screen. The honest reachable design therefore: one
//     transcript list mounted at any instant (streaming is a mode of it),
//     keeping the frozen `streaming-segment-row` test id for streamed
//     segments. Before/after DOM: today [role=list] transcript surfaces in
//     #tabpanel-subtitles = 2 (Transcript + TranscriptPane, both mounted in
//     every Subtitles-tab view); after = 1. If the builder's design keeps the
//     second list mounted underneath, THAT is the frozen conflict to record
//     as BLOCKED — never an edit of the 101 suites.
//
// Bridge-light: existing seams only (__zipEditorBridge, __zipWorkbenchBridge.
// injectAsrEvent — the layout.spec.ts streaming pattern). Committed rows come
// from the shared L2 fixture helper (transcriptBlocks — same module the
// frozen accessibility spec imports). Canary redaction: the fixture's canary
// marker must never reach the console (SECURITY-03).
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET, makeSegments } from '../../tests/unit/workbench/helpers/fake-engine'
import { CANARY_MARKER, transcriptBlocks } from '../../tests/unit/transcript/helpers/transcript-fixture'

const SRC = '/fixtures/speech-2min.mp4'
const JOB_ID = 'job-surface-1'
const SEGMENT_COUNT = 6

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

interface WorkbenchBridge {
  injectAsrEvent(event: { t: string; jobId: string; segments?: unknown[]; processedSec?: number; totalSec?: number }): void
}

/** Transcript surfaces: role=list elements in the Subtitles tabpanel whose
 *  accessible name identifies a transcript list (today: "Transcript" and
 *  "Streaming transcript"; a unified single surface must answer 1). */
async function transcriptListCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#tabpanel-subtitles [role=list]')).filter((el) => /transcript/iu.test(el.getAttribute('aria-label') ?? '')).length,
  )
}

async function mountWithBlocks(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
  await page.evaluate(
    ([asset, src, blocks]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src, blocks),
    [MEDIA_ASSET, SRC, transcriptBlocks()] as const,
  )
  await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
  await page.click('[data-testid=tab-subtitles]')
  await expect(page.getByTestId('transcript-row').first(), 'committed rows rendered').toBeVisible({ timeout: 15_000 })
}

test.describe('CC-110.8: one transcript surface mounted at a time (streaming is a mode of it)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

  test('CC-110.8: with a real transcript on screen, exactly ONE transcript list exists in the tabpanel', async ({ page }) => {
    test.setTimeout(90_000)
    const consoleTexts: string[] = []
    page.on('console', (msg) => consoleTexts.push(msg.text()))
    await mountWithBlocks(page)

    expect(await transcriptListCount(page), 'the dual mount (101 streaming pane + 104 transcript) is gone — one list at a time (#52)').toBe(1)
    expect(await page.getByTestId('transcript-row').count(), 'the single surface carries the committed rows').toBeGreaterThan(0)
    expect(consoleTexts.filter((t) => t.includes(CANARY_MARKER)), 'canary never logged (SECURITY-03)').toHaveLength(0)
  })

  test('CC-110.8: streaming keeps rows visible while still mounting only ONE transcript list', async ({ page }) => {
    test.setTimeout(90_000)
    const consoleTexts: string[] = []
    page.on('console', (msg) => consoleTexts.push(msg.text()))
    await mountWithBlocks(page)
    expect(await transcriptListCount(page), 'one list before streaming too').toBe(1)

    // Same streaming path the frozen CLS spec (layout.spec.ts) drives.
    await page.evaluate(
      ([jobId]) => (window as unknown as { __zipWorkbenchBridge?: WorkbenchBridge }).__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:progress', jobId, processedSec: 1, totalSec: 121.44 }),
      [JOB_ID] as const,
    )
    await page.evaluate(
      ([jobId, count]) => (window as unknown as { __zipWorkbenchBridge?: WorkbenchBridge }).__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:segments', jobId, segments: makeSegments(count) }),
      [JOB_ID, SEGMENT_COUNT] as const,
    )
    await expect
      .poll(async () => page.locator('[data-testid=streaming-segment-row]').count(), { message: 'streamed segments reach the DOM (frozen 101 contract)', timeout: 15_000 })
      .toBeGreaterThanOrEqual(SEGMENT_COUNT)

    // Single surface DURING streaming: still exactly one transcript list…
    expect(await transcriptListCount(page), 'one transcript surface during streaming (the second pane must not mount alongside)').toBe(1)
    // …and BOTH truths hold: committed rows stay visible, streaming rows show.
    expect(await page.getByTestId('transcript-row').count(), 'committed rows stay visible in streaming mode (rows kept visible)').toBeGreaterThan(0)
    expect(consoleTexts.filter((t) => t.includes(CANARY_MARKER)), 'canary never logged (SECURITY-03)').toHaveLength(0)
  })
})
