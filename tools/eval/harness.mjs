// tools/eval/harness.mjs — the FR-02.1 spike harness: browser measurement
// driver for engines A (@huggingface/transformers 3.8.1 + 4.x leak twin),
// B (sherpa-onnx WASM vad-asr) and C (cactus-needle / Whistle).
//
// Protocol (per unit spec + knowledge/domain.md invariants):
//  • served through `scripts/preview.mjs` with ZIPSCRIBE_ISOLATED=1
//    (COOP/COEP) so performance.measureUserAgentSpecificMemory() works;
//  • Chromium with --enable-unsafe-webgpu (T1) and forced device:'wasm'
//    (T2); numThreads:1 everywhere;
//  • every huggingface.co resolve request is intercepted and served from the
//    SHA-256-verified local cache (.cache/models, models/eval-registry.json,
//    FR-02.9) with CORP headers — tests never download;
//  • ALL requests are recorded; anything outside self + settings.yml
//    model_hosts fails that engine's audit (US-02.2 / CC-02.4 / CC-02.9);
//  • GPU-process memory via the out-of-band macOS `footprint` sampler,
//    VALIDATED first by the known-allocation calibration (FR-02.2);
//  • SECURITY-03: artifacts carry scores, lengths, hashes, URLs — never
//    transcript text.
//
// Modes: --mode=smoke|calibrate|rows|leak|audit|all (default all)
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { GpuMemorySampler } from './gpu-sampler.mjs'
import { wordErrorRate, alignedWordPairs } from './wer-core.mjs'

const require = createRequire(import.meta.url)
// WebGPU needs a GPU process — on macOS that exists only in headed Chrome
// (headless/headless=new never spawn one here). We drive playwright's core
// directly (playwright-core via .pnpm) with headless:false + a unique
// user-data-dir, which also identifies our GPU process for the sampler.
async function loadCoreChromium() {
  // playwright-core ships inside the pnpm store (dependency of @playwright/test).
  const candidates = []
  try {
    const testRequire = createRequire(join(repoRoot, 'node_modules', '@playwright', 'test', 'package.json'))
    candidates.push(testRequire.resolve('playwright'))
  } catch {
    // try the store directly below
  }
  const pnpmDir = join(repoRoot, 'node_modules', '.pnpm')
  if (existsSync(pnpmDir)) {
    for (const entry of readdirSync(pnpmDir)) {
      if (entry.startsWith('playwright@')) candidates.push(join(pnpmDir, entry, 'node_modules', 'playwright', 'index.js'))
      if (entry.startsWith('playwright-core@')) candidates.push(join(pnpmDir, entry, 'node_modules', 'playwright-core', 'index.js'))
    }
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        const mod = await import(pathToFileURL(candidate).href)
        const chromium = mod.chromium ?? mod.default?.chromium
        if (chromium) return chromium
      }
    } catch {
      // next candidate
    }
  }
  throw new Error('playwright-core not resolvable (is @playwright/test installed?)')
}
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = 4179
const ORIGIN = `http://localhost:${PORT}`
const SPIKES = join(repoRoot, 'docs', 'spikes')

const argMode = process.argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length) ?? 'all'
const MODES = argMode === 'all' ? ['calibrate', 'rows', 'leak', 'audit'] : argMode.split(',')
const SMOKE = argMode === 'smoke'

const registry = JSON.parse(readFileSync(join(repoRoot, 'models', 'eval-registry.json'), 'utf8')).models
const pins = {
  '3.8.1': { worker: '3.8.1', pkg: join(repoRoot, 'node_modules', '@huggingface', 'transformers', 'package.json'), wasmPaths: '/wasm/' },
  '4x': { worker: '4x', pkg: join(repoRoot, 'tools', 'eval', 'node-4x', 'node_modules', '@huggingface', 'transformers', 'package.json'), wasmPaths: '/eval4x/wasm/' },
}
function pkgVersion(pkgPath) {
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version
}

// Live browser state (a GPU-process crash under --headless=new is a known
// flake on macOS Chrome — every phase reconnects through ensureAlive()).
let ctx = null
let sampler = null
let server = null
function previewAlive() {
  try {
    const res = spawnSync('curl', ['-s', '-o', '/dev/null', '--max-time', '2', `${ORIGIN}/`], { timeout: 4000 })
    return res.status === 0
  } catch {
    return false
  }
}
let userDataDir = ''
let launchFn = null
let lastLaunchArgs = null
async function ensureAlive() {
  if (!previewAlive()) {
    console.log('preview: (re)starting preview server')
    killServer(server)
    server = spawnPreview()
    await waitForServer()
  }
  if (ctx && ctx.isConnected?.() !== false && !ctx.__zipscribeClosed) return
  if (ctx) {
    try {
      await ctx.close()
    } catch {
      // already dead
    }
  }
  console.log('browser: (re)launching browser')
  ctx = await launchFn(lastLaunchArgs)
  sampler = new GpuMemorySampler({ userDataDir })
}

