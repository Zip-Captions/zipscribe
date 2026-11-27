// CC-110.1 CC-110.2 CC-110.3 (L5, chromium, 1440×900): the #48 overflow
// family proven where it was observed — a REAL-content project on the
// production build. DOM-rect assertions only: numbers, rects, counts and
// attributes; ZERO transcript strings ever enter an assertion, message or
// artifact (SECURITY-03). Fixed viewport 1440×900, DPR 1 (deterministic
// wrap points with the bundled fonts).
//
// Bridge-light (spec § Technical Specification): reuses ONLY the seams the
// existing transcript specs already use — __zipEditorBridge
// (openProjectWithMedia/command/getEditorState), __zipTranscriptBridge
// (getTranscriptState) and the REAL import UI (the DataTransfer drop +
// caption-import dialog from e2e/transcript/import-qc-flow.spec.ts). NO new
// src/ui/testing bridge methods.
//
// Fixture route: fixtures/captions/senate-veterans-2min.srt (59 real long
// blocks) through the real drop-import dialog, then the US-110.1 "200 blocks"
// floor completed with 141 generated long-text blocks through the same
// `captions-import` command path perf-10k-scroll.spec.ts uses (numbers only).
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'

const SRC = '/fixtures/speech-2min.mp4'
const SENATE_SRT = Array.from(readFileSync('fixtures/captions/senate-veterans-2min.srt'))
const SENATE_CUES = 59
const TARGET_BLOCKS = 200
const TOL = 1.5

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

interface TranscriptBridge {
  getTranscriptState(): { renderedRows: number; totalRows: number; scrollTop: number; scrollHeight: number; viewportHeightPx: number; activeBlockId: string | null }
}

type RectData = { top: number; bottom: number; left: number; right: number }

interface RowMeasure {
  row: RectData
  parts: RectData[]
  words: number
}

interface OverflowReport {
  mounted: number
  insideCount: number
  spill: number
  maxSpill: number
  overlap: number
  maxOverlap: number
  maxWords: number
  scrollTop: number
}

async function bridgeReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
  await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src), [MEDIA_ASSET, SRC] as const)
  await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
  await page.click('[data-testid=tab-subtitles]')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge), undefined, { timeout: 20_000 })
}

async function totalRows(page: import('@playwright/test').Page): Promise<number> {
  const state = await page.evaluate(() => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getTranscriptState())
  if (state === undefined) throw new Error('transcript bridge missing')
  return state.totalRows
}

async function seek(page: import('@playwright/test').Page, time: number): Promise<void> {
  const reject = await page.evaluate(([t]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.command('transport-seek', { time: t }), [time] as const)
  if (reject !== null && reject !== undefined) throw new Error(`transport-seek rejected: ${reject.code}`)
}

function rowLocator(page: import('@playwright/test').Page, blockId: string): import('@playwright/test').Locator {
  return page.locator(`[data-testid=transcript-row][data-block-id=${blockId}]`)
}

async function measureOverflow(page: import('@playwright/test').Page): Promise<OverflowReport> {
  return page.evaluate((tol) => {
    const container = document.querySelector('[data-testid=transcript-root]')
    if (container === null) throw new Error('transcript root missing')
    const c = container.getBoundingClientRect()
    const rows = Array.from(container.querySelectorAll('[data-testid=transcript-row]'))
    const measures: RowMeasure[] = rows.map((row) => {
      const parts = (['transcript-row-text', 'transcript-row-timecode', 'transcript-row-chip'] as const)
        .map((testId) => row.querySelector(`[data-testid=${testId}]`))
        .filter((el): el is Element => el !== null)
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
        })
      const rb = row.getBoundingClientRect()
      return { row: { top: rb.top, bottom: rb.bottom, left: rb.left, right: rb.right }, parts, words: row.querySelectorAll('[data-testid=transcript-word]').length }
    })
    const intersect = (a: RectData, b: RectData): number => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      return w > 0 && h > 0 ? w * h : 0
    }
    let spill = 0
    let maxSpill = 0
    let overlap = 0
    let maxOverlap = 0
    let insideCount = 0
    measures.forEach((m, i) => {
      const fullyInside = m.row.top >= c.top - tol && m.row.bottom <= c.bottom + tol
      if (fullyInside) {
        insideCount += 1
        for (const p of m.parts) {
          const over = Math.max(0, p.bottom - m.row.bottom, m.row.top - p.top)
          if (over > tol) {
            spill += 1
            maxSpill = Math.max(maxSpill, over)
          }
        }
      }
      measures.forEach((other, j) => {
        if (i === j) return
        for (const p of m.parts) {
          const area = intersect(p, other.row)
          if (area > tol * tol) {
            overlap += 1
            maxOverlap = Math.max(maxOverlap, area)
          }
        }
      })
    })
    return {
      mounted: measures.length,
      insideCount,
      spill,
      maxSpill,
      overlap,
      maxOverlap,
      maxWords: measures.reduce((max, m) => Math.max(max, m.words), 0),
      scrollTop: container.scrollTop,
    }
  }, TOL)
}

