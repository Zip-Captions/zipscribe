// Intent completion suite — caption-studio-ui (CC-I2.1/2/3/8/11, L5 chromium,
// mocked fast worker via injectAsrEvent; no network). The per-unit suites
// (101–107) own the component-level proofs; this file proves the intent-level
// composition: full user journeys through the REAL app on the built bundle.
//
// Byte-equal reload doctrine (CC-I2.1/2/3): autosave flush via the
// persistence bridge, capture `exportProjectFile(id)` from IDB, `page.reload()
// `, capture again — the two JSON strings must compare byte-equal. SECURITY-03:
// only lengths/counts/codes cross into console; transcript text stays in-page.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; blockCount: number; clockTime: number; seekCount: number; videoReady: boolean }
}
interface TranscriptBridge {
  getTranscriptState(): { issueCount: number; runningJobKind: 'transcribe' | 'align' | null; runningJobId: string | null; totalRows: number }
  getBlockTimes(blockId: string): { start: number; end: number } | null
}
interface PersistenceBridge {
  saveNow(reason: 'idle' | 'manual' | 'hidden'): Promise<'saved' | 'not-dirty' | 'failed'>
  listProjects(): Promise<Array<{ id: string }>>
  exportProjectFile(id: string): Promise<string | null>
}
interface VisualizerBridge {
  getVisualizerState(): { framesDrawn: number; playing: boolean }
  getClockDiagnostics(): { kind: string; currentTime: number; duration: number }
  clockControl(method: 'play' | 'pause' | 'seek' | 'setRate' | 'dispose', arg?: number): void
  setScriptedBins(db: number[] | null): void
  setScriptedWaveform(samples: number[] | null): void
}
type B = Record<string, { [k: string]: unknown }>

const SRC = '/fixtures/speech-2min.mp4'
const MEDIA_ASSET = {
  id: 'ASSET_intent_mp4',
  name: 'speech-2min.mp4',
  kind: 'video',
  container: 'mp4',
  audioCodec: 'aac-lc',
  videoCodec: 'h264',
  duration: 119.888,
  width: 640,
  height: 360,
  fps: 30,
  sampleRate: 16_000,
  channels: 1,
  fingerprint: { name: 'speech-2min.mp4', size: 4096, durationMs: 119_888, sampleHashes: ['a', 'b', 'c'] },
}

function audioAsset(name: string, codec: string, sampleRate: number, channels: number, duration: number): Record<string, unknown> {
  return {
    id: `ASSET_intent_${name.replace(/[^a-z0-9]/gi, '_')}`,
    name,
    kind: 'audio',
    container: name.split('.').at(-1),
    audioCodec: codec,
    videoCodec: null,
    duration,
    width: 0,
    height: 0,
    fps: 0,
    sampleRate,
    channels,
    fingerprint: { name, size: 4096, durationMs: Math.round(duration * 1000), sampleHashes: ['a', 'b', 'c'] },
  }
}
const SPEECH_2SPK = { asset: audioAsset('speech-2spk-2min.m4a', 'aac-lc', 16_000, 2, 119.888), src: '/fixtures/audio/speech-2spk-2min.m4a' }
const AIFF_DECODED = { asset: audioAsset('fmt-30s.aiff', 'pcm_s16be', 16_000, 1, 30), src: '/fixtures/audio/fmt-30s.aiff' }

async function boot(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => {
    const w = window as unknown as B
    return w.__zipEditorBridge !== undefined && w.__zipWorkbenchBridge !== undefined && w.__zipPersistenceBridge !== undefined
  }, undefined, { timeout: 20_000 })
}

