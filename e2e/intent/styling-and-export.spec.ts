// Intent completion suite — styling-and-export (CC-I3.1/.2/.3/.4/.5/.6/.7/.8/
// .10, L5; the sibling of the closed caption-studio-ui.spec.ts / local-
// transcribe-engine.spec.ts: same doctrine — real app on the BUILT bundle
// (vite preview 4310), no network beyond self, SECURITY-03 codes/lengths only
// across the console boundary, byte-equal reload where state round-trips
// (FR-205.4)). Per-unit suites 200–204 own the component-level proofs; this
// file is the lead-citation leg for the 2026-11-24 verify:intent UNCOVERED
// rows (unit-205 spec). CC-I3.9 is [DEPLOY] — excluded per conventions
// § Criterion traceability; no test cites it (the closure-map guard asserts
// the absence).
//
// Journeys (FR-205.2, one lead-citing journey per cited ID):
//   J1 CC-I3.1  presets + custom controls render through the preview overlay
//   J2 CC-I3.2  sidecar goldens byte-exact, source + translation tracks
//   J3 CC-I3.3  burn-in MP4, 10 word-boundary frames SSIM ≥ 0.99 vs preview
//   J4 CC-I3.4  webkit tier: formats offered, MP4 never (E2E_WEBKIT=1)
//   J4b CC-I3.4 chromium mirror: AudioEncoder deleted via addInitScript —
//         the T3 shape the chromium verify:unit spawn can actually execute
//         and credit (unit-205 review round; webkit-1.64 HAS AudioEncoder,
//         so J4's encoder-less branch is dead code on that engine)
//   J5 CC-I3.5  audio project: no MP4 in dialog DOM, Style hides aspect
//   J6 CC-I3.6  CDP Page.getInstallabilityErrors zero on the built bundle
//   J7 CC-I3.7  offline reload → IDB reopen → autosave → sidecar offline
//   J8 CC-I3.8  closure aggregate cite (mechanics below)
//   J9 CC-I3.10 About/licensing panel lists models + licenses
//
// CC-I3.8 mechanism (FR-205.3, test-author decision): the "full
// `pnpm test:e2e` green incl. webkit" half is enforced by the verifier's
// junit-trust policy — scripts/lib/junit-trust.ts credits e2e criteria ONLY
// from a JUnit written by a spawn that exited 0 (nonzero/null exit ⇒ zero
// e2e credit ⇒ CC-I3.8 UNCOVERED ⇒ verify:intent exit 1). Any failure
// anywhere in the suite therefore reddens CC-I3.8 through the citation of
// the J8 test below; J8 itself asserts the closure run's observable
// preconditions (preview serves the PRODUCTION bundle, manifest present, the
// webkit tier is wired and its lead-citation legs exist) so the test is
// falsifiable on its own and can never pass vacuously.
//
// Helper policy (FR-205.1): shared machinery is IMPORTED from the unit-202/
// 204 helpers (export-harness, pwa-harness, installability). The SSIM/
// preview-composite/download/persistence-snapshot internals are file-LOCAL in
// the committed unit-202/201/intent specs and not exported — FR-205.1 forbids
// editing those files, so this spec mirrors them journey-locally rather than
// re-deriving them; Follow-up: lift them into e2e/export/helpers.
//
// RED doctrine (unit-205): journeys fail on missing composition legs, never
// on fixture/server/config errors. J9 was the honest-RED journey until 5bc27cb
// shipped the About/licensing panel — it is now a live regression pin on the
// seam contract: ⋯ menu item `pwa-menu-about` → `about-licensing-panel` →
// per-registry-model row `about-model-row-<id>` carrying the registry license
// (+ attribution where the row defines one).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { citationsOf } from '../../scripts/lib/junit-trust'
import { CANARY_MARKER } from '../../src/test-support/redaction'
import { DIAR_MODEL_REGISTRY, MODEL_REGISTRY } from '../../src/engine/model/registry'
import {
  cleanScratch,
  EXPORT_BLOCKS,
  extractFrame,
  mediaInfo,
  openExportProject,
  readGolden,
  SAMPLE_TIMES,
  scratchPath,
  SIDECAR_ASSET,
  SIDECAR_BLOCKS,
  SIDECAR_FR,
  SIDECAR_NAME,
  SIDECAR_SLUG,
  SIDECAR_SPEAKERS,
  TAXI_ASSET,
  TAXI_DURATION,
} from '../export/helpers/export-harness'
import { fetchManifest, getInstallability, iconPurposes } from '../pwa/helpers/installability'
import {
  attachSecurityGuards,
  CANARY_BLOCKS,
  CHILD,
  CHILD_REASON,
  ensurePrecache,
  openAppWithBridges,
  openProjectWithLocalMedia,
  PREVIEW_BASE,
  projectRows,
  saveState,
  TAXI_FINGERPRINT,
  taxiBytesBase64,
  warmShell,
} from '../pwa/helpers/pwa-harness'

const SSIM_MIN = 0.99
const STAGE_PIN = '[data-testid=panel-stage]{height:430px!important;min-height:430px!important;flex:0 0 auto!important} [data-testid=stage-media]{width:320px!important;height:180px!important}'

// RTL/escape half of the CC-I3.2 matrix — the same committed fixture data the
// unit-202 sidecar spec re-declares (the golden byte-compare is the drift
// guard; SECURITY-03 safe: committed CC0 fixture text).
const AR: Record<string, unknown> = {
  b1: { text: 'مرحبا', status: 'translated', sourceHash: 'h1' },
  b2: { text: 'مرحبا بالعالم & <نص>', status: 'translated', sourceHash: 'h2' },
  b3: { text: 'سطر زمني', status: 'translated', sourceHash: 'h3' },
  b4: { text: 'اقتباس', status: 'translated', sourceHash: 'h4' },
}

const CHROMIUM_ONLY = ({ browserName }: { browserName: string }): boolean => browserName !== 'chromium'

// — journey-local mirrors of the committed-spec internals (header note) -----

