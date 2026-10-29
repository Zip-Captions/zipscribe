// CC-03.3 (L4, Playwright/chromium): cache-hit load makes ZERO requests to
// any operations.model_hosts origin (route spy); offline load of a cached
// model succeeds; offline load of an uncached model emits
// OFFLINE_MODEL_MISSING within 1 s — no fetch attempted, no hang.
//
// Contract: FR-03.6 / US-1.1.2 (zero model-host requests on cache hit — the
// cache adapter is ours, not transformers.js best-effort), US-03.1 (offline +
// cached works; offline + uncached fails immediately with the coded notice).
// Network stays blocked: model bytes are seeded PRNG noise fulfilled locally
// from a page.route spy (SECURITY-03: never transcript-like text); the only
// real network in the run is the spec-owned vite dev server on 127.0.0.1:4311
// (closed in afterAll — unit-02 hang-bug rule: no orphan servers).
import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { REPO_ROOT } from '../../tests/helpers/repo'

const PORT = 4311
const BASE = `http://127.0.0.1:${PORT}`
const HARNESS_URL = `${BASE}/e2e/model/fixtures/harness.html`
const FAKE_REVISION = '0123456789abcdef0123456789abcdef01234567'
const HF_HOSTS = (host: string): boolean => host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co')

// --- deterministic fake model bytes (seeded PRNG; binary noise only) ------

function prngBytes(seed: string, length: number): Uint8Array {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let state = h >>> 0
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    out[i] = (t ^ (t >>> 14)) >>> 24
  }
  return out
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface E2eModelSpec {
  id: string
  engine: 'transformers-whisper'
  repo: string
  revision: string
  files: { path: string; sha256: string; bytes: number }[]
  approxBytes: number
  languages: string[]
  punctuation: boolean
  confidence: boolean
  languageDetect: boolean
  timestampMode: 'word-native'
  license: string
  tierHint: 'T2'
  runtimeWasm: string[]
  enOnly: boolean
}

interface E2ePlan {
  spec: E2eModelSpec
  /** URL → bytes for the route spy (model files on the HF host, wasm on self). */
  bodies: Map<string, Buffer>
  modelUrls: string[]
}

function makePlan(id: string, fileSizes: number[]): E2ePlan {
  const repo = `zipscribe-test/${id.split('@')[0]}`
  const spec: E2eModelSpec = {
    id,
    engine: 'transformers-whisper',
    repo,
    revision: FAKE_REVISION,
    files: [],
    approxBytes: 10_000,
    languages: ['*'],
    punctuation: false,
    confidence: false,
    languageDetect: true,
    timestampMode: 'word-native',
    license: 'Apache-2.0',
    tierHint: 'T2',
    runtimeWasm: ['/wasm/unit03-runtime.wasm'],
    enOnly: false,
  }
  const bodies = new Map<string, Buffer>()
  const modelUrls: string[] = []
  let total = 0
  for (const [index, size] of fileSizes.entries()) {
    const path = `onnx/part-${index}.onnx`
    const bytes = prngBytes(`${id}/${path}`, size)
    spec.files.push({ path, sha256: sha256Hex(bytes), bytes: size })
    const url = `https://huggingface.co/${repo}/resolve/${FAKE_REVISION}/${path}`
    bodies.set(url, Buffer.from(bytes))
    modelUrls.push(url)
    total += size
  }
  const wasmBytes = prngBytes(`${id}/wasm`, 4096)
  bodies.set(`${BASE}/wasm/unit03-runtime.wasm`, Buffer.from(wasmBytes))
  spec.approxBytes = total + wasmBytes.byteLength
  return { spec, bodies, modelUrls }
}

// --- spec-owned vite dev server (closed in afterAll — no orphans) ---------

