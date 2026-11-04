// CC-102.2 (L5, chromium): the SyncArbitrator over a REAL <video> element
// (fixtures media served by the preview server — the app itself never
// fetches fixtures; US-2.1.5 single playhead truth). Measured: after a seek
// the playhead lands ≤ 1 frame from the target; the loop region wraps within
// ± 33 ms of its start; a scrub-and-release resumes at the scrub position
// with a SINGLE seek (no double-seek). Non-vacuity guards on every assertion
// (101 CLS-spec doctrine): the video really decodes, the seek counter really
// moves, the playhead really advances. Generous CI timing; no absolute
// wall-clock floors (conventions § Performance).
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'

const SRC = '/fixtures/speech-2min.mp4'
const LOOP_TOLERANCE_MS = 33

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; loop: [number, number] | null; rate: number; blockCount: number; clockTime: number; seekCount: number; videoReady: boolean }
  scrubTo(time: number): void
  releaseScrub(): void
}

async function openStage(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean(window.__zipEditorBridge), undefined, { timeout: 20_000 })
  await page.evaluate(
    ([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src),
    [MEDIA_ASSET, SRC] as const,
  )
  await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
}

test.describe('CC-102.2: real-element playback sync', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-102.2: after a seek the playhead updates within ≤ 1 frame', async ({ page }) => {
    test.setTimeout(90_000)
    await openStage(page)

    const settle = await page.evaluate(async (target) => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('bridge gone')
      const seeksBefore = bridge.getEditorState().seekCount
      bridge.command('transport-seek', { time: target })
      // Poll on rAF: how many frames until the playhead reaches the target?
      const frames = await new Promise<number>((resolve, reject) => {
        let count = 0
        const tick = (): void => {
          count += 1
          if (Math.abs(bridge.getEditorState().playhead - target) <= 0.05) {
            resolve(count)
            return
          }
          if (count > 30) {
            reject(new Error(`playhead never settled at ${target}`))
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      return { frames, seeks: bridge.getEditorState().seekCount - seeksBefore }
    }, 30)

    expect(settle.frames, 'seek applied within ≤ 1 frame of the request').toBeLessThanOrEqual(1)
    expect(settle.seeks, 'the request issued exactly ONE media-element seek').toBe(1)
  })

  test('CC-102.2: the loop region wraps b → a within ± 33 ms', async ({ page }) => {
    test.setTimeout(90_000)
    await openStage(page)

    const wrap = await page.evaluate(async ({ a, b }) => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('bridge gone')
      bridge.command('transport-seek', { time: a })
      bridge.command('transport-loop-set', { start: a, end: b })
      bridge.command('transport-play', undefined)

      return await new Promise<{ wrapped: boolean; minDistanceMs: number; advanced: number }>((resolve) => {
        let last = bridge.getEditorState().playhead
        let detected = false
        let minDistance = Number.POSITIVE_INFINITY
        const start = performance.now()
        const startClock = bridge.getEditorState().clockTime
        const tick = (): void => {
          const s = bridge.getEditorState()
          if (s.playhead < last - 0.05) detected = true
          if (detected) minDistance = Math.min(minDistance, Math.abs(s.playhead - a))
          last = s.playhead
          if (performance.now() - start > 4000) {
            resolve({ wrapped: detected, minDistanceMs: detected ? minDistance * 1000 : Number.POSITIVE_INFINITY, advanced: s.clockTime - startClock })
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
    }, { a: 20, b: 21 })

    expect(wrap.advanced, 'the element clock genuinely advanced (non-vacuity)').toBeGreaterThan(0.5)
    expect(wrap.wrapped, 'the playhead wrapped at the loop end').toBe(true)
    expect(wrap.minDistanceMs, `wrap lands within ±${LOOP_TOLERANCE_MS} ms of the loop start`).toBeLessThanOrEqual(LOOP_TOLERANCE_MS)
  })

  test('US-2.1.5: scrub-while-playing releases a single seek and resumes at the scrub position', async ({ page }) => {
    test.setTimeout(90_000)
    await openStage(page)

    const scrub = await page.evaluate(async () => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('bridge gone')
      bridge.command('transport-seek', { time: 10 })
      bridge.command('transport-play', undefined)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

      const before = bridge.getEditorState()
      bridge.scrubTo(40)
      bridge.scrubTo(41)
      const during = bridge.getEditorState()
      bridge.releaseScrub()
      const after = bridge.getEditorState()
      return {
        beforeSeeks: before.seekCount,
        duringSeeks: during.seekCount,
        afterSeeks: after.seekCount,
        playing: after.playing,
        playhead: after.playhead,
      }
    })

    expect(scrub.duringSeeks - scrub.beforeSeeks, 'two scrub seeks').toBe(2)
    expect(scrub.afterSeeks - scrub.duringSeeks, 'the RELEASE adds no further seek (no double-seek)').toBe(0)
    expect(scrub.playing, 'playback resumes at the scrub position').toBe(true)
    expect(Math.abs(scrub.playhead - 41), 'resumed at the final scrub position').toBeLessThanOrEqual(0.15)
  })
})
