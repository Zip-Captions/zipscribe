// CC-110.1 (L5, chromium, 1440×900) — STRENGTHENING leg: the #48 rect audit
// extended to the STREAMING rows (review-r2 F2). CC-110.1's scan in
// row-layout.spec.ts covers committed `transcript-row`s only; the frozen
// unit-101 `streaming-segment-row` rows moved INTO this surface with the
// CC-110.8 mount, and a pinned inline height let long wrapped utterances
// paint 117–135 px over the rows below — the #48 class re-introduced in
// streaming mode. This leg drives streaming through the sanctioned seams
// (the ziptest-gated `makeSegments` page helper + `injectAsrEvent`, exactly
// the frozen single-surface.spec.ts pattern) with LONG wrappable segment
// texts and audits DOM rects WHILE STREAMING: zero text outside the row box,
// zero row→row overlap. Rects/counts/attrs only, generated filler text —
// SECURITY-03 clean; the fixture canary must never reach the console.
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'
import { CANARY_MARKER, transcriptBlocks } from '../../tests/unit/transcript/helpers/transcript-fixture'

const SRC = '/fixtures/speech-2min.mp4'
const JOB_ID = 'job-spill-1'
const SEGMENT_COUNT = 4
/** ~24 short words per segment (~300 chars) — the review's >110-char
 *  whisper-utterance class: several wrapped lines (measured, ≥ 60 px of
 *  text) while keeping at least one row fully inside the viewport for the
 *  fully-inside-filtered rect audit (the row-layout helper shape). */
const WORDS_PER_SEGMENT = 24
const TOL = 1.5

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

interface WorkbenchBridge {
  injectAsrEvent(event: { t: string; jobId: string; segments?: unknown[]; processedSec?: number; totalSec?: number }): void
}

interface RectData {
  top: number
  bottom: number
  left: number
  right: number
}

interface StreamAudit {
  rows: number
  insideCount: number
  grownRows: number
  maxTextHeight: number
  spill: number
  maxSpill: number
  overlap: number
  maxOverlap: number
}

async function bridgeReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
  await page.evaluate(([asset, src, blocks]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src, blocks), [MEDIA_ASSET, SRC, transcriptBlocks()] as const)
  await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
  await page.click('[data-testid=tab-subtitles]')
  await expect(page.getByTestId('transcript-row').first(), 'committed rows rendered').toBeVisible({ timeout: 15_000 })
}

/** Streaming rows carry LONG wrappable texts through the sanctioned
 *  page-side `makeSegments` seam (the frozen single-surface pattern — the
 *  same helper, exercised with its textFor parameter). */
async function injectLongSegments(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    ([jobId]) => (window as unknown as { __zipWorkbenchBridge?: WorkbenchBridge }).__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:progress', jobId, processedSec: 1, totalSec: 121.44 }),
    [JOB_ID] as const,
  )
  await page.evaluate(
    ([jobId, count, words]) => {
      const bridge = (window as unknown as { __zipWorkbenchBridge?: WorkbenchBridge }).__zipWorkbenchBridge
      const make = (window as unknown as { makeSegments?: (count: number, textFor?: (index: number) => string) => unknown[] }).makeSegments
      if (bridge === undefined || make === undefined) throw new Error('workbench bridge missing')
      const textFor = (index: number): string => Array.from({ length: words }, (_unused, k) => `seg${String(index)}filler${String(k)}x`).join(' ')
      bridge.injectAsrEvent({ t: 'job:segments', jobId, segments: make(count, textFor) })
    },
    [JOB_ID, SEGMENT_COUNT, WORDS_PER_SEGMENT] as const,
  )
}

/** Review-r2 F1 doctrine applied to the new leg: wait until every mounted
 *  streaming row's rect is stable across TWO consecutive animation frames —
 *  the measureElement ResizeObserver pass is async relative to the DOM
 *  mutation, and measuring mid-pass would race the audit. */
async function waitForStreamQuiescence(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 5_000
        let prev: number[] | null = null
        const sample = (): void => {
          const rows = Array.from(document.querySelectorAll('[data-testid=transcript-root] [data-testid=streaming-segment-row]'))
          const cur: number[] = []
          for (const row of rows) {
            const r = row.getBoundingClientRect()
            cur.push(r.top, r.bottom)
          }
          const stable = prev !== null && cur.length === prev.length && cur.every((value, index) => Math.abs(value - (prev?.[index] ?? 0)) <= 0.5)
          if (cur.length > 0 && stable) {
            resolve()
            return
          }
          prev = cur
          if (performance.now() > deadline) {
            reject(new Error('quiescence probe: streaming layout never settled'))
            return
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }),
  )
}

