// Shared e2e glue for the unit-202 export specs (CC-202.2/.3/.4/.5/.7).
// Bridges into __zipEditorBridge (ziptest=1). SECURITY-03: only protocol
// objects and numbers cross; the seeded texts are the committed CC0 sidecar
// fixture (re-declared verbatim — the golden byte-compare IS the drift guard).

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { REPO_ROOT } from '../../../tests/helpers/repo'

// sibling of e2e/media/helpers/media.ts (same ffmpeg-static resolution)
const ffmpegPath = createRequire(join(REPO_ROOT, 'package.json'))('ffmpeg-static') as string

export const FIXTURES = join(REPO_ROOT, 'fixtures')
export const GOLDEN_DIR = join(FIXTURES, 'golden', 'sidecars')
export const SCRATCH = join(REPO_ROOT, '.night', 'export-e2e')

interface EditorBridgeLike {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  setExportMedia(bytes: ArrayBuffer, type: string): Promise<void>
  setProjectName(name: string): void
  setProjectLanguage(language: string): void
  seedTranslation(language: string, entries: Record<string, unknown>): void
  seedBlocks(blocks: readonly unknown[], speakers: readonly unknown[]): void
}

// — taxi burn-in project (320×180@10fps, 30.0 s, h264+aac per manifest) -----

export const TAXI_DURATION = 29.888

export const TAXI_ASSET = {
  id: 'ASSET_202_TAXI',
  name: 'taxi-en-accented-1.mp4',
  kind: 'video',
  container: 'mp4',
  audioCodec: 'aac',
  videoCodec: 'h264',
  duration: TAXI_DURATION,
  width: 320,
  height: 180,
  fps: 10,
  sampleRate: 16000,
  channels: 1,
  fingerprint: { name: 'taxi-en-accented-1.mp4', size: 4096, durationMs: 29888, sampleHashes: ['a', 'b', 'c'] },
}

/** 10 blocks × 1 word each across the 30 s (the CC-202.2 sample points:
 *  word.start + 0.1, block-active mid-word). */
export const EXPORT_BLOCKS = Array.from({ length: 10 }, (_, i) => {
  const start = 0.4 + i * 2.9
  const end = start + 2.2
  return {
    id: `blk_202_${i}`,
    start,
    end,
    text: `word${i} frame`,
    words: [
      { text: `word${i}`, start, end: start + 1.0, timing: 'estimated' },
      { text: 'frame', start: start + 1.0, end, timing: 'estimated' },
    ],
    speakerId: 'SPK_1',
  }
})

export const SAMPLE_TIMES = EXPORT_BLOCKS.map((b) => b.start + 0.1)

// speech-2min.mp4: 120.0 s, same 320×180@10 h264+aac profile (long-run legs:
// progress rate + cancel need a run long enough to observe ≥ 1 Hz).
export const SPEECH_10MIN_ASSET = {
  ...TAXI_ASSET,
  id: 'ASSET_202_SPEECH10',
  name: 'speech-10min.mp4',
  duration: 600,
  fingerprint: { name: 'speech-10min.mp4', size: 4096, durationMs: 600000, sampleHashes: ['g', 'h', 'i'] },
}

export const SPEECH_2MIN_ASSET = {
  ...TAXI_ASSET,
  id: 'ASSET_202_SPEECH2',
  name: 'speech-2min.mp4',
  duration: 120,
  fingerprint: { name: 'speech-2min.mp4', size: 4096, durationMs: 120000, sampleHashes: ['d', 'e', 'f'] },
}

// — sidecar byte-exactness project (mirrors tests/unit/export/helpers/
//   sidecar-fixture.ts; drift breaks the golden compare below) ---------------

export const SIDECAR_NAME = 'Veterans Q&A — Part 2!!'
export const SIDECAR_SLUG = 'veterans-q-a-part-2'

export const SIDECAR_ASSET = {
  id: 'ASSET_202_SIDECAR',
  name: 'clip.mp4',
  kind: 'audio' as const,
  container: 'm4a',
  audioCodec: 'aac',
  videoCodec: null,
  duration: 119.888,
  width: 0,
  height: 0,
  fps: 0,
  sampleRate: 16000,
  channels: 1,
  fingerprint: { name: 'clip.mp4', size: 4096, durationMs: 119888, sampleHashes: ['x', 'y', 'z'] },
}

export const SIDECAR_BLOCKS = [
  { id: 'b1', start: 0.5, end: 3.25, text: 'welcome & goodbye', words: [{ text: 'welcome', start: 0.5, end: 1.5 }, { text: '&', start: 1.6, end: 1.8 }, { text: 'goodbye', start: 2, end: 3.25 }], speakerId: 'SPK_1' },
  { id: 'b2', start: 4, end: 7.5, text: 'tab\there\nsecond <line>', words: [{ text: 'tab', start: 4, end: 5 }, { text: 'here', start: 5, end: 6 }, { text: 'second', start: 6, end: 6.7 }, { text: '<line>', start: 6.7, end: 7.5 }], speakerId: 'SPK_2' },
  { id: 'b3', start: 9, end: 11, text: '00:00:09,000 --> 00:00:11,000', words: [{ text: 'marker', start: 9, end: 11 }], speakerId: 'SPK_1' },
  { id: 'b4', start: 13, end: 15.125, text: 'quote "and" comma', words: [{ text: 'quote', start: 13, end: 14 }, { text: 'quoted', start: 14, end: 15.125 }], speakerId: 'SPK_3' },
]