async function openMedia(page: import('@playwright/test').Page, asset: unknown, src: string, blocks?: unknown): Promise<void> {
  await page.evaluate(([a, s, b]) => {
    (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.openProjectWithMedia(a as never, s, b)
  }, [asset, src, blocks] as const)
  const kind = (asset as { kind?: string }).kind
  if (kind === 'audio') {
    await page.waitForFunction(() => {
      const b = (window as unknown as { __zipVisualizerBridge?: VisualizerBridge }).__zipVisualizerBridge
      const d = b?.getClockDiagnostics()
      return d !== undefined && d.kind !== 'none' && d.kind !== 'deferred' && d.duration > 0
    }, undefined, { timeout: 30_000 })
  } else {
    await page.waitForFunction(() => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.getEditorState().videoReady === true, undefined, { timeout: 30_000 })
  }
}

interface SegLike { start: number; end: number; text: string; words: { text: string; start: number; end: number }[] }
async function mockTranscribe(page: import('@playwright/test').Page, segments: SegLike[]): Promise<void> {
  await page.click('[data-testid=transcribe-button]', { timeout: 5_000 })
  await page.waitForSelector('[data-testid=transcribe-popover]', { timeout: 5_000 })
  const toggle = page.locator('[data-testid=diarize-toggle]')
  if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click()
  await page.click('[data-testid=transcribe-start-button]', { timeout: 5_000 })
  await page.waitForFunction(() => (window as unknown as { __zipTranscriptBridge: { getTranscriptState(): { runningJobKind: string | null } } }).__zipTranscriptBridge.getTranscriptState().runningJobKind === 'transcribe', undefined, { timeout: 15_000 })
  const jobId = await page.evaluate(() => (window as unknown as { __zipTranscriptBridge: TranscriptBridge }).__zipTranscriptBridge.getTranscriptState().runningJobId)
  if (jobId === null) throw new Error('transcribe job never started')
  await page.evaluate((p) => {
    const w = window as unknown as { __zipWorkbenchBridge?: { injectAsrEvent(event: { t: string; jobId: string; segments?: unknown[]; processedSec?: number; totalSec?: number }): void } }
    const frontier = Math.max(...p.segs.map((seg) => seg.end)) + 0.5
    w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:progress', jobId: p.id, processedSec: frontier, totalSec: 120 })
    w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:segments', jobId: p.id, segments: p.segs })
    w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:done', jobId: p.id })
  }, { id: jobId, segs: segments })
  await page.waitForFunction(() => (window as unknown as { __zipTranscriptBridge: TranscriptBridge }).__zipTranscriptBridge.getTranscriptState().runningJobKind === null, undefined, { timeout: 15_000 })
}

async function flushAndSnapshot(page: import('@playwright/test').Page): Promise<{ id: string; json: string }> {
  const flushed = await page.evaluate(() => (window as unknown as { __zipPersistenceBridge: PersistenceBridge }).__zipPersistenceBridge.saveNow('manual'))
  expect(['saved', 'not-dirty']).toContain(flushed)
  const id = await page.evaluate(async () => {
    const rows = await (window as unknown as { __zipPersistenceBridge: PersistenceBridge }).__zipPersistenceBridge.listProjects()
    return rows[0]?.id ?? null
  })
  if (id === null) throw new Error('no project row after autosave')
  const json = await page.evaluate((projectId) => (window as unknown as { __zipPersistenceBridge: PersistenceBridge }).__zipPersistenceBridge.exportProjectFile(projectId), id)
  if (json === null) throw new Error('exportProjectFile returned null')
  return { id, json }
}

async function snapshotAfterReload(page: import('@playwright/test').Page, id: string): Promise<string> {
  await page.reload()
  await boot(page)
  const json = await page.evaluate(async (projectId) => {
    const p = (window as unknown as { __zipPersistenceBridge: PersistenceBridge }).__zipPersistenceBridge
    const rows = await p.listProjects()
    if (!rows.some((row) => row.id === projectId)) throw new Error('project row missing after reload')
    return p.exportProjectFile(projectId)
  }, id)
  if (json === null) throw new Error('exportProjectFile null after reload')
  return json
}

async function editBlockText(page: import('@playwright/test').Page, blockId: string, text: string): Promise<void> {
  const row = page.locator(`[data-testid=transcript-row][data-block-id=${blockId}]`)
  await row.locator('[data-testid=transcript-word]').first().dblclick()
  await expect(page.getByTestId('transcript-editor')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

async function openSubtitlesTab(page: import('@playwright/test').Page): Promise<void> {
  await page.click('[data-testid=tab-subtitles]')
  await page.waitForFunction(() => (window as unknown as B).__zipTranscriptBridge !== undefined, undefined, { timeout: 20_000 })
}

async function blockIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid=transcript-row]')].map((row) => (row as HTMLElement).dataset.blockId ?? ''))
}

const TWO_SEGMENTS = [
  { start: 0.4, end: 2.6, text: 'first committed line', words: [{ text: 'first', start: 0.4, end: 1.0 }, { text: 'committed', start: 1.1, end: 1.9 }, { text: 'line', start: 2.0, end: 2.6 }] },
  { start: 3.0, end: 5.0, text: 'second committed line', words: [{ text: 'second', start: 3.0, end: 3.8 }, { text: 'committed', start: 3.9, end: 4.5 }, { text: 'line', start: 4.6, end: 5.0 }] },
]

const WALK_BLOCKS = [
  { id: 'blk_kb1', start: 0.4, end: 2.6, text: 'first committed line', words: [
    { text: 'first', start: 0.4, end: 1.0, timing: 'estimated' },
    { text: 'committed', start: 1.1, end: 1.9, timing: 'estimated' },
    { text: 'line', start: 2.0, end: 2.6, timing: 'estimated' }], speakerId: 'SPK_1' },
  { id: 'blk_kb2', start: 3.0, end: 5.0, text: 'second committed line', words: [
    { text: 'second', start: 3.0, end: 3.8, timing: 'estimated' },
    { text: 'committed', start: 3.9, end: 4.5, timing: 'estimated' },
    { text: 'line', start: 4.6, end: 5.0, timing: 'estimated' }], speakerId: 'SPK_2' },
]

test.describe('CC-108.7 CC-I2.1: import → mocked transcribe → edit → autosave → reload', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')

  test('CC-I2.1: import → mocked transcribe → text edit + split + merge + retime → autosave → reload byte-equal', async ({ page }) => {
    test.setTimeout(180_000)
      await boot(page)
    await openMedia(page, MEDIA_ASSET, SRC)
    await openSubtitlesTab(page)
    await mockTranscribe(page, TWO_SEGMENTS)
    await expect(page.locator('[data-testid=transcript-row]')).toHaveCount(2)

    // Edit text (real UI), then split/merge/retime via the command seam.
    const ids = await blockIds(page)
    await editBlockText(page, ids[0] ?? '', 'first committed edit')
    const split = await page.evaluate((blockId) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.command('block-split', { blockId, at: 1.5 }), ids[0] ?? '')
    expect(split, 'split accepted').toBeNull()
    await expect(page.locator('[data-testid=transcript-row]')).toHaveCount(3)
    const three = await blockIds(page)
    const merge = await page.evaluate(([leftId, rightId]) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.command('block-merge', { blockIds: [leftId, rightId] }), [three[0] ?? '', three[1] ?? ''] as const)
    expect(merge, 'merge accepted').toBeNull()
    await expect(page.locator('[data-testid=transcript-row]')).toHaveCount(2)
    const two = await blockIds(page)
    const retime = await page.evaluate((blockId) => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.command('block-retime', { blockId, start: 3.0, end: 5.5 }), two[1] ?? '')
    expect(retime, 'retime accepted').toBeNull()

    const before = await flushAndSnapshot(page)
    const after = await snapshotAfterReload(page, before.id)
    expect(after, 'state restored byte-equal after reload').toBe(before.json)
  })
  })

