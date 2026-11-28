// CC-110.5 (L5, chromium): no main-thread long task > 50 ms ATTRIBUTABLE TO
// ROW EXPANSION during scripted playback that crosses long-row boundaries —
// the #48 "expansion only on time-boundary crossings keeps the 50 ms gate"
// acceptance, in the longtask doctrine of e2e/asr/longtask.spec.ts (page
// PerformanceObserver('longtask'); workers never appear here, so a > 50 ms
// entry on the page IS main-thread UI work).
//
// CI tolerance (FR-110.2 / conventions § Performance): the 50 ms limit is the
// contract; attribution makes the gate honest — an entry counts only when it
// lands inside the scripted-playback window AND within 300 ms of an observed
// expansion jump, so unrelated Playwright/GC noise outside the leg can never
// redden it. No absolute wall-clock assertions. Numbers only (SECURITY-03).
//
// Bridge-light: __zipEditorBridge + __zipTranscriptBridge only (existing
// seams). Non-vacuity is the expansion witness itself: if the row model never
// expands (today), the leg never exercised the thing under test and the
// witness assertion is RED — the honest red for a not-yet-implemented leg.
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'

const SRC = '/fixtures/speech-2min.mp4'
const LONG_TASK_LIMIT_MS = 50
const ATTRIBUTION_WINDOW_MS = 300
const BLOCK_COUNT = 60
const MIN_GROWTH_PX = 4
const MIN_GROWN_BLOCKS = 5

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

interface TranscriptBridge {
  getTranscriptState(): { activeBlockId: string | null }
}

interface Jump {
  t: number
  id: string
  from: number
  to: number
}

interface LongTaskEntry {
  startTime: number
  duration: number
  name: string
}

interface SamplerResult {
  jumps: Jump[]
  t0: number
  t1: number
}

/** Even indices: 12-word long rows (2 s); odd: single-word shorts. Contiguous
 *  0–90 s, synthetic words only. */
function playbackBlocks(): unknown[] {
  const blocks: unknown[] = []
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const start = Math.round(i * 1.5 * 1000) / 1000
    const end = Math.round((i * 1.5 + 1.4) * 1000) / 1000
    const long = i % 2 === 0
    const words = long
      ? Array.from({ length: 12 }, (_unused, k) => ({ text: `walk${i}_${k}longer`, start: start + k * 0.11, end: start + k * 0.11 + 0.1 }))
      : [{ text: `step${i}`, start, end }]
    blocks.push({ id: `blk_w${i}`, start, end, speakerId: 'SPK_1', text: words.map((w) => w.text).join(' '), words })
  }
  return blocks
}

test.describe('CC-110.5: scripted playback across long rows — no > 50 ms expansion-attributed long task', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

  test('CC-110.5: boundary-crossing playback keeps expansion-attributed long tasks at zero (expansion witness non-vacuous)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.addInitScript(() => {
      const sink: Array<{ startTime: number; duration: number; name: string }> = []
      ;(window as unknown as { __zipLongTasks: typeof sink }).__zipLongTasks = sink
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) sink.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name })
      }).observe({ type: 'longtask', buffered: false })
      ;(window as unknown as { __zipStopSampler: boolean }).__zipStopSampler = false
    })

    await page.goto('/?ziptest=1')
    await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
    await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src), [MEDIA_ASSET, SRC] as const)
    await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
    await page.click('[data-testid=tab-subtitles]')
    await page.waitForFunction(() => Boolean((window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge), undefined, { timeout: 20_000 })

    await page.evaluate(([blocks]) => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('editor bridge missing')
      const reject = bridge.command('captions-import', { blocks, replace: true })
      if (reject !== null) throw new Error(`captions-import rejected: ${reject.code}`)
    }, [playbackBlocks()] as const)
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __zipTranscriptBridge?: TranscriptBridge; __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().seekCount ?? -1))
      .toBeGreaterThanOrEqual(0)

    // In-page rAF witness: records every > MIN_GROWTH_PX height change of the
    // currently-active row (expansion jumps), on the performance.now timeline.
    const samplerPromise = page.evaluate(
      async ([minGrowth]) => {
        const w = window as unknown as { __zipStopSampler: boolean; __zipEditorBridge?: EditorBridge; __zipTranscriptBridge?: TranscriptBridge }
        const jumps: Jump[] = []
        const last = new Map<string, number>()
        const t0 = performance.now()
        while (w.__zipStopSampler !== true) {
          const activeId = w.__zipTranscriptBridge?.getTranscriptState().activeBlockId ?? null
          if (activeId !== null) {
            const row = document.querySelector(`[data-testid=transcript-row][data-block-id=${activeId}]`)
            if (row !== null) {
              const h = row.getBoundingClientRect().height
              const prev = last.get(activeId) ?? h
              if (Math.abs(h - prev) > minGrowth) jumps.push({ t: performance.now(), id: activeId, from: prev, to: h })
              last.set(activeId, h)
            }
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        }
        return { jumps, t0, t1: performance.now() }
      },
      [MIN_GROWTH_PX] as const,
    )

    // Scripted playback: step the playhead across every long-row boundary.
    const seekTimes: number[] = []
    for (let i = 0; i < BLOCK_COUNT; i += 2) seekTimes.push(Math.round((i * 1.5 + 0.7) * 1000) / 1000)
    for (const time of seekTimes) {
      await page.evaluate(([t]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.command('transport-seek', { time: t }), [time] as const)
      await page.waitForTimeout(55)
    }
    const finalPlayhead = await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().playhead)
    expect(finalPlayhead, 'the scripted playback leg genuinely crossed the track').toBeGreaterThanOrEqual((seekTimes[seekTimes.length - 1] ?? 0) - 1)

    await page.evaluate(() => {
      ;(window as unknown as { __zipStopSampler: boolean }).__zipStopSampler = true
    })
    const sampler = (await samplerPromise) as SamplerResult
    const longTasks = (await page.evaluate(() => (window as unknown as { __zipLongTasks?: LongTaskEntry[] }).__zipLongTasks)) ?? []

    // NON-VACUITY — the expansion witness: the leg must actually see rows
    // grow (≥ MIN_GROWN_BLOCKS distinct blocks). RED today: no expansion
    // model exists, so the sampler could never observe growth and the 50 ms
    // gate below would be vacuous (conventions § Principles: no test that
    // cannot fail).
    const grown = new Set(sampler.jumps.filter((j) => j.to - j.from >= MIN_GROWTH_PX).map((j) => j.id))
    expect(grown.size, `expansion witness: ≥ ${MIN_GROWN_BLOCKS} distinct rows grew during the leg (measured ${grown.size} — no expansion observed, the gate below is vacuous until the row model lands)`).toBeGreaterThanOrEqual(MIN_GROWN_BLOCKS)

    // THE gate: long tasks inside the leg, adjacent to an expansion.
    const attributed = longTasks.filter(
      (entry) =>
        entry.duration > LONG_TASK_LIMIT_MS &&
        entry.startTime >= sampler.t0 &&
        entry.startTime <= sampler.t1 &&
        sampler.jumps.some((jump) => Math.abs(entry.startTime - jump.t) <= ATTRIBUTION_WINDOW_MS),
    )
    expect(attributed, `main-thread long tasks > ${LONG_TASK_LIMIT_MS} ms attributable to expansion during ${seekTimes.length} boundary crossings: ${JSON.stringify(attributed.map((v) => ({ durationMs: Math.round(v.duration), name: v.name })))}`).toEqual([])
  })
})
