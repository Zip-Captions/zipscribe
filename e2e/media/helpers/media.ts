// Shared helpers for the unit-04 media e2e suite — test-author-owned.
//
// - The per-browser path matrices (CC-04.2/04.3/04.7): the committed fixture
//   set is partitioned from the manifest (`expectedPath`), not hand-listed, so
//   a new fixture lands in the right matrix automatically. `WEBKIT_EXPECTED`
//   is the per-browser matrix CC-04.7 requires recorded in discovery.md — the
//   observed values are in the unit report; this table is the assertion shape
//   (browsers lacking a codec skip-annotate via `pathFor`).
// - The correlation helper is a REAL normalized cross-correlation with an
//   offset search (± `maxOffsetSamples`), used against `fmt-30s.ref.wav`.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { REPO_ROOT } from '../../../tests/helpers/repo'

/**
 * Install the one network policy every unit-04 spec uses: the app/harness
 * page loads from the Playwright webServer (or the spec-owned isolated
 * preview), `/fixtures/**` is fulfilled from `fixtures/` on disk (the vite
 * preview's publicDir is `public/`, which only carries the unit-02 corpus
 * copies — the unit-01 fixture tree is served by the spec, never fetched),
 * and every other origin is aborted (network policy: tests never reach the
 * network).
 */
export async function routeFixtures(page: Page, baseURL?: string): Promise<void> {
  const base = baseURL ?? HARNESS_ORIGIN
  const origin = base.endsWith('/') ? base.slice(0, -1) : base
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (!url.startsWith(`${origin}/`)) return route.abort()
    if (url.startsWith(`${origin}/fixtures/`)) {
      const rel = decodeURIComponent(url.slice(origin.length + '/fixtures/'.length).split('?')[0] ?? '')
      const path = join(REPO_ROOT, 'fixtures', rel)
      if (!path.startsWith(join(REPO_ROOT, 'fixtures')) || !existsSync(path)) return route.fulfill({ status: 404, body: `fixture not found: ${rel}` })
      return route.fulfill({ status: 200, body: readFileSync(path) })
    }
    await route.continue()
  })
}

export interface ManifestEntry {
  duration: number
  kind: string
  codec?: string
  sampleRate?: number
  channels?: number
  expectedPath?: 'webcodecs' | 'ffmpeg'
  generated?: boolean
  sha256?: string
}

export interface Manifest {
  files: Record<string, ManifestEntry>
}

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures/harness/manifest.json'), 'utf8')) as Manifest
}

/** Manifest keys are relative to `fixtures/audio` (`../tone-30s.wav` lives in `fixtures/`). */
export function fixturePath(key: string): string {
  return key.startsWith('../') ? `fixtures/${key.slice(3)}` : `fixtures/audio/${key}`
}

const AUDIO_FORMAT_KEY = /^fmt-30s\./

/** Native set (mediabunny + WebCodecs): the `fmt-30s.*` matrix entries whose manifest path is webcodecs. */
export function nativeSet(): string[] {
  return Object.entries(loadManifest().files)
    .filter(([key, entry]) => AUDIO_FORMAT_KEY.test(key) && entry.expectedPath === 'webcodecs' && key !== 'fmt-30s.ref.wav')
    .map(([key]) => key)
    .sort()
}

/** Fallback set (ffmpeg.wasm): the `fmt-30s.*` matrix entries whose manifest path is ffmpeg. */
export function fallbackSet(): string[] {
  return Object.entries(loadManifest().files)
    .filter(([key, entry]) => AUDIO_FORMAT_KEY.test(key) && entry.expectedPath === 'ffmpeg')
    .map(([key]) => key)
    .sort()
}

/** Video fixtures from the corpus root (architecture § Supported media). */
export function videoSet(): string[] {
  return Object.entries(loadManifest().files)
    .filter(([key, entry]) => key.startsWith('../') && entry.kind !== 'tone' && !key.includes('audio-120min'))
    .map(([key]) => key)
    .sort()
}

/**
 * CC-04.7 per-browser matrix — observed on this reference machine (recorded in
 * the unit report; the orchestrator copies it into discovery.md). Absent keys
 * fall back to the manifest's Chromium `expectedPath`.
 */
/**
 * The unit-04 harness page is served from the public `fixtures/` dir by the
 * Playwright `webServer` (build + `vite preview` on 4310,
 * vite.config.ts `publicDir: fixtures`). The harness modules are prebuilt
 * into that public dir by the harness build step (package.json
 * `build:harness`), so the same URL works under preview and under CI.
 */
export const HARNESS_ORIGIN = 'http://127.0.0.1:4310'
export const HARNESS_PAGE = '/harness/media.html'