async function auditStreamingRows(page: import('@playwright/test').Page): Promise<StreamAudit> {
  return page.evaluate((tol) => {
    const container = document.querySelector('[data-testid=transcript-root]')
    if (container === null) throw new Error('transcript root missing')
    const c = container.getBoundingClientRect()
    const rowRect = (el: Element): RectData => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    }
    const streamRows = Array.from(container.querySelectorAll('[data-testid=streaming-segment-row]'))
    // Overlap targets: EVERY row box in the surface (streaming AND
    // committed) — spill paints over whatever sits beneath. The audit skips
    // the row's OWN box by element identity (not index: the target list is
    // the whole surface, the source list is streaming-only).
    const targetEls = Array.from(container.querySelectorAll('[data-testid=streaming-segment-row], [data-testid=transcript-row]'))
    const targetBoxes = targetEls.map(rowRect)
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
    let grownRows = 0
    let maxTextHeight = 0
    const selfBoxes = streamRows.map(rowRect)
    streamRows.forEach((row, i) => {
      const own = selfBoxes[i] as RectData
      if (own.bottom - own.top > 28) grownRows += 1
      const fullyInside = own.top >= c.top - tol && own.bottom <= c.bottom + tol
      if (!fullyInside) return
      insideCount += 1
      const parts = (['ts-stream-text', 'ts-stream-time'] as const)
        .map((cls) => row.querySelector(`.${cls}`))
        .filter((el): el is Element => el !== null)
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, isText: el.classList.contains('ts-stream-text') }
        })
      for (const p of parts) {
        if (p.isText) maxTextHeight = Math.max(maxTextHeight, p.bottom - p.top)
        const over = Math.max(0, p.bottom - own.bottom, own.top - p.top)
        if (over > tol) {
          spill += 1
          maxSpill = Math.max(maxSpill, over)
        }
        targetEls.forEach((el, j) => {
          if (el === row) return
          const box = targetBoxes[j] as RectData
          const area = intersect(p, box)
          if (area > tol * tol) {
            overlap += 1
            maxOverlap = Math.max(maxOverlap, area)
          }
        })
      }
    })
    return { rows: streamRows.length, insideCount, grownRows, maxTextHeight, spill, maxSpill, overlap, maxOverlap }
  }, TOL)
}

test.describe('CC-110.1 (strengthened): streaming rows keep wrapped text inside their boxes — zero spill over rows below WHILE STREAMING', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

  test('CC-110.1: long wrapped streaming segments never paint over the rows below (streaming-mode #48 audit)', async ({ page }) => {
    test.setTimeout(90_000)
    const consoleTexts: string[] = []
    page.on('console', (msg) => consoleTexts.push(msg.text()))
    await bridgeReady(page)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid=transcript-root]')
      if (el !== null) el.scrollTop = 0
    })

    await injectLongSegments(page)
    await expect
      .poll(async () => page.locator('[data-testid=streaming-segment-row]').count(), { message: 'streamed segments reach the DOM (frozen 101 contract)', timeout: 15_000 })
      .toBeGreaterThanOrEqual(SEGMENT_COUNT)
    await waitForStreamQuiescence(page)

    const audit = await auditStreamingRows(page)
    // THE acceptance assertions (review-r2 F2 — the #48 class in streaming
    // mode): no part of a streaming row paints outside its box, and no
    // streaming text rect lands over ANY other row box.
    expect(audit.spill, `streaming row→text spill out of the row box (max spill ${String(audit.maxSpill)}px, ${String(audit.spill)} offenders)`).toBe(0)
    expect(audit.overlap, `streaming text over another row box (max overlap area ${String(audit.maxOverlap)}px², ${String(audit.overlap)} offenders)`).toBe(0)
    // Non-vacuity: the audit measured REAL wrapped content — the segments
    // mounted, boxes were measured multi-line tall (a pinned 26 px box with
    // overflowing text is exactly what the spill assertions above reject).
    expect(audit.rows, 'streaming rows were audited (non-vacuity)').toBeGreaterThanOrEqual(SEGMENT_COUNT)
    expect(audit.insideCount, 'fully-inside streaming rows were audited (non-vacuity)').toBeGreaterThanOrEqual(1)
    expect(audit.grownRows, 'streaming rows were MEASURED past the single-line estimate (measureElement grew the box)').toBeGreaterThanOrEqual(1)
    expect(audit.maxTextHeight, 'a mounted streaming row carries long multi-line wrapped content (the streaming #48 class)').toBeGreaterThanOrEqual(60)
    expect(consoleTexts.filter((t) => t.includes(CANARY_MARKER)), 'canary never logged (SECURITY-03)').toHaveLength(0)
  })
})