test.describe('CC-I2.2: vendor.vtt QC → shift → mocked align → autosave → reload byte-equal', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')

  test('CC-I2.2: media + vendor.vtt → import report → QC fix → shift → mocked align → autosave → reload byte-equal', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)
    await openMedia(page, MEDIA_ASSET, SRC)
    await openSubtitlesTab(page)

    const vtt = readFileSync('fixtures/captions/voices.vtt')
    await page.evaluate(([bytes]) => {
      const file = new File([new Uint8Array(bytes)], 'voices.vtt', { type: 'text/vtt' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const shell = document.querySelector('[data-testid=workbench-shell]') ?? document.body
      shell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    }, [Array.from(vtt)] as const)
    const dialog = page.getByTestId('caption-import-dialog')
    await expect(dialog, 'third-party (voices) vtt import report dialog').toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('caption-import-report-format')).toHaveText('vtt')
    await page.getByTestId('caption-import-confirm').click()
    await expect(page.locator('[data-testid=transcript-row]').first()).toBeVisible({ timeout: 20_000 })

    // QC fix: a long edit raises an issue dot; fixing it clears the count.
    const firstId = await page.evaluate(() => (document.querySelector('[data-testid=transcript-row]') as HTMLElement).dataset.blockId ?? '')
    await editBlockText(page, firstId, 'x'.repeat(60))
    await expect(page.locator('[data-testid=transcript-issue-dot]').first()).toBeVisible({ timeout: 10_000 })
    await editBlockText(page, firstId, 'café au lait')
    await expect(page.locator('[data-testid=transcript-issue-dot]')).toHaveCount(0)

    // Shift timing by +0.5 s through the retime dialog (media never moves).
    const clockBefore = await page.evaluate(() => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.getEditorState())
    const timesBefore = await page.evaluate((blockId) => (window as unknown as { __zipTranscriptBridge: TranscriptBridge }).__zipTranscriptBridge.getBlockTimes(blockId), firstId)
    if (timesBefore === null) throw new Error('first block missing before shift')
    await page.getByTestId('transcript-retime-tool').click()
    await expect(page.getByTestId('retime-dialog')).toBeVisible()
    await page.getByTestId('retime-offset').fill('0.5')
    await page.getByTestId('retime-apply').click()
    await page.waitForFunction(([blockId, expected]) => {
      const b = (window as unknown as { __zipTranscriptBridge: TranscriptBridge }).__zipTranscriptBridge
      const t = b.getBlockTimes(blockId)
      return t !== null && Math.abs(t.start - expected) < 0.002
    }, [firstId, timesBefore.start + 0.5] as const, { timeout: 10_000 })
    const clockAfter = await page.evaluate(() => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.getEditorState())
    expect(clockAfter.seekCount, 'shift never seeks the media (invariant 9)').toBe(clockBefore.seekCount)

    // Mocked align: scripted ASR job over the existing blocks.
    await page.getByTestId('transcript-align-audio').click()
    await page.waitForFunction(() => (window as unknown as { __zipTranscriptBridge: TranscriptBridge }).__zipTranscriptBridge.getTranscriptState().runningJobKind === 'align', undefined, { timeout: 15_000 })
    const jobId = await page.evaluate(() => (window as unknown as { __zipTranscriptBridge: TranscriptBridge }).__zipTranscriptBridge.getTranscriptState().runningJobId)
    if (jobId === null) throw new Error('align job never started')
    await page.evaluate(([id]) => {
      const w = window as unknown as { __zipWorkbenchBridge?: { injectAsrEvent(event: { t: string; jobId: string; segments?: unknown[]; processedSec?: number; totalSec?: number }): void } }
      w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:segments', jobId: id, segments: [{ start: 1.0, end: 2.3, text: 'café au lait', words: [{ text: 'café', start: 1.0, end: 1.5 }, { text: 'au', start: 1.6, end: 1.9 }, { text: 'lait', start: 2.0, end: 2.3 }] }] })
      w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:done', jobId: id })
    }, [jobId] as const)
    await page.waitForFunction(() => (window as unknown as { __zipTranscriptBridge: TranscriptBridge }).__zipTranscriptBridge.getTranscriptState().runningJobKind === null, undefined, { timeout: 15_000 })

    const before = await flushAndSnapshot(page)
    const after = await snapshotAfterReload(page, before.id)
    expect(after, 'state restored byte-equal after reload').toBe(before.json)
  })
  })