interface StyleBridgeWindow {
  __zipStyleTest?: {
    renderCaptionsForTime(time: number, width: number, height: number, dpr?: number): Promise<string>
  }
}
interface PersistenceBridgeWindow {
  __zipPersistenceBridge?: {
    saveNow(reason: 'idle' | 'manual' | 'hidden'): Promise<'saved' | 'not-dirty' | 'failed'>
    listProjects(): Promise<Array<{ id: string; name: string; updatedAt: number }>>
    exportProjectFile(id: string): Promise<string | null>
  }
}

async function waitStyleBridge(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as StyleBridgeWindow).__zipStyleTest !== undefined, undefined, { timeout: 20_000 })
}

/** In-page luma SSIM (8×8 blocks); both images scaled to 320×180 first — the
 *  reference geometry the closure suite pins (mirror of the unit-202 burn-in
 *  spec's math; the unit-201 identity spec's unscaled variant). */
async function ssimInPage(page: Page, a: string, b: string): Promise<number> {
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

/** Fraction of pixels whose luma differs by more than 16 — the POSITIVE
 *  control (styling visibly changed the preview), SSIM being the negative
 *  one (single-renderer identity). */
async function inkDiffRatio(page: Page, a: string, b: string): Promise<number> {
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
      if (A === null || B === null || A.w !== B.w || A.h !== B.h) return -1
      const luma = (d: Uint8ClampedArray, i: number): number => 0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0)
      let diff = 0
      let n = 0
      for (let i = 0; i + 3 < A.data.length; i += 4) {
        n += 1
        if (Math.abs(luma(A.data, i) - luma(B.data, i)) > 16) diff += 1
      }
      return n === 0 ? -1 : diff / n
    },
    [a, b] as const,
  )
}

async function captureCaptionCanvas(page: Page): Promise<{ png: string; w: number; h: number }> {
  const cap = await page.evaluate(() => {
    const el = document.querySelector<HTMLCanvasElement>('[data-testid=caption-canvas]')
    if (el === null) return null
    const rect = el.getBoundingClientRect()
    return { png: el.toDataURL('image/png'), w: rect.width, h: rect.height }
  })
  if (cap === null) throw new Error('caption canvas not mounted (preview overlay renderer missing)')
  return cap
}

async function renderViaSharedBridge(page: Page, t: number, w: number, h: number): Promise<string> {
  return page.evaluate(async ([time, width, height]) => {
    const bridge = (window as unknown as StyleBridgeWindow).__zipStyleTest
    if (bridge === undefined) throw new Error('style bridge missing (ziptest=1)')
    return bridge.renderCaptionsForTime(time, width, height, 1)
  }, [t, w, h] as const)
}

/** seek + fonts.settled + paint settle, the unit-201 identity recipe. The
 *  overlay layer renders from the ONE rAF/arbitrator source — synchronously
 *  on seek (frozen unit-102 contract) — so every style mutation is followed
 *  by a two-step seek nudge (out and back) to guarantee a fresh sample was
 *  flushed with the NEW style; the nudge stays inside the active word. */
async function seekAndSettle(page: Page, t: number): Promise<void> {
  const seek = (time: number): Promise<void> =>
    page.evaluate((x) => {
      const b = (window as unknown as { __zipEditorBridge?: { command(id: string, payload?: unknown): { code: string } | null } }).__zipEditorBridge
      const rejection = b?.command('transport-seek', { time: x })
      if (rejection !== null && rejection !== undefined) throw new Error(`transport-seek rejected: ${rejection.code}`)
    }, time)
  await seek(t + 0.03)
  await seek(t)
  await page.waitForFunction((time) => Math.abs(((window as unknown as { __zipEditorBridge?: { getEditorState(): { playhead: number } } }).__zipEditorBridge?.getEditorState().playhead ?? -1) - time) < 0.04, t, { timeout: 10_000 })
  await page.evaluate(() => document.fonts.ready)
  await seek(t)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(r, 150)))))
}

/** Mirror of the unit-202 burn-in spec's preview composite (video frame +
 *  caption canvas at the output's pinned 320×180; UI furniture excluded BY
 *  CONSTRUCTION — the burn-in file never carries it either). */
