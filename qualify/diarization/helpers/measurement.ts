// Shared readers/record-writer/harness helpers for the unit-06 L6
// release-qualification suite (`qualify/diarization/**` — CC-06.3). Runs ONLY
// under `pnpm qualify` on reference hardware (settings.yml
// reference_hardware), never in the per-PR `pnpm test` run (vitest.config.ts
// includes only src/** and tests/unit/**; the suite is additionally gated
// behind ZIPSCRIBE_QUALIFY_MEASURE=1 — see vitest.config.qualify.ts).
//
// VENDORING DOCTRINE (qualify/asr/helpers/measurement.ts:243-250, unit-05
// precedent): the qualification scratch trees
// (tests/unit/model-eval/qualify-pipeline-fabrication-adversarial baseline)
// copy `qualify/**` + `tests/**` + `src/**` + `scripts/**` + `public/**` +
// `models/**` + `docs/**` + `.ai-dlc/**` but NOT `e2e/**` — so `qualify/**`
// must NEVER statically import `e2e/**` (module load would crash the frozen
// infrastructure baseline). The harness-server + network-route + cache-gate
// logic below is VENDORED from the test-author-owned
// `e2e/diarization/helpers/diarization.ts` (same author, same contract);
// the e2e vite config and harness page are referenced ONLY as runtime string
// paths, and every spawn happens exclusively inside measurement-mode code
// paths (the preflight tests touch no filesystem outside COPIED_DIRS).
//
// Honesty doctrine (unit-02 row-field doctrine): an unmeasurable condition
// records `ok:false` + per-value `null` + `reason` in
// `qualification/unit-06-measurements.json` — NEVER a fabricated number.
// SECURITY-03: the page boundary carries numbers/codes/counts only;
// transcript/ground-truth text never enters this file or the log.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { REPO_ROOT } from '../../../tests/helpers/repo'

/** Measurement mode: the hour-capable runs execute only when explicitly
 *  enabled (the release flow); without the flag the suite stays a fast
 *  preflight audit so the frozen CC-02.5 `pnpm qualify` leg (150 s vitest
 *  spawn) keeps completing inside its budget. */
export const MEASURE = process.env.ZIPSCRIBE_QUALIFY_MEASURE === '1'

// --- gate constants (from the unit spec / settings.yml, never tuned here) ---

/** CC-06.3 (unit-06-speaker-diarization.md): T1 10-minute diarize ≤ 90 s wall. */
export const T1_DIARIZE_MAX_MS = 90_000
export const PERF_FIXTURE = 'fixtures/speech-10min.mp4'
export const MEASUREMENTS_FILE = 'qualification/unit-06-measurements.json'

/** Reference ports above the e2e range (4310–4315) — spec-owned servers,
 *  started inside the measurement test and killed in its finally (unit-02
 *  orphan-server doctrine). */
export const PORT_DIAR_PERF = 4328

/** e2e-owned files referenced as RUNTIME STRINGS only (never imported). */
export const HARNESS_PATH = '/e2e/diarization/fixtures/harness.html'
export const HARNESS_VITE_CONFIG = 'e2e/diarization/fixtures/vite.harness.config.ts'

/** The two unit-06 model cache directories (models-fetch kebab-case names;
 *  frozen per ledger adjudication (5)). */
export const DIAR_MODEL_CACHE_DIRS = ['pyannote-segmentation-3-0', 'eres2net-base-3dspeaker'] as const

const HF_HOSTS = (host: string): boolean => host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co')

/** Repo-fragment → cache-dir mappings (URL FRAGMENT keyed per adjudication
 *  (5) so repo-id verification drift cannot break this frozen-shape shim). */
const REPO_FRAGMENT_TO_CACHE_DIR: [RegExp, string][] = [
  [/pyannote|segmentation-3/i, 'pyannote-segmentation-3-0'],
  [/eres2net|3dspeaker/i, 'eres2net-base-3dspeaker'],
  [/whisper-tiny/i, 'whisper-tiny-timestamped'],
  [/silero/i, 'silero-vad'],
]

export interface NetworkCounters {
  modelHost: number
  blocked: string[]
}

export interface DiarRunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  frames: unknown[]
  speakers: number
  eventSummary: { t: string; code?: string; device?: string }[]
  runWallMs: number
}

// --- measurement rows (conventions.md § Release qualification schema) -------

export interface MeasurementRow {
  id: string
  run: string
  pass: boolean
  measured: string
  threshold: string
  values: Record<string, number | string | null>
  ok: boolean
  reason: string | null
}

/**
 * Upsert measurement rows into `qualification/unit-06-measurements.json`
 * (sibling of `qualification/0.0.0-spike.json` — the committed CC-02 record
 * and the frozen CC-02.5 legs are untouched; the release flow promotes these
 * results[] entries per conventions § Release qualification).
 */