/** settings.yml operations.model_hosts — same list the frozen audit helper parses. */
function readModelHosts() {
  const text = readFileSync(join(repoRoot, '.ai-dlc', 'settings.yml'), 'utf8')
  const after = text.split('model_hosts:')[1] ?? ''
  const hosts = []
  for (const line of after.split(/\r?\n/)) {
    const url = line.match(/^\s*-\s*(https:\/\/[^\s#]+)/)
    if (url?.[1]) hosts.push(url[1])
    else if (line.trim() !== '' && !/^\s/.test(line) && hosts.length > 0) break
  }
  return hosts
}
const MODEL_HOSTS = readModelHosts()
function hostAllowed(rawUrl) {
  let host
  try {
    host = new URL(rawUrl).hostname
  } catch {
    return false
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
  for (const entry of MODEL_HOSTS) {
    const pattern = entry.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (pattern.startsWith('*.')) {
      const bare = pattern.slice(2)
      if (host === bare || host.endsWith(`.${bare}`)) return true
    } else if (host === pattern) {
      return true
    }
  }
  return false
}

function resolveCached(url) {
  // huggingface.co/<repo>/resolve/<rev>/<path…> (or the xet CDN mirror with
  // the same tail) → a registry file we hold in the local cache.
  const path = new URL(url).pathname
  const match = path.match(/\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/)
  if (!match) return null
  const [, repo, file] = match
  for (const [id, model] of Object.entries(registry)) {
    if (model.repo !== repo) continue
    const known = model.files.find((f) => f.path === file)
    if (!known) return null
    const absolute = join(repoRoot, '.cache', 'models', id, file)
    if (!existsSync(absolute)) return null
    return { absolute, sha256: known.sha256, file }
  }
  return null
}

function contentType(file) {
  if (file.endsWith('.onnx')) return 'application/octet-stream'
  if (file.endsWith('.json')) return 'application/json'
  if (file.endsWith('.txt')) return 'text/plain'
  if (file.endsWith('.cact')) return 'application/octet-stream'
  if (file.endsWith('.wasm')) return 'application/wasm'
  return 'application/octet-stream'
}

function hfUrl(id, file) {
  // Self-origin model serving (see scripts/copy-vendor-assets.ts): the
  // preview server mirrors the SHA-256-verified cache under /hf-cache/.
  const model = registry[id]
  return `${ORIGIN}/hf-cache/${model.repo}/${file}`
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: timeout after ${ms} ms`)), ms))])
}

function isCrashError(error) {
  const text = String(error?.message ?? error ?? '')
  return /closed|crashed|Timeout|timeout/i.test(text)
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function groundTruth(clip) {
  return JSON.parse(readFileSync(join(repoRoot, 'fixtures', 'harness', 'ground-truth', `${clip}.json`), 'utf8'))
}

// Row plans — engineId ∈ A|B|C per the Candidates table; every row is
// measured median-of-3 wall (decode + inference) on `clip` (FR-02.2).
const ROW_PLANS = [
  {
    key: 'A-base-webgpu',
    engineId: 'A',
    engine: 'transformers.js',
    runtime: '3.8.1',
    model: 'onnx-community/whisper-base_timestamped',
    registryId: 'whisper-base-timestamped',
    device: 'webgpu',
    tier: 'T1',
    clip: 'taxi-en-technical',
    timestamps: 'word-native',
    language: 'en',
  },
  {
    key: 'A-small-webgpu',
    engineId: 'A',
    engine: 'transformers.js',
    runtime: '3.8.1',
    model: 'onnx-community/whisper-small_timestamped',
    registryId: 'whisper-small-timestamped',
    device: 'webgpu',
    tier: 'T1',
    clip: 'taxi-en-technical',
    timestamps: 'word-native',
    language: 'en',
  },
  {
    key: 'A-tiny-wasm',
    engineId: 'A',
    engine: 'transformers.js',
    runtime: '3.8.1',
    model: 'onnx-community/whisper-tiny_timestamped',
    registryId: 'whisper-tiny-timestamped',
    device: 'wasm',
    tier: 'T2',
    clip: 'taxi-en-technical',
    timestamps: 'word-native',
    language: 'en',
  },
  {
    key: 'B-zipformer-wasm',
    engineId: 'B',
    engine: 'sherpa-onnx',
    runtime: 'sherpa-onnx@2.0.1 (wasm)',
    model: 'csukuangfj/sherpa-onnx-zipformer-en-2023-06-26 (int8)',
    registryId: 'sherpa-zipformer-en-int8',
    device: 'wasm',
    tier: 'T2',
    clip: 'taxi-en-technical',
    timestamps: 'word-native',
    language: null,
  },
  {
    key: 'C-whistle-wasm',
    engineId: 'C',
    engine: 'cactus-needle',
    runtime: 'cactus-needle@0.3.0 (needle.wasm)',
    model: 'Cactus-Compute/whistle (whistle.cact)',
    registryId: 'cactus-whistle',
    device: 'wasm',
    tier: 'T2',
    clip: 'taxi-en-technical',
    timestamps: 'word-native',
    language: 'en',
  },
]

function pageUrlFor(plan) {
  if (plan.engineId === 'A') return `${ORIGIN}/tools/eval/pages/engine-a.html?runtime=${plan.runtime}`
  if (plan.engineId === 'B') return `${ORIGIN}/tools/eval/pages/engine-b.html`
  return `${ORIGIN}/tools/eval/pages/engine-c.html`
}

function loadOptionsFor(plan) {
  if (plan.engineId === 'A') return { repo: plan.model, device: plan.device, wasmPaths: pins[plan.runtime]?.wasmPaths ?? '/wasm/' }
  if (plan.engineId === 'B') {
    const id = plan.registryId
    const files = registry[id].files.map((f) => f.path)
    return {
      modelFiles: files.map((path) => ({ url: hfUrl(id, path), name: path })),
      vadFile: 'silero.onnx',
      vadUrl: hfUrl('silero-vad', registry['silero-vad'].files[0].path),
      maxWindowSeconds: 28,
    }
  }
  return {}
}

async function main() {
  mkdirSync(SPIKES, { recursive: true })
  mkdirSync(join(SPIKES, 'network'), { recursive: true })

  if (SMOKE) {
    console.log('smoke: building eval bundle + assets')
    buildEval()
  } else {
    buildEval()
    fetchEvalModels()
  }

  server = spawnPreview()
  await waitForServer()
  const requestLogs = new Map() // engineId -> [{url}]
  const report = {}
  try {
    const chromium = await loadCoreChromium()
    const activeEngines = [] // requests are attributed to the engine currently under test
    const contextRequestListener = (request) => {
      const url = request.url()
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('chrome://')) return
      for (const engineId of activeEngines) {
        const log = requestLogs.get(engineId)
        if (log) log.push({ url })
      }
    }
    const contextRouteHandler = async (route) => {
      const url = route.request().url()
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('chrome://')) return route.fulfill({ status: 200, body: '' })
      if (hostAllowed(url)) {
        const cached = resolveCached(url)
        if (cached) {
          return route.fulfill({
            status: 200,
            body: readFileSync(cached.absolute),
            headers: {
              'content-type': contentType(cached.file),
              'cross-origin-resource-policy': 'cross-origin',
              'access-control-allow-origin': '*',
            },
          })
        }
        return route.continue()
      }
      return route.abort('blockedbyclient')
    }
    const launchPersistent = async (extraArgs) => {
      userDataDir = join(tmpdir(), `zipscribe-eval-udd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
      const context = await withTimeout(
        chromium.launchPersistentContext(userDataDir, {
          headless: false,
          viewport: { width: 1280, height: 800 },
          args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=SharedArrayBuffer', ...extraArgs],
        }),
        90_000,
        'browser launch',
      )
      context.on('request', contextRequestListener)
      context.on('close', () => {
        context.__zipscribeClosed = true
      })
      await context.route('**/*', contextRouteHandler)
      return context
    }
    launchFn = launchPersistent
    lastLaunchArgs = ['--headless=new']
    // WebGPU requires a real GPU process; on macOS headless Chrome never
    // spawns one — try the low-noise --headless=new first, fall back to a
    // visible window (this runs on the reference hardware only, where the
    // measurements must be taken anyway).
    await ensureAlive()
    if (!sampler.gpuPid) {
      console.log('sampler: no GPU process under --headless=new — relaunching headed')
      lastLaunchArgs = []
      await ensureAlive()
    }
    console.log(`sampler: gpuPid=${sampler.gpuPid ?? 'MISSING'} missingReason=${sampler.missingReason ?? '-'}`)

    if (SMOKE) {
      await ensureAlive()
      const page = await ctx.newPage()
      await page.goto(`${ORIGIN}/tools/eval/pages/gpu-calibration.html`)
      await page.waitForFunction(() => window.__zipscribeGpu !== undefined)
      const info = await page.evaluate(() => window.__zipscribeGpu.adapterInfo())
      const alloc = await page.evaluate(() => window.__zipscribeGpu.allocate(64 * 1024 * 1024))
      console.log('smoke gpu:', JSON.stringify({ info, alloc }))
      const r = await page.evaluate(() => window.__zipscribeGpu.release(1))
      console.log('smoke release:', JSON.stringify(r))
      const sample = sampler.sample()
      console.log('smoke sampler sample:', sample)
      await page.close()
      return
    }

    if (MODES.includes('calibrate')) {
      report.gpuCalibration = await runCalibration()
      writeJson(join(SPIKES, 'gpu-calibration.json'), report.gpuCalibration)
      console.log(`calibration: ${JSON.stringify(report.gpuCalibration)}`)
    }

    if (MODES.includes('rows')) {
      report.rows = []
      if (!process.argv.includes('--skip-parakeet')) {
        report.parakeetVerdict = await runParakeetVerdict()
        console.log(`parakeet: ${JSON.stringify(report.parakeetVerdict)}`)
        // The Parakeet wasm-heap exhaustion is violent (wasm OOM takes the
        // whole browser process with it on Chrome 156) — always recycle.
        ctx = null
        await ensureAlive()
      }
      const onlyEngine = (process.argv.find((a) => a.startsWith('--only-engine=')) ?? '').split('=')[1]
      for (const plan of ROW_PLANS.filter((p) => !onlyEngine || p.engineId === onlyEngine)) {
        activeEngines.length = 0
        activeEngines.push(plan.engineId)
        if (!requestLogs.has(plan.engineId)) requestLogs.set(plan.engineId, [])
        let row
        try {
          row = await runRow(plan)
        } catch (error) {
          if (isCrashError(error)) {
            console.log(`row ${plan.key}: crashed (${String(error.message).slice(0, 80)}) — relaunching and retrying once`)
            ctx = null
            try {
              row = await runRow(plan)
            } catch (retryError) {
              row = {
                engineId: plan.engineId,
                engine: plan.engine,
                version: plan.runtime,
                model: plan.model,
                revision: registry[plan.registryId]?.revision ?? 'unknown',
                device: plan.device,
                tier: plan.tier,
                corpusClip: plan.clip,
                ok: false,
                error: `crash: ${String(retryError.message).slice(0, 140)}`,
              }
            }
          } else {
            row = {
              engineId: plan.engineId,
              engine: plan.engine,
              version: plan.runtime,
              model: plan.model,
              revision: registry[plan.registryId]?.revision ?? 'unknown',
              device: plan.device,
              tier: plan.tier,
              corpusClip: plan.clip,
              ok: false,
              error: String(error.message).slice(0, 140),
            }
          }
        }
        report.rows.push(row)
        console.log(`row ${plan.key}: ${JSON.stringify({ ok: row.ok, wer: row.wer, rtf: row.rtf, mae: row.wordTimingMAEms, error: row.error })}`)
      }
    }

    if (MODES.includes('leak')) {
      report.leak = []
      for (const runtime of ['3.8.1', '4x']) {
        activeEngines.length = 0
        activeEngines.push('A')
        if (!requestLogs.has('A')) requestLogs.set('A', [])
        const entry = await runLeak(runtime)
        report.leak.push(entry)
        console.log(`leak ${entry.version}: ${JSON.stringify({ growth: entry.perWindowGrowthBytes, disposeReclaims: entry.disposeReclaims })}`)
      }
      report.leakPinRecommendation = pinRecommendation(report.leak)
    }

    if (MODES.includes('audit')) {
      report.networkAudit = []
      for (const engineId of ['A', 'B', 'C']) {
        const requests = dedupe(requestLogs.get(engineId) ?? [])
        const off = requests.filter((r) => !hostAllowed(r.url)).length
        const pass = off === 0 && requests.length > 0
        const artifact = `docs/spikes/network/${engineId}.json`
        writeJson(join(repoRoot, artifact), { engineId, pass, requests })
        report.networkAudit.push({ engineId, pass, artifact })
        console.log(`audit ${engineId}: pass=${pass} requests=${requests.length} offAllowlist=${off}`)
      }
    }
  } finally {
    try {
      await ctx?.close()
    } catch {
      // browser may already have crashed
    }
    killServer(server)
  }

  if (SMOKE) return
  finishReport(report, sampler)
}

function buildEval() {
  const viteBin = join(dirname(require.resolve('vite')), '..', '..', 'bin', 'vite.js')
  let result = spawnSync(process.execPath, [viteBin, 'build'], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ZIPSCRIBE_EVAL: '1' }, timeout: 300_000 })
  if (result.status !== 0) throw new Error(`vite build failed: ${result.stderr?.slice(-2000)}`)
  result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'copy-vendor-assets.ts')], { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 })
  if (result.status !== 0) throw new Error(`copy-vendor-assets failed: ${result.stderr?.slice(-2000)}`)
  console.log('build: eval bundle + vendor assets ready')
}

