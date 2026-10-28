// CC-01.6: production build request audit (wasm) + COOP/COEP preview split.
//
// Contract: FR-1.0.9 — runtime wasm is self-hosted under `/wasm/`, boot config
// sets `env.backends.onnx.wasm.wasmPaths = '/wasm/'` and `numThreads = 1`, and
// "a production build makes no request to any CDN for wasm". FR-1.0.10 —
// `pnpm preview:isolated` sends `Cross-Origin-Opener-Policy: same-origin` and
// `Cross-Origin-Embedder-Policy: require-corp`; the default preview and
// production send neither. `.ai-dlc/settings.yml operations.model_hosts` is the
// only other allowlist.
import { describe, expect, test } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { exists, isPlaceholderScript, packageScripts, readText, REPO_ROOT, walkFiles } from '../../helpers/repo'

const PORT = 4178
const BASE = `http://127.0.0.1:${PORT}`
// Pre-fetched once, committed as a fixture (never at test time). The audit
// rewrites response bodies containing this file name.
export const ORT_WASM_FILE = 'ort-wasm-simd-threaded.jsep.wasm'

interface ServerHandle {
  child: ChildProcess
  ready: boolean
}

async function startPreview(script: string): Promise<ServerHandle> {
  const child = spawn('corepack', ['pnpm', 'run', '--silent', script, '--', '--port', String(PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return { child, ready: true }
    } catch {
      /* server not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  child.kill('SIGTERM')
  throw new Error(`preview server (${script}) did not start: ${output.slice(-2000)}`)
}

async function stopPreview(handle: ServerHandle | undefined): Promise<void> {
  if (!handle) return
  handle.child.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 300))
}

describe('CC-01.6: production wasm is self-hosted and the preview split is real', () => {
  test('CC-01.6: runtime wasm is copied into public/wasm/ at build time', () => {
    expect(exists('public/wasm'), 'public/wasm/ (FR-1.0.9)').toBe(true)
  })

  test('CC-01.6: the boot config points ONNX Runtime at /wasm/ with numThreads = 1', () => {
    // The value is set in src/main.tsx / engine boot glue; grep the product tree.
    const sources = walkFiles('src').filter((file) => /\.(ts|tsx)$/.test(file))
    const text = sources.map((file) => readText(file)).join('\n')
    expect(text, "env.backends.onnx.wasm.wasmPaths = '/wasm/'").toMatch(/wasmPaths\s*[:=]\s*['"]\/wasm\/['"]/)
    expect(text, 'env.backends.onnx.wasm.numThreads = 1').toMatch(/numThreads\s*[:=]\s*1\b/)
  })

  test('CC-01.6: production build makes zero CDN requests for wasm', async () => {
    const scripts = packageScripts()
    expect(isPlaceholderScript(scripts.preview), `preview = ${scripts.preview ?? '<missing>'}`).toBe(false)
    const build = spawnSync('corepack', ['pnpm', 'run', '--silent', 'build'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 })
    expect(build.status, `pnpm build prerequisite failed\n${(build.stderr ?? '').slice(-4000)}`).toBe(0)
    expect(exists(`dist/${ORT_WASM_FILE}`) || exists(`dist/wasm/${ORT_WASM_FILE}`), 'wasm is served from the build, not a CDN').toBe(true)

    let server: ServerHandle | undefined
    try {
      server = await startPreview('preview')
      const memory = new Map<string, number[]>()
      memory.set(ORT_WASM_FILE, [])
      const wasmRequests: { url: string; host: string; status: number }[] = []
      const playwright = await import('@playwright/test')
      const browser = await playwright.chromium.launch({ headless: true })
      const page = await browser.newPage()
      page.on('request', (request) => {
        if (!request.url().includes(ORT_WASM_FILE)) return
        wasmRequests.push({ url: request.url(), host: new URL(request.url()).host, status: 0 })
      })
      page.on('response', (response) => {
        if (!response.url().includes(ORT_WASM_FILE)) return
        const entry = wasmRequests.find((candidate) => candidate.url === response.url())
        if (entry) entry.status = response.status()
      })
      await page.route('**/*', async (route) => {
        const url = route.request().url()
        if (url.startsWith(BASE)) {
          const response = await route.fetch()
          const headers = { ...response.headers() }
          const contentType = headers['content-type'] ?? ''
          if (contentType.includes('javascript') || contentType.includes('html')) {
            const body = (await response.text()).replaceAll(ORT_WASM_FILE, url.startsWith(BASE + '/wasm/') ? url : `${BASE}/wasm/${ORT_WASM_FILE}`)
            await route.fulfill({ response, body, headers })
            return
          }
          await route.fulfill({ response })
          return
        }
        if (url.includes(ORT_WASM_FILE)) {
          const response = await route.fetch()
          const body = await response.body()
          await route.fulfill({ status: response.status(), headers: response.headers(), body })
          return
        }
        await route.abort()
      })
      await page.goto(`${BASE}/`, { waitUntil: 'load' })
      await page.waitForTimeout(1500)
      await browser.close()

      // The audit is meaningful only if the app actually asked for the ORT
      // wasm; an inlined copy would hide a CDN fetch.
      expect(wasmRequests.length, `the production build must request ${ORT_WASM_FILE}`).toBeGreaterThan(0)
      const external = wasmRequests.filter((request) => request.host !== `127.0.0.1:${PORT}`)
      expect(external, 'CDN wasm requests observed (must be same-origin /wasm/)').toEqual([])
      const served = wasmRequests.filter((request) => request.status === 200)
      expect(served.length, `expected the ORT wasm fetch to be served from ${BASE}/wasm/, saw ${JSON.stringify(wasmRequests)}`).toBeGreaterThan(0)
    } finally {
      await stopPreview(server)
    }
  }, 900_000)

  test('CC-01.6: `preview:isolated` reports crossOriginIsolated === true, default preview false', async () => {
    const scripts = packageScripts()
    expect(isPlaceholderScript(scripts['preview:isolated']), `preview:isolated = ${scripts['preview:isolated'] ?? '<missing>'}`).toBe(false)
    const playwright = await import('@playwright/test')
    const browser = await playwright.chromium.launch({ headless: true })
    const page = await browser.newPage()
    try {
      const plain = await startPreview('preview')
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'load' })
        expect(await page.evaluate(() => (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated), 'default preview must not send COOP/COEP').toBe(false)
      } finally {
        await stopPreview(plain)
      }
      const isolated = await startPreview('preview:isolated')
      try {
        const response = await fetch(`${BASE}/`)
        expect(response.headers.get('cross-origin-opener-policy'), 'COOP header').toBe('same-origin')
        expect(response.headers.get('cross-origin-embedder-policy'), 'COEP header').toBe('require-corp')
        await page.goto(`${BASE}/`, { waitUntil: 'load' })
        expect(await page.evaluate(() => (globalThis as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated), 'preview:isolated must be cross-origin isolated').toBe(true)
      } finally {
        await stopPreview(isolated)
      }
    } finally {
      await browser.close()
    }
  }, 600_000)
})