// CC-104.1 (L5, chromium): 10k-block transcript scroll — ≥ 55 FPS while
// scrolling (settings.yml `transcript_scroll` baseline; conventions §
// Performance: structural budgets, rAF sampler) AND a row-count bound:
// `renderedRows` is the virtualized window, never the 10k DOM nodes
// (≤ 3× viewport rows and ≤ 200 absolute — the overscan-6 budget).
// Load: 10k valid blocks generated IN-PAGE and seeded through 10 chunked
// `captions-import` commands (replace on the first) via the editor bridge —
// the same command path the UI uses. Non-vacuity: scrollTop genuinely
// increases, the mounted row-id set changes, and ≥ 100 frames are counted.
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'

const SRC = '/fixtures/speech-2min.mp4'
const BLOCK_COUNT = 10_000
const CHUNK = 1_000
const FPS_FLOOR = 55
const MIN_FRAMES = 100
const SAMPLE_MS = 2_500
const VIEWPORT_ROWS_MAX = 200

interface TranscriptBridge {
  getTranscriptState(): {
    renderedRows: number
    totalRows: number
    scrollTop: number
    scrollHeight: number
    viewportHeightPx: number
    searchOpen: boolean
    matchCount: number
    currentMatchIndex: number
    activeBlockId: string | null
    editingBlockId: string | null
    skeletonRows: number
    issueCount: number
    focusedRowBlockId: string | null
    hiddenSpeakerIds: string[]
    runningJobKind: 'transcribe' | 'align' | null
    runningJobId: string | null
  }
  getHistory(): { undoCount: number; redoCount: number }
  getWordTimings(blockId: string): Array<{ timing: string; start: number; end: number }> | null
  getBlockTimes(blockId: string): { start: number; end: number } | null
}

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

async function transcriptState(page: import('@playwright/test').Page): Promise<ReturnType<TranscriptBridge['getTranscriptState']>> {
  const state = await page.evaluate(() => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge?.getTranscriptState())
  if (state === undefined) throw new Error('transcript bridge missing')
  return state
}

test.describe('CC-104.1: 10k-block transcript — ≥ 55 FPS scroll + virtualized row bound', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-104.1: wheel-scrolling 10k blocks holds ≥ 55 FPS and renders only a bounded window', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?ziptest=1')
    await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
    await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src), [MEDIA_ASSET, SRC] as const)
    await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
    await page.click('[data-testid=tab-subtitles]')

    // Seed 10k blocks through the real command path, chunked (replace first).
    await page.evaluate(
      ([count, chunk]) => {
        const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
        if (!bridge) throw new Error('editor bridge missing')
        for (let offset = 0; offset < count; offset += chunk) {
          const blocks = []
          for (let i = offset; i < Math.min(offset + chunk, count); i++) {
            const start = Math.round(i * 0.012 * 1000) / 1000
            const end = Math.round((i * 0.012 + 0.011) * 1000) / 1000
            blocks.push({ id: `blk_k${i}`, start, end, speakerId: 'SPK_1', text: `synthetic${i}`, words: [{ text: `synthetic${i}`, start, end }] })
          }
          const reject = bridge.command('captions-import', { blocks, replace: offset === 0 })
          if (reject !== null) throw new Error(`captions-import chunk rejected: ${reject.code}`)
        }
      },
      [BLOCK_COUNT, CHUNK] as const,
    )

    // The transcript bridge is the acceptance seam (unit104-api-contract.d.ts).
    await page.waitForFunction(() => Boolean((window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge), undefined, { timeout: 20_000 })
    const seeded = await transcriptState(page)
    expect(seeded.totalRows, 'all 10k blocks seeded').toBe(BLOCK_COUNT)

    // Row-count bound (structural virtualization budget, no timing).
    const viewportRows = Math.ceil(seeded.viewportHeightPx / 20)
    expect(seeded.renderedRows, `renderedRows bounded by the virtualized window (≤ 3× viewport rows ${viewportRows * 3}; got ${seeded.renderedRows})`).toBeLessThanOrEqual(viewportRows * 3)
    expect(seeded.renderedRows, 'renderedRows ≤ 200 absolute').toBeLessThanOrEqual(VIEWPORT_ROWS_MAX)
    expect(seeded.renderedRows, 'rows actually rendered (non-vacuity)').toBeGreaterThan(0)

    await page.hover('[data-testid=transcript-root]')
    const idsAt = async (): Promise<string> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid=transcript-row]'))
          .map((el) => el.getAttribute('data-block-id') ?? '')
          .join(','),
      )
    const startTop = (await transcriptState(page)).scrollTop
    const idsStart = await idsAt()

    // rAF sampler + continuous wheel scroll for SAMPLE_MS.
    const sampler = page.evaluate(async (sampleMs) => {
      const stamps: number[] = []
      return await new Promise<{ fps: number; frames: number }>((resolve) => {
        const begin = performance.now()
        const tick = (): void => {
          stamps.push(performance.now())
          if (performance.now() - begin < sampleMs) {
            requestAnimationFrame(tick)
            return
          }
          const elapsed = (stamps[stamps.length - 1] ?? begin) - (stamps[0] ?? begin)
          resolve({ fps: ((stamps.length - 1) / elapsed) * 1000, frames: stamps.length })
        }
        requestAnimationFrame(tick)
      })
    }, SAMPLE_MS)
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 240)
      await page.waitForTimeout(80)
    }
    const sample = await sampler
    expect(sample.frames, `the sampler counted ≥ ${MIN_FRAMES} frames (non-vacuity)`).toBeGreaterThanOrEqual(MIN_FRAMES)
    expect(sample.fps, `≥ 55 FPS while wheel-scrolling 10k virtualized rows (measured ${sample.fps.toFixed(1)} FPS)`).toBeGreaterThanOrEqual(FPS_FLOOR)

    // Non-vacuity of the scroll itself: the viewport genuinely moved and the
    // mounted window genuinely changed.
    const endTop = (await transcriptState(page)).scrollTop
    expect(endTop, 'scrollTop genuinely increased under wheel input').toBeGreaterThan(startTop)
    const idsEnd = await idsAt()
    expect(idsEnd, 'the mounted row window changed (real virtualization, not a static pool)').not.toBe(idsStart)
  })
})