export function recordMeasurementRow(row: MeasurementRow): void {
  const outPath = join(REPO_ROOT, MEASUREMENTS_FILE)
  const existing = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')) as { rows?: MeasurementRow[] }) : {}
  const rows = Array.isArray(existing.rows) ? existing.rows : []
  const at = rows.findIndex((r) => r.id === row.id && r.run === row.run)
  if (at >= 0) rows.splice(at, 1, row)
  else rows.push(row)
  const record = {
    version: '0.0.0-spike',
    unit: 'unit-06-speaker-diarization',
    recordedAt: new Date().toISOString(),
    rows: rows.sort((a, b) => `${a.id}/${a.run}`.localeCompare(`${b.id}/${b.run}`)),
  }
  mkdirSync(join(REPO_ROOT, 'qualification'), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`)
}

/** The honest unmeasurable row: ok:false, every numeric value null, reason. */
export function unmeasurableRow(id: string, run: string, threshold: string, reason: string, valueKeys: string[]): MeasurementRow {
  const values: Record<string, number | string | null> = {}
  for (const key of valueKeys) values[key] = null
  return { id, run, pass: false, measured: `unmeasurable: ${reason}`, threshold, values, ok: false, reason }
}

// --- model-cache gate (MEASURE-mode callers only; setup is `pnpm
// models:fetch`, a setup step that never runs inside a test) -----------------

function cacheDirHasModel(dir: string): boolean {
  const root = join(REPO_ROOT, '.cache/models', dir)
  if (!existsSync(root)) return false
  const walk = (path: string): boolean => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isFile() && /\.(onnx|bin|json|wav)$/i.test(entry.name)) return true
      if (entry.isDirectory() && walk(join(path, entry.name))) return true
    }
    return false
  }
  return walk(root)
}

export function assertDiarModelCachePresent(): void {
  for (const dir of DIAR_MODEL_CACHE_DIRS) {
    if (!cacheDirHasModel(dir)) {
      throw new Error(`model cache incomplete: .cache/models/${dir} has no model files — run \`pnpm models:fetch\` (setup step, never during a test)`)
    }
  }
}

// --- network policy (vendored from e2e/diarization/helpers/diarization.ts —
// unit-01 request-audit contract: `blocked` must stay empty) ------------------

export async function routeDiarNetwork(page: Page, base: string, counters: NetworkCounters): Promise<void> {
  const origin = base.endsWith('/') ? base.slice(0, -1) : base
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(`${origin}/`)) {
      if (url.startsWith(`${origin}/fixtures/`)) {
        const rel = decodeURIComponent(url.slice(origin.length + '/fixtures/'.length).split('?')[0] ?? '')
        const path = join(REPO_ROOT, 'fixtures', rel)
        if (!path.startsWith(join(REPO_ROOT, 'fixtures')) || !existsSync(path)) return route.fulfill({ status: 404, body: `fixture not found: ${rel}` })
        return route.fulfill({ status: 200, body: readFileSync(path), headers: { 'content-type': 'application/octet-stream' } })
      }
      if (url.startsWith(`${origin}/wasm/`)) {
        const rel = decodeURIComponent(url.slice(origin.length + '/wasm/'.length).split('?')[0] ?? '')
        const path = join(REPO_ROOT, 'public/wasm', rel)
        if (!path.startsWith(join(REPO_ROOT, 'public/wasm')) || !existsSync(path)) return route.fulfill({ status: 404, body: 'wasm not found' })
        return route.fulfill({ status: 200, body: readFileSync(path), headers: { 'content-type': 'application/wasm' } })
      }
      await route.continue()
      return
    }
    const host = new URL(url).host
    if (HF_HOSTS(host)) {
      counters.modelHost += 1
      const match = url.match(/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[^/]+\/(.+)$/)
      const file = match?.[1]
      const dir = REPO_FRAGMENT_TO_CACHE_DIR.find(([re]) => re.test(url))?.[1]
      const cached = dir && file ? join(REPO_ROOT, '.cache/models', dir, file) : undefined
      if (cached && cached.startsWith(join(REPO_ROOT, '.cache/models')) && existsSync(cached)) {
        return route.fulfill({ status: 200, body: readFileSync(cached), headers: { 'content-type': 'application/octet-stream', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' } })
      }
      return route.abort('blockedbyclient')
    }
    counters.blocked.push(host)
    return route.abort('blockedbyclient')
  })
}

// --- spec-owned harness server (vendored from
// e2e/diarization/helpers/diarization.ts: unit-02 orphan-server doctrine;
// the e2e vite config is referenced by PATH STRING only per the vendoring
// doctrine in this file's header — call this ONLY from measurement-mode code) -

export interface HarnessServer {
  child: ChildProcess
  base: string
}

export async function startDiarQualifyHarnessServer(port: number, options: { isolated: boolean; probePath: string }): Promise<HarnessServer> {
  const base = `http://127.0.0.1:${port}`
  const child = spawn('corepack', ['pnpm', 'exec', 'vite', '--config', HARNESS_VITE_CONFIG, '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    env: { ...process.env, CI: '1', NO_COLOR: '1', ...(options.isolated ? { ZIPSCRIBE_ISOLATED: '1' } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      const response = await fetch(`${base}${options.probePath}`, { signal: AbortSignal.timeout(1_000) })
      if (response.status < 500) return { child, base }
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await stopDiarQualifyHarnessServer(child)
  throw new Error(`unit-06 diarization qualify harness vite server (port ${port}) did not start: ${output.slice(-2_000)}`)
}

export async function stopDiarQualifyHarnessServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const kill = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(kill)
      resolve()
    })
  })
}
