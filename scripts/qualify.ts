// scripts/qualify.ts — the FR-02.10 release-qualification runner
// (`pnpm qualify`, conventions § Release qualification, CC-02.5).
//
// Executes the `qualify/**` L6 suites (vitest.config.qualify.ts) on reference
// hardware, collects machine info from the same pinned Chromium the e2e gate
// uses, and writes `qualification/<version>.json` (version `0.0.0` ⇒
// `0.0.0-spike` — see scripts/lib/qualification-hash.ts). The suites are
// data-driven over the committed `docs/spikes/**` artifacts, so a re-run is a
// fast artifact audit; the measurements come from the spike harness.
//
// Exit code: 0 iff every recorded [RQ] result passes (an honest gate — never
// a rubber stamp).
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import os from 'node:os'
import { computeContentHash, qualificationFileName } from './lib/qualification-hash.ts'

const repoRoot = join(fileURLToPath(import.meta.url), '../..')

const RQ_IDS = ['CC-02.1', 'CC-02.2', 'CC-02.3', 'CC-02.4', 'CC-02.7', 'CC-02.8', 'CC-02.9', 'CC-02.11'] as const

interface AssertionResult {
  fullName?: string
  title?: string
  status?: string
}
interface TestResult {
  name?: string
  assertionResults?: AssertionResult[]
}

/**
 * Machine-info probe (slice-2B honesty fix). Build-1's probe launched
 * `headless: true` with no channel — that is Playwright's chrome-headless-
 * shell, which disables the GPU by default (https://playwright.dev/docs/browsers,
 * https://developer.chrome.com/blog/supercharge-web-ai-testing) — and then
 * reported 'webgpu-unavailable' whenever `adapter.info` was falsy even though
 * an ADAPTER existed (adapter.info is the Chrome-130+ surface; pre-130 needs
 * requestAdapterInfo()). The consequence was the qualification file claiming
 * gpu=webgpu-unavailable while webgpu rows claimed ok:true. Probe the SAME
 * way the harness measures: channel 'chromium' (new headless — the real
 * browser, GPU flags per https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips),
 * gate on navigator.gpu + requestAdapter(), record isFallbackAdapter, and
 * only call it unavailable when requestAdapter() genuinely returns null.
 */
async function collectMachine(): Promise<Record<string, unknown>> {
  let browser = 'unknown'
  let gpu = 'unknown'
  const launchArgs = ['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=metal']
  // WebGPU requires a secure context (https://developer.chrome.com/docs/web-
  // platform/webgpu/troubleshooting-tips) — about:blank is not one, so the
  // probe serves itself from loopback (a trustworthy origin), no dist needed.
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const instance = await chromium.launch({ channel: 'chromium', headless: true, args: launchArgs })
    const context = await instance.newContext()
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}/`)
    browser = await page.evaluate(() => navigator.userAgent)
    gpu = await page.evaluate(async () => {
      interface AdapterInfoLike {
        vendor?: string
        architecture?: string
        device?: string
        description?: string
      }
      interface AdapterLike {
        isFallbackAdapter?: boolean
        info?: AdapterInfoLike
        requestAdapterInfo?: () => Promise<AdapterInfoLike>
      }
      const nav = navigator as unknown as { gpu?: { requestAdapter(): Promise<AdapterLike | null> } }
      if (!nav.gpu) return 'webgpu-unavailable(navigator.gpu)'
      const adapter = await nav.gpu.requestAdapter()
      if (!adapter) return 'webgpu-unavailable(no-adapter)'
      if (adapter.isFallbackAdapter === true) return 'webgpu-fallback-adapter(swiftshader)'
      let info = adapter.info
      if (!info && typeof adapter.requestAdapterInfo === 'function') {
        try {
          info = await adapter.requestAdapterInfo()
        } catch {
          info = undefined
        }
      }
      const text = info ? `${info.vendor ?? 'gpu'} ${info.architecture ?? ''} ${info.description ?? ''}`.trim() : ''
      return text !== '' ? text : 'webgpu(adapter, no-info)'
    })
    await instance.close()
  } catch {
    // keep placeholders — the schema requires strings, and a machine-info
    // probe failure must not mask the measurement suites' verdicts.
  }
  return {
    browser,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    gpu,
    ramGB: Math.round((os.totalmem() / 1_000_000_000) * 10) / 10,
  }
}

function readQualifyResults(): Map<string, { passed: number; failed: number }> {
  const outPath = join(repoRoot, '.cache', 'qualify-results.json')
  const verdicts = new Map<string, { passed: number; failed: number }>()
  for (const id of RQ_IDS) verdicts.set(id, { passed: 0, failed: 0 })
  if (!existsSync(outPath)) return verdicts
  const parsed = JSON.parse(readFileSync(outPath, 'utf8')) as { testResults?: TestResult[] }
  for (const suite of parsed.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      const label = `${assertion.fullName ?? ''} ${assertion.title ?? ''}`
      for (const id of RQ_IDS) {
        if (!label.includes(id)) continue
        const verdict = verdicts.get(id)
        if (!verdict) continue
        if (assertion.status === 'passed') verdict.passed += 1
        else if (assertion.status === 'failed') verdict.failed += 1
      }
    }
  }
  return verdicts
}

function readManual(): Array<Record<string, unknown>> {
  const path = join(repoRoot, 'qualification', 'manual.json')
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { entries?: unknown }
      if (Array.isArray(parsed.entries)) return parsed.entries.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    } catch {
      // fall through to the placeholder — a malformed manual file is a
      // reporting defect, not a reason to crash the runner.
    }
  }
  return []
}

async function main(): Promise<void> {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
  const startedAt = new Date().toISOString()

  const vitestBin = join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs')
  const run = spawnSync(process.execPath, [vitestBin, 'run', '--config', 'vitest.config.qualify.ts', '--reporter=json', `--outputFile=${join(repoRoot, '.cache', 'qualify-results.json')}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 150_000,
  })
  if (run.status !== 0 && run.status !== null) {
    console.error('qualify: qualify suites failed (see suites output above)')
  }

  const verdicts = readQualifyResults()
  const results = RQ_IDS.map((id) => {
    const verdict = verdicts.get(id) ?? { passed: 0, failed: 1 }
    return {
      id,
      pass: verdict.failed === 0 && verdict.passed > 0,
      measured: `${verdict.passed}/${verdict.passed + verdict.failed} qualify assertions passed`,
      threshold: 'all qualify assertions for the criterion pass',
    }
  })

  const manual = readManual()
  if (!manual.some((entry) => String(entry['id']) === 'CC-02.10')) {
    manual.push({
      id: 'CC-02.10',
      by: 'owner-pending',
      date: 'unrecorded',
      result: 'license statuses recorded in docs/spikes/model-eval-report.json; owner sign-off pending',
    })
  }

  const machine = await collectMachine()
  const file = {
    version: qualificationFileName(pkg.version),
    contentHash: computeContentHash(repoRoot),
    startedAt,
    machine,
    results,
    manual,
  }

  const outDir = join(repoRoot, 'qualification')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${file.version}.json`)
  writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`)
  console.log(`qualify: wrote qualification/${file.version}.json (${results.filter((r) => r.pass).length}/${results.length} RQ criteria pass)`)

  if (results.some((r) => !r.pass)) process.exit(1)
}

main().catch((error: unknown) => {
  console.error(`qualify: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