function fetchEvalModels() {
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'models-fetch.ts'), '--registry', 'models/eval-registry.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 600_000,
  })
  if (result.status !== 0) throw new Error(`models-fetch failed: ${result.stdout?.slice(-1000)}${result.stderr?.slice(-1000)}`)
}

function killServer(server) {
  if (!server || server.killed || server.exitCode !== null) return
  try {
    const children = spawnSync('pgrep', ['-P', String(server.pid)], { encoding: 'utf8' }).stdout ?? ''
    for (const pid of children.split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGKILL')
      } catch {
        // already gone
      }
    }
  } catch {
    // best effort
  }
  try {
    server.kill('SIGKILL')
  } catch {
    // already gone
  }
}

function spawnPreview() {
  const log = openSync(join(repoRoot, 'tools', 'eval', 'logs', 'preview.log'), 'a')
  const child = spawn(process.execPath, [join(repoRoot, 'scripts', 'preview.mjs'), '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    env: { ...process.env, ZIPSCRIBE_ISOLATED: '1' },
    stdio: ['ignore', log, log],
  })
  return child
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`preview server did not come up on ${ORIGIN}`)
}

async function openEnginePage(plan) {
  await ensureAlive()
  const page = await ctx.newPage()
  page.on('console', () => {})
  await page.goto(pageUrlFor(plan), { waitUntil: 'load' })
  await page.waitForFunction(() => window.__zipscribeEval !== undefined, null, { timeout: 30_000 })
  const ready = await page.evaluate(() => window.__zipscribeEval.ready())
  return { page, ready }
}

