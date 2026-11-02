// Shared helpers for the unit-05 ASR e2e suite — test-author-owned.
//
// - `startHarnessServer` / `stopHarnessServer`: spec-owned vite dev server for
//   `e2e/asr/fixtures/harness.html` on a spec-chosen port (4313 standard,
//   4314 for the COOP/COEP `memory` project — same spec-owned-server doctrine
//   as e2e/model/model-cache.spec.ts / e2e/media/memory/decode-memory.spec.ts;
//   `pnpm exec vite --config` spawn, killed in afterAll, no orphans).
// - `routeAsrNetwork`: the one network policy all three specs use — app/harness
//   from the vite server, `/fixtures/**` from `fixtures/` on disk, `/wasm/**`
//   from the build-time `public/wasm/`, huggingface resolve URLs served from
//   the SHA-256-verified local model cache (`.cache/models/`, fetched by
//   `pnpm models:fetch`), EVERYTHING ELSE aborted (tests never touch the
//   network — settings.yml testing.determinism).
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { REPO_ROOT } from '../../../tests/helpers/repo'

const HF_HOSTS = (host: string): boolean => host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co')

/** eval-registry model ids → `.cache/models/<dir>` names (models-fetch keys). */
const CACHE_DIR_BY_REPO: Record<string, string> = {
  'onnx-community/whisper-tiny_timestamped': 'whisper-tiny-timestamped',
}

export interface NetworkCounters {
  modelHost: number
  blocked: string[]
}

interface EvalRegistryRow {
  repo: string
  revision: string
  files: { path: string; sha256: string }[]
}

/** The CI-served `tiny` whisper row, straight from models/eval-registry.json. */
export function loadTinyModelRow(): EvalRegistryRow {
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, 'models/eval-registry.json'), 'utf8')) as { models: Record<string, EvalRegistryRow> }
  const row = registry.models['whisper-tiny-timestamped']
  if (!row) throw new Error('models/eval-registry.json lacks whisper-tiny-timestamped')
  return row
}

export function assertModelCachePresent(): void {
  const row = loadTinyModelRow()
  const dir = CACHE_DIR_BY_REPO[row.repo]
  if (!dir) throw new Error(`no cache directory mapping for ${row.repo}`)
  for (const file of row.files) {
    if (!existsSync(join(REPO_ROOT, '.cache/models', dir, file.path))) {
      throw new Error(`model cache incomplete: .cache/models/${dir}/${file.path} missing — run \`pnpm models:fetch\` (setup step, never during a test)`)
    }
  }
}

/**
 * Install the spec network policy. Returns live counters: `modelHost` counts
 * served huggingface requests, `blocked` lists origins aborted (must stay
 * empty for a green run — the unit-01 request-audit contract).
 */
export async function routeAsrNetwork(page: Page, base: string, counters: NetworkCounters): Promise<void> {
  const row = loadTinyModelRow()
  const dir = CACHE_DIR_BY_REPO[row.repo]!
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
      const match = url.match(/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/)
      const repo = match?.[1]
      const file = match?.[2]
      const cached = repo && file && CACHE_DIR_BY_REPO[repo] ? join(REPO_ROOT, '.cache/models', CACHE_DIR_BY_REPO[repo]!, file) : undefined
      if (cached && cached.startsWith(join(REPO_ROOT, '.cache/models')) && existsSync(cached)) {
        // CORP/ACAO so the COOP/COEP `memory` project accepts the response
        // under require-corp (Playwright-fulfilled responses are judged like
        // network responses for COEP).
        return route.fulfill({
          status: 200,
          body: readFileSync(cached),
          headers: { 'content-type': 'application/octet-stream', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' },
        })
      }
      return route.abort('blockedbyclient')
    }
    counters.blocked.push(host)
    return route.abort('blockedbyclient')
  })
}

// --- spec-owned vite servers (unit-02 orphan-server doctrine) ---------------

export interface HarnessServer {
  child: ChildProcess
  base: string
}

export async function startHarnessServer(port: number, options: { isolated: boolean; probePath: string }): Promise<HarnessServer> {
  const base = `http://127.0.0.1:${port}`
  const child = spawn('corepack', ['pnpm', 'exec', 'vite', '--config', 'e2e/asr/fixtures/vite.harness.config.ts', '--port', String(port), '--strictPort'], {
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
  await stopHarnessServer(child)
  throw new Error(`unit-05 harness vite server (port ${port}) did not start: ${output.slice(-2_000)}`)
}

export async function stopHarnessServer(child: ChildProcess): Promise<void> {
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

/**
 * The spike `tiny` WER baseline — read from the spike artifact, never invented.
 *
 * CC-05.5 states the gate in percentage points ("WER ≤ spike `tiny` baseline
 * + 5 pts") to match `scoreWer`'s percent output, while the spike artifact
 * stores `wer` as a ratio (whisper-tiny T2 `wer: 1` = 100 %), so convert
 * ratio → percentage points (×100) here. The corpus is interim (sine-formant
 * synthetic speech; real-corpus vendoring is an AWAITING-OWNER item), so the
 * absolute WER is corpus-bound — the assertion is a regression guard at
 * baseline + 5 points, not an absolute quality claim.
 */
export function spikeTinyWerBaseline(): { value: number; source: string } {
  const report = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/spikes/model-eval-report.json'), 'utf8')) as {
    rows: { engine: string; model: string; device: string; tier: string; wer: number; ok: boolean }[]
  }
  const row = report.rows.find((r) => r.model === 'onnx-community/whisper-tiny_timestamped' && r.tier === 'T2' && r.engine === 'transformers.js')
  if (!row) throw new Error('docs/spikes/model-eval-report.json has no whisper-tiny T2 row')
  return { value: row.wer * 100, source: 'docs/spikes/model-eval-report.json rows[whisper-tiny_timestamped,T2].wer (ratio ×100 → percentage points, CC-05.5)' }
}