/** Long-text seed (CC-110.2/.3): uniform clean shorts + one multi-line block
 *  with a known neighbour; synthetic words only, no assertion ever names text. */
function expansionBlocks(): unknown[] {
  const blocks: unknown[] = []
  const shorts: Array<[string, number, number]> = [
    ['blk_s0', 0.2, 1.2],
    ['blk_s1', 1.4, 2.4],
    ['blk_s2', 2.6, 3.6],
    ['blk_s3', 3.8, 4.8],
    ['blk_next', 8, 9],
    ['blk_s5', 9.2, 10.2],
    ['blk_s6', 10.4, 11.4],
  ]
  // Time-ordered: `captions-import` rejects BLOCKS_UNSORTED — blk_long sits
  // between blk_s3 and blk_next. Text is the words joined (TEXT_WORD_MISMATCH
  // is rejected by the frozen command validation).
  const pushBlock = (id: string, start: number, end: number, count: number, pad: string): void => {
    const blockWords = Array.from({ length: count }, (_unused, index) => ({ text: `${id}w${index}${pad}`, start: start + ((end - start) * index) / count, end: start + ((end - start) * (index + 1)) / count }))
    blocks.push({ id, start, end, speakerId: 'SPK_1', text: blockWords.map((w) => w.text).join(' '), words: blockWords })
  }
  for (const [id, start, end] of shorts) {
    if (id === 'blk_next') pushBlock('blk_long', 5, 8, 24, 'padding')
    pushBlock(id, start, end, 3, '')
  }
  return blocks
}