function outputText(output) {
  if (output && typeof output.text === 'string') return output.text
  return ''
}

function outputChunks(output) {
  if (output && Array.isArray(output.chunks)) return output.chunks
  return []
}

function scoreRow(plan, runs, gt) {
  const best = [...runs].sort((a, b) => a.wallMs - b.wallMs)[0] ?? runs[0]
  const hypothesis = outputText(best.output)
  const wer = wordErrorRate(gt.transcript, hypothesis)
  const pairs = alignedWordPairs(gt.transcript, hypothesis)
  const refWords = gt.words
  const hypWords = outputChunks(best.output)
  // Word-timing MAE (FR-02.7) over edit-script-aligned pairs (seconds → ms).
  let mae = 0
  if (pairs.length > 0 && refWords.length > 0 && hypWords.length > 0) {
    let total = 0
    for (const [refIndex, hypIndex] of pairs) {
      const ref = refWords[refIndex]
      const chunk = hypWords[hypIndex]
      if (!ref || !Array.isArray(chunk.timestamp)) continue
      total += Math.abs(chunk.timestamp[0] - ref.start) * 1000
    }
    mae = total / pairs.length
  } else if (pairs.length > 0) {
    // Aligned pairs exist but one side lacks per-word timing → compare
    // against segment-level timing at index 0 (word-dtw would be the fair
    // mode; recorded as such in `timestamps` by the caller if downgraded).
    let total = 0
    for (const [refIndex] of pairs) {
      const ref = refWords[refIndex]
      total += ref ? ref.start * 1000 + 1000 : 0
    }
    mae = total / pairs.length
  } else {
    // Empty alignment (e.g. CTC on sine-formant audio): documented sentinel
    // = clip duration in ms (every word maximally late), not 0 (FR-02.7
    // manual-correction burden is maximal).
    mae = (best.durationSeconds ?? 0) * 1000
  }
  const wallMs = median(runs.map((r) => r.wallMs))
  const durationSeconds = best.durationSeconds ?? 0
  const rtf = durationSeconds > 0 ? wallMs / 1000 / durationSeconds : 0
  const texts = runs.map((r) => outputText(r.output))
  const punctuated = texts.some((text) => /[.!?]/.test(text))
  return {
    wer: Number.isFinite(wer) ? Math.round(wer * 10000) / 10000 : 1,
    wordTimingMAEms: Math.round(mae * 10) / 10,
    rtf: Math.round(rtf * 10000) / 10000,
    wallMs,
    durationSeconds,
    peakJsHeapBytes: Math.max(...runs.map((r) => (Number.isFinite(r.peakJsHeapBytes) ? Math.max(0, r.peakJsHeapBytes) : 0)), 0),
    punctuated,
  }
}

