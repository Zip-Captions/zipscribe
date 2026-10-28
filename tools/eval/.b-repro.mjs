import { spawn } from 'node:child_process'
const repoRoot = '/Users/oblivious/Documents/zipscribe'
const pw = await import('file:///Users/oblivious/Documents/zipscribe/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.js')
const chromium = pw.chromium ?? pw.default.chromium
const server = spawn(process.execPath, ['scripts/preview.mjs', '--port', '4186', '--strictPort'], { cwd: repoRoot, env: { ...process.env, ZIPSCRIBE_ISOLATED: '1' }, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))
const ctx = await chromium.launchPersistentContext('/tmp/zs-b-udd-' + Date.now(), { headless: false, args: ['--headless=new', '--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await ctx.newPage()
page.on('response', (r) => {
  if (r.status() >= 400) console.log('404>', r.url())
})
page.on('requestfailed', (r) => console.log('RF>', r.url()))
page.on('console', (m) => console.log('PAGE>', m.type(), m.text().slice(0, 200)))
page.on('pageerror', (e) => console.log('PAGEERR>', String(e).slice(0, 200)))
await page.exposeFunction('__bProgress', (s) => console.log('B-STAGE>', s))
await page.addInitScript(() => {
  /* progress via console */
})
await page.goto('http://localhost:4186/tools/eval/pages/engine-b.html')
await page.waitForFunction(() => window.__zipscribeEval !== undefined, null, { timeout: 20000 })
console.log('B page ready')
// worker 'progress' messages are swallowed by the page bridge — mirror them via console in the worker

const reg = (await import('node:fs')).readFileSync('models/eval-registry.json', 'utf8')
const models = JSON.parse(reg).models
const z = models['sherpa-zipformer-en-int8']
const files = z.files.map((f) => ({ url: `http://localhost:4186/hf-cache/${z.repo}/${f.path}`, name: f.path }))
const sv = models['silero-vad']
const t0 = Date.now()
const load = await Promise.race([
  page.evaluate((o) => window.__zipscribeEval.load(o), { modelFiles: files, vadFile: 'silero.onnx', maxWindowSeconds: 28, vadUrl: `http://localhost:4186/hf-cache/${sv.repo}/${sv.files[0].path}` }),
  new Promise((_, rej) => setTimeout(() => rej(new Error('B load hang 180s')), 180000)),
])
console.log('B LOAD', Date.now() - t0, JSON.stringify(load).slice(0, 200))
if (load.ok) {
  const run = await Promise.race([page.evaluate(() => window.__zipscribeEval.run('/fixtures/taxi-en-technical.mp4', {})), new Promise((_, rej) => setTimeout(() => rej(new Error('B run hang 120s')), 120000))])
  console.log('B RUN', JSON.stringify({ ok: run.ok, wallMs: run.wallMs, err: run.error, seg: run.segmentCount, textLen: (run.output?.text ?? '').length }))
  const run2 = await Promise.race([page.evaluate(() => window.__zipscribeEval.run('/eval-tmp/voice.m4a', {})), new Promise((_, rej) => setTimeout(() => rej(new Error('B run2 hang 120s')), 120000))])
  console.log('B RUN2', JSON.stringify({ ok: run2.ok, wallMs: run2.wallMs, err: run2.error, seg: run2.segmentCount, text: (run2.output?.text ?? '').slice(0, 90) }))
}
await ctx.close()
server.kill('SIGKILL')
process.exit(0)