export const WEBKIT_EXPECTED: Record<string, 'webcodecs' | 'ffmpeg'> = {
  // Filled from the observed matrix in the unit report (ASSUMPTIONS).
}

export function pathFor(browserName: string, key: string): 'webcodecs' | 'ffmpeg' {
  if (browserName === 'webkit') return WEBKIT_EXPECTED[key] ?? loadManifest().files[key]?.expectedPath ?? 'ffmpeg'
  return loadManifest().files[key]?.expectedPath ?? 'ffmpeg'
}

/** Duration tolerance: manifest ±20 ms; VBR MP3 without a seek table ±50 ms. */
export function durationTolerance(key: string): number {
  return key.includes('vbr.mp3') ? 0.05 : 0.02
}

/** Lossless containers tolerate a tighter correlation than lossy codecs. */
export const LOSSLESS = new Set(['fmt-30s.wav', 'fmt-30s.flac', 'fmt-30s.aiff', 'fmt-30s.caf', 'fmt-30s.alac.m4a'])

export function minCorrelation(key: string): number {
  return LOSSLESS.has(key) ? 0.98 : 0.9
}

/** Alignment offset ceiling (spec: ≤ 5 ms). */
export const MAX_OFFSET_SEC = 0.005

// --- reference PCM -----------------------------------------------------------

/** Read `fixtures/audio/fmt-30s.ref.wav` (16 kHz mono s16) as f32. */
export function referencePcm2000Hz(): Float32Array {
  const bytes = readFileSync(join(REPO_ROOT, 'fixtures/audio/fmt-30s.ref.wav'))
  let offset = 12
  let data: Buffer | undefined
  let channels = 1
  let bits = 16
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(offset + 10)
      bits = bytes.readUInt16LE(offset + 22)
    }
    if (id === 'data') data = bytes.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }
  if (!data || bits !== 16) throw new Error('fmt-30s.ref.wav must be 16-bit PCM')
  const frames = data.length / 2 / channels
  const out = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) sum += data.readInt16LE((frame * channels + channel) * 2) / 32768
    out[frame] = sum / channels
  }
  return out
}

export function concatChunks(chunks: readonly { samples: Float32Array }[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0)
  const out = new Float32Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk.samples, at)
    at += chunk.samples.length
  }
  return out
}

export function nccOverlap(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let energyA = 0
  let energyB = 0
  for (let index = 0; index < length; index++) {
    dot += a[index]! * b[index]!
    energyA += a[index]! * a[index]!
    energyB += b[index]! * b[index]!
  }
  return dot / (Math.sqrt(energyA * energyB) + 1e-30)
}

/**
 * Real normalized cross-correlation with an offset search: the best score over
 * `actual` shifted by ±`maxOffsetSamples` against `reference`, comparing only
 * the overlap. Positive offset = `actual` starts later than the reference.
 */
export function bestAlignment(reference: Float32Array, actual: Float32Array, maxOffsetSamples: number): { corr: number; offset: number } {
  let best = { corr: -Infinity, offset: 0 }
  for (let offset = -maxOffsetSamples; offset <= maxOffsetSamples; offset++) {
    const startRef = Math.max(0, -offset)
    const startActual = Math.max(0, offset)
    const length = Math.min(reference.length - startRef, actual.length - startActual)
    if (length < 4800) continue // < 0.3 s of 16 kHz audio
    let dot = 0
    let energyRef = 0
    let energyActual = 0
    for (let index = 0; index < length; index++) {
      const ref = reference[startRef + index]!
      const act = actual[startActual + index]!
      dot += ref * act
      energyRef += ref * ref
      energyActual += act * act
    }
    const corr = dot / (Math.sqrt(energyRef * energyActual) + 1e-30)
    if (corr > best.corr) best = { corr, offset }
  }
  return best
}

export interface PortLike {
  postMessage(message: unknown, transfer?: unknown[]): void
  onmessage: ((event: { data: unknown }) => void) | null
  start?(): void
}

/** Node-side MessageChannel end: collects chunk/event traffic (used by the harness bridge). */
export class NodePortRecorder {
  readonly chunks: { startSec: number; samples: Float32Array }[] = []
  readonly raw: { t?: string; startSec?: number; samples?: Float32Array }[] = []

  constructor(port: PortLike) {
    port.onmessage = (message) => {
      const data = message.data as { t?: string; startSec?: number; samples?: Float32Array }
      this.raw.push(data)
      if (data.t === undefined && typeof data.startSec === 'number' && data.samples instanceof Float32Array) {
        this.chunks.push({ startSec: data.startSec, samples: data.samples.slice() })
      }
    }
    port.start?.()
  }

  async waitFor(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
    const started = Date.now()
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) throw new Error('timed out waiting on the port')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}