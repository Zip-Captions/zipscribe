// CC-04.9 (L4, `memory` project): the 120-minute decode memory gate —
// peak heap < 150 MB above baseline while the full decode pipeline streams
// `fixtures/audio-120min.mp4` (US-1.2.1, settings.yml testing.memory_tests).
//
// Why the spec owns its server: Playwright 1.64.1's per-project `webServer`
// is declared in the types but the runner only starts the ROOT config's
// webServer (webServerPluginsForConfig iterates config.webServers — the root
// entry). `performance.measureUserAgentSpecificMemory()` requires
// cross-origin isolation, which the root preview (4310, no COOP/COEP —
// production parity) must never send. So this spec spawns the unit-01-owned
// isolated preview (`pnpm preview:isolated` → ZIPSCRIBE_ISOLATED=1 →
// vite.config.ts preview.headers COOP/COEP + Origin-Agent-Cluster) on port
// 4312 in beforeAll and kills it in afterAll — the spec-owned-server
// doctrine of e2e/model/model-cache.spec.ts (4311); preview.mjs preempts
// stale holders of its own port and tears down the whole ancestor chain, so
// a killed runner cannot orphan a listener. The `memory` project pins
// `channel: 'chromium'`: the default headless-shell build throws
// SecurityError ("not available") from measureUserAgentSpecificMemory even
// when cross-origin isolated — the full browser binary does not.
//
// How it measures (GREEN semantics, real for the builder):
//   baseline = measureUserAgentSpecificMemory() after page load;
//   decodeStreaming() drops every chunk on arrival (a bounded consumer — no
//   history retained), so retained heap is the decode WINDOW, never the
//   120-minute file; the loop samples every 2 s during the decode and the
//   gate is (peak − baseline) < 150 MB. Coverage asserts (7200 s ± tolerance,
//   > 7000 one-second chunks) prove the measurement is over a full decode,
//   not an early exit.
//
// RED (tonight): the page fails inside `decodeStreaming` because
// `@engine/audio/worker-core` is a declared not-implemented stub — the same
// stub discipline as the whole unit-04 L4 suite. The infrastructure
// assertions (server up, crossOriginIsolated, fixture present) run FIRST so
// an infra break is never blamed on the missing production code.
//
// The perf fixture is generated (`pnpm fixtures --perf`, gitignored,
// sha256 cafbea59…); when absent (CI without --perf) the test skips with a
// reason and the unit report lists the measurement as a
// reference-hardware/release-time gate (settings.yml memory_tests).
import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../../tests/helpers/repo'
import { routeFixtures } from '../helpers/media'

const PORT = 4312
const BASE = `http://127.0.0.1:${PORT}`
const PERF_FIXTURE = join(REPO_ROOT, 'fixtures/audio-120min.mp4')
const LIMIT_MB = 150
const SAMPLE_MS = 2_000

let server: ChildProcess | undefined

async function startIsolatedPreview(): Promise<void> {
  server = spawn('corepack', ['pnpm', 'run', '--silent', 'preview:isolated', '--', '--port', String(PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  server.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  for (let attempt = 0; attempt < 480; attempt++) {
    try {
      const response = await fetch(`${BASE}/harness/media.html`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    if (server.exitCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await stopIsolatedPreview()
  throw new Error(`isolated preview (port ${PORT}) did not start: ${output.slice(-2000)}`)
}

async function stopIsolatedPreview(): Promise<void> {
  const child = server
  server = undefined
  if (!child || child.exitCode !== null) return
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

test.describe('CC-04.9: 120-minute decode memory gate', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.skip(!existsSync(PERF_FIXTURE), 'audio-120min.mp4 is a generated perf fixture (`pnpm fixtures --perf`) — reference-hardware gate, see the unit report')
  test.use({ baseURL: BASE })
  test.setTimeout(20 * 60_000)

  test.beforeAll(async () => {
    if (process.env.ZIPSCRIBE_CHILD === '1') return
    await startIsolatedPreview()
  })
  test.afterAll(stopIsolatedPreview)

  test('CC-04.9: decoding audio-120min.mp4 stays < 150 MB above baseline', async ({ page, baseURL }) => {
    // The perf fixture is served from disk like the rest of the corpus (the
    // preview's publicDir does not carry the fixtures tree).
    await routeFixtures(page, baseURL ?? BASE)
    await page.goto('/harness/media.html')
    await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeMediaHarnessReady === true, { timeout: 30_000 })
    // Infrastructure preconditions first: the gate's mechanism must work
    // independently of the (absent) production modules.
    expect(await page.evaluate(() => globalThis.crossOriginIsolated), 'COOP/COEP isolated preview must make the page cross-origin isolated').toBe(true)

    const measurement = await page.evaluate(async ({ sampleMs }) => {
      type Measured = { bytes: number }
      const performanceMeasured = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<Measured> }
      if (typeof performanceMeasured.measureUserAgentSpecificMemory !== 'function') throw new Error('measureUserAgentSpecificMemory unavailable (needs COOP/COEP + Chromium)')
      const measure = () => performanceMeasured.measureUserAgentSpecificMemory!().then((result) => result.bytes / 1024 / 1024)
      const harness = (globalThis as unknown as { __zipscribeMediaHarness: { decodeStreaming(url: string): Promise<{ chunks: number; duration: number }> } }).__zipscribeMediaHarness
      await new Promise((resolve) => setTimeout(resolve, 500))
      const baseline = await measure()
      let peak = baseline
      const decode = harness.decodeStreaming('fixtures/audio-120min.mp4')
      let finished = false
      void decode.then(
        () => (finished = true),
        () => (finished = true),
      )
      while (!finished) {
        peak = Math.max(peak, await measure())
        await new Promise((resolve) => setTimeout(resolve, sampleMs))
      }
      const result = await decode // re-throws the pipeline error in RED
      const after = await measure()
      peak = Math.max(peak, after)
      return { baseline, peak, chunks: result.chunks, duration: result.duration }
    }, { sampleMs: SAMPLE_MS })

    expect(measurement.duration, 'the gate measures a full 120-minute asset').toBeCloseTo(7200, 0)
    expect(measurement.chunks, 'the asset streamed as one-second chunks').toBeGreaterThan(7_000)
    expect(measurement.peak - measurement.baseline, `peak heap growth ${(measurement.peak - measurement.baseline).toFixed(1)} MB must stay under the ${LIMIT_MB} MB ceiling`).toBeLessThan(LIMIT_MB)
  })
})