test.describe('CC-110.1 CC-110.2 CC-110.3: transcript row model — zero overlap at 1440×900 · expand/collapse · expand-before-edit', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

  test('CC-110.1: real-content fixture project — zero row→row text overlap and zero spill out of the row box', async ({ page }) => {
    test.setTimeout(120_000)
    await bridgeReady(page)

    // Real import route (identical to import-qc-flow.spec.ts): shell drop →
    // report → confirm. The frozen report numbers for this fixture pin the
    // route actually loaded the real block set.
    await page.evaluate(
      ([bytes]) => {
        const file = new File([new Uint8Array(bytes)], 'senate-veterans-2min.srt', { type: 'application/x-subrip' })
        const dt = new DataTransfer()
        dt.items.add(file)
        const shell = document.querySelector('[data-testid=workbench-shell]')
        if (shell === null) throw new Error('workbench shell missing')
        shell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      },
      [SENATE_SRT] as const,
    )
    const dialog = page.getByTestId('caption-import-dialog')
    await expect(dialog, 'import dialog opens on drop over an open project').toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('caption-import-report-blocks'), 'the real fixture loaded through the real route').toHaveText(String(SENATE_CUES))
    await page.getByTestId('caption-import-confirm').click()
    await expect.poll(async () => totalRows(page), 'import landed').toBe(SENATE_CUES)

    // US-110.1 floor: 200 blocks — the remainder lands through the same
    // command path perf-10k-scroll.spec.ts uses (chunked, replace:false).
    await page.evaluate(
      ([from, to]) => {
        const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
        if (!bridge) throw new Error('editor bridge missing')
        const blocks = []
        for (let i = from; i < to; i++) {
          const start = 130 + (i - from) * 2
          const end = start + 2
          const textWords = Array.from({ length: 12 }, (_unused, k) => `filler${i}_${k}x`)
          blocks.push({ id: `blk_f${i}`, start, end, speakerId: 'SPK_1', text: textWords.join(' '), words: textWords.map((text, k) => ({ text, start: start + k * 0.16, end: start + k * 0.16 + 0.1 })) })
        }
        const reject = bridge.command('captions-import', { blocks, replace: false })
        if (reject !== null) throw new Error(`captions-import fill rejected: ${reject.code}`)
      },
      [SENATE_CUES, TARGET_BLOCKS] as const,
    )
    expect(await totalRows(page), 'the US-110.1 200-block floor').toBe(TARGET_BLOCKS)

    await page.hover('[data-testid=transcript-root]')
    let mountedTotal = 0
    let insideTotal = 0
    let maxWords = 0
    for (const scroll of [8, 30]) {
      for (let i = 0; i < scroll; i++) {
        await page.mouse.wheel(0, 240)
        await page.waitForTimeout(20)
      }
      await page.waitForTimeout(150)
      const report = await measureOverflow(page)
      // THE acceptance assertions (issue #48 verbatim): nothing spills out of
      // its row box, nothing paints over another row.
      expect(report.spill, `row→text spill out of the row box at scrollTop ${report.scrollTop} (max spill ${report.maxSpill}px, ${report.spill} offenders)`).toBe(0)
      expect(report.overlap, `row→row text overlap at scrollTop ${report.scrollTop} (max overlap area ${report.maxOverlap}px², ${report.overlap} offenders)`).toBe(0)
      mountedTotal += report.mounted
      insideTotal += report.insideCount
      maxWords = Math.max(maxWords, report.maxWords)
    }
    // Non-vacuity: the measurements actually covered long real content.
    expect(mountedTotal, 'mounted rows were measured (non-vacuity)').toBeGreaterThan(20)
    expect(insideTotal, 'fully-inside rows were measured (non-vacuity)').toBeGreaterThan(10)
    expect(maxWords, 'a mounted row carries long multi-line content (the #48 overflow class)').toBeGreaterThanOrEqual(10)
  })

  test('CC-110.2: active row expands to full text; rows below shift exactly by the growth; collapse on exit', async ({ page }) => {
    test.setTimeout(90_000)
    await bridgeReady(page)
    await page.evaluate(([blocks]) => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('editor bridge missing')
      const reject = bridge.command('captions-import', { blocks, replace: true })
      if (reject !== null) throw new Error(`captions-import rejected: ${reject.code}`)
    }, [expansionBlocks()] as const)
    expect(await totalRows(page)).toBe(8)

    await seek(page, 0)
    const longRow = rowLocator(page, 'blk_long')
    const below = rowLocator(page, 'blk_next')
    await expect(longRow).toBeVisible()
    const scrollRoot = page.getByTestId('transcript-root')
    await scrollRoot.evaluate((el) => {
      el.scrollTop = 0
    })

    const h0 = (await longRow.boundingBox())?.height ?? 0
    const belowTop0 = (await below.boundingBox())?.y ?? 0
    expect(h0, 'baseline row height is a real box').toBeGreaterThan(4)
    // Clamp today (and after the fix): the long text never exceeds its box.
    const text0 = (await longRow.locator('[data-testid=transcript-row-text]').boundingBox()) ?? { height: 0, y: 0 }
    expect(text0.y + text0.height, 'clamped inactive row keeps its text inside the row box').toBeLessThanOrEqual((await longRow.boundingBox())!.y + h0 + TOL)

    // Playhead crosses INTO blk_long (5–8): the row expands, rows below shift
    // EXACTLY by the growth.
    await seek(page, 6.5)
    await expect
      .poll(async () => (await longRow.boundingBox())?.height ?? 0, { message: 'active row (playhead in span) expands beyond its clamp', timeout: 5_000 })
      .toBeGreaterThan(h0 + 20)
    const h1 = (await longRow.boundingBox())?.height ?? 0
    const belowTop1 = (await below.boundingBox())?.y ?? 0
    const text1 = (await longRow.locator('[data-testid=transcript-row-text]').boundingBox()) ?? { height: 0, y: 0 }
    expect(text1.y + text1.height, 'expanded row shows the FULL text inside its own box').toBeLessThanOrEqual((await longRow.boundingBox())!.y + h1 + TOL)
    expect(Math.abs(belowTop1 - belowTop0 - (h1 - h0)), `rows below shift exactly by the growth (expected Δ ${h1 - h0}, measured Δ ${belowTop1 - belowTop0})`).toBeLessThanOrEqual(1)

    // Playhead leaves the span → collapse back to the clamp.
    await seek(page, 12)
    await expect
      .poll(async () => (await longRow.boundingBox())?.height ?? 0, { message: 'row collapses when the playhead leaves', timeout: 5_000 })
      .toBeLessThanOrEqual(h0 + 1)
    const belowTop2 = (await below.boundingBox())?.y ?? 0
    expect(Math.abs(belowTop2 - belowTop0), 'rows below return to their pre-expansion positions').toBeLessThanOrEqual(1)
  })

  test('CC-110.3: click-to-edit expands FIRST — the frozen word-dblclick editor never renders inside clipped text', async ({ page }) => {
    test.setTimeout(90_000)
    await bridgeReady(page)
    await page.evaluate(([blocks]) => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('editor bridge missing')
      const reject = bridge.command('captions-import', { blocks, replace: true })
      if (reject !== null) throw new Error(`captions-import rejected: ${reject.code}`)
    }, [expansionBlocks()] as const)
    await seek(page, 12)

    const longRow = rowLocator(page, 'blk_long')
    await expect(longRow).toBeVisible()
    const h0 = (await longRow.boundingBox())?.height ?? 0

    // The frozen CC-104.3 path: double-click the first word (first line —
    // reachable even while the rest is clipped) opens the in-place editor.
    await longRow.locator('[data-testid=transcript-word]').first().dblclick()
    const editor = page.getByTestId('transcript-editor')
    await expect(editor, 'frozen word-dblclick path still opens the editor').toBeVisible({ timeout: 10_000 })
    expect(await longRow.getAttribute('data-row-state'), 'the row is expanded before/while the editor renders').toBe('expanded')
    const h1 = (await longRow.boundingBox())?.height ?? 0
    expect(h1, 'the row under edit is expanded beyond the clamp').toBeGreaterThan(h0 + 20)
    const editorBox = await editor.boundingBox()
    const rowBox = await longRow.boundingBox()
    expect((editorBox?.y ?? 0) + (editorBox?.height ?? 0), 'the editor renders fully inside the expanded row — never inside clipped text').toBeLessThanOrEqual((rowBox?.y ?? 0) + (rowBox?.height ?? 0) + 2)
    expect(await longRow.locator('[data-testid=transcript-row-timecode]').count(), 'FR-104.1 fixed timecode slot survives (frozen)').toBe(1)
  })
})
