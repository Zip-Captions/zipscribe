// CC-204.4 (L5, chromium): the SW update flow on the PRODUCTION build.
// Deploy build A → open → deploy build B → toast "New version ready — Reload"
// → clicking flushes autosave THEN skipWaiting+reload; ignoring it (or
// pressing Later) keeps the old version with the waiting worker parked —
// NEVER an auto-reload (registerType: 'prompt'; design.md § Offline & install).
//
// Two-build mechanism (documented choice): a spec-owned single-origin static
// server (helpers/dual-root-preview) serves staged copies of the root build
// from <repo>/.night/, and flips which one is "deployed". Route interception
// is NOT an option — the SW main-script update fetch cannot be routed
// (https://playwright.dev/docs/service-workers "Known Limitations",
// microsoft/playwright#14711) — and interception replacing SW behaviour would
// mock away the unit under test. Registration, the byte-compared update
// check, the waiting worker, skipWaiting and the reload all run the REAL
// machinery.
//
// FR-204.6 (verification half): the preview server must answer /sw.js and
// /manifest.webmanifest with the public/_headers no-cache entries (a stale
// cached sw.js is exactly what strands an update).
import { expect, test } from '@playwright/test'
import { startDualRootServer, stageBuilds, triggerUpdateCheck, type DualRootServer } from './helpers/dual-root-preview'
import {
  attachSecurityGuards,
  CANARY_BLOCKS,
  CHILD,
  CHILD_REASON,
  openAppWithBridges,
  openProjectWithLocalMedia,
  PREVIEW_BASE,
  projectRows,
  TAXI_FINGERPRINT,
  taxiBytesBase64,
  warmShell,
} from './helpers/pwa-harness'
import { TAXI_ASSET } from '../export/helpers/export-harness'

const UPDATE_PORT = 4316 // spec-owned (root 4310 / model 4311 / memory 4312 / asr 4313-14 / diar 4315)

const TOAST_TEXT = /new version ready/iu
const RELOAD_BUTTON = { name: /reload/iu } as const
const LATER_BUTTON = { name: /later/iu } as const

test.describe('CC-204.4: SW update — prompt toast, click flushes autosave, never auto-reloads (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  let server: DualRootServer

  test.beforeAll(async () => {
    const { distA, distB } = stageBuilds()
    server = await startDualRootServer(UPDATE_PORT, distA, distB)
  })

  test.afterAll(async () => {
    await server?.close()
  })

  async function openInstalled(page: import('@playwright/test').Page): Promise<void> {
    await warmShell(page, server.url, '/?ziptest=1')
  }

  test('CC-204.4: deploy B while open → toast → click flushes autosave THEN reloads into build B', async ({ page, context }) => {
    test.setTimeout(240_000)
    const audit = attachSecurityGuards(context, page)
    server.deploy('a') // deterministic start (tests share the one staged server)
    await openInstalled(page)
    // A real persisted project is the witness for "flushed before reload".
    await openAppWithBridges(page, server.url)
    const id = await openProjectWithLocalMedia(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: CANARY_BLOCKS,
      name: 'update-baseline',
      fingerprint: TAXI_FINGERPRINT,
      fileBytesBase64: taxiBytesBase64(),
      fileType: 'video/mp4',
    })

    // "Deploy" build B, then ask the browser to re-check (the real update
    // fetch; the server now answers /sw.js with B's bytes).
    server.deploy('b')
    await triggerUpdateCheck(page)
    await expect(page.getByText(TOAST_TEXT), 'waiting worker surfaces the prompt toast (US-204.4)').toBeVisible({ timeout: 60_000 })

    // No reload without the click (asserted from the page side AND by the
    // survival of an in-page sentinel below).
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>).__zipNoReloadSentinel = true
    })
    await page.waitForTimeout(3_000)
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__zipNoReloadSentinel === true),
      'the page was NEVER reloaded without the click',
    ).toBe(true)
    await expect(page.getByText(TOAST_TEXT), 'the toast stays until decided').toBeVisible()

    // Dirty edit → click "Reload" → autosave must flush BEFORE skipWaiting +
    // reload: after the reload the stored row carries the edit (only the
    // autosave writes rows; a pre-flush reload would leave updatedAt stale).
    const before = (await projectRows(page)).find((row) => row.id === id)?.updatedAt ?? 0
    await page.evaluate(() => (window as unknown as { __zipEditorBridge?: { setProjectName(n: string): void } }).__zipEditorBridge?.setProjectName('flushed-before-reload'))
    const reloads = page.waitForNavigation({ timeout: 60_000 }).catch(() => undefined)
    await page.getByRole('button', RELOAD_BUTTON).click()
    await reloads
    await page.waitForFunction(
      () => document.documentElement.innerHTML.includes('zipscribe-e2e-build-B'),
      undefined,
      { timeout: 30_000 },
    )
    // The bridge must survive the reload into B (same origin, ziptest query)
    // so the row read below is against the freshly reloaded app.
    await openAppWithBridges(page, server.url)
    const after = (await projectRows(page)).find((row) => row.id === id)?.updatedAt ?? 0
    expect(after, 'the click flushed the autosave BEFORE skipWaiting+reload (US-204.4)').toBeGreaterThan(before)
    const waiting = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting ?? null)
    expect(waiting, 'the updated SW took control after the click').toBeNull()
    expect(audit.external, 'update flow touched no non-allowlisted host').toEqual([])
  })

  test('CC-204.4: Later does not reload; the old SW keeps controlling with the worker parked', async ({ page, context }) => {
    test.setTimeout(180_000)
    attachSecurityGuards(context, page)
    server.deploy('a') // deterministic start — an update needs A→B bytes, and A is what this test opens
    await openInstalled(page)

    server.deploy('b')
    await triggerUpdateCheck(page)
    await expect(page.getByText(TOAST_TEXT)).toBeVisible({ timeout: 60_000 })
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>).__zipNoReloadSentinel = true
    })

    await page.getByRole('button', LATER_BUTTON).click()
    await page.waitForTimeout(5_000)
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__zipNoReloadSentinel === true),
      'Later never auto-reloads (registerType: prompt — design.md)',
    ).toBe(true)
    const stillA = await page.evaluate(() => !document.documentElement.innerHTML.includes('zipscribe-e2e-build-B'))
    expect(stillA, 'the old version keeps running').toBe(true)
    // Review r1 (finding 5): assert the waiting registration ITSELF — the
    // previous `evaluate(... !== null)` compared inside the page and passed
    // vacuously on `undefined !== null` when no registration existed.
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting ?? null)).not.toBeNull()
  })

  test('CC-204.4 (FR-204.6): the preview server answers /sw.js and /manifest.webmanifest no-cache', async ({ page, request }) => {
    test.setTimeout(60_000)
    await page.goto(`${PREVIEW_BASE}/`)
    for (const path of ['/sw.js', '/manifest.webmanifest']) {
      const response = await request.get(`${PREVIEW_BASE}${path}`)
      expect(response.status(), `${path} must exist on the production build (FR-204.1/FR-204.6 — RED until vite-plugin-pwa lands)`).toBe(200)
      const cacheControl = response.headers()['cache-control'] ?? ''
      // public/_headers entries this unit self-provides (FR-204.6): a cached
      // sw.js must revalidate, never be served stale (stale-SW risk).
      expect(cacheControl, `${path} Cache-Control carries max-age=0 (public/_headers)`).toContain('max-age=0')
      expect(cacheControl, `${path} Cache-Control carries must-revalidate (public/_headers)`).toContain('must-revalidate')
    }
  })
})
