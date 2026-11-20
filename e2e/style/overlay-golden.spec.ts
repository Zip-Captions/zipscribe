// CC-201.1 (L5, pinned engine): overlay goldens — 4 presets × 3 sample
// captions × {16:9, 9:16} safe-margin matrix at DPR 1+2, plus one RTL
// translation-track golden, all rendered by the SHARED renderer through the
// ziptest style bridge and compared against committed PNGs in
// fixtures/golden/style/ at SSIM ≥ 0.98.
//
// Doctrine (fixtures/golden/README): PNGs are generated ONLY by
// scripts/make-style-goldens.ts inside the pinned linux playwright image
// (font rasterization is engine-stable, not OS-stable). Non-linux hosts skip;
// never re-bless from an unpinned environment.
import { chromium, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'

const GOLDEN_DIR = join(REPO_ROOT, 'fixtures', 'golden', 'style')
const SSIM_MIN = 0.98
const DATA = JSON.parse(readFileSync(join(REPO_ROOT, 'e2e', 'style', 'overlay-goldens-data.json'), 'utf8')) as {
  samples: Record<string, { text: string; words: [string, number, number][] | null }>
  presets: string[]
  aspects: Record<string, { width: number; height: number; aspect: string }>
  dprs: number[]
  playhead: number
  rtl: { language: string; text: string; width: number; height: number }
}

// Page-side 8×8-block luma SSIM (same math as the visualizer golden spec).
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
    [pngA, pngB],
  )
}

interface StyleBridge {
  renderOverlayPng(frame: Record<string, unknown>, dpr?: number): Promise<string>
  ensureDefaultFonts(): Promise<void>
  getPresetStyle(id: string): Promise<Record<string, unknown>>
}
const styleBridge = (page: import('@playwright/test').Page): StyleBridge => {
  return {
    async getPresetStyle(id) {
      return await page.evaluate((pid) => (window as unknown as { __zipStyleTest: StyleBridge }).__zipStyleTest.getPresetStyle(pid), id)
    },
    async renderOverlayPng(frame, dpr) {
      return await page.evaluate(async ([f, d]) => await (window as unknown as { __zipStyleTest: StyleBridge }).__zipStyleTest.renderOverlayPng(f as never, d as number), [frame, dpr])
    },
    async ensureDefaultFonts() {
      await page.evaluate(async () => { await (window as unknown as { __zipStyleTest: StyleBridge }).__zipStyleTest.ensureDefaultFonts(); await document.fonts.ready })
    },
  }
}

async function buildFrame(page: import('@playwright/test').Page, presetId: string, sampleKey: string, aspectKey: string): Promise<Record<string, unknown>> {
  const sample = DATA.samples[sampleKey]
  const geom = DATA.aspects[aspectKey]
  if (sample === undefined || geom === undefined) throw new Error(`FIXTURE_MISSING ${sampleKey}/${aspectKey}`)
  const style = await styleBridge(page).getPresetStyle(presetId)
  if (style === null) throw new Error(`PRESET_MISSING ${presetId}`)
  const words = sample.words === null
    ? sample.text.split(/[\s\n]+/).filter(w => w !== '').map((t, i, arr) => ({ text: t, start: (i * 2.4) / arr.length, end: ((i + 1) * 2.4) / arr.length }))
    : sample.words.map(([t, s, e]) => ({ text: t, start: s, end: e }))
  return {
    blocks: [{ id: 'g', start: 0, end: 2.4, text: sample.text, words, speakerId: 'SPK_1' }],
    time: DATA.playhead,
    style,
    track: 'source',
    width: geom.width,
    height: geom.height,
    speakerPalette: ['#4c8dff', '#e5534b', '#4ab871', '#d9a03f'],
  }
}

