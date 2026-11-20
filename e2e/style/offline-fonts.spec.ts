// CC-201.4 (L5): bundled fonts render with NO network (US-3.1.1 offline
// session) and the Google-Fonts path is opt-in only (product privacy rule).
// The bundled woff2s are served by the app origin (self); everything else is
// hard-aborted.
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'

test.describe('CC-201.4: bundled fonts offline + remote opt-in', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')

  test('CC-201.4: with every non-origin request aborted, default set renders from the bundled faces; remote never fires unbidden', async ({ browser }) => {
    test.setTimeout(90_000)
    const context = await browser.newContext()
    let remoteAttempts = 0
    await context.route('**', async route => {
      const url = route.request().url()
      if (url.startsWith('http://127.0.0.1:4310/') || url.startsWith('data:') || url.startsWith('blob:')) {
        await route.continue()
        return
      }
      if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) remoteAttempts += 1
      await route.abort()
    })
    const page = await context.newPage()
    try {
      await page.goto('http://127.0.0.1:4310/?ziptest=1')
      await page.waitForFunction(() => (window as unknown as { __zipStyleTest?: unknown }).__zipStyleTest !== undefined, undefined, { timeout: 20_000 })
      const b = (window: unknown) => (window as { __zipStyleTest: {
        ensureDefaultFonts: () => Promise<void>
        enableRemoteFont: (f: string) => Promise<boolean>
        fontLoaded: (f: string, w: number) => boolean
        renderOverlayPng: (f: Record<string, unknown>, d?: number) => Promise<string>
      } }).__zipStyleTest
      await page.evaluate(async () => { await (window as unknown as { __zipStyleTest: { ensureDefaultFonts: () => Promise<void> } }).__zipStyleTest.ensureDefaultFonts(); await document.fonts.ready })
      const loaded = await page.evaluate(() => {
        const s = (window as unknown as { __zipStyleTest: { fontLoaded: (f: string, w: number) => boolean } }).__zipStyleTest
        return { inter400: s.fontLoaded('Inter', 400), inter700: s.fontLoaded('Inter', 700), archivo: s.fontLoaded('Archivo', 400), mono: s.fontLoaded('JetBrains Mono', 400), anton: s.fontLoaded('Anton', 400) }
      })
      expect(loaded.inter400, 'bundled Inter 400 active offline').toBe(true)
      expect(loaded.inter700, 'bundled Inter 700 active offline').toBe(true)
      expect(loaded.archivo, 'bundled Archivo active offline').toBe(true)
      expect(loaded.mono, 'bundled JetBrains Mono active offline').toBe(true)
      expect(loaded.anton, 'display faces stay lazy (not pre-registered)').toBe(false)
      expect(remoteAttempts, 'no remote font request without explicit opt-in').toBe(0)

      const png = await page.evaluate(async () => {
        const s = (window as unknown as { __zipStyleTest: { renderOverlayPng: (f: Record<string, unknown>, d?: number) => Promise<string>; getPresetStyle: (id: string) => unknown } }).__zipStyleTest
        return s.renderOverlayPng({
          blocks: [{ id: 'o', start: 0, end: 2, text: 'offline renders', words: [{ text: 'offline', start: 0, end: 1 }, { text: 'renders', start: 1, end: 2 }], speakerId: 'SPK_1' }],
          time: 0.5,
          style: s.getPresetStyle('karaoke'),
          track: 'source',
          width: 480,
          height: 270,
        }, 2)
      })
      const ink = await page.evaluate(async (url) => {
        const img = new Image()
        img.src = url
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const cx = c.getContext('2d')!
        cx.drawImage(img, 0, 0)
        const d = cx.getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 3; i < d.length; i += 4) if (d[i]! > 16) n += 1
        return n
      }, png)
      expect(ink, 'offline caption render has real ink').toBeGreaterThan(500)

      // opt-in with aborted network ⇒ soft failure, no throw
      const ok = await page.evaluate(async () => await (window as unknown as { __zipStyleTest: { enableRemoteFont: (f: string) => Promise<boolean> } }).__zipStyleTest.enableRemoteFont('Anton'))
      expect(ok, 'remote opt-in fails softly when the network is gone').toBe(false)
      expect(remoteAttempts, 'remote attempted only after explicit opt-in').toBeGreaterThan(0)
    } finally {
      await context.close()
    }
  })

  test('CC-201.4: opt-in remote load succeeds when the css2 + gstatic bytes are served (real woff2)', async ({ browser }) => {
    test.setTimeout(90_000)
    const context = await browser.newContext()
    const woff2 = readFileSync(join(REPO_ROOT, 'public', 'fonts', 'display', 'anton-latin-all-400.woff2')).toString('base64')
    let cssRequests = 0
    let binaryRequests = 0
    await context.route('https://fonts.googleapis.com/**', route => {
      cssRequests += 1
      void route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: "@font-face{font-family:'Anton';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/s/anton/v25/stub.woff2) format('woff2')}",
      })
    })
    await context.route('https://fonts.gstatic.com/**', route => {
      binaryRequests += 1
      void route.fulfill({ status: 200, contentType: 'font/woff2', body: Buffer.from(woff2, 'base64') })
    })
    const page = await context.newPage()
    try {
      await page.goto('http://127.0.0.1:4310/?ziptest=1')
      await page.waitForFunction(() => (window as unknown as { __zipStyleTest?: unknown }).__zipStyleTest !== undefined, undefined, { timeout: 20_000 })
      expect(cssRequests, 'no remote css fetch before opt-in').toBe(0)
      const ok = await page.evaluate(async () => await (window as unknown as { __zipStyleTest: { enableRemoteFont: (f: string) => Promise<boolean> } }).__zipStyleTest.enableRemoteFont('Anton'))
      expect(ok, 'opt-in succeeds with served bytes').toBe(true)
      expect(cssRequests, 'exactly one css2 fetch').toBe(1)
      expect(binaryRequests, 'the resolved gstatic woff2 was fetched').toBe(1)
      const loaded = await page.evaluate(() => (window as unknown as { __zipStyleTest: { fontLoaded: (f: string, w: number) => boolean } }).__zipStyleTest.fontLoaded('Anton', 400))
      expect(loaded, 'remote face registered in FontFaceSet').toBe(true)
    } finally {
      await context.close()
    }
  })
})