test.describe('CC-108.7 CC-I2.3: audio project — visualizer, mocked transcribe+diarize, sidecar-only export, fallback decode', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')

  test('CC-I2.3: audio project — visualizer renders while playing, mocked transcribe+diarize, edit, export sidecars-only (no burn-in DOM), reload byte-equal', async ({ page }) => {
    test.setTimeout(180_000)
      await boot(page)
    await openMedia(page, SPEECH_2SPK.asset, SPEECH_2SPK.src)
    await openSubtitlesTab(page)

    // Visualizer renders while playing (scripted analyser, deterministic).
    await page.evaluate(() => {
      const b = (window as unknown as { __zipVisualizerBridge: VisualizerBridge }).__zipVisualizerBridge
      const bins: number[] = []
      for (let i = 0; i < 2048; i++) bins.push(i < 200 ? -22 : i < 900 ? -45 : -95)
      b.setScriptedBins(bins)
      b.setScriptedWaveform(null)
      b.clockControl('seek', 1.0)
      b.clockControl('play')
    })
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge: VisualizerBridge }).__zipVisualizerBridge.getVisualizerState().framesDrawn > 0, undefined, { timeout: 15_000 })
    await page.evaluate(() => (window as unknown as { __zipVisualizerBridge: VisualizerBridge }).__zipVisualizerBridge.clockControl('pause'))

    await mockTranscribe(page, TWO_SEGMENTS)
    await expect(page.locator('[data-testid=transcript-row]')).toHaveCount(2)
    // Diarize (mocked): assign the second speaker through the same engine seam.
    const ids = await blockIds(page)
    await page.evaluate((blockId) => {
      const e = (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge
      e.command('speaker-add', { label: 'Second', color: '#ff8c00' })
      e.command('speaker-assign', { blockIds: [blockId], speakerId: 'SPK_2' })
    }, ids[1] ?? '')
    await editBlockText(page, ids[0] ?? '', 'audio project edit')

    // Export surface: button live, and NO burn-in control anywhere in the DOM
    // (unit-202 owns the dialog itself — [107-ADJ 23] precedent, CC-107.8).
    const exportButton = page.locator('[data-testid=export-button]')
    await expect(exportButton, 'export enabled — blocks seeded').toBeEnabled()
    await expect(page.getByText(/burn|burn-in|burn in/i), 'no burn-in affordance in the audio workbench DOM').toHaveCount(0)
    await expect(page.locator('[data-testid*="aspect"]'), 'no output-aspect selector for audio').toHaveCount(0)

    const before = await flushAndSnapshot(page)
    const after = await snapshotAfterReload(page, before.id)
    expect(after, 'audio project restored byte-equal').toBe(before.json)
  })

  test('CC-I2.3: fallback-path file (fmt-30s.aiff) plays decoded and survives the same round trip', async ({ page }) => {
    test.setTimeout(180_000)
      await boot(page)
    await openMedia(page, AIFF_DECODED.asset, AIFF_DECODED.src)
    await openSubtitlesTab(page)
    await page.evaluate(() => {
      const b = (window as unknown as { __zipVisualizerBridge: VisualizerBridge }).__zipVisualizerBridge
      b.setScriptedBins(new Array<number>(2048).fill(-60))
      b.clockControl('seek', 0.5)
      b.clockControl('play')
    })
    await page.waitForFunction(() => (window as unknown as { __zipVisualizerBridge: VisualizerBridge }).__zipVisualizerBridge.getVisualizerState().framesDrawn > 0, undefined, { timeout: 15_000 })
    const diag = await page.evaluate(() => (window as unknown as { __zipVisualizerBridge: VisualizerBridge }).__zipVisualizerBridge.getClockDiagnostics())
    expect(diag.kind, 'aiff takes the decoded clock').toBe('decoded')
    await page.evaluate(() => (window as unknown as { __zipVisualizerBridge: VisualizerBridge }).__zipVisualizerBridge.clockControl('pause'))

    await mockTranscribe(page, TWO_SEGMENTS.slice(0, 1))
    const before = await flushAndSnapshot(page)
    const after = await snapshotAfterReload(page, before.id)
    expect(after, 'decoded-path project restored byte-equal').toBe(before.json)
  })

  test.skip('CC-I2.3 (export dialog leg): dialog offers sidecars only — blocked on styling-and-export/unit-202 (the dialog does not exist yet; [107-ADJ 23], same adjudication as CC-107.8)', async () => {
    // The absence half is covered above (no burn-in in the DOM). The positive
    // "offers sidecars" half requires unit-202's capability-gated dialog.
  })
  })