export const SIDECAR_SPEAKERS = [
  { id: 'SPK_1', label: 'Host', color: '#4c8dff' },
  { id: 'SPK_2', label: 'Guest & Co', color: '#e5534b' },
  { id: 'SPK_3', label: 'Caller', color: '#4ab871' },
]

export const SIDECAR_FR: Record<string, unknown> = {
  b1: { text: 'bienvenue et au revoir', status: 'translated', sourceHash: 'h1' },
  b2: { text: 'tabulation ici\nligne <deux>', status: 'edited', sourceHash: 'h2' },
  b3: { text: 'ligne de minutage', status: 'translated', sourceHash: 'h3' },
  b4: { text: 'guillemets et virgule', status: 'failed', sourceHash: 'h4' },
}

// --- page glue ---------------------------------------------------------------

export async function openExportProject(
  page: Page,
  opts: { asset: Record<string, unknown>; src: string; blocks?: unknown[]; speakers?: unknown[]; name?: string; language?: string; translations?: Record<string, Record<string, unknown>>; mediaBytes?: { path: string; type: string } },
): Promise<void> {
  await page.addInitScript(() => {
    // determinism: no File System Access picker in e2e → the download
    // fallback path is exercised (Playwright cannot auto-accept pickers).
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
  })
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: unknown }).__zipEditorBridge), undefined, { timeout: 20_000 })
  await page.evaluate(
    ([asset, src, blocks, speakers, name, language, translations, mediaPath, mediaType]) => {
      void (async () => {
        const w = window as unknown as { __zipEditorBridge?: EditorBridgeLike }
        const b = w.__zipEditorBridge
        if (b === undefined) throw new Error('editor bridge missing')
        b.openProjectWithMedia(asset, src)
        if (speakers !== null && speakers !== undefined) {
          // byte-exact seed for the serializer golden compare (see bridge doc)
          b.seedBlocks(blocks as readonly unknown[], speakers as readonly unknown[])
        } else if (blocks !== null && blocks !== undefined) {
          b.seedBlocks(blocks, [{ id: 'SPK_1', label: 'Speaker 1', color: '#4c8dff' }])
        }
        if (typeof name === 'string') b.setProjectName(name)
        if (typeof language === 'string') b.setProjectLanguage(language)
        if (translations !== null && translations !== undefined) {
          for (const [lang, entries] of Object.entries(translations)) b.seedTranslation(lang, entries)
        }
        if (typeof mediaPath === 'string') {
          const res = await fetch(mediaPath)
          await b.setExportMedia(await res.arrayBuffer(), mediaType as string)
        }
      })()
    },
    [opts.asset, opts.src, opts.blocks ?? null, opts.speakers ?? null, opts.name ?? null, opts.language ?? null, opts.translations ?? null, opts.mediaBytes?.path ?? null, opts.mediaBytes?.type ?? null] as const,
  )
  await page.waitForFunction(() => {
    const w = window as unknown as { __zipEditorBridge?: EditorBridgeLike & { getEditorState(): { blockCount: number } } }
    return (w.__zipEditorBridge?.getEditorState()?.blockCount ?? 0) > 0
  }, undefined, { timeout: 30_000 })
}

// --- ffmpeg helpers (node-side; ffmpeg-static is a devDependency) -----------

export function ffmpeg(args: readonly string[]): void {
  execFileSync(ffmpegPath, [...args], { stdio: 'pipe' })
}

export function mediaInfo(file: string): { durationSec: number; hasAudio: boolean; hasVideo: boolean } {
  let stderr = ''
  try {
    execFileSync(ffmpegPath, ['-i', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    stderr = (err as { stderr?: string }).stderr ?? ''
  }
  const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr)
  const durationSec = dur === null ? -1 : Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
  return {
    durationSec,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(stderr),
    hasVideo: /Stream #\d+:\d+.*: Video:/.test(stderr),
  }
}

export function extractFrame(video: string, tSec: number, outFile: string): void {
  mkdirSync(SCRATCH, { recursive: true })
  ffmpeg(['-y', '-ss', tSec.toFixed(2), '-i', video, '-frames:v', '1', '-update', '1', outFile])
  if (!existsSync(outFile)) throw new Error(`frame extract produced nothing at t=${tSec}`)
}

export function scratchPath(name: string): string {
  mkdirSync(SCRATCH, { recursive: true })
  return join(SCRATCH, name)
}

export function cleanScratch(): void {
  rmSync(SCRATCH, { recursive: true, force: true })
}

export function readGolden(name: string): string {
  return readFileSync(join(GOLDEN_DIR, name), 'utf8')
}
