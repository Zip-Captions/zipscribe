// US-3.1.4 / CC-201.2 (L5): preview==burn-in identity. The main-thread
// caption canvas (unit-102 layer ← createCaptionOverlayRenderer) and an
// OffscreenCanvas render through the shared renderer (exactly what the export
// worker consumes) must match at SSIM ≥ 0.99 for the same (project, time,
// style) — not byte-exact: font rasterization can differ by context.
// Same-browser comparison ⇒ platform-independent (no linux gate).
import { expect, test } from '@playwright/test'
import { bridge, openAudioProject, STAGE_BLOCKS, TONES } from '../audio-preview/helpers/bridge'

const SSIM_MIN = 0.99
const PLAYHEAD = 2.0

// In-page SSIM over luma, 8×8 blocks (sibling of the golden spec's math).
async function pageSsim(page: import('@playwright/test').Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    async ([ua, ub]) => {
      const load = async (url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> => {
        const img = new Image()
        img.src = url
        await img.decode().catch(() => undefined)
        if (img.width === 0 || img.height === 0) return null
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const cx = c.getContext('2d')
        if (cx === null) return null
        cx.drawImage(img, 0, 0)
        const d = cx.getImageData(0, 0, c.width, c.height)
        return { data: d.data, w: c.width, h: c.height }
      }
      const A = await load(ua as string)
      const B = await load(ub as string)
      if (A === null || B === null) return -1
      if (A.w !== B.w || A.h !== B.h) return -1
      const luma = (d: Uint8ClampedArray, i: number): number => 0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0)
      let total = 0
      let count = 0
      for (let by = 0; by + 8 <= A.h; by += 8) {
        for (let bx = 0; bx + 8 <= A.w; bx += 8) {
          let sa = 0
          let sb = 0
          let saa = 0
          let sbb = 0
          let sab = 0
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
            const i = ((by + y) * A.w + (bx + x)) * 4
            const va = luma(A.data, i)
            const vb = luma(B.data, i)
            sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb
          }
          const n = 64
          const ma = sa / n
          const mb = sb / n
          const c1 = 6.5025
          const c2 = 58.5201
          total += ((2 * ma * mb + c1) * (2 * (sab / n - ma * mb) + c2)) / ((ma * ma + mb * mb + c1) * ((saa / n - ma * ma) + (sbb / n - mb * mb) + c2))
          count += 1
        }
      }
      return count === 0 ? -1 : total / count
    },
    [a, b],
  )
}

test.describe('US-3.1.4: preview vs OffscreenCanvas identity', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test('CC-201.2: main-layer caption canvas matches worker-path OffscreenCanvas (SSIM ≥ 0.99)', async ({ browser }) => {
    test.setTimeout(90_000)
    const context = await browser.newContext({ deviceScaleFactor: 2 })
    const page = await context.newPage()
    try {
      await openAudioProject(page, TONES, STAGE_BLOCKS as never[])
      const b = bridge(page)
      await b.control('play')
      await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getVisualizerState: () => { playing: boolean } } }).__zipVisualizerBridge!.getVisualizerState().playing, undefined, { timeout: 10_000 })
      await b.control('pause')
      await b.control('seek', PLAYHEAD)
      await page.waitForFunction((t: number) => Math.abs((window as unknown as { __zipVisualizerBridge?: { getClockDiagnostics: () => { currentTime: number } } }).__zipVisualizerBridge!.getClockDiagnostics().currentTime - t) < 0.0005, PLAYHEAD, { timeout: 5_000 })
      await page.evaluate(() => document.fonts.ready)
      // the caption canvas may have painted pre-font-ready at first seek —
      // re-seek AFTER fonts.ready so the main-layer draw uses the same loaded
      // faces as the offscreen render, then settle past in-flight rAFs.
      await b.control('seek', PLAYHEAD)
      await page.waitForFunction((t: number) => Math.abs((window as unknown as { __zipVisualizerBridge?: { getClockDiagnostics: () => { currentTime: number } } }).__zipVisualizerBridge!.getClockDiagnostics().currentTime - t) < 0.0005, PLAYHEAD, { timeout: 5_000 })
      await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(r, 150)))))

      const capture = await page.evaluate(() => {
        const el = document.querySelector<HTMLCanvasElement>('[data-testid=caption-canvas]')
        if (el === null) return null
        const rect = el.getBoundingClientRect()
        return { main: el.toDataURL('image/png'), w: rect.width, h: rect.height }
      })
      expect(capture, 'caption canvas mounted').not.toBeNull()
      if (capture === null) return
      expect(Math.round(capture.w * 2), 'main canvas backing width matches css×dpr').toBe(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('[data-testid=caption-canvas]')?.width ?? 0))

      const offscreen = await page.evaluate(async ([t, w, h, d]) => await (window as unknown as { __zipStyleTest: { renderCaptionsForTime: (t: number, w: number, h: number, d: number) => Promise<string> } }).__zipStyleTest.renderCaptionsForTime(t, w, h, d), [PLAYHEAD, capture.w, capture.h, 2] as const)
      // sanity: both contain non-transparent pixels (captions actually drew)
      const nonBlank = await page.evaluate(async (url) => {
        const img = new Image()
        img.src = url
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const cx = c.getContext('2d')!
        cx.drawImage(img, 0, 0)
        const d = cx.getImageData(0, 0, c.width, c.height).data
        let ink = 0
        for (let i = 3; i < d.length; i += 4) if (d[i]! > 16) ink += 1
        return ink
      }, capture.main)
      expect(nonBlank, 'main caption canvas has ink').toBeGreaterThan(100)

      const ssim = await pageSsim(page, capture.main, offscreen)
      expect(ssim, 'preview vs worker-path SSIM; -1 ⇒ dimension mismatch').toBeGreaterThanOrEqual(SSIM_MIN)
    } finally {
      await context.close()
    }
  })
})