// Child-safety (same doctrine as vitest.config.ts's ZIPSCRIBE_CHILD exclude
// list): the frozen gates scaffold (tests/unit/scaffold/gates.test.ts,
// CC-01.5) spawns `pnpm test:e2e` as a command-wiring proof and asserts the
// spawned child is green. Under ZIPSCRIBE_CHILD=1 this spec stands down; it
// runs (and, in the RED phase, fails) in every authoritative sweep —
// `pnpm test:e2e` and `verify:unit` run without ZIPSCRIBE_CHILD set.
const spawnedChild = process.env.ZIPSCRIBE_CHILD === '1'
test.skip(spawnedChild, 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit (ZIPSCRIBE_CHILD unset)')

let server: ChildProcess | undefined

async function startHarnessServer(): Promise<void> {
  server = spawn('corepack', ['pnpm', 'exec', 'vite', '--config', 'e2e/model/fixtures/vite.harness.config.ts', '--port', String(PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  server.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1000) })
      if (response.status < 500) return
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await stopHarnessServer()
  throw new Error(`harness vite server did not start: ${output.slice(-2000)}`)
}

async function stopHarnessServer(): Promise<void> {
  const child = server
  server = undefined
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const kill = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2000)
    child.once('exit', () => {
      clearTimeout(kill)
      resolve()
    })
  })
}

test.beforeAll(async () => {
  if (spawnedChild) return
  await startHarnessServer()
})
test.afterAll(stopHarnessServer)
test.afterAll(async () => {
  // Belt and braces against the unit-02 orphan-server hang class of bug.
  await stopHarnessServer()
})

// --- page plumbing ---------------------------------------------------------

interface Counters {
  modelHost: number
}

async function wireRoutes(page: Page, plan: E2ePlan, counters: Counters): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) {
      const body = plan.bodies.get(url)
      if (body !== undefined) {
        await route.fulfill({ status: 200, body, headers: { 'content-type': 'application/octet-stream' } })
        return
      }
      await route.continue()
      return
    }
    if (HF_HOSTS(new URL(url).host)) {
      counters.modelHost += 1
      const body = plan.bodies.get(url)
      if (body === undefined) {
        await route.fulfill({ status: 404, body: 'outside test plan' })
        return
      }
      await route.fulfill({ status: 200, body, headers: { 'content-type': 'application/octet-stream' } })
      return
    }
    await route.abort()
  })
}

async function waitForHarness(page: Page): Promise<void> {
  await page.waitForFunction(
    (name: string) => (globalThis as unknown as Record<string, unknown>)[name] !== undefined,
    '__zipscribeModelHarness',
    { timeout: 15_000 },
  )
}

async function setupHarness(page: Page, spec: E2eModelSpec): Promise<void> {
  await page.evaluate(
    ([id, modelSpec]) => {
      const h = (globalThis as unknown as Record<string, { setup(registry: Record<string, unknown>, options?: unknown): void } | undefined>).__zipscribeModelHarness
      if (!h) throw new Error('harness not installed')
      h.setup({ [id]: modelSpec })
    },
    [spec.id, spec] as const,
  )
}

async function loadInPage(page: Page, id: string): Promise<{ ok: boolean; elapsed: number; error?: unknown }> {
  return page.evaluate(async (modelId: string) => {
    const h = (globalThis as unknown as Record<string, { loadModel(id: string): Promise<void> } | undefined>).__zipscribeModelHarness
    if (!h) throw new Error('harness not installed')
    const startedAt = Date.now()
    try {
      await h.loadModel(modelId)
      return { ok: true, elapsed: Date.now() - startedAt }
    } catch (error: unknown) {
      return { ok: false, elapsed: Date.now() - startedAt, error: error instanceof Error ? { name: error.name, message: error.message } : { raw: String(error) } }
    }
  }, id)
}

async function readEvents(page: Page): Promise<{ t: string; phase?: string; code?: string; device?: string }[]> {
  return page.evaluate(() => {
    const h = (globalThis as unknown as Record<string, { events: Record<string, unknown>[] } | undefined>).__zipscribeModelHarness
    if (!h) throw new Error('harness not installed')
    return h.events.map((event) => ({
      t: String(event.t),
      ...(typeof event.phase === 'string' ? { phase: event.phase } : {}),
      ...(typeof event.device === 'string' ? { device: event.device } : {}),
      ...((event.notice as { code?: string } | undefined)?.code !== undefined ? { code: String((event.notice as { code: string }).code) } : {}),
    }))
  })
}

// --- the criteria ------------------------------------------------------------

