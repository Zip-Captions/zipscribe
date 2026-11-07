// CC-102.6 (L5, chromium): ≥ 55 FPS with 10 000 synthetic blocks during
// playback (settings.yml performance_baselines `transcript_scroll` /
// `ui_main_thread_during_transcription`, rAF frame-drop sampler with the
// CI-tolerant threshold — conventions § Performance: structural budgets only,
// generous timing, absolute floors are [RQ]).
//
// Load: 10k synthetic segments generated IN-PAGE (chunked `job:segments`
// batches through the FR-2.0.6 bridge) rendered by unit-101's virtualized
// streaming rows, while the real `<video>` plays through the
// SyncArbitrator/rAF loop. Non-vacuity guards (101 CLS-spec doctrine): the
// DOM row pool is genuinely virtualized (rendered rows ≪ seeded rows), the
// playhead/clock advance during the sample window, and enough frames are
// actually counted — an idle page cannot pass.
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET, makeSegments } from '../../tests/unit/workbench/helpers/fake-engine'

const SRC = '/fixtures/speech-2min.mp4'
const BLOCK_COUNT = 10_000
const BATCH = 1_000
const JOB_ID = 'job-fps-10k'
const FPS_FLOOR = 55
const MIN_FRAMES = 100
const SAMPLE_MS = 2_500

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; loop: [number, number] | null; rate: number; blockCount: number; clockTime: number; seekCount: number; videoReady: boolean }
  scrubTo(time: number): void
  releaseScrub(): void
}

test.describe('CC-102.6: ≥ 55 FPS during synthetic 10k-block playback', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-102.6: rAF frame-drop sampler stays ≥ 55 FPS with 10k blocks while playing', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?ziptest=1')
    await page.waitForFunction(() => Boolean(window.__zipEditorBridge), undefined, { timeout: 20_000 })
    await page.evaluate(
      ([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src),
      [MEDIA_ASSET, SRC] as const,
    )
    await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })

    // Seed 10k synthetic blocks in-page, chunked (no 10k-event single shot).
    // Segments are generated in NODE (the helper is not part of the page) and
    // only the plain-object batches cross the bridge.
    const batches = Array.from({ length: BLOCK_COUNT / BATCH }, (_, batchIndex) =>
      makeSegments(BATCH, (i) => `w${batchIndex * BATCH + i}`).map((s) => ({ ...s, start: (batchIndex * BATCH + s.start) % 120 })),
    )
    await page.evaluate(
      ([jobId, all]) => {
        const workbench = window as unknown as {
          __zipWorkbenchBridge?: { injectAsrEvent(event: { t: string; jobId: string; segments: unknown[] }): void }
        }
        if (!workbench.__zipWorkbenchBridge) throw new Error('workbench bridge missing')
        for (const segments of all) workbench.__zipWorkbenchBridge.injectAsrEvent({ t: 'job:segments', jobId, segments })
      },
      [JOB_ID, batches] as const,
    )

    const rows = await page.locator('[data-testid=streaming-segment-row]').count()
    expect(rows, 'rows rendered at all (non-vacuity: something is on screen)').toBeGreaterThan(0)
    expect(rows, 'the row list is VIRTUALIZED (101 react-virtual lineage) — not 10k DOM nodes').toBeLessThan(1_000)

    // Warm-up, then sample rAF deltas for SAMPLE_MS while playing.
    await page.evaluate(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.command('transport-play', undefined))
    await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().playing === true, undefined, { timeout: 10_000 })
    await page.waitForTimeout(500)

    const sample = await page.evaluate(async (sampleMs) => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('bridge gone')
      const stamps: number[] = []
      const startClock = bridge.getEditorState().clockTime
      const startPlayhead = bridge.getEditorState().playhead
      return await new Promise<{ fps: number; frames: number; clockAdvanced: number; playheadAdvanced: number; droppedOver33: number }>((resolve) => {
        const begin = performance.now()
        const tick = (): void => {
          const now = performance.now()
          stamps.push(now)
          if (now - begin < sampleMs) {
            requestAnimationFrame(tick)
            return
          }
          const deltas = stamps.slice(1).map((t, i) => t - (stamps[i] ?? t))
          const elapsed = (stamps[stamps.length - 1] ?? begin) - (stamps[0] ?? begin)
          const end = bridge.getEditorState()
          resolve({
            fps: ((stamps.length - 1) / elapsed) * 1000,
            frames: stamps.length,
            clockAdvanced: end.clockTime - startClock,
            playheadAdvanced: Math.abs(end.playhead - startPlayhead),
            droppedOver33: deltas.filter((d) => d > 33.4).length,
          })
        }
        requestAnimationFrame(tick)
      })
    }, SAMPLE_MS)

    expect(sample.frames, `the sampler actually counted frames (non-vacuity; ≥ ${MIN_FRAMES} over the window)`).toBeGreaterThanOrEqual(MIN_FRAMES)
    expect(sample.clockAdvanced, 'the media clock genuinely advanced during the sample (non-vacuity)').toBeGreaterThan(1.5)
    expect(sample.playheadAdvanced, 'the arbitrator playhead advanced with the clock').toBeGreaterThan(1.5)
    expect(sample.fps, `average frame rate over the ${SAMPLE_MS} ms window meets the baseline (measured ${sample.fps.toFixed(1)} FPS, dropped>33ms: ${sample.droppedOver33})`).toBeGreaterThanOrEqual(FPS_FLOOR)
  })
})
