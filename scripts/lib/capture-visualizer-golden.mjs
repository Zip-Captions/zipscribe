// Capture half of the CC-107.7 golden generator (runs INSIDE the pinned
// playwright image via scripts/make-visualizer-goldens.ts — never during
// tests). Mirrors e2e/audio-preview/golden.spec.ts captureScene exactly:
// the scripted-bin spectrum scene + the frozen caption overlay at playhead
// 1.5 s, screenshot of [data-testid=stage-visualizer-slot] at DPR 1 and 2.
// Plain .mjs (no build step): imports the workspace playwright from the
// mounted checkout. SECURITY-03: scripted synthetic caption data only.

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUTPUT_DIR = process.env.GOLDEN_OUT ?? join(REPO_ROOT, 'fixtures', 'golden', 'visualizer')
const BASE = 'http://127.0.0.1:4310'

const ASSET = {
  id: 'ASSET_107_tones',
  name: 'tones-220-1k-5k-10s.wav',
  kind: 'audio',
  container: 'wav',
  audioCodec: 'pcm_s16le',
  videoCodec: null,
  duration: 10,
  width: 0,
  height: 0,
  fps: 0,
  sampleRate: 44100,
  channels: 1,
  fingerprint: { name: 'tones-220-1k-5k-10s.wav', size: 4096, durationMs: 10000, sampleHashes: ['a', 'b', 'c'] },
}
const SRC = '/fixtures/audio/tones-220-1k-5k-10s.wav'

const BLOCKS = [
  {
    id: 'blk_107_a',
    start: 0.2,
    end: 4.8,
    text: 'steady tone alpha',
    words: [
      { text: 'steady', start: 0.2, end: 1.2, timing: 'estimated' },
      { text: 'tone', start: 1.3, end: 2.4, timing: 'estimated' },
      { text: 'alpha', start: 2.5, end: 4.8, timing: 'estimated' },
    ],
    speakerId: 'SPK_1',
  },
  {
    id: 'blk_107_b',
    start: 5.0,
    end: 9.6,
    text: 'steady tone beta',
    words: [
      { text: 'steady', start: 5.0, end: 6.0, timing: 'estimated' },
      { text: 'tone', start: 6.1, end: 7.2, timing: 'estimated' },
      { text: 'beta', start: 7.3, end: 9.6, timing: 'estimated' },
    ],
    speakerId: 'SPK_1',
  },
]

function scriptedBins() {
  const sr = 44100
  const bins = 2048
  const out = []
  for (let i = 0; i < bins; i++) {
    const f = (i * sr) / (bins * 2)
    const base = f < 200 ? -22 : f < 2000 ? -45 : f < 6000 ? -70 : -95
    out.push(base + Math.sin(i * 0.7) * 3)
  }
  return out
}

async function captureScene(browser, dpr) {
  const context = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1280, height: 720 } })
  try {
    const page = await context.newPage()
    await page.goto(`${BASE}/?ziptest=1`)
    await page.waitForFunction(() => Boolean(window.__zipVisualizerBridge), undefined, { timeout: 20000 })
    await page.evaluate(
      ([asset, src, blocks]) => {
        window.__zipEditorBridge.openProjectWithMedia(asset, src, blocks)
      },
      [ASSET, SRC, BLOCKS],
    )
    await page.waitForFunction(
      () => {
        const d = window.__zipVisualizerBridge.getClockDiagnostics()
        return d.kind !== 'none' && d.kind !== 'deferred' && d.duration > 0
      },
      undefined,
      { timeout: 30000 },
    )
    await page.evaluate((bins) => window.__zipVisualizerBridge.setScriptedBins(bins), scriptedBins())
    await page.evaluate(() => window.__zipVisualizerBridge.setScriptedWaveform(null))
    await page.evaluate(() => window.__zipVisualizerBridge.clockControl('seek', 1.5))
    await page.evaluate(() => window.__zipVisualizerBridge.clockControl('play'))
    await page.waitForFunction(() => window.__zipVisualizerBridge.getVisualizerState().framesDrawn > 0, undefined, { timeout: 15000 })
    await page.evaluate(() => window.__zipVisualizerBridge.clockControl('pause'))
    await page.waitForFunction(() => window.__zipVisualizerBridge.getVisualizerState().playing === false, undefined, { timeout: 5000 })
    // DETERMINISM ([107-ADJ 19]): re-seek AFTER the pause (paused clocks
    // land exactly on 1.5 — the playhead drifts between seek and pause on a
    // loaded runner) and settle past any in-flight rAF. Mirrors
    // e2e/audio-preview/golden.spec.ts captureScene.
    await page.evaluate(() => window.__zipVisualizerBridge.clockControl('seek', 1.5))
    await page.waitForFunction(() => Math.abs(window.__zipVisualizerBridge.getClockDiagnostics().currentTime - 1.5) < 0.0005, undefined, { timeout: 5000 })
    await page.addStyleTag({ content: `*, *::before, *::after { font-family: 'Liberation Sans', sans-serif !important; }` })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, 150)))))
    const state = await page.evaluate(() => window.__zipVisualizerBridge.getVisualizerState())
    if (state.dpr !== dpr) throw new Error(`dpr mismatch: ${String(state.dpr)} !== ${String(dpr)}`)
    const buffer = await page.locator('[data-testid=stage-visualizer-slot]').screenshot({ type: 'png' })
    return buffer
  } finally {
    await context.close()
  }
}

const browser = await chromium.launch({ channel: 'chromium' })
try {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  for (const dpr of [1, 2]) {
    const png = await captureScene(browser, dpr)
    const file = join(OUTPUT_DIR, `spectrum-overlay-dpr${String(dpr)}.png`)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, png)
    console.log(`wrote ${file} (${String(png.length)} bytes)`)
  }
} finally {
  await browser.close()
}
