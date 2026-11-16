// CC-107.6 (L5, chromium): the spectrum canvas is REAL pixels. Pixel scans
// prove the mapping: while the 220 Hz tone plays, the log-x band around
// spectrumX(220) carries ink high in the frame (loud → near top) and the
// 1 kHz/5 kHz bands carry none; paused freezes the frame with ZERO further
// draws at 40 % opacity; prefers-reduced-motion throttles to ≤ 4 Hz; the
// canvas is aria-hidden, not a tab stop, and paints BELOW the caption
// overlay (elementFromPoint = overlay, never the visualizer canvas).
import { expect, test } from '@playwright/test'
import { bridge, editor, openAudioProject, STAGE_BLOCKS, TONES } from './helpers/bridge'

const CSS = { width: 640, height: 360 }

/** Pinned copy of the CC-107.5 log-x mapping (FR-107.3: 30 Hz →
 *  min(16 kHz, Nyquist)) — node↔page bridge serialization does not allow
 *  importing the unbuilt module here; the mapping is FROZEN contract text
 *  (unit107-api-contract.d.ts spectrumX), and the L1 suite
 *  (tests/unit/audio-preview/spectrum.test.ts) is its authority. */
function pinnedSpectrumX(hz: number, width: number, minHz = 30, maxHz = 16_000): number {
  const f = Math.max(minHz, Math.min(maxHz, hz))
  return (width * Math.log(f / minHz)) / Math.log(maxHz / minHz)
}

async function scanBands(page: import('@playwright/test').Page, freqs: number[]): Promise<{ height: number; minRows: number[]; dpr: number }> {
  const b = bridge(page)
  const state = await b.state()
  return page.evaluate(
    ([centers, devicePixelRatio, cssWidth, cssHeight]) => {
      const canvas = document.querySelector('[data-testid=visualizer-canvas]') as HTMLCanvasElement | null
      if (canvas === null) throw new Error('no [data-testid=visualizer-canvas] mounted')
      const ctx = canvas.getContext('2d')
      if (ctx === null) throw new Error('visualizer canvas has no 2d context')
      const { width, height } = canvas
      const data = ctx.getImageData(0, 0, width, height).data
      const bandHalfPx = 12 * devicePixelRatio
      const minRows = (centers as number[]).map((centerCss) => {
        const center = centerCss * devicePixelRatio
        const x0 = Math.max(0, Math.round(center - bandHalfPx))
        const x1 = Math.min(width - 1, Math.round(center + bandHalfPx))
        let best = height
        for (let x = x0; x <= x1; x++) {
          for (let y = 0; y < height; y++) {
            if (data[(y * width + x) * 4 + 3]! > 8) {
              if (y < best) best = y
              break
            }
          }
        }
        return best
      })
      void cssWidth
      void cssHeight
      return { height, minRows, dpr: devicePixelRatio }
    },
    [freqs.map((f) => pinnedSpectrumX(f, CSS.width, 30, Math.min(16_000, 44_100 / 2))), state.dpr, CSS.width, CSS.height] as const,
  )
}

