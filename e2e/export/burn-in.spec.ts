// CC-202.2 (L5): burn-in MP4 on chromium. The worker pipeline (mediabunny
// Conversion + shared drawCaptions hook, FR-202.3) must produce a file whose
// duration matches the source ± 1 s, carries the muxed audio, and whose
// overlay matches the LIVE preview at 10 word-boundary frames at SSIM ≥ 0.99.
// CC-202.6: cancel lands ≤ 2 s.
import { expect, test } from '@playwright/test'
import { cleanScratch, extractFrame, mediaInfo, openExportProject, scratchPath, SAMPLE_TIMES, SPEECH_10MIN_ASSET, SPEECH_2MIN_ASSET, TAXI_ASSET, TAXI_DURATION, EXPORT_BLOCKS } from './helpers/export-harness'

const SSIM_MIN = 0.99

// In-page luma SSIM (8×8 blocks) over two data-URL images; the preview image
// is scaled to the output size before the compare (sibling of the unit-201
// identity spec's math).
async function pageSsim(page: import('@playwright/test').Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    async ([ua, ub]) => {
      const load = async (url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> => {
        const img = new Image()
        img.src = url
        await img.decode().catch(() => undefined)
        if (img.width === 0 || img.height === 0) return null
        const c = document.createElement('canvas')
        c.width = 320
        c.height = 180
        const cx = c.getContext('2d')
        if (cx === null) return null
        cx.drawImage(img, 0, 0, 320, 180)
        const d = cx.getImageData(0, 0, 320, 180)
        return { data: d.data, w: 320, h: 180 }
      }
      const A = await load(ua as string)
      const B = await load(ub as string)
      if (A === null || B === null) return -1
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
    [a, b] as const,
  )
}

async function toDataUrl(file: string): Promise<string> {
  const { readFileSync } = await import('node:fs')
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`
}

async function capturePreviewAt(page: import('@playwright/test').Page, t: number): Promise<string> {
  await page.evaluate((time) => {
    const w = window as unknown as { __zipEditorBridge?: { scrubTo(x: number): void; releaseScrub(): void } }
    w.__zipEditorBridge?.scrubTo(time)
    w.__zipEditorBridge?.releaseScrub()
  }, t)
  await page.waitForFunction(
    (time) => {
      const w = window as unknown as { __zipEditorBridge?: { getEditorState(): { playhead: number } } }
      return Math.abs((w.__zipEditorBridge?.getEditorState().playhead ?? -1) - time) < 0.04
    },
    t,
    { timeout: 10_000 },
  )
  await page.waitForTimeout(350) // two rAF paints settle the overlay canvas
  // composite the preview the way the user sees it — video frame + caption
  // canvas — at the OUTPUT's native 320×180 (the spec pins stage geometry to
  // that). UI furniture (stage transport overlay) is excluded BY CONSTRUCTION:
  // the burn-in file never carries it either.
  return page.evaluate(() => {
    const video = document.querySelector('[data-testid=stage-video]') as HTMLVideoElement | null
    const canvas = document.querySelector('[data-testid=preview-canvas-layer] canvas') as HTMLCanvasElement | null
    if (video === null || canvas === null) throw new Error('preview surfaces missing')
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 180
    const cx = c.getContext('2d')
    if (cx === null) throw new Error('no 2d')
    cx.fillStyle = '#000'
    cx.fillRect(0, 0, 320, 180)
    cx.drawImage(video, 0, 0, 320, 180)
    cx.drawImage(canvas, 0, 0, 320, 180)
    return c.toDataURL('image/png')
  })
}

test.describe('CC-202.2: burn-in MP4 (chromium)', () => {
  test.setTimeout(240_000)
  test.afterAll(cleanScratch)

  async function openTaxi(page: import('@playwright/test').Page): Promise<void> {
    await openExportProject(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: EXPORT_BLOCKS,
      mediaBytes: { path: '/fixtures/taxi-en-accented-1.mp4', type: 'video/mp4' },
    })
    // deterministic reference geometry: pin the stage to the output's native
    // 320×180 so the preview overlay canvas rasterizes captions at the exact
    // pixel scale the burn-in worker used (ResizeObserver re-fits the layer).
    await page.addStyleTag({
      content: '[data-testid=panel-stage]{height:430px!important;min-height:430px!important;flex:0 0 auto!important} [data-testid=stage-media]{width:320px!important;height:180px!important}',
    })
    await page.waitForTimeout(400)
  }

  test('CC-202.2: burn-in output — duration ± 1 s, muxed audio, 10/10 overlay frames SSIM ≥ 0.99 vs preview', async ({ page }) => {
    await openTaxi(page)
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()
    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
    await page.getByTestId('burnin-start').click()
    await expect(page.getByTestId('export-progress')).toBeVisible()

    const download = await downloadPromise
    const out = scratchPath('burn-in.mp4')
    await download.saveAs(out)
    const info = mediaInfo(out)
    expect(Math.abs(info.durationSec - TAXI_DURATION), `duration ${info.durationSec}`).toBeLessThanOrEqual(1)
    expect(info.hasAudio).toBe(true)
    expect(info.hasVideo).toBe(true)

    for (let i = 0; i < SAMPLE_TIMES.length; i += 1) {
      const t = SAMPLE_TIMES[i] ?? 0
      const framePath = scratchPath(`out-${i}.png`)
      extractFrame(out, t, framePath)
      const ssim = await pageSsim(page, await toDataUrl(framePath), await capturePreviewAt(page, t))
      expect(ssim, `overlay frame at t=${t.toFixed(2)}s`).toBeGreaterThanOrEqual(SSIM_MIN)
    }
  })

  async function openSpeech(page: import('@playwright/test').Page): Promise<void> {
    await openExportProject(page, {
      asset: SPEECH_2MIN_ASSET,
      src: '/fixtures/speech-2min.mp4',
      blocks: EXPORT_BLOCKS,
      mediaBytes: { path: '/fixtures/speech-2min.mp4', type: 'video/mp4' },
    })
  }

  test('CC-202.6: progress advances at ≥ 1 Hz while a run lasts > 2.5 s', async ({ page }) => {
    await openSpeech(page)
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()
    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
    await page.getByTestId('burnin-start').click()
    await expect(page.getByTestId('export-progress')).toBeVisible()
    // sampled every 150 ms: non-decreasing; ≥ 3 distinct values whenever the
    // wall-clock run outlives 2.5 s (the reference hardware encodes these
    // small fixtures ~35× realtime — a sub-2.5 s run makes the 1 Hz gate
    // vacuously satisfied; the pacer's own guarantee is L1-proven with an
    // injected clock, tests/unit/export/burn-in-pacing.test.ts).
    const observed: number[] = []
    const started = Date.now()
    let done = false
    while (Date.now() - started < 170_000 && !done) {
      const txt = await page.getByTestId('export-progress').innerText().catch(() => null)
      if (txt === null) {
        done = true
        break
      }
      const m = /([\d.]+) s \/ [\d.]+ s/.exec(txt)
      if (m !== null) observed.push(Number(m[1]))
      done = observed.at(-1) === 120 && observed.length > 3
      if (!done) await page.waitForTimeout(150)
    }
    const wallMs = Date.now() - started
    await downloadPromise.catch(() => undefined)
    const distinct = [...new Set(observed)]
    for (let i = 1; i < distinct.length; i += 1) expect(distinct[i]).toBeGreaterThan(distinct[i - 1] ?? -1)
    expect(distinct.at(-1)).toBe(120) // final 100 % always emitted
    if (wallMs > 2500) expect(distinct.length).toBeGreaterThanOrEqual(3)
  })

  // speech-10min, NOT speech-2min: the 2-min encode finishes in ~1.3 s on a
  // warm pipeline (90× realtime observed) and the run can COMPLETE before
  // the click lands — cancelling a finished run is not CC-202.6.
  test('CC-202.6: cancel lands within 2 s', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })
    await page.goto('/?ziptest=1')
    await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: unknown }).__zipEditorBridge), undefined, { timeout: 20_000 })
    await page.evaluate(async ([asset, src, blocks]: [Record<string, unknown>, string, unknown[]]) => {
      const w = window as unknown as { __zipEditorBridge?: { openProjectWithMedia(a: unknown, s: string): void; seedBlocks(b: readonly unknown[], sp: readonly unknown[]): void; setExportMedia(by: ArrayBuffer, t: string): Promise<void> } }
      const b = w.__zipEditorBridge
      if (b === undefined) throw new Error('bridge missing')
      b.openProjectWithMedia(asset, src)
      b.seedBlocks(blocks, [{ id: 'SPK_1', label: 'Speaker 1', color: '#4c8dff' }])
      const res = await fetch(src)
      await b.setExportMedia(await res.arrayBuffer(), 'video/mp4')
    }, [SPEECH_10MIN_ASSET, '/fixtures/speech-10min.mp4', EXPORT_BLOCKS] as [Record<string, unknown>, string, unknown[]])
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()
    await page.getByTestId('burnin-start').click()
    await expect(page.getByTestId('export-progress')).toBeVisible()
    // wait until the run is visibly in flight (not a pre-start race)
    await page.waitForFunction(() => {
      const m = /([\d.]+) s \/ [\d.]+ s/.exec(document.querySelector('[data-testid=export-progress]')?.textContent ?? '')
      return m !== null && Number(m[1]) > 0
    }, undefined, { timeout: 10_000 }).catch(() => undefined)
    await page.getByTestId('export-cancel').click()
    const t0 = Date.now()
    await expect(page.getByTestId('export-progress')).toHaveCount(0, { timeout: 2000 })
    expect(Date.now() - t0).toBeLessThanOrEqual(2000)
    await expect(page.getByTestId('export-toast')).toContainText('CANCELLED')
  })
})