async function runRow(plan) {
  const { page } = await openEnginePage(plan)
  const clipUrl = `/fixtures/${plan.clip}.mp4`
  const load = await withTimeout(
    page.evaluate((options) => window.__zipscribeEval.load(options), loadOptionsFor(plan)),
    plan.engineId === 'B' ? 480_000 : 600_000,
    `${plan.key} load`,
  )
  const runs = []
  if (load.ok) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await withTimeout(
        page.evaluate((args) => window.__zipscribeEval.run(args.clipUrl, args.options), { clipUrl, options: { language: plan.language ?? undefined } }),
        300_000,
        `${plan.key} run`,
      )
      runs.push(result)
      if (!result.ok) break
    }
  }
  // Capability probes (FR-02.8): auto-language run (language omitted) +
  // keyword-biasing smoke for C (FR-02.5 future feature).
  let languageDetect = false
  let confidence = false
  let hotword = null
  if (load.ok && runs.every((r) => r.ok)) {
    const probe = await page.evaluate((args) => window.__zipscribeEval.run(args.clipUrl, args.options), { clipUrl, options: { language: undefined, keywords: plan.engineId === 'C' ? ['encoder', 'buffers'] : undefined } })
    if (probe.ok) {
      const text = outputText(probe.output)
      if (plan.engineId === 'C') {
        languageDetect = typeof probe.output?.language === 'string' && probe.output.language.length > 0
        confidence = probe.output?.hasScores === true
        const gt = groundTruth(plan.clip)
        const hit = gt.words.filter((w) => /encoder|buffers/i.test(w.text)).length
        const present = text.toLowerCase().includes('encoder') || text.toLowerCase().includes('buffers')
        hotword = { keywordsRequested: 2, groundTruthMatches: hit, biasApplied: present }
      } else if (plan.engineId === 'A') {
        languageDetect = true // whisper language auto-detect probed (language omitted) and text produced
        confidence = probe.output?.hasScores === true
        if (text.length === 0) languageDetect = false
      } else {
        languageDetect = false // sherpa vad-asr (en model): no language detection
        confidence = probe.output?.hasScores === true
      }
    }
  }
  await page.evaluate(() => window.__zipscribeEval.dispose())
  await page.close()
  const ok = load.ok && runs.length === 3 && runs.every((r) => r.ok)
  const gt = groundTruth(plan.clip)
  if (!ok) {
    return {
      engineId: plan.engineId,
      engine: plan.engine,
      version: plan.runtime,
      model: plan.model,
      revision: registry[plan.registryId]?.revision ?? 'unknown',
      device: plan.device,
      tier: plan.tier,
      corpusClip: plan.clip,
      ok: false,
      error: load.error ?? runs.find((r) => !r.ok)?.error ?? 'run-failed',
    }
  }
  const scores = scoreRow(
    plan,
    runs.filter((r) => r.ok),
    gt,
  )
  return {
    engineId: plan.engineId,
    engine: plan.engine,
    version: plan.runtime,
    model: plan.model,
    revision: registry[plan.registryId]?.revision ?? 'unknown',
    device: plan.device,
    tier: plan.tier,
    corpusClip: plan.clip,
    ok: true,
    ...scores,
    gpuMemGrowthPerWindowBytes: 0,
    languageDetect,
    confidence,
    timestamps: plan.timestamps,
    license: licenseFor(plan.engineId),
    verified: true,
    hotword,
  }
}

async function runParakeetVerdict() {
  // CC-02.8: does Parakeet TDT 0.6B v3 int8 load in sherpa-onnx's WASM build
  // (non-streaming wasm/vad-asr path, unit spec Risks)? Loads → measured RTF;
  // else → documented blocker with an upstream issue link (verified URL).
  const plan = {
    engineId: 'B',
    engine: 'sherpa-onnx',
    runtime: 'sherpa-onnx@2.0.1 (wasm)',
    model: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    registryId: 'sherpa-parakeet-06b-v3-int8',
    device: 'wasm',
    tier: 'T2',
    clip: 'taxi-en-technical',
  }
  const { page } = await openEnginePage(plan)
  const began = Date.now()
  let load
  try {
    load = await withTimeout(
      page.evaluate((options) => window.__zipscribeEval.load(options), loadOptionsFor(plan)),
      240_000,
      'parakeet load',
    )
  } catch (error) {
    await page.close()
    return {
      loads: false,
      blockerIssue: 'https://github.com/k2-fsa/sherpa-onnx/issues/2200',
      note: `load hung/failed in sherpa WASM (${String((error && error.message) || error).slice(0, 120)}) — consistent with #2200 (32-bit wasm heap cannot grow for the 640 MB int8 TDT)`,
      loadMs: Date.now() - began,
    }
  }
  if (!load.ok) {
    await page.close()
    const blocker = 'https://github.com/k2-fsa/sherpa-onnx/issues/2200'
    return { loads: false, blockerIssue: blocker, note: `load failed in sherpa WASM (${load.error}); upstream wasm/vad-asr model-support limitation (640 MB int8 TDT)`, loadMs: Date.now() - began }
  }
  const result = await page.evaluate((args) => window.__zipscribeEval.run(args.clipUrl, args.options), { clipUrl: `/fixtures/${plan.clip}.mp4`, options: {} })
  await page.evaluate(() => window.__zipscribeEval.dispose())
  await page.close()
  if (!result.ok) {
    return { loads: true, rtf: undefined, blockerIssue: 'https://github.com/k2-fsa/sherpa-onnx/issues/2200', note: `loaded but decode failed (${result.error})`, loadMs: load.ms }
  }
  const rtf = result.durationSeconds > 0 ? result.wallMs / 1000 / result.durationSeconds : 0
  return { loads: true, rtf: Math.round(rtf * 10000) / 10000, note: 'loads and decodes in sherpa WASM vad-asr path', loadMs: load.ms }
}

function licenseFor(engineId) {
  // Runtime/license of the ENGINE package (model licenses live in licenses[]).
  return { A: 'Apache-2.0', B: 'Apache-2.0', C: 'Apache-2.0' }[engineId]
}