test.describe('CC-107.6: visualizer canvas (real chromium pixels)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-107.6: spectrum ink follows the ACTIVE tone — 220 Hz band lights while 1 k/5 k stay dark', async ({ page }) => {
    test.setTimeout(90_000)
    await openAudioProject(page, TONES, STAGE_BLOCKS as never[])
    const b = bridge(page)
    const ed = editor(page)
    const initial = await b.state()
    expect(initial.mode, 'default mode is spectrum (FR-107.5 default)').toBe('spectrum')

    await b.control('seek', 0.5)
    await b.control('play')
    // The line must be drawn WHILE the 220 Hz tone is the only active one
    // (window (0.5, 3.0) s), and the sweep must have actually advanced —
    // non-vacuity: playhead really moved and frames really drew.
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __zipVisualizerBridge?: { getVisualizerState: () => { framesDrawn: number } }
          __zipEditorBridge?: { getEditorState: () => { playhead: number } }
        }
        return (w.__zipVisualizerBridge?.getVisualizerState().framesDrawn ?? 0) > 2 && (w.__zipEditorBridge?.getEditorState().playhead ?? 0) > 1.0 && (w.__zipEditorBridge?.getEditorState().playhead ?? 0) < 2.9
      },
      undefined,
      { timeout: 15_000 },
    )
    const { height, minRows } = await scanBands(page, [220, 1000, 5000])
    const [row220, row1k, row5k] = minRows as [number, number, number]
    expect(row220, 'active-tone band carries ink in the upper frame (loud tone → high y-line)').toBeLessThan(height * 0.4)
    expect(row1k, 'inactive 1 kHz band stays near/below the floor — no ink where no tone plays').toBeGreaterThanOrEqual(height * 0.6)
    expect(row5k, 'inactive 5 kHz band stays near/below the floor').toBeGreaterThanOrEqual(height * 0.6)
    expect((await ed.state()).playhead, 'playhead really advanced (non-vacuity)').toBeGreaterThan(1.0)
    await b.control('pause')
  })

  test('CC-107.6: paused freezes — zero further draws, last frame held at 0.4 opacity', async ({ page }) => {
    test.setTimeout(60_000)
    await openAudioProject(page, TONES)
    const b = bridge(page)
    await b.control('seek', 0.5)
    await b.control('play')
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getVisualizerState: () => { framesDrawn: number } } }).__zipVisualizerBridge!.getVisualizerState().framesDrawn > 2, undefined, { timeout: 15_000 })
    await b.control('pause')
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getVisualizerState: () => { playing: boolean } } }).__zipVisualizerBridge!.getVisualizerState().playing === false, undefined, { timeout: 5_000 })

    await b.reset()
    await page.waitForTimeout(2_000)
    const state = await b.state()
    expect(state.framesDrawn, `paused frame budget must be 0 (measured ${String(state.framesDrawn)})`).toBe(0)
    expect(state.opacity, 'frozen frame holds at 40 % opacity (design.md)').toBeCloseTo(0.4, 5)
    expect(state.playing).toBe(false)
  })

  test('CC-107.6: prefers-reduced-motion throttles draws to ≤ 4 Hz', async ({ browser }) => {
    test.setTimeout(60_000)
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    try {
      await openAudioProject(page, TONES)
      const b = bridge(page)
      await b.control('seek', 0.5)
      await b.control('play')
      await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getVisualizerState: () => { playing: boolean } } }).__zipVisualizerBridge!.getVisualizerState().playing === true, undefined, { timeout: 15_000 })
      await b.reset()
      await page.waitForTimeout(3_000)
      const state = await b.state()
      // 3 s at ≤ 4 Hz ⇒ ≤ 12, plus one immediate draw allowance.
      expect(state.framesDrawn, `reduced-motion budget exceeded in ~3 s (measured ${String(state.framesDrawn)}; limit 13)`).toBeLessThanOrEqual(13)
      expect(state.framesDrawn, 'still draws SOMETHING — throttled, not dead (non-vacuity)').toBeGreaterThan(0)
      await b.control('pause')
    } finally {
      await context.close()
    }
  })

  test('CC-107.9: visualizer canvas is aria-hidden, not focusable, and under the caption overlay', async ({ page }) => {
    test.setTimeout(60_000)
    await openAudioProject(page, TONES, STAGE_BLOCKS as never[])
    const b = bridge(page)
    await b.control('seek', 1)
    await b.control('play')
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getVisualizerState: () => { framesDrawn: number } } }).__zipVisualizerBridge!.getVisualizerState().framesDrawn > 0, undefined, { timeout: 15_000 })
    await b.control('pause')

    const facts = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid=visualizer-canvas]') as HTMLCanvasElement | null
      if (canvas === null) return null
      const slot = canvas.closest('[data-testid=stage-visualizer-slot]')
      const overlayCanvas = document.querySelector('[data-testid=preview-canvas-layer] canvas')
      return {
        ariaHidden: canvas.getAttribute('aria-hidden'),
        hasTabIndex: canvas.hasAttribute('tabindex'),
        pointerEvents: canvas.style.pointerEvents,
        inSlot: slot !== null,
        overlayMounted: overlayCanvas !== null,
        // Paint order inside the stage is z-stacking [107-ADJ 6]: the
        // positioned .ws-canvas-layer host (z 2) must stack above the
        // positioned 16:9 visualizer slot (auto/0). DOM order is not the
        // contract (the video path relies on z-stacking too).
        belowOverlay: (() => {
          if (overlayCanvas === null) return false
          const host = overlayCanvas.closest('[data-testid=preview-canvas-layer]')
          const slot = canvas.closest('[data-testid=stage-visualizer-slot]')
          if (host === null || slot === null) return false
          const zOverlay = Number.parseFloat(getComputedStyle(host as HTMLElement).zIndex)
          const zViz = Number.parseFloat(getComputedStyle(slot as HTMLElement).zIndex)
          return (Number.isNaN(zOverlay) ? 0 : zOverlay) > (Number.isNaN(zViz) ? 0 : zViz)
        })(),
      }
    })
    expect(facts, 'visualizer canvas mounted with its pinned testid').not.toBeNull()
    expect(facts!.ariaHidden, 'decorative canvas is aria-hidden').toBe('true')
    expect(facts!.hasTabIndex, 'never a tab stop').toBe(false)
    expect(facts!.pointerEvents, 'pointer-transparent like the overlay canvas (overlay.ts frozen style)').toBe('none')
    expect(facts!.inSlot, 'mounted inside [data-testid=stage-visualizer-slot]').toBe(true)
    expect(facts!.overlayMounted, 'caption overlay canvas is mounted (comparison is meaningful)').toBe(true)
    expect(facts!.belowOverlay, 'caption overlay paints ABOVE the visualizer (DOM/paint order)').toBe(true)
  })
})
