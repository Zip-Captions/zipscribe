// CC-110.4 (L5, chromium): the virtualization bound holds at 1000 blocks WITH
// the expansion mix — the perf-10k doctrine (e2e/transcript/perf-10k-scroll.
// spec.ts) at the smaller count the unit names, plus the re-measure leg the
// row model adds: when the active long row expands, the virtualizer
// RE-MEASURES it — total scroll height grows by exactly the row's growth —
// and the mounted window stays bounded. No absolute wall-clock assertions
// (conventions § Performance: structural budgets only; ≤ 3× viewport rows and
// ≤ 200 absolute, same budget as the frozen 10k bound).
//
// Bridge-light: __zipEditorBridge (openProjectWithMedia/command/
// getEditorState) + __zipTranscriptBridge.getTranscriptState — the exact
// seams perf-10k-scroll.spec.ts uses. Seeding = chunked `captions-import`
// commands. Numbers only in assertions (SECURITY-03).
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'

const SRC = '/fixtures/speech-2min.mp4'
const BLOCK_COUNT = 1_000
const CHUNK = 500
const VIEWPORT_ROWS_MAX = 200
const EXPAND_INDEX = 500 // divisible by 5 → a long-text block (see seedBlocks)

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

interface TranscriptBridge {
  getTranscriptState(): { renderedRows: number; totalRows: number; scrollTop: number; scrollHeight: number; viewportHeightPx: number; activeBlockId: string | null }
}

async function transcriptState(page: import('@playwright/test').Page): Promise<ReturnType<TranscriptBridge['getTranscriptState']>> {
  const state = await page.evaluate(() => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getTranscriptState())
  if (state === undefined) throw new Error('transcript bridge missing')
  return state
}

/** Every 5th block is multi-line (12 words); the rest are single-word.
 *  Synthetic words only; ids positional (blk_k<i>) like the frozen 10k spec. */
function chunkBlocks(offset: number, count: number): unknown[] {
  const blocks: unknown[] = []
  for (let i = offset; i < Math.min(offset + count, BLOCK_COUNT); i++) {
    const start = Math.round(i * 0.1 * 1000) / 1000
    const end = Math.round((i * 0.1 + 0.09) * 1000) / 1000
    const long = i % 5 === 0
    const words = long
      ? Array.from({ length: 12 }, (_unused, k) => ({ text: `synthetic${i}_${k}long`, start: start + k * 0.007, end: start + k * 0.007 + 0.006 }))
      : [{ text: `synthetic${i}`, start, end }]
    blocks.push({ id: `blk_k${i}`, start, end, speakerId: 'SPK_1', text: words.map((w) => w.text).join(' '), words })
  }
  return blocks
}