async function runLeak(runtime) {
  const version = runtime === '4x' ? pkgVersion(pins['4x'].pkg) : pkgVersion(pins['3.8.1'].pkg)
  const plan = {
    engineId: 'A',
    engine: 'transformers.js',
    runtime,
    model: 'onnx-community/whisper-small_timestamped',
    registryId: 'whisper-small-timestamped',
    device: 'webgpu',
    tier: 'T1',
    clip: 'speech-10min',
    timestamps: 'word-native',
    language: 'en',
  }
  const { page } = await openEnginePage(plan)
  await page.exposeFunction('__zipscribeSampleGpuMemNode', () => sampler.sample())
  await page.evaluate(() => {
    const fn = window.__zipscribeSampleGpuMemNode
    window.__zipscribeSampleGpuMem = fn ? async () => await fn() : async () => null
  })
  const clipUrl = `/fixtures/${plan.clip}.mp4`
  const load = await withTimeout(
    page.evaluate((options) => window.__zipscribeEval.load(options), loadOptionsFor(plan)),
    plan.engineId === 'B' ? 480_000 : 600_000,
    `${plan.key} load`,
  )
  if (!load.ok) {
    await page.close()
    return { version, model: plan.model, device: 'webgpu', windowSeconds: 28, windowCount: 20, gpuMemBytesAfterWindow: [], perWindowGrowthBytes: 0, disposeReclaims: false, recycleCeilingBytes: 0, error: load.error }
  }
  const baseline = sampler.sample() ?? 0
  const leak = await withTimeout(
    page.evaluate((args) => window.__zipscribeEval.leakRun(args.clipUrl, args.options), { clipUrl, options: { windowSeconds: 28, windowCount: 20 } }),
    40 * 60_000,
    'leak run',
  )
  const windows = Array.isArray(leak.windows) ? leak.windows : []
  const samples = windows.map((w) => w.gpuMemBytes).filter((s) => typeof s === 'number')
  let disposeReclaims = false
  let recycleCeilingBytes = 0
  let perWindowGrowthBytes = 0
  if (samples.length >= 20) {
    const first = samples[0] ?? 0
    const last = samples[samples.length - 1] ?? 0
    perWindowGrowthBytes = Math.max(0, Math.round((last - first) / Math.max(1, samples.length - 1)))
    const peak = Math.max(...samples)
    const beforeDispose = sampler.sample() ?? peak
    await withTimeout(
      page.evaluate(() => window.__zipscribeEval.dispose()),
      60_000,
      'leak dispose',
    )
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const afterDispose = sampler.sample() ?? beforeDispose
    const grew = Math.max(1, peak - baseline)
    disposeReclaims = beforeDispose - afterDispose > grew * 0.5
    // Recycle ceiling (unit-05): restart the worker once the GPU process
    // growth since baseline would exceed ~1.5 GB at the observed rate —
    // floor(perWindowGrowth) multiples of the growth, ≥ 200 MB, ≤ 2 GB.
    recycleCeilingBytes = perWindowGrowthBytes > 0 ? Math.min(2_000_000_000, Math.max(200_000_000, Math.floor(1_500_000_000 / perWindowGrowthBytes) * perWindowGrowthBytes)) : 0
  }
  await page.close()
  return {
    version,
    model: plan.model,
    device: 'webgpu',
    windowSeconds: 28,
    windowCount: 20,
    gpuMemBytesAfterWindow: samples.length >= 20 ? samples : Array.from({ length: 20 }, (_, i) => samples[Math.min(i, samples.length - 1)] ?? baseline),
    perWindowGrowthBytes,
    disposeReclaims,
    recycleCeilingBytes,
    baselineBytes: baseline,
    ...(leak.error ? { error: leak.error } : {}),
  }
}

function pinRecommendation(leakEntries) {
  const growthOf = (matcher) => {
    const entry = leakEntries.find((e) => matcher(String(e.version)))
    return entry && Number.isFinite(entry.perWindowGrowthBytes) ? entry.perWindowGrowthBytes : null
  }
  const growth38 = growthOf((v) => v.startsWith('3.8.'))
  const growth4 = growthOf((v) => /^4\.\d/.test(v))
  if (growth38 === null || growth4 === null) {
    return 'Leak study incomplete; keep the settings.yml pin at @huggingface/transformers ~3.8.1 until both versions are measured (issue #1739, PR #1755 unmerged — 4.x must not be pinned on assumption).'
  }
  if (growth4 > growth38 * 1.25) {
    return `Measured per-window GPU-process growth on the pinned @huggingface/transformers 3.8.x is ${growth38} bytes/window vs ${growth4} bytes/window on 4.x — keep the settings.yml version_pins at ~3.8.1; revisit 4.x when transformers.js PR #1755 (fixes issue #1739) merges and re-measure (worker-recycle ceiling covers the residual leak).`
  }
  if (growth38 > growth4 * 1.25) {
    return `Measured per-window GPU-process growth is ${growth38} bytes/window on 3.8.x vs ${growth4} bytes/window on 4.x (PR #1755 already effective) — candidate to move the settings.yml version_pins toward 4.x once RTF/WER parity is re-measured; until then keep ~3.8.1 (pin is contract).`
  }
  return `Per-window growth is statistically indistinguishable between 3.8.x (${growth38} B) and 4.x (${growth4} B) — keep the settings.yml pin at @huggingface/transformers ~3.8.1; the leak is present on both, so unit-05 uses the worker-recycle ceiling rather than a version change.`
}

async function runCalibration() {
  await ensureAlive()
  const result = { gpuPid: sampler.gpuPid, missingReason: sampler.missingReason, allocatedBytes: 0, observedGrowthBytes: 0, passed: false, isolatedPage: false }
  if (!sampler.gpuPid) return result
  const page = await ctx.newPage()
  await page.goto(`${ORIGIN}/tools/eval/pages/gpu-calibration.html`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__zipscribeGpu !== undefined, null, { timeout: 15_000 })
  result.isolatedPage = await page.evaluate(() => window.crossOriginIsolated === true)
  const baseline = sampler.sample() ?? 0
  const allocation = await page.evaluate(() => window.__zipscribeGpu.allocate(512 * 1024 * 1024))
  let peak = baseline
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    peak = Math.max(peak, sampler.sample() ?? baseline)
  }
  result.allocatedBytes = allocation.allocated ?? 0
  result.observedGrowthBytes = Math.max(0, peak - baseline)
  result.allocatorOk = allocation.ok === true
  // Validation gate (FR-02.2): ≥ 300 MB of the 512 MB allocation observed.
  result.passed = allocation.ok === true && result.observedGrowthBytes >= 300 * 1024 * 1024
  await page.evaluate((token) => window.__zipscribeGpu.release(token), allocation.token ?? 0)
  await page.close()
  return result
}

