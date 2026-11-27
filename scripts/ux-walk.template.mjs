#!/usr/bin/env node
// UX walkthrough harness — copy to .night/ux-<story>.mjs and fill STORY (docs/ops/ux-review-plan.md).
// Rules: live-DOM locators only (no src/ui/testing bridges), fixture content only, evidence per step.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const PORT = Number(process.env.UX_PORT ?? 4181)
const STORY = process.env.UX_STORY ?? 'J-00'
const DATE = new Date().toISOString().slice(0, 10)
const EVIDENCE = `docs/ux-review-evidence/${DATE}/${STORY}`
mkdirSync(EVIDENCE, { recursive: true })

const consoleLines = []
const networkFails = []
const verdicts = []
let stepNo = 0

const server = spawn('corepack', ['pnpm', 'preview', '--port', String(PORT)], { stdio: 'ignore' })
const stop = () => server.kill()
process.on('exit', stop)

const ctx = await chromium.launchPersistentContext(`.night/ux-profile-${PORT}`, {
  headless: process.env.UX_HEADED !== '1',
  viewport: { width: 1440, height: 900 },
  args: ['--use-fake-ui-for-media-stream'],
})
const page = await ctx.newPage()
page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 300)))
page.on('requestfailed', (r) => networkFails.push(`${r.failure()?.errorText} ${r.url().slice(0, 140)}`))

async function boot() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`)
      if (res.ok) break
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await page.goto(`http://127.0.0.1:${PORT}/`)
  await page.waitForLoadState('networkidle')
}

const GEOMETRY_AUDIT = () => {
  const problems = []
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  }
  const clipped = []
  for (const el of document.querySelectorAll('section, [class*=row], [class*=panel], [class*=tab], li, p, span')) {
    if (!el.textContent.trim() || !vis(el)) continue
    if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflow !== 'visible' && el.children.length <= 3)
      clipped.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), overflowPx: el.scrollHeight - el.clientHeight, text: el.textContent.trim().slice(0, 30) })
    const r = el.getBoundingClientRect()
    if (r.bottom > innerHeight + 4 && r.height > 0) clipped.push({ tag: 'off-viewport', cls: String(el.className).slice(0, 40), overflowPx: Math.round(r.bottom - innerHeight), text: el.textContent.trim().slice(0, 30) })
  }
  const interactive = [...document.querySelectorAll('button, [role=button], [role=tab], a, select, input')].filter(vis)
  const occluded = []
  for (const el of interactive) {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el))
      occluded.push({ blocked: (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30), by: `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 30)}` })
  }
  const panels = [...document.querySelectorAll('[role=tabpanel] > *, section')].filter(vis)
  const overlaps = []
  for (let i = 0; i < panels.length; i++)
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i].getBoundingClientRect(),
        b = panels[j].getBoundingClientRect()
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ox > 8 && oy > 8)
        overlaps.push({ a: panels[i].tagName + '.' + String(panels[i].className).slice(0, 25), b: panels[j].tagName + '.' + String(panels[j].className).slice(0, 25), ox: Math.round(ox), oy: Math.round(oy) })
    }
  return { clipped: clipped.slice(0, 15), occluded: occluded.slice(0, 15), panelOverlaps: overlaps.slice(0, 10) }
}

async function step(name, fn, expected) {
  stepNo += 1
  const tag = `step-${String(stepNo).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
  let actual = 'pass'
  let verdict = 'pass'
  try {
    const note = await fn()
    if (typeof note === 'string' && note.length > 0) actual = note
  } catch (err) {
    verdict = 'fail'
    actual = String(err).slice(0, 300)
  }
  const shot = `${EVIDENCE}/${tag}.png`
  await page.screenshot({ path: shot, fullPage: false })
  const geometry = await page.evaluate(GEOMETRY_AUDIT).catch(() => null)
  if (geometry && (geometry.clipped.length || geometry.occluded.length || geometry.panelOverlaps.length)) {
    writeFileSync(`${EVIDENCE}/${tag}-geometry.json`, JSON.stringify(geometry, null, 2))
    if (verdict === 'pass') actual = `geometry issues: ${geometry.clipped.length} clipped, ${geometry.occluded.length} occluded, ${geometry.panelOverlaps.length} overlaps`
  }
  verdicts.push({ story: STORY, step: stepNo, name, expected: expected ?? '', actual, verdict, evidence: shot, geometry })
  console.log(`[${STORY}] ${stepNo.toString().padStart(2)} ${verdict.toUpperCase().padEnd(4)} ${name}`)
  return verdict === 'pass'
}

console.log(`[ux-walk] story=${STORY} port=${PORT} evidence=${EVIDENCE}`)
await boot()

// --- FILL IN (agent): DOM-derived locators only. Example pattern:
// await step('open Transcribe popover', async () => {
//   await page.getByRole('button', { name: /Transcribe/ }).click()
//   const popover = page.getByRole('dialog')
//   if (!(await popover.isVisible())) return 'popover did not open'
// }, 'popover opens with model list')
//
// const rows = await page.locator('[role="row"], [data-testid^="transcript-row"]').count()

// --- FILL END ---

writeFileSync(`${EVIDENCE}/verdicts.json`, JSON.stringify(verdicts, null, 2))
writeFileSync(`${EVIDENCE}/console.txt`, consoleLines.join('\n'))
writeFileSync(`${EVIDENCE}/network-failed.txt`, networkFails.join('\n'))
console.log(`[ux-walk] ${verdicts.filter((v) => v.verdict === 'fail').length} failing of ${verdicts.length} → ${EVIDENCE}`)
if (process.env.UX_KEEP !== '1') await ctx.close()
stop()
process.exit(0)
