// CC-302.3 (L5, pinned engine): the burn-in overlay renders an Arabic
// translation track RTL (block-level highlight, ctx.direction=rtl) — compared
// against the committed PNG golden via the shared renderer through the ziptest
// style bridge (the SAME renderer the export worker composites, so this is the
// burn-in pixel path). Doctrine: goldens are blessed only by
// scripts/make-style-goldens.ts in the pinned linux image; non-linux skips.
import { chromium, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'

const GOLDEN_DIR = join(REPO_ROOT, 'fixtures', 'golden', 'style')
const SSIM_MIN = 0.98
const DATA = JSON.parse(readFileSync(join(REPO_ROOT, 'e2e', 'style', 'overlay-goldens-data.json'), 'utf8')) as { rtl: { language: string; text: string; width: number; height: number } }

async function pageSsim(page: import('@playwright/test').Page, pngA: string, pngB: string): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      const load = async (url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> => {
        const img = new Image()
        img.src = url
        await img.decode().catch(() => undefined)
        if (img.width === 0 || img.height === 0) return null
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        if (ctx === null) return null
        ctx.drawImage(img, 0, 0)
        const d = ctx.getImageData(0, 0, c.width, c.height)
        return { data: d.data, w: c.width, h: c.height }
      }
      const A = await load(a as string)
      const B = await load(b as string)
      if (A === null || B === null) return -1
      if (A.w !== B.w || A.h !== B.h) return -1
      const luma = (d: Uint8ClampedArray, i: number): number => 0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0)
      let total = 0
      let count = 0
      for (let by = 0; by + 8 <= A.h; by += 8) {
        for (let bx = 0; bx + 8 <= A.w; bx += 8) {
          let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0
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
    [pngA, pngB],
  )
}

interface StyleBridge {
  renderOverlayPng(frame: Record<string, unknown>, dpr?: number): Promise<string>
  ensureDefaultFonts(): Promise<void>
  getPresetStyle(id: string): Promise<Record<string, unknown>>
}

test.describe('CC-302.3: Arabic burn-in track pixel golden (shared renderer, pinned engine)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.skip(process.platform !== 'linux', 'CC-302.3: pixel golden compares against the pinned linux engine only (font rasterization is platform-specific)')

  test('CC-302.3: burn-in Arabic translation track matches rtl-ar-dpr2.png (SSIM ≥ 0.98)', async ({}, testInfo) => {
    test.setTimeout(120_000)
    const name = 'rtl-ar-dpr2.png'
    const goldenFile = join(GOLDEN_DIR, name)
    expect(existsSync(goldenFile), `golden ${name} missing — generate with \`node scripts/make-style-goldens.ts\` (pinned linux engine)`).toBe(true)
    const golden = `data:image/png;base64,${readFileSync(goldenFile).toString('base64')}`
    const browser = await chromium.launch({ channel: 'chromium', args: ['--font-render-hinting=none', '--force-color-profile=srgb'] })
    const context = await browser.newContext({ deviceScaleFactor: 2 })
    const page = await context.newPage()
    try {
      await page.goto('http://127.0.0.1:4310/?ziptest=1')
      await page.waitForFunction(() => (window as unknown as { __zipStyleTest?: unknown }).__zipStyleTest !== undefined, undefined, { timeout: 15_000 })
      const b = {
        getPresetStyle: (id: string) => page.evaluate((pid) => (window as unknown as { __zipStyleTest: StyleBridge }).__zipStyleTest.getPresetStyle(pid), id),
        renderOverlayPng: (f: Record<string, unknown>, d: number) => page.evaluate(async ([frame, dpr]) => await (window as unknown as { __zipStyleTest: StyleBridge }).__zipStyleTest.renderOverlayPng(frame as never, dpr as number), [f, d] as const),
        ensureDefaultFonts: () => page.evaluate(async () => { await (window as unknown as { __zipStyleTest: StyleBridge }).__zipStyleTest.ensureDefaultFonts(); await document.fonts.ready }),
      }
      await b.ensureDefaultFonts()
      const style = await b.getPresetStyle('minimal')
      if (style === null) throw new Error('PRESET_MISSING')
      const words = DATA.rtl.text.split(' ').map((t, i, arr) => ({ text: t, start: (i * 2) / arr.length, end: ((i + 1) * 2) / arr.length }))
      const frame = { blocks: [{ id: 'rtl', start: 0, end: 2, text: DATA.rtl.text, words, speakerId: 'SPK_1' }], time: 1, style, track: DATA.rtl.language, width: DATA.rtl.width, height: DATA.rtl.height }
      const actual = await b.renderOverlayPng(frame, 2)
      const ssim = await pageSsim(page, golden, actual)
      if (ssim < SSIM_MIN) {
        const dir = testInfo.outputPath()
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `actual-${name}`), Buffer.from(actual.split(',')[1] ?? '', 'base64'))
      }
      expect(ssim, 'burn-in RTL golden SSIM; -1 ⇒ dimension mismatch').toBeGreaterThanOrEqual(SSIM_MIN)
    } finally {
      await context.close()
      await browser.close()
    }
  })
})
