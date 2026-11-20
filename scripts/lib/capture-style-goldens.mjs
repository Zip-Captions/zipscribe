// Pinned-engine capture driver for the unit-201 overlay goldens (CC-201.1).
// Runs INSIDE the pinned playwright image (see scripts/make-style-goldens.ts):
// renders every matrix cell through the ziptest style bridge and writes the
// PNGs to GOLDEN_OUT. Frame inputs come from e2e/style/overlay-goldens-data.json
// (shared with the spec); styles are read LIVE from the app's CAPTION_PRESETS
// via the bridge — golden and runtime can never drift on preset values.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const OUT = process.env.GOLDEN_OUT ?? 'fixtures/golden/style'
const BASE = process.env.GOLDEN_BASE ?? 'http://127.0.0.1:4310'
const DATA = JSON.parse(readFileSync(new URL('../../e2e/style/overlay-goldens-data.json', import.meta.url), 'utf8'))

const browser = await chromium.launch({ channel: 'chromium', args: ['--font-render-hinting=none', '--force-color-profile=srgb'] })

async function capture(name, frame, dpr) {
  const context = await browser.newContext({ deviceScaleFactor: dpr })
  const page = await context.newPage()
  try {
    await page.goto(`${BASE}/?ziptest=1`)
    await page.waitForFunction(() => window.__zipStyleTest !== undefined, undefined, { timeout: 15_000 })
    await page.evaluate(async () => { await window.__zipStyleTest.ensureDefaultFonts(); await document.fonts.ready })
    const dataUrl = await page.evaluate(async ([f, d]) => await window.__zipStyleTest.renderOverlayPng(f, d), [frame, dpr])
    writeFileSync(join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log(`wrote ${name}`)
  } finally {
    await context.close()
  }
}

mkdirSync(OUT, { recursive: true })
for (const dpr of DATA.dprs) {
  for (const preset of DATA.presets) {
    for (const [sampleKey, sample] of Object.entries(DATA.samples)) {
      for (const [aspectKey, geom] of Object.entries(DATA.aspects)) {
        const style = await (async () => {
          const context = await browser.newContext({ deviceScaleFactor: dpr })
          const page = await context.newPage()
          try {
            await page.goto(`${BASE}/?ziptest=1`)
            await page.waitForFunction(() => window.__zipStyleTest !== undefined, undefined, { timeout: 15_000 })
            return await page.evaluate((id) => window.__zipStyleTest.getPresetStyle(id), preset)
          } finally { await context.close() }
        })()
        const words = sample.words === null
          ? sample.text.split(/[\s\n]+/).filter(w => w !== '').map((t, i, arr) => ({ text: t, start: (i * 2.4) / arr.length, end: ((i + 1) * 2.4) / arr.length }))
          : sample.words.map(([t, s, e]) => ({ text: t, start: s, end: e }))
        const frame = {
          blocks: [{ id: 'g', start: 0, end: 2.4, text: sample.text, words, speakerId: 'SPK_1' }],
          time: DATA.playhead,
          style,
          track: 'source',
          width: geom.width,
          height: geom.height,
          speakerPalette: ['#4c8dff', '#e5534b', '#4ab871', '#d9a03f'],
        }
        await capture(`${preset}-${sampleKey}-${aspectKey}-dpr${String(dpr)}.png`, frame, dpr)
      }
    }
  }
}

// RTL track golden
{
  const context = await browser.newContext({ deviceScaleFactor: 2 })
  const page = await context.newPage()
  let minimal
  try {
    await page.goto(`${BASE}/?ziptest=1`)
    await page.waitForFunction(() => window.__zipStyleTest !== undefined, undefined, { timeout: 15_000 })
    await page.evaluate(async () => { await window.__zipStyleTest.ensureDefaultFonts(); await document.fonts.ready })
    minimal = await page.evaluate(() => window.__zipStyleTest.getPresetStyle('minimal'))
  } finally { await context.close() }
  const words = DATA.rtl.text.split(' ').map((t, i, arr) => ({ text: t, start: (i * 2) / arr.length, end: ((i + 1) * 2) / arr.length }))
  const frame = {
    blocks: [{ id: 'rtl', start: 0, end: 2, text: DATA.rtl.text, words, speakerId: 'SPK_1' }],
    time: 1,
    style: minimal,
    track: DATA.rtl.language,
    width: DATA.rtl.width,
    height: DATA.rtl.height,
  }
  await capture('rtl-ar-dpr2.png', frame, 2)
}

await browser.close()
console.log('style goldens captured')