async function capturePreviewComposite(page: Page, t: number): Promise<string> {
  await seekAndSettle(page, t)
  await page.waitForTimeout(350)
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

async function toDataUrl(file: string): Promise<string> {
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`
}

// — SECURITY-03 console audit (CC-205.5): codes/lengths only ----------------

interface LeakRecord {
  channel: string
  needleIndex: number
  length: number
}

/** Collects every console/pageerror line in the TEST process; leaks() reports
 *  only {channel, needleIndex, length} records — the seeded caption text
 *  never echoes into an assertion message or report (unit-301 redaction
 *  pattern; conventions § Principles 4). */
function attachConsoleAudit(page: Page, needles: string[]): { leaks(): LeakRecord[] } {
  const texts: { channel: string; text: string }[] = []
  page.on('console', (msg) => texts.push({ channel: `console.${msg.type()}`, text: msg.text() }))
  page.on('pageerror', (error) => texts.push({ channel: `pageerror.${error.name}`, text: error.message }))
  return {
    leaks: () => {
      const out: LeakRecord[] = []
      for (const entry of texts) {
        needles.forEach((needle, needleIndex) => {
          if (needle !== '' && entry.text.includes(needle)) out.push({ channel: entry.channel, needleIndex, length: entry.text.length })
        })
      }
      return out
    },
  }
}

// — download / persistence mirrors (header note) -----------------------------

async function downloadBytes(page: Page, action: () => Promise<void>): Promise<{ name: string; body: string }> {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), action()])
  const path = await download.path()
  if (path === null) throw new Error('download has no path')
  return { name: download.suggestedFilename(), body: readFileSync(path, 'utf8') }
}

async function pick(page: Page, format: string, track: string, labels: string): Promise<void> {
  await page.getByTestId(`sidecar-format-${format}`).click()
  await page.getByTestId('sidecar-track').selectOption(track)
  await page.getByTestId('sidecar-speaker-labels').selectOption(labels)
}

async function flushAndSnapshot(page: Page): Promise<{ id: string; json: string }> {
  const flushed = await page.evaluate(() => (window as unknown as PersistenceBridgeWindow).__zipPersistenceBridge?.saveNow('manual'))
  expect(['saved', 'not-dirty']).toContain(flushed)
  const id = await page.evaluate(async () => ((await (window as unknown as PersistenceBridgeWindow).__zipPersistenceBridge?.listProjects()) ?? [])[0]?.id ?? null)
  if (id === null) throw new Error('no project row after autosave')
  const json = await page.evaluate((projectId) => (window as unknown as PersistenceBridgeWindow).__zipPersistenceBridge?.exportProjectFile(projectId), id)
  if (json === null || json === undefined) throw new Error('exportProjectFile returned null')
  return { id, json }
}

async function snapshotAfterReload(page: Page, id: string): Promise<string> {
  await page.reload()
  await page.waitForFunction(() => (window as unknown as PersistenceBridgeWindow).__zipPersistenceBridge !== undefined, undefined, { timeout: 20_000 })
  const json = await page.evaluate(async (projectId) => {
    const p = (window as unknown as PersistenceBridgeWindow).__zipPersistenceBridge
    const rows = (await p?.listProjects()) ?? []
    if (!rows.some((row) => row.id === projectId)) throw new Error('project row missing after reload')
    return p?.exportProjectFile(projectId) ?? null
  }, id)
  if (json === null) throw new Error('exportProjectFile null after reload')
  return json
}

// — closure-map parser (CC-205.1 guard + J8 aggregate integrity) -------------

interface ModeledCase {
  /** Title of the single enclosing describe ('' when top-level). */
  describe: string
  test: string
  /** The junit `name` the reporter will emit: `describe › test`. */
  title: string
}

/** Model the Playwright junit title space of this file: `describe › test`
 *  (the concatenation scripts/lib/junit-trust.ts citationsOf parses), from
 *  the committed source text — one describe per test in this file. The
 *  regexes spell their quote as \u0027 so scripts/lib/criteria-credit.ts's
 *  stripStringsAndComments (no regex-literal awareness) keeps string parity
 *  over this file and every describe stays visible to the committed-spec
 *  model (unit-205 review MAJOR-1). */
function modeledCases(src: string): ModeledCase[] {
  const describes: { index: number; title: string }[] = []
  for (const match of src.matchAll(/test\.describe\(\s*\u0027([^\u0027]*)\u0027/g)) describes.push({ index: match.index ?? 0, title: match[1]! })
  const out: ModeledCase[] = []
  for (const match of src.matchAll(/\btest\(\s*\u0027([^\u0027]*)\u0027/g)) {
    const idx = match.index ?? 0
    const enclosing = describes.filter((entry) => entry.index < idx).at(-1)
    const title = match[1]!
    out.push({ describe: enclosing?.title ?? '', test: title, title: enclosing === undefined ? title : `${enclosing.title} › ${title}` })
  }
  return out
}

const CITED_ROWS = ['CC-I3.1', 'CC-I3.2', 'CC-I3.3', 'CC-I3.4', 'CC-I3.5', 'CC-I3.6', 'CC-I3.7', 'CC-I3.8', 'CC-I3.10'] as const

// ============================== J1 · CC-I3.1 ================================

test.describe('CC-I3.1 CC-205.5: J1 preset library + custom controls render through the shared preview overlay renderer (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium journey — the webkit tier owns CC-I3.4')
  test.setTimeout(180_000)

  test('CC-I3.1 CC-205.5: four presets + Case/box custom controls visibly restyle the preview; preview canvas == shared renderer output (SSIM ≥ 0.99); style survives reload byte-equal', async ({ page }) => {
    const needles = [CANARY_MARKER, ...CANARY_BLOCKS.flatMap((block) => [block.text, ...block.words.map((w) => w.text)])] as string[]
    const audit = attachConsoleAudit(page, needles)
    await openExportProject(page, { asset: TAXI_ASSET, src: '/fixtures/taxi-en-accented-1.mp4', blocks: CANARY_BLOCKS as unknown[] })
    await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: { getEditorState(): { videoReady: boolean } } }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 30_000 })
    await waitStyleBridge(page)
    await page.addStyleTag({ content: STAGE_PIN })
    await page.waitForTimeout(400)

    await page.getByTestId('tab-style').click()
    await expect(page.getByTestId('style-panel'), 'preset gallery + full style controls (US-3.1.2)').toBeVisible({ timeout: 10_000 })
    for (const id of ['preset-karaoke', 'preset-broadcast-box', 'preset-bold-lower', 'preset-minimal']) {
      await expect(page.getByTestId(id), `preset ${id} renders in the library`).toBeVisible()
    }

    const t = 2.0
    await seekAndSettle(page, t)
    const base = await captureCaptionCanvas(page)
    expect(base.w).toBeGreaterThan(0)

    await page.getByTestId('preset-minimal').click()
    await seekAndSettle(page, t)
    const minimal = await captureCaptionCanvas(page)
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
      let inked = 0
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 16) inked += 1
      return inked
    }, minimal.png)
    expect(ink, 'the preview overlay actually draws the captions').toBeGreaterThan(100)

    await page.getByTestId('preset-bold-lower').click()
    await seekAndSettle(page, t)
    const boldLower = await captureCaptionCanvas(page)
    expect(await inkDiffRatio(page, minimal.png, boldLower.png), 'preset switch visibly restyles the preview overlay').toBeGreaterThanOrEqual(0.002)

    await page.locator('#style-textTransform').selectOption('uppercase')
    await seekAndSettle(page, t)
    const upper = await captureCaptionCanvas(page)
    expect(await inkDiffRatio(page, boldLower.png, upper.png), 'custom Case control visibly restyles the preview overlay').toBeGreaterThanOrEqual(0.002)

    await page.locator('#style-backgroundColor').check()
    await seekAndSettle(page, t)
    const boxed = await captureCaptionCanvas(page)
    expect(await inkDiffRatio(page, upper.png, boxed.png), 'custom Background-box control visibly restyles the preview overlay').toBeGreaterThanOrEqual(0.005)

    const viaShared = await renderViaSharedBridge(page, t, base.w, base.h)
    const ssim = await ssimInPage(page, boxed.png, viaShared)
    expect(ssim, `preview canvas vs engine/export/overlay.ts render at t=${t}; -1 ⇒ dimension mismatch`).toBeGreaterThanOrEqual(SSIM_MIN)

    const before = await flushAndSnapshot(page)
    const after = await snapshotAfterReload(page, before.id)
    expect(after, 'styled project restored byte-equal after reload (FR-205.4)').toBe(before.json)

    expect(audit.leaks(), 'SECURITY-03: caption text never crosses the console (codes/lengths only)').toEqual([])
  })
})

// ============================== J2 · CC-I3.2 ================================

test.describe('CC-I3.2 CC-205.5: J2 sidecar goldens byte-exact — source + translation tracks on a styled project (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium journey — the webkit tier owns CC-I3.4')
  test.setTimeout(180_000)

  test('CC-I3.2 CC-205.5: SRT/VTT/JSON/TSV (source) + FR/AR translation downloads match the committed goldens byte-for-byte, escape/RTL/newline included', async ({ page }) => {
    const needles = [
      ...SIDECAR_BLOCKS.map((block) => block.text),
      ...Object.values(SIDECAR_FR).map((entry) => String((entry as { text?: string }).text ?? '')),
      ...Object.values(AR).map((entry) => String((entry as { text: string }).text)),
    ]
    const audit = attachConsoleAudit(page, needles)
    // Deferral (unit-205 review round): CC-I3.2's re-import half — the
    // local-transcribe-engine/unit-07 parsers round-tripping our own
    // sidecar bytes (± 1 ms) — is owned by unit-202
    // (tests/unit/export/roundtrip.test.ts, CC-202.1); FR-205.1 keeps
    // committed suites the single owner of their legs.
    await openExportProject(page, {
      asset: SIDECAR_ASSET,
      src: '/fixtures/audio/speech-2min.m4a',
      blocks: SIDECAR_BLOCKS,
      speakers: SIDECAR_SPEAKERS,
      name: SIDECAR_NAME,
      language: 'en',
      translations: { fr: SIDECAR_FR, ar: AR },
    })
    // Intent composition (beyond unit-202's dialog-level proof): the export
    // runs on a project STYLED through the real Style tab — styling must not
    // perturb the serialized caption bytes.
    await page.getByTestId('tab-style').click()
    await expect(page.getByTestId('style-panel')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('preset-karaoke').click()
    await page.waitForTimeout(300)

    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()

    const cases: Array<{ format: string; track: string; labels: string; golden: string; file: string }> = [
      { format: 'srt', track: 'source', labels: 'off', golden: 'audio-source-off.srt', file: `${SIDECAR_SLUG}.srt` },
      { format: 'vtt', track: 'source', labels: 'prefix', golden: 'vtt-source-prefix.vtt', file: `${SIDECAR_SLUG}.vtt` },
      { format: 'json', track: 'source', labels: 'off', golden: 'json-source.json', file: `${SIDECAR_SLUG}.json` },
      { format: 'tsv', track: 'source', labels: 'off', golden: 'audio-source-off.tsv', file: `${SIDECAR_SLUG}.tsv` },
      { format: 'srt', track: 'fr', labels: 'off', golden: 'srt-fr-off.srt', file: `${SIDECAR_SLUG}.fr.srt` },
      { format: 'vtt', track: 'fr', labels: 'vtt-voice', golden: 'vtt-fr-voice.vtt', file: `${SIDECAR_SLUG}.fr.vtt` },
      { format: 'json', track: 'fr', labels: 'off', golden: 'json-fr.json', file: `${SIDECAR_SLUG}.fr.json` },
      { format: 'srt', track: 'ar', labels: 'off', golden: 'srt-ar-off.srt', file: `${SIDECAR_SLUG}.ar.srt` },
      { format: 'tsv', track: 'ar', labels: 'prefix', golden: 'tsv-ar-prefix.tsv', file: `${SIDECAR_SLUG}.ar.tsv` },
    ]
    for (const c of cases) {
      await pick(page, c.format, c.track, c.labels)
      const got = await downloadBytes(page, async () => {
        await page.getByTestId('sidecar-save').click()
      })
      expect(got.name, `filename for ${c.golden}`).toBe(c.file)
      expect(got.body, `bytes for ${c.golden}`).toBe(readGolden(c.golden))
    }

    expect(audit.leaks(), 'SECURITY-03: caption/translation text never crosses the console (codes/lengths only)').toEqual([])
  })
})

// ============================== J3 · CC-I3.3 ================================

test.describe('CC-I3.3 CC-205.5: J3 burn-in MP4 — 10 word-boundary frames SSIM ≥ 0.99 vs preview + audio ± 1 s (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium journey — the webkit tier owns CC-I3.4')
  test.setTimeout(300_000)
  test.afterAll(cleanScratch)

  test('CC-I3.3 CC-205.5: burned MP4 — duration ± 1 s, muxed audio, 10/10 word-boundary frames match the live preview overlay at SSIM ≥ 0.99', async ({ page }) => {
    const needles = EXPORT_BLOCKS.flatMap((block) => [block.text, ...block.words.map((w) => w.text)])
    const audit = attachConsoleAudit(page, needles)
    await openExportProject(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: EXPORT_BLOCKS,
      mediaBytes: { path: '/fixtures/taxi-en-accented-1.mp4', type: 'video/mp4' },
    })
    // deterministic reference geometry (unit-202 doctrine): pin the stage to
    // the output's native 320×180 so preview rasterizes at the burn-in scale.
    await page.addStyleTag({ content: STAGE_PIN })
    await page.waitForTimeout(400)

    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog'), 'the capability-gated dialog opens (T1 chromium)').toBeVisible()
    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 })
    await page.getByTestId('burnin-start').click()
    await expect(page.getByTestId('export-progress')).toBeVisible()

    const download = await downloadPromise
    const out = scratchPath('i3-burn-in.mp4')
    await download.saveAs(out)
    const info = mediaInfo(out)
    expect(Math.abs(info.durationSec - TAXI_DURATION), `audio+video duration ${info.durationSec}s vs source ${TAXI_DURATION}s (± 1 s)`).toBeLessThanOrEqual(1)
    expect(info.hasAudio, 'muxed audio track').toBe(true)
    expect(info.hasVideo, 'video track').toBe(true)

    for (let i = 0; i < SAMPLE_TIMES.length; i += 1) {
      const t = SAMPLE_TIMES[i] ?? 0
      const framePath = scratchPath(`i3-out-${i}.png`)
      extractFrame(out, t, framePath)
      const ssim = await ssimInPage(page, await toDataUrl(framePath), await capturePreviewComposite(page, t))
      expect(ssim, `active-word overlay at word-boundary t=${t.toFixed(2)}s; -1 ⇒ decode failure`).toBeGreaterThanOrEqual(SSIM_MIN)
    }

    expect(audit.leaks(), 'SECURITY-03: block text never crosses the console (codes/lengths only)').toEqual([])
  })
})

// ============================== J4 · CC-I3.4 ================================

// The on-engine webkit leg. Reviewer probe (unit-205 review round): webkit
// 1.64 HAS AudioEncoder, so the encoder-less branch below is dead code on
// this engine — the executable T3 proof is the chromium mirror (J4b), and
// the chromium verify:unit spawn (which skips this case) credits the IDs
// from J4b's passing run. This journey stays as the real-engine tier check.
test.describe('CC-I3.4 CC-205.2: J4 webkit export tier — SRT/VTT/JSON/TSV offered, MP4 never offered on the encoder-less tier (webkit)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(({ browserName }: { browserName: string }): boolean => browserName !== 'webkit', 'webkit export tier — run under E2E_WEBKIT=1')
  test.setTimeout(120_000)

  test('CC-I3.4 CC-205.2: all four sidecar formats are offered and work; burn-in is offered exactly when BOTH encoders exist — never a broken-but-offered MP4', async ({ page }) => {
    await openExportProject(page, { asset: TAXI_ASSET, src: '/fixtures/taxi-en-accented-1.mp4', blocks: EXPORT_BLOCKS })
    const encoders = await page.evaluate(() => ({
      video: typeof (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder === 'function',
      audio: typeof (globalThis as unknown as { AudioEncoder?: unknown }).AudioEncoder === 'function',
    }))
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()

    for (const format of ['srt', 'vtt', 'json', 'tsv']) {
      await expect(page.getByTestId(`sidecar-format-${format}`), `format ${format.toUpperCase()} is offered`).toBeVisible()
    }
    await expect(page.getByTestId('sidecar-save')).toBeVisible()

    const start = page.getByTestId('burnin-start')
    if (encoders.video && encoders.audio) {
      await expect(start, 'full encoder stack ⇒ burn-in may be offered').toBeVisible()
    } else {
      // the CC-I3.4 case: no AudioEncoder ⇒ MP4 burn-in is NEVER offered …
      await expect(start, 'encoder-less tier must never offer MP4 burn-in').toHaveCount(0)
      // … and the absence is explained honestly (unit-202 gating contract).
      const explained = (await page.getByTestId('burnin-absent-reason').count()) + (await page.getByTestId('requirements-copy').count())
      expect(explained, 'one honest one-line reason replaces the offer').toBe(1)
    }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByTestId('sidecar-save').click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.srt$/u)
    await expect(page.getByTestId('export-toast')).toContainText('Download', { timeout: 15_000 })
  })
})

// ============================= J4b · CC-I3.4 ================================

// The chromium mirror of the T3 encoder-less tier (unit-205 review round,
// BLOCKER-1 + MAJOR-2): webkit-1.64 exposes AudioEncoder, so J4's
// encoder-less branch never executes there, and under the chromium-only
// verify:unit spawn J4 stays skipped — leaving CC-I3.4/CC-205.2
// cited-only-skipped and uncreditable. This leg reproduces the exact T3
// shape on chromium with the unit-202 doctrine (e2e/export/gating.spec.ts:
// addInitScript deleting AudioEncoder before navigation) and LEAD-CITES the
// same IDs, so a passing chromium case credits them under the leading-ID
// rule; the real webkit J4 is kept as the on-engine leg.
test.describe('CC-I3.4 CC-205.2: J4b chromium AudioEncoder-less tier — SRT/VTT/JSON/TSV offered, MP4 never offered (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium tier mirror — the on-engine leg is J4 under E2E_WEBKIT=1')
  test.setTimeout(120_000)

  test('CC-I3.4 CC-205.2: AudioEncoder deleted by init script — all four sidecar formats stay offered and SRT downloads; burn-in is NEVER offered; the gating copy honestly names AudioEncoder', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'AudioEncoder', { value: undefined, configurable: true })
    })
    await openExportProject(page, { asset: TAXI_ASSET, src: '/fixtures/taxi-en-accented-1.mp4', blocks: EXPORT_BLOCKS })
    const encoders = await page.evaluate(() => ({
      video: typeof (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder === 'function',
      audio: typeof (globalThis as unknown as { AudioEncoder?: unknown }).AudioEncoder === 'function',
    }))
    expect(encoders.audio, 'the init script really removed AudioEncoder (unit-202 gating.spec.ts doctrine)').toBe(false)
    expect(encoders.video, 'VideoEncoder stays present — this is the T3 AudioEncoder-less shape, not the T4 requirements view').toBe(true)

    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()

    for (const format of ['srt', 'vtt', 'json', 'tsv']) {
      await expect(page.getByTestId(`sidecar-format-${format}`), `format ${format.toUpperCase()} stays offered at the encoder-less tier`).toBeVisible()
    }
    await expect(page.getByTestId('sidecar-save'), 'sidecar export stays startable').toBeVisible()

    // The CC-I3.4 contract: never a broken-but-offered MP4 …
    await expect(page.getByTestId('burnin-start'), 'MP4 burn-in is NEVER offered without AudioEncoder').toHaveCount(0)
    // … and the absence is explained honestly (unit-202 gating contract:
    // exactly one reason line naming the missing encoder, not the T4
    // requirements screen — navigator.gpu is untouched here).
    await expect(page.getByTestId('burnin-absent-reason')).toContainText('AudioEncoder')
    await expect(page.getByTestId('requirements-copy')).toHaveCount(0)

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByTestId('sidecar-save').click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.srt$/u)
    await expect(page.getByTestId('export-toast')).toContainText('Download', { timeout: 15_000 })
  })
})

// ============================== J5 · CC-I3.5 ================================

test.describe('CC-I3.5 CC-205.5: J5 audio project — no MP4 in the dialog DOM, Style tab hides the aspect selector, sidecar byte-exact (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium journey — the webkit tier owns CC-I3.4')
  test.setTimeout(120_000)

  test('CC-I3.5 CC-205.5: audio project — burn-in absent from the dialog DOM at every level, no MP4 text, aspect selector hidden, sidecar golden byte-exact', async ({ page }) => {
    const needles = [...SIDECAR_BLOCKS.map((block) => block.text), ...Object.values(SIDECAR_FR).map((entry) => String((entry as { text?: string }).text ?? ''))]
    const audit = attachConsoleAudit(page, needles)
    await openExportProject(page, {
      asset: SIDECAR_ASSET,
      src: '/fixtures/audio/speech-2min.m4a',
      blocks: SIDECAR_BLOCKS,
      speakers: SIDECAR_SPEAKERS,
      name: SIDECAR_NAME,
      language: 'en',
      translations: { fr: SIDECAR_FR },
    })

    // Style tab: aspect controls hidden for audio (FR-201.6), honest note shown.
    await page.getByTestId('tab-style').click()
    await expect(page.getByTestId('style-panel')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#style-outputAspect'), 'no output-aspect selector for audio').toHaveCount(0)
    await expect(page.getByLabel('Aspect', { exact: true }), 'no Aspect-labelled control for audio').toHaveCount(0)
    await expect(page.getByText('aspect is fixed 16:9'), 'the audio Style tab explains the fixed aspect').toBeVisible()

    // Export dialog: burn-in absent from the DOM, MP4 never mentioned, T4
    // requirements copy never shown for an audio (gate-none) project.
    await page.getByTestId('export-button').click()
    const dialog = page.getByTestId('export-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-testid^=burnin]'), 'no burn-in affordance in the audio dialog DOM').toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Burn-in MP4' }), 'no Burn-in MP4 region').toHaveCount(0)
    await expect(dialog.getByText(/mp4/iu), 'the audio dialog never mentions MP4').toHaveCount(0)
    await expect(page.getByTestId('requirements-copy'), 'audio is gate-none, not a requirements screen').toHaveCount(0)
    for (const format of ['srt', 'vtt', 'json', 'tsv']) {
      await expect(page.getByTestId(`sidecar-format-${format}`), `sidecar format ${format.toUpperCase()} offered`).toBeVisible()
    }

    await pick(page, 'srt', 'source', 'off')
    const got = await downloadBytes(page, async () => {
      await page.getByTestId('sidecar-save').click()
    })
    expect(got.name).toBe(`${SIDECAR_SLUG}.srt`)
    expect(got.body, 'audio sidecar byte-exact vs the committed golden').toBe(readGolden('audio-source-off.srt'))

    expect(audit.leaks(), 'SECURITY-03: caption/translation text never crosses the console (codes/lengths only)').toEqual([])
  })
})

// ============================== J6 · CC-I3.6 ================================

test.describe('CC-I3.6: J6 installability — zero CDP errors + manifest fields on the production build (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'CDP Page.getInstallabilityErrors is a Chromium domain')
  test.use({ serviceWorkers: 'allow' })
  test.setTimeout(120_000)

  test('CC-I3.6: Page.getInstallabilityErrors reports none on the built bundle and the manifest carries the install-critical fields', async ({ page, request, context }) => {
    const audit = attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/')

    const report = await getInstallability(page)
    expect(report.manifestParseErrors, 'the generated manifest parses without CDP errors').toEqual([])
    expect(report.manifestUrl, 'the document links a manifest').not.toBeNull()
    expect(report.installErrors, `Chrome reports the app installable (CDP errors: ${JSON.stringify(report.installErrors)})`).toEqual([])

    const manifest = await fetchManifest(request, PREVIEW_BASE)
    expect(String(manifest['name'] ?? '').length, 'name present').toBeGreaterThan(0)
    expect(String(manifest['short_name'] ?? '').length, 'short_name present').toBeGreaterThan(0)
    expect(manifest['display'], 'standalone shell').toBe('standalone')
    expect(manifest['start_url'], 'start_url is the root').toBe('/')
    expect(manifest['scope'], 'scope is the root').toBe('/')
    const icons = iconPurposes(manifest)
    expect(icons.some((i) => i.sizes === '192x192' && i.purposes.includes('any')), 'a 192 any icon').toBe(true)
    expect(icons.some((i) => i.sizes === '512x512' && i.purposes.includes('any')), 'a 512 any icon').toBe(true)

    expect(audit.external, 'zero non-allowlisted hosts during the installability boot').toEqual([])
    expect(audit.cspViolations, 'no CSP violations against the built output').toEqual([])
  })
})

// ============================== J7 · CC-I3.7 ================================

test.describe('CC-I3.7 CC-205.5: J7 offline — reload from the SW cache, project reopens from IndexedDB, edits autosave, sidecar exports offline (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium journey — the webkit tier owns CC-I3.4')
  test.use({ serviceWorkers: 'allow' })
  test.setTimeout(240_000)

  test('CC-I3.7 CC-205.5: one visit then offline — shell reloads, the stored project reopens, a rename autosaves to IDB, an SRT sidecar downloads with zero network', async ({ page, context }) => {
    const needles = [CANARY_MARKER, ...CANARY_BLOCKS.flatMap((block) => [block.text, ...block.words.map((w) => w.text)])] as string[]
    const audit = attachSecurityGuards(context, page)
    const consoleAudit = attachConsoleAudit(page, needles)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await ensurePrecache(page)
    await openAppWithBridges(page)
    const id = await openProjectWithLocalMedia(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: CANARY_BLOCKS,
      name: 'j7-offline-export',
      fingerprint: TAXI_FINGERPRINT,
      fileBytesBase64: taxiBytesBase64(),
      fileType: 'video/mp4',
    })
    const before = (await projectRows(page)).find((row) => row.id === id)?.updatedAt ?? 0
    audit.reset()

    // Deferral (unit-205 review round): CC-I3.7's transcription half — the
    // offline-ready model transcribing after one visit, and the honest
    // OFFLINE_MODEL_MISSING fast-fail otherwise — is owned by unit-204
    // (e2e/pwa/offline.spec.ts); FR-205.1 keeps e2e/pwa/** untouched.
    await context.setOffline(true)
    try {
      // Offline reload (navigateFallback) → reopen from REAL IndexedDB.
      await openAppWithBridges(page)
      await expect(page.getByTestId('workbench-shell'), 'the app boots offline from the SW cache').toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId(`project-open-${id}`), 'the project list renders from IndexedDB offline').toBeVisible({ timeout: 15_000 })
      await page.getByTestId(`project-open-${id}`).click()
      await expect
        .poll(async () => (await page.evaluate(() => (window as unknown as { __zipEditorBridge?: { getEditorState(): { blockCount: number } } }).__zipEditorBridge?.getEditorState().blockCount ?? 0)), { message: 'the stored project reopens offline with its blocks', timeout: 30_000 })
        .toBeGreaterThan(0)

      // Edit autosaves to IndexedDB with zero network (CC-I3.7 leg).
      await page.evaluate((name) => (window as unknown as { __zipEditorBridge?: { setProjectName(n: string): void } }).__zipEditorBridge?.setProjectName(name), 'j7-offline-edited')
      await expect
        .poll(async () => (await projectRows(page)).find((row) => row.id === id)?.updatedAt ?? 0, { message: 'autosave wrote the offline edit to IndexedDB', timeout: 30_000 })
        .toBeGreaterThan(before)
      await expect.poll(() => saveState(page), { message: 'save state reports saved', timeout: 30_000 }).toBe('saved')

      // Sidecar export works offline (lazy dialog chunk precached).
      await page.getByTestId('export-button').click()
      await expect(page.getByTestId('export-dialog')).toBeVisible()
      await page.getByTestId('sidecar-format-srt').click()
      await page.getByTestId('sidecar-track').selectOption('source')
      await page.getByTestId('sidecar-speaker-labels').selectOption('off')
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByTestId('sidecar-save').click()])
      expect(download.suggestedFilename(), 'the sidecar downloaded offline, named from the AUTOSAVED rename').toBe('j7-offline-edited.srt')
      const path = await download.path()
      if (path === null) throw new Error('offline sidecar download has no path')
      // structural check only — caption text stays out of assertion output
      // (SECURITY-03); structure proves the serializer really ran.
      expect(readFileSync(path, 'utf8')).toMatch(/\d{2}:\d{2}:\d{2},\d{3} -->/u)

      expect(audit.bypassedSw, 'the offline reload + reopen + autosave + export reached NO network').toEqual([])
      expect(audit.modelHost, 'no model-host attempts in the offline session').toEqual([])
      expect(audit.external, 'zero non-allowlisted hosts').toEqual([])
      expect(consoleAudit.leaks(), 'SECURITY-03: caption text never crosses the console (codes/lengths only)').toEqual([])
    } finally {
      await context.setOffline(false)
    }
  })
})

// ============================== J8 · CC-I3.8 ================================

test.describe('CC-I3.8: J8 closure aggregate — the closure run gates on the production bundle + wired webkit tier (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium journey — the webkit tier owns CC-I3.4')
  test.setTimeout(60_000)

  // The "pnpm test:e2e green incl. webkit" half is the verifier's junit-trust
  // gate (header): any failing e2e test ⇒ nonzero spawn ⇒ zero e2e credit ⇒
  // CC-I3.8 UNCOVERED ⇒ verify:intent exit 1. This leg asserts the run's
  // falsifiable preconditions: a dev-server fallback, a missing manifest, a
  // renamed-away webkit leg, or a dropped citation leg all redden it.
  test('CC-I3.8: preview serves the production bundle (no dev fallback), the manifest ships, and every CC-I3 citation leg + the webkit tier wiring exist', async ({ request }, testInfo) => {
    const index = await request.get('/')
    expect(index.status(), 'the preview origin answers').toBe(200)
    const html = await index.text()
    // The quotes are spelled \u0022: scripts/lib/criteria-credit.ts's
    // stripStringsAndComments has no regex-literal awareness, and raw "
    // here flipped string parity and swallowed the trailing describes of
    // this file from the committed-spec model (unit-205 review MAJOR-1).
    expect(html, 'the served index references the BUILT hashed bundle (not the Vite dev client)').toMatch(/<script[^>]+src=\u0022\/assets\/[^\u0022]+\.js\u0022/u)
    expect(html, 'no dev-server fallback inside the e2e webServer').not.toContain('/@vite/client')
    const manifestResponse = await request.get('/manifest.webmanifest')
    expect(manifestResponse.status(), 'the production build ships the manifest (PWA parity)').toBe(200)

    const own = readFileSync(testInfo.file, 'utf8')
    const cases = modeledCases(own)
    // Tier-aware uniqueness (unit-205 review round): every row leads exactly
    // one CHROMIUM-runnable journey — the tier the chromium verify:unit spawn
    // can actually credit (CC-I3.4's chromium leg is the J4b mirror) — and
    // CC-I3.4 additionally keeps exactly one on-engine WEBKIT journey (J4).
    // Renaming, duplicating or dropping any leg reddens this.
    for (const row of CITED_ROWS) {
      const chromiumLeads = cases.filter((entry) => citationsOf(entry.title).includes(row) && /\(chromium\)$/u.test(entry.describe))
      expect(chromiumLeads.length, `exactly one chromium-runnable lead-citing journey for ${row}`).toBe(1)
    }
    const webkitLeads = cases.filter((entry) => citationsOf(entry.title).includes('CC-I3.4') && /\(webkit\)$/u.test(entry.describe))
    expect(webkitLeads.length, 'CC-I3.4 keeps exactly one on-engine webkit journey (J4)').toBe(1)
    expect(cases.some((entry) => citationsOf(entry.title).includes('CC-I3.9')), 'the [DEPLOY] row is never lead-cited').toBe(false)
    expect(own.includes("browserName !== 'webkit'"), 'the webkit journey is project-tagged (no test.skip-free drift)').toBe(true)

    const config = readFileSync(join(dirname(testInfo.file), '..', '..', 'playwright.config.ts'), 'utf8')
    expect(config.includes("name: 'webkit'"), 'the webkit project exists in the config (CC-I3.8 incl. webkit)').toBe(true)
    expect(config.includes('E2E_WEBKIT'), 'the webkit tier is gated behind E2E_WEBKIT=1 (FR-1.0.4)').toBe(true)
    readFileSync(join(dirname(testInfo.file), '..', 'export', 'webkit-export.spec.ts'), 'utf8')
  })
})

// ============================== J9 · CC-I3.10 ===============================

test.describe('CC-I3.10: J9 About/licensing panel lists every registry model with license + attribution (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium journey — the webkit tier owns CC-I3.4')
  test.setTimeout(60_000)

  test('CC-I3.10: the ⋯ menu opens the About/licensing panel and every MODEL_REGISTRY + DIAR_MODEL_REGISTRY row lists id, license and attribution', async ({ page }) => {
    await page.goto('/?ziptest=1')
    await expect(page.getByTestId('workbench-shell'), 'the app boots on the built bundle').toBeVisible({ timeout: 20_000 })
    await page.locator('.shell-pwa-menu-button').click()

    // Seam contract (unit-205 header): pwa-menu-about → about-licensing-panel
    // → about-model-row-<id>. The panel shipped with 5bc27cb (the honest-RED
    // leg the review round filed as the unit-205 blocker) — these assertions
    // are now the regression pin on that seam, not a placeholder.
    await expect(page.getByTestId('pwa-menu-about'), 'About/licensing entry in the ⋯ menu (seam contract, shipped 5bc27cb)').toBeVisible({ timeout: 5_000 })
    await page.getByTestId('pwa-menu-about').click()
    const panel = page.getByTestId('about-licensing-panel')
    await expect(panel, 'the About/licensing panel opens').toBeVisible({ timeout: 10_000 })

    for (const spec of [...Object.values(MODEL_REGISTRY), ...Object.values(DIAR_MODEL_REGISTRY)]) {
      const row = page.getByTestId(`about-model-row-${spec.id}`)
      await expect(row, `registry model ${spec.id} is listed`).toBeVisible()
      await expect(row, `model ${spec.id} shows its license`).toContainText(spec.license)
      if (spec.attribution !== undefined) await expect(row, `model ${spec.id} shows attribution`).toContainText(spec.attribution)
    }
  })
})

// ============ unit-205 own criteria: SECURITY-03 + closure-map lint =========

test.describe('CC-205.5: SECURITY-03 console boundary — caption/translation text never crosses the console (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium journey — the webkit tier owns CC-I3.4')
  test.setTimeout(120_000)

  test('CC-205.5: console + pageerror channels stay canary-clean across seed, render, edit and export (codes/lengths only)', async ({ page }) => {
    const needles = [
      CANARY_MARKER,
      ...CANARY_BLOCKS.flatMap((block) => [block.text, ...block.words.map((w) => w.text)]),
      ...SIDECAR_BLOCKS.map((block) => block.text),
      ...Object.values(SIDECAR_FR).map((entry) => String((entry as { text?: string }).text ?? '')),
    ]
    const audit = attachConsoleAudit(page, needles)
    await openExportProject(page, {
      asset: SIDECAR_ASSET,
      src: '/fixtures/audio/speech-2min.m4a',
      blocks: SIDECAR_BLOCKS,
      speakers: SIDECAR_SPEAKERS,
      name: SIDECAR_NAME,
      language: 'en',
      translations: { fr: SIDECAR_FR },
    })
    await page.getByTestId('tab-subtitles').click()
    await expect(page.getByTestId('transcript-row').first(), 'caption text rendered (the canary is in the page)').toBeVisible({ timeout: 20_000 })
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()
    await pick(page, 'srt', 'source', 'off')
    await downloadBytes(page, async () => {
      await page.getByTestId('sidecar-save').click()
    })
    await page.getByTestId('export-close').click()

    const leaks = audit.leaks()
    // Records carry {channel, needleIndex, length} only — never the text.
    expect(leaks.map((leak) => `${leak.channel}:${leak.needleIndex}:${leak.length}`), 'SECURITY-03: no caption/translation text on any console channel (codes/lengths only)').toEqual([])
  })
})

test.describe('CC-205.1: closure-map lint — every CC-I3 row has exactly one lead-citing journey (static)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.skip(CHROMIUM_ONLY, 'chromium journey — the webkit tier owns CC-I3.4')
  test.setTimeout(30_000)

  // Falsifiable spec-lint: renaming, duplicating or dropping any journey's
  // leading citation reddens this test (it parses this very file through the
  // SAME grammar the verifier uses — scripts/lib/junit-trust.citationsOf —
  // over the modelled `describe › test` junit title space). Tier-aware
  // (unit-205 review round): every row needs exactly one chromium-runnable
  // lead (what the chromium verify:unit spawn can credit — for CC-I3.4 that
  // is the J4b mirror) plus, for CC-I3.4, exactly one on-engine webkit
  // lead (J4). A duplicated or dropped leg reddens it either way.
  test('CC-205.1: every covered CC-I3 row leads exactly one chromium-runnable journey (+ the CC-I3.4 webkit leg); the [DEPLOY] row is never lead-cited', async ({}, testInfo) => {
    const own = readFileSync(testInfo.file, 'utf8')
    const cases = modeledCases(own)
    expect(cases.length, 'the spec exposes its test titles to the parser').toBeGreaterThanOrEqual(CITED_ROWS.length + 3)
    const problems: string[] = []
    for (const row of CITED_ROWS) {
      const chromiumLeads = cases.filter((entry) => citationsOf(entry.title).includes(row) && /\(chromium\)$/u.test(entry.describe))
      if (chromiumLeads.length !== 1) problems.push(`${row}: ${String(chromiumLeads.length)} chromium-runnable lead-citing journeys (want exactly 1)`)
    }
    const webkitLeads = cases.filter((entry) => citationsOf(entry.title).includes('CC-I3.4') && /\(webkit\)$/u.test(entry.describe))
    if (webkitLeads.length !== 1) problems.push(`CC-I3.4 webkit journey (J4): ${String(webkitLeads.length)} (want exactly 1)`)
    for (const entry of cases) {
      if (citationsOf(entry.title).includes('CC-I3.9')) problems.push('CC-I3.9 ([DEPLOY]) is lead-cited — it must stay uncited')
    }
    expect(problems, `closure-map violations: ${problems.join(' | ')}`).toEqual([])
  })
})
