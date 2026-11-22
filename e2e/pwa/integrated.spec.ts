// CC-204.8 (L5, chromium): the integrated unit-204 journey in ONE session on
// the production build — installable shell online → offline work (shell
// reload, chip, project edit + autosave, sidecar export) → update prompt →
// offline models panel — with the request audit clean throughout. The
// per-criterion specs (installability, offline, cache-policy, update,
// models-panel, launch-queue) own the depth; this one owns the seams: that
// the flows compose in a single running app (the "all gates green incl.
// pnpm test:e2e" criterion's e2e witness for the unit as a whole).
import { expect, test } from '@playwright/test'
import { startDualRootServer, stageBuilds, triggerUpdateCheck, type DualRootServer } from './helpers/dual-root-preview'
import {
  attachSecurityGuards,
  CANARY_BLOCKS,
  CHILD,
  CHILD_REASON,
  ensurePrecache,
  openAppWithBridges,
  openProjectWithLocalMedia,
  projectRows,
  TAXI_FINGERPRINT,
  taxiBytesBase64,
  warmShell,
} from './helpers/pwa-harness'
import { TAXI_ASSET } from '../export/helpers/export-harness'

const INTEGRATED_PORT = 4317 // distinct from update.spec's 4316 (parallel workers)

test.describe('CC-204.8: integrated offline PWA journey (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  let server: DualRootServer

  test.beforeAll(async () => {
    const { distA, distB } = stageBuilds()
    server = await startDualRootServer(INTEGRATED_PORT, distA, distB)
  })

  test.afterAll(async () => {
    await server?.close()
  })

  test('CC-204.8: shell → offline work → update prompt → models panel, audit clean end to end', async ({ page, context }) => {
    test.setTimeout(300_000)
    const base = server.url
    const audit = attachSecurityGuards(context, page)

    // 1. First visit (online): the SW installs and takes control; precache
    //    is populated. (Installability itself: installability.spec.ts.)
    await warmShell(page, base, '/?ziptest=1')
    await ensurePrecache(page)
    await openAppWithBridges(page, base)
    const id = await openProjectWithLocalMedia(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: CANARY_BLOCKS,
      name: 'integrated-journey',
      fingerprint: TAXI_FINGERPRINT,
      fileBytesBase64: taxiBytesBase64(),
      fileType: 'video/mp4',
    })

    // 2. Go offline: reload the shell, see the chip, edit + autosave, export.
    audit.reset()
    await context.setOffline(true)
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('workbench-shell'), 'shell served by the SW offline').toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('Offline', { exact: true }), 'Offline chip while disconnected').toBeVisible({ timeout: 10_000 })

    await openAppWithBridges(page, base)
      await page.getByTestId(`project-open-${id}`).click()
      const before = (await projectRows(page)).find((row) => row.id === id)?.updatedAt ?? 0
      await page.evaluate(() => (window as unknown as { __zipEditorBridge?: { setProjectName(n: string): void } }).__zipEditorBridge?.setProjectName('integrated-offline-edit'))
      await expect
        .poll(async () => (await projectRows(page)).find((row) => row.id === id)?.updatedAt ?? 0, { message: 'offline autosave reaches IndexedDB', timeout: 30_000 })
        .toBeGreaterThan(before)

      await page.getByTestId('export-button').click()
      await expect(page.getByTestId('export-dialog')).toBeVisible()
      await page.getByTestId('sidecar-format-srt').click()
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByTestId('sidecar-save').click()])
      expect(download.suggestedFilename(), 'sidecar export works offline').toMatch(/\.srt$/u)
      // Clean up the in-memory download (Chromium defers navigation while a
      // download is pending — it would otherwise stall the update Reload click).
      await download.delete()
      await page.getByTestId('export-close').click()
      await expect(page.getByTestId('export-dialog')).toHaveCount(0)

      expect(audit.bypassedSw, 'the offline leg issued zero network requests').toEqual([])
      expect(audit.modelHost, 'the offline leg issued zero model-host attempts').toEqual([])
    } finally {
    await context.setOffline(false)
    }
    await expect(page.getByText('Offline', { exact: true }), 'chip clears on reconnect').toHaveCount(0, { timeout: 10_000 })

    // 3. Update prompt: deploy build B, prompt toast, reload into B.
    server.deploy('b')
    await triggerUpdateCheck(page)
    await expect(page.getByText(/new version ready/iu), 'update toast after deploy').toBeVisible({ timeout: 60_000 })
    const reloads = page.waitForNavigation({ timeout: 60_000 }).catch(() => undefined)
    await page.getByRole('button', { name: /reload/iu }).click()
    await reloads
    await page.waitForFunction(() => document.documentElement.innerHTML.includes('zipscribe-e2e-build-B'), undefined, { timeout: 30_000 })

    // 4. Offline models panel on the updated build.
    await openAppWithBridges(page, base)
    await page.getByRole('button', { name: '⋯' }).click()
    await page.getByRole('menuitem', { name: /offline models/iu }).click()
    await expect(page.getByText(/whisper-tiny/iu), 'models panel lists registry models post-update').toBeVisible({ timeout: 15_000 })

    // Audit across the WHOLE journey.
    expect(audit.external, 'no non-allowlisted host at any point').toEqual([])
    expect(audit.cspViolations, 'no CSP violations against the built output').toEqual([])
    expect(audit.canaryLeaks(), 'SECURITY-03: canary transcript text never reaches the console').toEqual([])
  })
})