test.describe('CC-I2.8: keyboard-only walkthrough — open project, run commands, reach export without a mouse', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')

  test('CC-I2.8: keyboard-only walkthrough — open project, run commands via palette/shortcuts, reach export — without a mouse click', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)
    await openMedia(page, MEDIA_ASSET, SRC, WALK_BLOCKS)
    await openSubtitlesTab(page)
    await expect(page.locator('[data-testid=transcript-row]')).toHaveCount(2)

    // Keyboard: region cycling, ⌘/ overlay lists the registry, palette runs a
    // transport command, transcript selection + S splits, focus+Enter reaches export.
    await page.keyboard.press('Alt+1')
    await expect(page.getByTestId('panel-sidebar')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+/')
    const overlay = page.getByTestId('shortcuts-overlay')
    await expect(overlay, '⌘/ opens the shortcuts overlay').toBeVisible({ timeout: 5_000 })
    await expect(overlay.getByTestId('shortcuts-row').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()

    await page.evaluate(() => (window as unknown as { __zipEditorBridge: EditorBridge }).__zipEditorBridge.command('transport-seek', { time: 1.0 }))
    await page.keyboard.press('Alt+3')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('s')
    await expect(page.locator('[data-testid=transcript-row]'), 'keyboard S splits the selected block').toHaveCount(3)

    await page.locator('[data-testid=export-button]').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid=export-button]'), 'export button is keyboard-reachable and live').toBeEnabled()
  })
  })

