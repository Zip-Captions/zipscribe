// scripts/deploy-smoke.mjs — L7 smoke for PR-preview / staging / production
// (FR-1.0.13–16). Minimal qualification: the deployed app boots in chromium,
// renders the workbench shell, shows its build version, and logs zero console
// errors. Deeper smoke (import → transcribe → edit → export) lands with the
// UI units. Usage: node scripts/deploy-smoke.mjs <url>

import { chromium } from '@playwright/test'

const url = process.argv[2]
if (!url || !/^https?:\/\//.test(url)) {
  console.error('usage: node scripts/deploy-smoke.mjs <url>')
  process.exit(2)
}

const browser = await chromium.launch()
const failures = []
try {
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  if (!response || !response.ok()) failures.push(`document response ${response ? response.status() : 'no response'}`)
  try {
    await page.waitForSelector('[data-testid="workbench-shell"]', { timeout: 15_000 })
  } catch {
    failures.push('workbench shell did not render')
  }
  const version = await page.$eval('[data-testid="build-info"]', (el) => el.textContent).catch(() => null)
  if (!version || !version.trim()) failures.push('build-info version is not visible')
  if (consoleErrors.length > 0) {
    failures.push(`${consoleErrors.length} console error(s); first: ${consoleErrors[0]?.slice(0, 200)}`)
  }
} finally {
  await browser.close()
}

if (failures.length > 0) {
  for (const f of failures) console.error(`deploy-smoke: ${f}`)
  console.error(`deploy-smoke: FAILED ${url}`)
  process.exit(1)
}
console.log(`deploy-smoke: OK — ${url}`)
