// CC-107.7 (L5, chromium): visualizer goldens. A deterministic scripted scene
// (setScriptedBins — real analyser output is never golden-compared) plus the
// frozen caption overlay at a pinned playhead is captured as a slot-region
// screenshot and compared against the committed PNGs in
// fixtures/golden/visualizer/ at DPR 1 and DPR 2 with in-page SSIM ≥ 0.98.
//
// Goldens are generated on the CI-matching linux engine by
// scripts/make-visualizer-goldens.ts (docker mcr.microsoft.com/playwright) —
// text antialiasing is engine-stable, not OS-stable, so a byte-mismatching
// local regeneration on macOS is expected: regenerate via the pinned
// generator, never by re-blessing a screenshot from an unpinned environment
// (fixtures/golden/README doctrine).
//
// RED: the golden PNGs are produced by the slice-C generator — until then
// this spec fails on the committed-file existence check (never on a missing
// fixture silently skipping).
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { bridge, openAudioProject, STAGE_BLOCKS, TONES } from './helpers/bridge'

const GOLDEN_DIR = join(REPO_ROOT, 'fixtures', 'golden', 'visualizer')
const SSIM_MIN = 0.98

// Page-side: decode two PNG data URLs, SSIM over luma with 8×8 blocks.
async function pageSsim(page: import('@playwright/test').Page, pngA: string, pngB: string): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      const load = async (url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> => {
        const res = await fetch(url)
        const blob = await res.blob()
        const bitmap = await createImageBitmap(blob)
        const c = document.createElement('canvas')
        c.width = bitmap.width
        c.height = bitmap.height
        const ctx = c.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const A = await load(a)
      const B = await load(b)
      if (A.width !== B.width || A.height !== B.height) return -1
      const luma = (d: Uint8ClampedArray, i: number): number => (d[i * 4]! * 299 + d[i * 4 + 1]! * 587 + d[i * 4 + 2]! * 114) / 1000
      const C1 = (0.01 * 255) ** 2
      const C2 = (0.03 * 255) ** 2
      let total = 0
      let blocks = 0
      for (let by = 0; by + 8 <= A.height; by += 8) {
        for (let bx = 0; bx + 8 <= A.width; bx += 8) {
          let sa = 0
          let sb = 0
          let saa = 0
          let sbb = 0
          let sab = 0
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const i = (by + y) * A.width + (bx + x)
              const va = luma(A.data, i)
              const vb = luma(B.data, i)
              sa += va
              sb += vb
              saa += va * va
              sbb += vb * vb
              sab += va * vb
            }
          }
          const n = 64
          const ma = sa / n
          const mb = sb / n
          const va = saa / n - ma * ma
          const vb = sbb / n - mb * mb
          const cov = sab / n - ma * mb
          const num = (2 * ma * mb + C1) * (2 * cov + C2)
          const den = (ma * ma + mb * mb + C1) * (va + vb + C2)
          total += num / den
          blocks += 1
        }
      }
      return blocks === 0 ? -1 : total / blocks
    },
    [pngA, pngB] as const,
  )
}

async function captureScene(page: import('@playwright/test').Page, dpr: number): Promise<string> {
  await openAudioProject(page, TONES, STAGE_BLOCKS as never[])
  const b = bridge(page)
  const bins = await page.evaluate(() => {
    const sr = 44_100
    const bins = 2048
    const out: number[] = []
    for (let i = 0; i < bins; i++) {
      const f = (i * sr) / (bins * 2)
      const base = f < 200 ? -22 : f < 2_000 ? -45 : f < 6_000 ? -70 : -95
      out.push(base + Math.sin(i * 0.7) * 3)
    }
    return out
  })
  await b.setScriptedBins(bins)
  expect(bins.length, 'scripted bin input computed in-page').toBe(2048)
  await b.setScriptedWaveform(null)
  await b.control('seek', 1.5)
  await b.control('play')
  await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getVisualizerState: () => { framesDrawn: number } } }).__zipVisualizerBridge!.getVisualizerState().framesDrawn > 0, undefined, { timeout: 15_000 })
  await b.control('pause')
  await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge?: { getVisualizerState: () => { playing: boolean } } }).__zipVisualizerBridge!.getVisualizerState().playing === false, undefined, { timeout: 5_000 })
  // DETERMINISM ([107-ADJ 19]): playhead travels between seek and pause —
  // on a loaded runner it lands well past 1.5 (measured CI SSIM jitter
  // 0.9575/0.9618 as the playhead line + caption-active-block edge moved).
  // Re-seek AFTER the pause (paused clocks land exactly) and settle past
  // any in-flight rAF before the slot screenshot.
  await b.control('seek', 1.5)
  await page.waitForFunction(() => Math.abs(((window as unknown as { __zipVisualizerBridge?: { getClockDiagnostics: () => { currentTime: number } } }).__zipVisualizerBridge!.getClockDiagnostics().currentTime) - 1.5) < 0.02, undefined, { timeout: 5_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, 150)))))

  const state = await b.state()
  expect(state.dpr, `device scale factor must be ${String(dpr)} for this golden`).toBe(dpr)
  const slot = page.locator('[data-testid=stage-visualizer-slot]')
  await expect(slot).toBeVisible()
  const buffer = await slot.screenshot({ type: 'png' })
  return `data:image/png;base64,${buffer.toString('base64')}`
}

test.describe('CC-107.7: visualizer goldens (scripted scene, committed PNGs)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')
  // [107-ADJ 9] The committed PNGs are PINNED-ENGINE artifacts (linux noble
  // docker, scripts/make-visualizer-goldens.ts); text rasterization is
  // platform-specific, so non-linux hosts are not comparable (verified:
  // same-engine comparison passes both DPRs; the CI ubuntu runner is the
  // authoritative environment — never re-bless from an unpinned host).
  test.skip(process.platform !== 'linux', 'CC-107.7: goldens compare against the pinned linux engine only (font rasterization is platform-specific)')

  for (const dpr of [1, 2] as const) {
    test(`CC-107.7: DPR ${String(dpr)} scripted-spectrum + caption overlay matches the committed golden (SSIM ≥ ${String(SSIM_MIN)})`, async ({ browser }, testInfo) => {
      test.setTimeout(120_000)
      const goldenFile = join(GOLDEN_DIR, `spectrum-overlay-dpr${String(dpr)}.png`)
      expect(existsSync(goldenFile), `golden ${goldenFile} missing — generate with \`corepack pnpm exec node scripts/make-visualizer-goldens.ts\` (linux/pinned engine)`).toBe(true)
      const golden = `data:image/png;base64,${readFileSync(goldenFile).toString('base64')}`
      const context = await browser.newContext({ deviceScaleFactor: dpr })
      const page = await context.newPage()
      try {
        const actual = await captureScene(page, dpr)
        const ssim = await pageSsim(page, golden, actual)
        if (ssim < SSIM_MIN) {
          // Diagnostics: the failing pixels ride the test-results artifact
          // (uploads on always()) — compare against the committed golden to
          // localize the delta without a blind CI round-trip.
          await testInfo.attach(`golden-actual-dpr${String(dpr)}`, { body: Buffer.from(actual.split(',')[1] ?? '', 'base64'), contentType: 'image/png' })
        }
        expect(ssim, `in-page SSIM vs committed golden (dpr ${String(dpr)}); -1 ⇒ dimension mismatch`).toBeGreaterThanOrEqual(SSIM_MIN)
      } finally {
        await context.close()
      }
    })
  }
})