test.describe('CC-110.4: bounded virtualization with re-measure at 1000 blocks (expansion mix)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

  test('CC-110.4: 1000 blocks with an expanded active row — mounted window bounded, total size re-measured', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?ziptest=1')
    await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
    await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src), [MEDIA_ASSET, SRC] as const)
    await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
    await page.click('[data-testid=tab-subtitles]')
    await page.waitForFunction(() => Boolean((window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge), undefined, { timeout: 20_000 })

    for (let offset = 0; offset < BLOCK_COUNT; offset += CHUNK) {
      await page.evaluate(
        ([blocks, replace]) => {
          const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
          if (!bridge) throw new Error('editor bridge missing')
          const reject = bridge.command('captions-import', { blocks, replace })
          if (reject !== null) throw new Error(`captions-import chunk rejected: ${reject.code}`)
        },
        [chunkBlocks(offset, CHUNK), offset === 0] as const,
      )
    }
    const seeded = await transcriptState(page)
    expect(seeded.totalRows, 'all 1000 blocks seeded').toBe(BLOCK_COUNT)

    const bound = (rows: number, vh: number, when: string): void => {
      const viewportRows = Math.ceil(vh / 20)
      expect(rows, `renderedRows bounded by the virtualized window ${when} (≤ 3× viewport rows ${viewportRows * 3}; got ${rows})`).toBeLessThanOrEqual(viewportRows * 3)
      expect(rows, `renderedRows ≤ 200 absolute ${when}`).toBeLessThanOrEqual(VIEWPORT_ROWS_MAX)
      expect(rows, `rows actually rendered ${when} (non-vacuity)`).toBeGreaterThan(0)
    }
    bound(seeded.renderedRows, seeded.viewportHeightPx, 'at rest')

    // Pause follow-scroll with a USER wheel gesture (30 s window) so the
    // viewport under measurement can never be moved underneath us.
    await page.hover('[data-testid=transcript-root]')
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 240)
      await page.waitForTimeout(30)
    }

    // Playhead crosses INTO the long row → expansion (follow is paused, so
    // the mount below is purely our own scroll).
    const mid = EXPAND_INDEX * 0.1 + 0.045
    const reject = await page.evaluate(([t]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.command('transport-seek', { time: t }), [mid] as const)
    if (reject !== null && reject !== undefined) throw new Error(`transport-seek rejected: ${reject.code}`)

    // Long rows are estimate-positioned (40 px) until measured — sweep the
    // scroll offsets covering both regimes until the target mounts.
    const rowLocator = page.locator(`[data-testid=transcript-row][data-block-id=blk_k${EXPAND_INDEX}]`)
    let mounted = 0
    for (let attempt = 0; attempt < 36 && mounted === 0; attempt++) {
      await page.evaluate(
        ([offset]) => {
          const el = document.querySelector('[data-testid=transcript-root]')
          if (el !== null) el.scrollTop = offset
        },
        [9_000 + attempt * 340] as const,
      )
      await page.waitForTimeout(70)
      mounted = await rowLocator.count()
    }
    await expect(rowLocator, 'the long target row is mounted (scrolled into the window)').toHaveCount(1)
    await page.waitForTimeout(300) // let the passive measure pass settle

    // Expansion + re-measure: the active long row grows clearly beyond the
    // uniform clamp height of its clean single-word neighbour.
    const clampH = (await page.locator('[data-testid=transcript-row][data-block-id=blk_k501]').boundingBox())?.height ?? 0
    expect(clampH, 'uniform short row is a real clamped box').toBeGreaterThan(4)
    await expect
      .poll(async () => (await rowLocator.boundingBox())?.height ?? 0, { message: 'active long row expands (re-measure at 1000 blocks)', timeout: 5_000 })
      .toBeGreaterThan(clampH + 20)
    const h1 = (await rowLocator.boundingBox())?.height ?? 0
    const total1 = (await transcriptState(page)).scrollHeight

    const expanded = await transcriptState(page)
    bound(expanded.renderedRows, expanded.viewportHeightPx, 'with the expanded mix')

    // Collapse: playhead past every span → the measured size returns. Re-mount
    // the row first (sweep the offset regimes), then assert the measured
    // height — a null box (never re-mounted) must not pass vacuously — and
    // the total size re-measures DOWN by exactly the growth.
    await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.command('transport-seek', { time: 110 }))
    let remounted = 0
    for (let attempt = 0; attempt < 36 && remounted === 0; attempt++) {
      await page.evaluate(
        ([offset]) => {
          const el = document.querySelector('[data-testid=transcript-root]')
          if (el !== null) el.scrollTop = offset
        },
        [9_000 + attempt * 340] as const,
      )
      await page.waitForTimeout(70)
      remounted = await rowLocator.count()
    }
    await expect(rowLocator, 'target row re-mounted for the collapse check').toHaveCount(1)
    await page.waitForTimeout(300)
    await expect
      .poll(async () => (await rowLocator.boundingBox())?.height ?? -1, { message: 'long row collapses back (measure shrinks again)', timeout: 5_000 })
      .toBeGreaterThanOrEqual(0)
    const hBack = (await rowLocator.boundingBox())?.height ?? -1
    expect(hBack, 'collapsed height returns to the clamp baseline').toBeLessThanOrEqual(clampH + 1)
    const total2 = (await transcriptState(page)).scrollHeight
    expect(Math.abs(total1 - total2 - (h1 - clampH)), `total scroll height re-measured down by exactly the growth (expected Δ ${h1 - clampH}, measured Δ ${total1 - total2})`).toBeLessThanOrEqual(2)

    // Virtualization stays alive around the collapse/expand mix (window
    // genuinely changes under wheel input).
    const idsAt = async (): Promise<string> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid=transcript-row]'))
          .map((el) => el.getAttribute('data-block-id') ?? '')
          .join(','),
      )
    const idsStart = await idsAt()
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 240)
      await page.waitForTimeout(40)
    }
    expect(await idsAt(), 'the mounted window changed with the expansion mix mounted').not.toBe(idsStart)

    const after = await transcriptState(page)
    bound(after.renderedRows, after.viewportHeightPx, 'after collapse')
  })
})
