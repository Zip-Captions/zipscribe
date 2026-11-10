// Shared helpers for the unit-06 diarization e2e suite — test-author-owned
// (mirrors e2e/asr/helpers/asr.ts, which is never import-edited).
//
// - `assertDiarModelCachePresent`: the two unit-06 models must be in the local
//   model cache BEFORE the specs start (setup step `pnpm models:fetch` —
//   tests never touch the network, settings.yml testing.determinism). Fails
//   with the actionable setup instruction, never with invented thresholds.
//   NOTE (follow-up): `models/eval-registry.json` has no diarization rows yet
//   (unit-06 builder adds them); until then this checks the conventional
//   cache directories for at least one model file each.
// - `routeDiarNetwork`: the one network policy — app/harness from the vite
//   server, `/fixtures/**` from disk, `/wasm/**` from `public/wasm/`,
//   huggingface resolve URLs served from the local model cache, EVERYTHING
//   ELSE aborted (unit-01 request-audit contract: `blocked` must stay empty).
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { REPO_ROOT } from '../../../tests/helpers/repo'

const HF_HOSTS = (host: string): boolean => host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co')

/** The two unit-06 model cache directories (models-fetch kebab-case names). */
export const DIAR_MODEL_CACHE_DIRS = ['pyannote-segmentation-3-0', 'eres2net-base-3dspeaker'] as const

/** Extra repo-fragment → cache-dir mappings beyond the diarization pair. */
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

/**
 * Install the spec network policy (same doctrine as e2e/asr/helpers/asr.ts:
 * `blocked` must stay empty for a green run).
 */
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

// --- spec-owned vite server (unit-02 orphan-server doctrine) -----------------

export interface HarnessServer {
  child: ChildProcess
  base: string
}

export async function startHarnessServer(port: number, options: { isolated: boolean; probePath: string }): Promise<HarnessServer> {
  const base = `http://127.0.0.1:${port}`
  const child = spawn('corepack', ['pnpm', 'exec', 'vite', '--config', 'e2e/diarization/fixtures/vite.harness.config.ts', '--port', String(port), '--strictPort'], {
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
  throw new Error(`unit-06 harness vite server (port ${port}) did not start: ${output.slice(-2_000)}`)
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