test.describe('CC-201.1: overlay goldens (shared renderer, pinned engine)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.skip(process.platform !== 'linux', 'CC-201.1: goldens compare against the pinned linux engine only (font rasterization is platform-specific)')

  for (const dpr of DATA.dprs) {
    for (const preset of DATA.presets) {
      for (const sample of Object.keys(DATA.samples)) {
        for (const aspect of Object.keys(DATA.aspects)) {
          test(`CC-201.1: ${preset}/${sample}/${aspect} dpr${String(dpr)} matches golden (SSIM ≥ ${String(SSIM_MIN)})`, async ({}, testInfo) => {
            test.setTimeout(120_000)
            const name = `${preset}-${sample}-${aspect}-dpr${String(dpr)}.png`
            const goldenFile = join(GOLDEN_DIR, name)
            expect(existsSync(goldenFile), `golden ${name} missing — generate with \`node scripts/make-style-goldens.ts\` (pinned linux engine)`).toBe(true)
            const golden = `data:image/png;base64,${readFileSync(goldenFile).toString('base64')}`
            const browser = await chromium.launch({ channel: 'chromium', args: ['--font-render-hinting=none', '--force-color-profile=srgb'] })
            const context = await browser.newContext({ deviceScaleFactor: dpr })
            const page = await context.newPage()
            try {
              await page.goto('http://127.0.0.1:4310/?ziptest=1')
              await page.waitForFunction(() => (window as unknown as { __zipStyleTest?: unknown }).__zipStyleTest !== undefined, undefined, { timeout: 15_000 })
              const b = styleBridge(page)
              await b.ensureDefaultFonts()
              const frame = await buildFrame(page, preset, sample, aspect)
              const actual = await b.renderOverlayPng(frame, dpr)
              const ssim = await pageSsim(page, golden, actual)
              if (ssim < SSIM_MIN) {
                const dir = testInfo.outputPath()
                mkdirSync(dir, { recursive: true })
                writeFileSync(join(dir, `actual-${name}`), Buffer.from(actual.split(',')[1] ?? '', 'base64'))
              }
              expect(ssim, `in-page SSIM vs committed golden ${name}; -1 ⇒ dimension mismatch`).toBeGreaterThanOrEqual(SSIM_MIN)
            } finally {
              await context.close()
              await browser.close()
            }
          })
        }
      }
    }
  }

  test('CC-201.1: RTL translation-track golden (ar, block-level, ctx.direction=rtl)', async ({}, testInfo) => {
    test.setTimeout(120_000)
    const name = 'rtl-ar-dpr2.png'
    const goldenFile = join(GOLDEN_DIR, name)
    expect(existsSync(goldenFile), `golden ${name} missing — generate with \`node scripts/make-style-goldens.ts\``).toBe(true)
    const golden = `data:image/png;base64,${readFileSync(goldenFile).toString('base64')}`
    const browser = await chromium.launch({ channel: 'chromium', args: ['--font-render-hinting=none', '--force-color-profile=srgb'] })
    const context = await browser.newContext({ deviceScaleFactor: 2 })
    const page = await context.newPage()
    try {
      await page.goto('http://127.0.0.1:4310/?ziptest=1')
      await page.waitForFunction(() => (window as unknown as { __zipStyleTest?: unknown }).__zipStyleTest !== undefined, undefined, { timeout: 15_000 })
      const b = styleBridge(page)
      await b.ensureDefaultFonts()
      const style = await styleBridge(page).getPresetStyle('minimal')
      if (style === null) throw new Error('PRESET_MISSING')
      const words = DATA.rtl.text.split(' ').map((t, i, arr) => ({ text: t, start: (i * 2) / arr.length, end: ((i + 1) * 2) / arr.length }))
      const frame = {
        blocks: [{ id: 'rtl', start: 0, end: 2, text: DATA.rtl.text, words, speakerId: 'SPK_1' }],
        time: 1,
        style,
        track: DATA.rtl.language,
        width: DATA.rtl.width,
        height: DATA.rtl.height,
      }
      const actual = await b.renderOverlayPng(frame, 2)
      const ssim = await pageSsim(page, golden, actual)
      if (ssim < SSIM_MIN) {
        const dir = testInfo.outputPath()
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `actual-${name}`), Buffer.from(actual.split(',')[1] ?? '', 'base64'))
      }
      expect(ssim, `RTL golden SSIM; -1 ⇒ dimension mismatch`).toBeGreaterThanOrEqual(SSIM_MIN)
    } finally {
      await context.close()
      await browser.close()
    }
  })
})