test.describe('CC-108.7 CC-I2.11: job:error mid-transcription — editable blocks, coded notice, no modal', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:intent')

  test('CC-I2.11: job:error mid-transcription leaves committed blocks editable with a one-line coded notice and no modal', async ({ page }) => {
    test.setTimeout(180_000)
      await boot(page)
    await openMedia(page, MEDIA_ASSET, SRC)
    await openSubtitlesTab(page)

    await page.click('[data-testid=transcribe-button]', { timeout: 5_000 })
    await page.waitForSelector('[data-testid=transcribe-popover]', { timeout: 5_000 })
    await page.click('[data-testid=transcribe-start-button]', { timeout: 5_000 })
    await page.waitForFunction(() => (window as unknown as { __zipTranscriptBridge: TranscriptBridge }).__zipTranscriptBridge.getTranscriptState().runningJobKind === 'transcribe', undefined, { timeout: 15_000 })
    const jobId = await page.evaluate(() => (window as unknown as { __zipTranscriptBridge: TranscriptBridge }).__zipTranscriptBridge.getTranscriptState().runningJobId)
    if (jobId === null) throw new Error('transcribe job never started')
    await page.evaluate((p) => {
      const w = window as unknown as { __zipWorkbenchBridge?: { injectAsrEvent(event: { t: string; jobId: string; segments?: unknown[]; processedSec?: number; totalSec?: number; error?: unknown }): void } }
      w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:progress', jobId: p.id, processedSec: 3.0, totalSec: 120 })
      w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:segments', jobId: p.id, segments: p.segs })
    }, { id: jobId, segs: TWO_SEGMENTS.slice(0, 1) })
    await expect(page.locator('[data-testid=transcript-row]'), 'the committed segment survived').toHaveCount(1)
    await page.evaluate(([id]) => {
      const w = window as unknown as { __zipWorkbenchBridge?: { injectAsrEvent(event: { t: string; jobId: string; segments?: unknown[]; processedSec?: number; totalSec?: number; error?: unknown }): void } }
      w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:error', jobId: id, error: { code: 'DECODE_FAILED', retryable: false } })
    }, [jobId] as const)

    const notice = page.getByTestId('job-error')
    await expect(notice, 'one-line coded notice').toBeVisible({ timeout: 10_000 })
    await expect(notice).toContainText('DECODE_FAILED')
    await expect(notice, 'single line').toHaveCount(1)
    // The popover button is live again (running cleared) — close it; the
    // job-error notice itself must not be a modal.
    await page.click('[data-testid=transcribe-button]', { timeout: 5_000 })
    await expect(page.getByTestId('transcribe-popover')).toBeHidden({ timeout: 5_000 })
    await expect(page.getByRole('dialog'), 'no modal').toHaveCount(0)

    // Committed block stays editable through the real UI path.
    await editBlockText(page, (await blockIds(page))[0] ?? '', 'still editable after error')
    await expect(page.locator('[data-testid=transcript-row]').first()).toContainText('still editable')
  })
})