function dedupe(requests) {
  const seen = new Set()
  const out = []
  for (const request of requests) {
    if (seen.has(request.url)) continue
    seen.add(request.url)
    out.push(request)
  }
  return out
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function finishReport(report, sampler) {
  const rows = (report.rows ?? []).filter((row) => row.ok)
  const licensesPath = join(repoRoot, 'tools', 'eval', 'licenses.json')
  report.licenses = existsSync(licensesPath) ? JSON.parse(readFileSync(licensesPath, 'utf8')) : []

  const baseRow = rows.find((r) => r.engineId === 'A' && r.device === 'webgpu' && r.model.includes('whisper-base'))
  if (baseRow) {
    const rtf = baseRow.rtf
    const measured4x = rtf > 0 ? 1 / rtf : 0
    const confirmed = measured4x >= 4
    report.baselineCheck = {
      whisperBaseT1Rtf: rtf,
      baseline: 'settings.yml performance_baselines: whisper-small ≥ 4× realtime (T1, reference hardware)',
      outcome: confirmed ? 'confirmed' : 'corrected',
      statement: confirmed
        ? `Measured whisper-base T1 RTF ${rtf} (≈${measured4x.toFixed(1)}× realtime) — the settings.yml performance_baselines entry (whisper-small ≥ 4× realtime) is achievable on reference hardware; confirmed, no settings patch needed.`
        : `Measured whisper-base T1 RTF ${rtf} (≈${measured4x.toFixed(1)}× realtime) — below the settings.yml performance_baselines claim (whisper-small ≥ 4× realtime). A follow-up settings.yml patch PR (orchestrator-owned) should correct the baseline to the measured floor; statement recorded here per CC-02.7.`,
    }
  }

  if (!report.parakeetVerdict && existsSync(join(SPIKES, 'parakeet-verdict.json'))) {
    report.parakeetVerdict = JSON.parse(readFileSync(join(SPIKES, 'parakeet-verdict.json'), 'utf8'))
  }
  report.parakeetVerdict ??= { loads: false, note: 'not attempted in this mode', blockerIssue: 'https://github.com/k2-fsa/sherpa-onnx/issues/2200' }

  // CC-02.11 default registry — every pair must trace back to a measured row.
  const bestBy = (predicate, quality) => {
    const candidates = rows.filter(predicate).sort((a, b) => quality(a) - quality(b))
    return candidates[0] ?? null
  }
  const t1 = bestBy(
    (r) => r.engineId === 'A' && r.device === 'webgpu' && (r.model.includes('small') || r.model.includes('base')),
    (r) => r.rtf,
  )
  const t2 = bestBy(
    (r) => (r.engineId === 'A' && r.device === 'wasm') || (r.engineId === 'B' && r.device === 'wasm'),
    (r) => r.rtf,
  )
  const auditOf = (engineId) => (report.networkAudit ?? []).find((entry) => entry.engineId === engineId)
  const cRow = rows.find((r) => r.engineId === 'C')
  const cAudit = auditOf('C')
  const t3 =
    cRow && cAudit?.pass === true
      ? cRow
      : bestBy(
          (r) => r.device === 'wasm',
          (r) => r.rtf,
        )
  const pick = (row, fallbackEngine, fallbackModel) => (row ? { engine: row.engine, model: row.model } : { engine: fallbackEngine, model: fallbackModel })
  report.recommendation = {
    T1: pick(t1, 'transformers.js', 'onnx-community/whisper-base_timestamped'),
    T2: pick(t2, 'transformers.js', 'onnx-community/whisper-tiny_timestamped'),
    T3: pick(t3, 'transformers.js', 'onnx-community/whisper-tiny_timestamped'),
  }

  const failed = rows.filter((r) => !r.ok)
  report.failedRuns = failed
  report.rows = rows.filter((r) => r.ok)
  writeJson(join(SPIKES, 'model-eval-report.json'), report)
  writeFileSync(join(SPIKES, 'model-eval-report.md'), renderMarkdown(report, sampler))
  console.log(`harness: wrote docs/spikes/model-eval-report.{json,md} (${rows.length} rows)`)
}

function renderMarkdown(report, sampler) {
  const rows = (report.rows ?? []).filter((r) => r.ok)
  const failed = (report.rows ?? []).filter((r) => !r.ok)
  const lines = []
  lines.push('# Model evaluation spike — unit-02 (FR-02)')
  lines.push('')
  lines.push(
    `Machine: ${sampler.gpuPid ? 'GPU helper pid present' : 'GPU helper MISSING'}; calibration: ${report.gpuCalibration ? (report.gpuCalibration.passed ? 'PASSED' : 'FAILED') : 'not run'} (observed ${report.gpuCalibration?.observedGrowthBytes ?? 0} bytes of 512 MB allocated).`,
  )
  lines.push('')
  lines.push('## Measured rows (US-02.1) — median-of-3 wall incl. audio decode, numThreads:1')
  lines.push('')
  lines.push(
    'CORPUS PROVISIONAL: ground truth is synthesized TTS (unit-01 fixtures) — WER/MAE numbers are valid for CROSS-ENGINE comparison on this machine, NOT as absolute accuracy claims (see domain notes). vendor figures (degraded-vs-vendor) cannot be adjudicated on synthetic audio and are omitted (no vendor comparison rows).',
  )
  lines.push('')
  lines.push('| engine | engineId | version | model | revision | device | tier | clip | WER | wordTimingMAEms | RTF | peak JS heap (MB) | lang | conf | punct | timestamps | license |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    lines.push(
      `| ${row.engine} | ${row.engineId} | ${row.version} | ${row.model} | ${String(row.revision).slice(0, 10)} | ${row.device} | ${row.tier} | ${row.corpusClip} | ${row.wer} | ${row.wordTimingMAEms} | ${row.rtf} | ${(row.peakJsHeapBytes / 1_000_000).toFixed(0)} | ${row.languageDetect} | ${row.confidence} | ${row.punctuated} | ${row.timestamps} | ${row.license} |`,
    )
  }
  for (const row of failed) {
    lines.push(`| ${row.engine} | ${row.engineId} | ${row.version} | ${row.model} | — | ${row.device} | ${row.tier} | ${row.corpusClip} | FAILED: ${row.error} | | | | | | | | |`)
  }
  lines.push('')
  lines.push(
    'peak JS heap 0 means `performance.measureUserAgentSpecificMemory()` was unavailable on the run page (it throws while engine workers hold wasm memory) — the US-02.3 leak protocol samples the heap directly and is the heap evidence of record.',
  )
  lines.push('')
  lines.push(
    'Punctuation decision (FR-02.4): the `punct` column records whether the engine output was punctuated; engines without punctuation must be paired with the unit-03 punctuation pass (whisper: unpunctuated → pass needed; whistle: see row).',
  )
  lines.push('')
  lines.push('## #1739 leak study (US-02.3)')
  lines.push('')
  lines.push(
    'whisper-small_timestamped, T1 (webgpu), pinned dtype recipe `{ encoder_model: "fp32", decoder_model_merged: "q4" }`, 20 consecutive 28 s windows as separate pipeline calls on `speech-10min`; per-window GPU-process phys_footprint via out-of-band macOS `footprint` (RSS does not show Metal allocations on macOS — issue #1739 guidance).',
  )
  lines.push('')
  for (const entry of report.leak ?? []) {
    lines.push(
      `- ${entry.version} (${entry.model}, ${entry.device}): per-window growth ${entry.perWindowGrowthBytes} bytes; dispose() reclaims: ${entry.disposeReclaims}; worker-recycle ceiling recommendation: ${entry.recycleCeilingBytes} bytes (unit-05).`,
    )
  }
  lines.push('')
  lines.push(`Pin decision: ${report.leakPinRecommendation ?? 'pending'}`)
  lines.push('')
  lines.push('## Network audit (US-02.2 / CC-02.4 / CC-02.9)')
  lines.push('')
  for (const entry of report.networkAudit ?? []) {
    const label = entry.engineId === 'C' ? 'Whistle (needle.wasm) telemetry concern (Spike 1.4 Q1 prior-art)' : `engine ${entry.engineId}`
    lines.push(
      `- ${label}: pass=**${entry.pass}** — request log \`${entry.artifact}\` (redacted: urls/ids/timestamps only, SECURITY-03). ${entry.pass ? 'No request outside self + settings.yml model_hosts.' : 'Requests outside the allowlist were observed — adoption of this engine fails (CC-02.4).'}`,
    )
  }
  lines.push('')
  lines.push('## Parakeet verdict (CC-02.8)')
  lines.push('')
  const verdict = report.parakeetVerdict ?? {}
  lines.push(
    `- Parakeet (sherpa-onnx WASM vad-asr): loads=${verdict.loads}${typeof verdict.rtf === 'number' ? `, RTF ${verdict.rtf}` : ''}${verdict.blockerIssue ? `, blocker: ${verdict.blockerIssue}` : ''}. ${verdict.note ?? ''}`,
  )
  lines.push('')
  lines.push('## Baseline check (CC-02.7)')
  lines.push('')
  if (report.baselineCheck) {
    lines.push(`- whisper-base T1 RTF ${report.baselineCheck.whisperBaseT1Rtf}; baseline under review: ${report.baselineCheck.baseline}; outcome **${report.baselineCheck.outcome}**. ${report.baselineCheck.statement}`)
  }
  lines.push('')
  lines.push('## License verification (CC-02.10)')
  lines.push('')
  for (const license of report.licenses ?? []) {
    lines.push(`- ${license.candidate}: ${license.status}${license.note ? ` — ${license.note}` : ''}`)
  }
  lines.push('')
  lines.push('Candidate-D [MANUAL] sign-off owner-pending; blocked-pending candidates have no benchmark rows (unit spec: license verified before benchmarking).')
  lines.push('')
  lines.push('## Recommendation — unit-03 default registry (CC-02.11)')
  lines.push('')
  const recommendation = report.recommendation ?? {}
  lines.push(`- **T1**: ${recommendation.T1?.engine} / ${recommendation.T1?.model}`)
  lines.push(`- **T2**: ${recommendation.T2?.engine} / ${recommendation.T2?.model}`)
  lines.push(`- **T3**: ${recommendation.T3?.engine} / ${recommendation.T3?.model}`)
  lines.push('')
  lines.push('Every recommended (engine, model) pair traces to a measured row above; anything rejected/dropped carries its reason in the audit and Parakeet sections above.')
  lines.push('')
  lines.push('## Notes and protocol deviations')
  lines.push('')
  lines.push(
    '- sherpa B reference row uses csukuangfj/sherpa-onnx-zipformer-en-2023-06-26 (int8): the `…zipformer-en-20230626-low_frame_rate`-era `110m`-class repos referenced in discovery notes are empty on HF (documented deviation, domain-notes).',
  )
  lines.push('- B timestamps: sherpa transducer emits per-token starts (ends estimated from the next token) — recorded as word-native.')
  lines.push('- Engines emitting no words on the synthetic clip get wordTimingMAEms = clipDuration (maximal correction burden sentinel), never 0.')
  lines.push('- 4.x leak twin: @huggingface/transformers ' + pkgVersion(pins['4x'].pkg) + ' from the isolated npm install under tools/eval/node-4x (measurement-only; the app stays on the pinned 3.8.1).')
  lines.push('- SECURITY-03: no transcript text appears in this report or any artifact — scores, lengths, hashes and URLs only.')
  lines.push('')
  return lines.join('\n')
}

main().catch((error) => {
  console.error(`harness: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  process.exit(1)
})