test('CC-03.3: cache-hit reload makes ZERO requests to any model_hosts origin (route spy)', async ({ page }) => {
  const plan = makePlan('e2e-cache-hit@deadbeef', [8192, 16_384])
  const counters: Counters = { modelHost: 0 }
  await wireRoutes(page, plan, counters)
  await page.goto(HARNESS_URL)
  await waitForHarness(page)
  await setupHarness(page, plan.spec)

  const first = await loadInPage(page, plan.spec.id)
  expect(first.ok, `first load succeeded (${JSON.stringify(first.error)})`).toBe(true)
  expect(counters.modelHost, 'first (uncached) load fetched every model file from a model-host origin').toBe(plan.spec.files.length)
  let events = await readEvents(page)
  expect(events.filter((event) => event.t === 'model:ready').length).toBe(1)
  expect(events.some((event) => event.t === 'model:progress' && event.phase === 'download'), 'download progress seen').toBe(true)
  expect(events.some((event) => event.t === 'model:progress' && event.phase === 'compile'), 'compile progress seen').toBe(true)
  const cacheNames = await page.evaluate(() => (globalThis as unknown as { caches: { keys(): Promise<string[]> } }).caches.keys())
  expect(cacheNames, 'cache DB name is zipscribe-models (FR-03.6)').toContain('zipscribe-models')

  counters.modelHost = 0
  await page.reload()
  await waitForHarness(page)
  await setupHarness(page, plan.spec)
  const second = await loadInPage(page, plan.spec.id)
  expect(second.ok, `cache-hit reload succeeded (${JSON.stringify(second.error)})`).toBe(true)
  expect(counters.modelHost, 'cache-hit reload made ZERO requests to any model_hosts origin').toBe(0)
  events = await readEvents(page)
  expect(events.filter((event) => event.t === 'model:ready').length, 'ready on cache hit').toBe(1)
  const cached = await page.evaluate(() => (globalThis as unknown as Record<string, { listCached(): Promise<unknown[]> } | undefined>).__zipscribeModelHarness?.listCached())
  expect(JSON.stringify(cached)).toContain(plan.spec.id)
})

test('CC-03.3: context.setOffline(true) + cached model → load succeeds without network', async ({ page, context }) => {
  const plan = makePlan('e2e-offline-hit@cafebab0', [8192])
  const counters: Counters = { modelHost: 0 }
  await wireRoutes(page, plan, counters)
  await page.goto(HARNESS_URL)
  await waitForHarness(page)
  await setupHarness(page, plan.spec)
  const first = await loadInPage(page, plan.spec.id)
  expect(first.ok, 'seeded online').toBe(true)
  await page.evaluate(() => (globalThis as unknown as Record<string, { unload(): Promise<void> } | undefined>).__zipscribeModelHarness?.unload())

  await context.setOffline(true)
  counters.modelHost = 0
  const offline = await loadInPage(page, plan.spec.id)
  expect(offline.ok, `offline load of the cached model succeeded (${JSON.stringify(offline.error)})`).toBe(true)
  expect(counters.modelHost, 'offline cached load attempted ZERO model-host requests').toBe(0)
  const events = await readEvents(page)
  expect(events.filter((event) => event.t === 'model:ready').length, 'ready emitted again while offline (after the unload)').toBe(2)
  await context.setOffline(false)
})

test('CC-03.3: offline + UNCACHED → OFFLINE_MODEL_MISSING notice within 1 s, zero fetch attempts', async ({ page, context }) => {
  const plan = makePlan('e2e-offline-miss@feedface', [8192])
  const counters: Counters = { modelHost: 0 }
  await wireRoutes(page, plan, counters)
  await page.goto(HARNESS_URL)
  await waitForHarness(page)
  await setupHarness(page, plan.spec)

  await context.setOffline(true)
  const result = await loadInPage(page, plan.spec.id)
  await context.setOffline(false)
  expect(result.ok, 'offline load of an uncached model fails immediately').toBe(false)
  expect(result.elapsed, `OFFLINE_MODEL_MISSING within 1 s (measured ${result.elapsed} ms)`).toBeLessThan(1000)
  expect(counters.modelHost, 'no fetch attempted').toBe(0)
  const events = await readEvents(page)
  expect(events.some((event) => event.t === 'notice' && event.code === 'OFFLINE_MODEL_MISSING'), 'OFFLINE_MODEL_MISSING notice emitted').toBe(true)
  expect(events.some((event) => event.t === 'model:ready'), 'never ready').toBe(false)
})
