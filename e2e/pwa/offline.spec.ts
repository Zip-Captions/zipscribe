// CC-204.2 (L5, chromium): the US-204.2 offline contract on the production
// build — one visit installs the SW; then with the network disabled the shell
// loads from cache, projects open from IndexedDB, edits autosave, sidecar
// exports download, burn-in export runs (lazy chunks precached), and
// transcription runs offline with an offline-ready model at zero network —
// while an uncached model fast-fails with OFFLINE_MODEL_MISSING (no spinner,
// no fetch). CC-204.3: the request audit on the offline run sees ZERO network
// attempts (domain invariant: App job lifecycle — offline + model absent →
// OFFLINE_MODEL_MISSING notice, "never a hang"; unit-03 manager short-circuits
// BEFORE fetch).
//
// Offline mechanism: context.setOffline(true) after the page is SW-controlled
// (helpers/pwa-harness warmShell). Model bytes come ONLY from the local model
// cache (.cache/models/, pnpm models:fetch — a setup step) via the shared
// e2e/asr route spy; nothing downloads at test time (settings.yml
// testing.determinism). SECURITY-03: seeded caption text carries the canary
// marker; console/request channels are scanned for it.
import { expect, test } from '@playwright/test'
import { assertModelCachePresent, routeAsrNetwork, type NetworkCounters } from '../asr/helpers/asr'
import { openExportProject, SIDECAR_ASSET, SIDECAR_NAME, SIDECAR_SLUG, TAXI_ASSET } from '../export/helpers/export-harness'
import {
  attachSecurityGuards,
  CANARY_BLOCKS,
  CHILD,
  CHILD_REASON,
  editorBlockCount,
  ensurePrecache,
  openAppWithBridges,
  openProjectWithLocalMedia,
  PREVIEW_BASE,
  projectRows,
  saveState,
  startTranscription,
  TAXI_FINGERPRINT,
  taxiBytesBase64,
  warmShell,
} from './helpers/pwa-harness'

test.describe('CC-204.2: offline after first visit (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test('CC-204.2: shell loads from cache offline — precached, zero network, CSP clean', async ({ page, context }) => {
    test.setTimeout(120_000)
    const audit = attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/')
    await ensurePrecache(page)
    audit.reset()

    await context.setOffline(true)
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('workbench-shell')).toBeVisible({ timeout: 20_000 })
      // The document itself must have been answered by the SW, not the wire.
      expect(audit.bypassedSw, 'offline reload reached NO network (everything SW-served)').toEqual([])
      expect(audit.modelHost, 'no model-host activity on the offline boot').toEqual([])
      expect(audit.external, 'zero non-allowlisted hosts').toEqual([])
      expect(audit.cspViolations, 'no CSP violations against the built output').toEqual([])
    } finally {
      await context.setOffline(false)
    }
  })

  test('CC-204.2: Offline chip shows offline, disappears online, tooltip lists what works', async ({ page, context }) => {
    test.setTimeout(90_000)
    attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/')
    const chip = page.getByText('Offline', { exact: true })
    await expect(chip, 'online: no offline chip (product.md rule 4)').toHaveCount(0)

    await context.setOffline(true)
    try {
      await expect(chip, 'the Offline chip appears next to the tier chip (design.md § Offline & install)').toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('tier-chip'), 'the chip sits in the header beside the tier chip').toBeVisible()
      const tooltip = await chip.evaluate((el) => {
        const title = el.getAttribute('title')
        if (title !== null && title !== '') return title
        const sibling = el.parentElement?.querySelector('[role=tooltip]')
        return sibling?.textContent ?? el.parentElement?.textContent ?? ''
      })
      expect(tooltip.trim().length, 'tooltip lists what still works (design.md: "tooltip listing what works")').toBeGreaterThan('Offline'.length + 4)
    } finally {
      await context.setOffline(false)
    }
    await expect(chip, 'chip disappears on reconnect').toHaveCount(0, { timeout: 10_000 })
  })

  test('CC-204.2: existing project opens offline and edits autosave to IndexedDB', async ({ page, context }) => {
    test.setTimeout(180_000)
    const audit = attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await ensurePrecache(page)
    await openAppWithBridges(page)
    const id = await openProjectWithLocalMedia(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: CANARY_BLOCKS,
      name: 'offline-project',
      fingerprint: TAXI_FINGERPRINT,
      fileBytesBase64: taxiBytesBase64(),
      fileType: 'video/mp4',
    })
    const before = (await projectRows(page)).find((row) => row.id === id)?.updatedAt ?? 0
    audit.reset()

    await context.setOffline(true)
    try {
      // Re-enter from the project list: a fresh offline navigation to the app,
      // then open the stored project (real IndexedDB, not a mock).
      await openAppWithBridges(page)
      await expect(page.getByTestId(`project-open-${id}`), 'the project list renders from IndexedDB offline').toBeVisible({ timeout: 15_000 })
      await page.getByTestId(`project-open-${id}`).click()
      await expect.poll(() => editorBlockCount(page), 'the existing project opens offline with its blocks').toBeGreaterThan(0)

      // Edit (real rename command through the bridge) → autosave (2 s idle)
      // must reach IndexedDB with zero network.
      await page.evaluate((name) => (window as unknown as { __zipEditorBridge?: { setProjectName(n: string): void } }).__zipEditorBridge?.setProjectName(name), 'offline-edited')
      await expect
        .poll(async () => (await projectRows(page)).find((row) => row.id === id)?.updatedAt ?? 0, 'autosave wrote the edit while offline')
        .toBeGreaterThan(before)
      await expect.poll(() => saveState(page), 'save state reports saved').toBe('saved')
      expect(audit.bypassedSw, 'open + edit + autosave reached NO network').toEqual([])
      expect(audit.modelHost, 'no model-host attempts in the offline editing leg').toEqual([])
      expect(audit.external, 'no non-allowlisted hosts').toEqual([])
    } finally {
      await context.setOffline(false)
    }
  })

  test('CC-204.2: sidecar export downloads offline (lazy chunk served by the SW)', async ({ page, context }) => {
    test.setTimeout(180_000)
    const audit = attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await ensurePrecache(page)
    await openExportProject(page, {
      asset: SIDECAR_ASSET,
      src: '/fixtures/audio/speech-2min.m4a',
      blocks: CANARY_BLOCKS,
      name: SIDECAR_NAME,
      language: 'en',
    })
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()
    audit.reset()

    await context.setOffline(true)
    try {
      await page.getByTestId('sidecar-format-srt').click()
      await page.getByTestId('sidecar-track').selectOption('source')
      await page.getByTestId('sidecar-speaker-labels').selectOption('off')
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByTestId('sidecar-save').click()])
      expect(download.suggestedFilename(), 'sidecar filename derives from the project slug').toBe(`${SIDECAR_SLUG}.srt`)
      const path = await download.path()
      if (path === null) throw new Error('download has no path')
      expect(audit.bypassedSw, 'the sidecar path (incl. its lazy chunk) ran with zero network').toEqual([])
      expect(audit.modelHost, 'no model-host attempts in the offline export leg').toEqual([])
      // SECURITY-03: the export body is the app's own data path (marker in it
      // is the feature); the audit channel is the console — scanned below.
      expect(audit.canaryLeaks(), 'canary text never reaches the console').toEqual([])
    } finally {
      await context.setOffline(false)
    }
  })

  test('CC-204.2: burn-in export runs offline (worker + mediabunny chunks precached)', async ({ page, context }) => {
    test.setTimeout(300_000)
    const audit = attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await ensurePrecache(page)
    await openExportProject(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: CANARY_BLOCKS,
      name: 'burnin-offline',
      mediaBytes: { path: '/fixtures/taxi-en-accented-1.mp4', type: 'video/mp4' },
    })
    await page.getByTestId('export-button').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()
    audit.reset()

    await context.setOffline(true)
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 180_000 }),
        page.getByTestId('burnin-start').click(),
      ])
      const path = await download.path()
      if (path === null) throw new Error('burn-in download has no path')
      expect(download.suggestedFilename(), 'burn-in delivers an MP4').toMatch(/\.mp4$/u)
      expect(audit.bypassedSw, 'burn-in (export worker + mediabunny lazy chunks, per FR-204.2) ran with zero network').toEqual([])
      expect(audit.modelHost, 'no model-host attempts in the offline burn-in leg').toEqual([])
    } finally {
      await context.setOffline(false)
    }
  })

  test('CC-204.2: offline-ready tiny model transcribes offline with ZERO network requests', async ({ page, context }) => {
    test.skip(!assertModelCachePresentSafe(), 'model cache missing — run `pnpm models:fetch` (setup step)')
    test.setTimeout(420_000)
    const audit = attachSecurityGuards(context, page)
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeAsrNetwork(page, PREVIEW_BASE, counters)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await ensurePrecache(page)
    await openAppWithBridges(page)
    await openProjectWithLocalMedia(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: CANARY_BLOCKS,
      name: 'offline-transcribe',
      fingerprint: TAXI_FINGERPRINT,
      fileBytesBase64: taxiBytesBase64(),
      fileType: 'video/mp4',
    })

    // Warm leg (online, model bytes served from the LOCAL cache through the
    // HF route — the user's explicit "download on first use"): this is what
    // makes the model offline-ready.
    await startTranscription(page)
    await expect(page.getByTestId('status-bar'), 'the job runs').toContainText('transcribing', { timeout: 30_000 })
    await expect(page.getByTestId('status-bar'), 'the job completes').toContainText(/no model/, { timeout: 300_000 })
    await expect(page.getByTestId('job-error')).toHaveCount(0)
    await expect.poll(() => editorBlockCount(page), 'the online warm run produced blocks').toBeGreaterThan(0)
    expect(counters.modelHost, 'the warm run fetched the model through the (cache-served) model-host route').toBeGreaterThan(0)
    expect(counters.blocked, 'the warm run touched no non-allowlisted origin').toEqual([])

    // Offline leg: same model, now offline-ready — zero network attempts.
    audit.reset()
    await context.setOffline(true)
    try {
      await startTranscription(page)
      await expect(page.getByTestId('status-bar'), 'the offline job runs').toContainText('transcribing', { timeout: 30_000 })
      await expect(page.getByTestId('status-bar'), 'the offline job completes with no network').toContainText(/no model/, { timeout: 300_000 })
      await expect(page.getByTestId('job-error')).toHaveCount(0)
      await expect.poll(() => editorBlockCount(page), 'the offline run produced blocks').toBeGreaterThan(0)
      expect(audit.modelHost, 'CC-204.2/US-204.2: the cached-model offline run made ZERO model-host requests').toEqual([])
      expect(audit.bypassedSw, 'the offline transcription reached NO network at all').toEqual([])
      expect(audit.external, 'no non-allowlisted hosts').toEqual([])
      expect(audit.canaryLeaks(), 'canary text never reaches the console').toEqual([])
    } finally {
      await context.setOffline(false)
    }
  })

  test('CC-204.2: offline + uncached model → OFFLINE_MODEL_MISSING fast-fail, no spinner, no fetch', async ({ page, context }) => {
    test.setTimeout(150_000)
    const audit = attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await ensurePrecache(page)
    await openAppWithBridges(page)
    await openProjectWithLocalMedia(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: CANARY_BLOCKS,
      name: 'offline-missing',
      fingerprint: TAXI_FINGERPRINT,
      fileBytesBase64: taxiBytesBase64(),
      fileType: 'video/mp4',
    })
    audit.reset()

    await context.setOffline(true)
    try {
      // Fresh context: this model was NEVER downloaded (models only ever
      // download on explicit action) — the fast-fail must arrive WITHOUT a
      // fetch attempt and WITHOUT a spinner (domain App lifecycle: "never a
      // hang"; US-204.2: "immediately (no spinner)").
      await page.getByTestId('transcribe-button').click()
      await expect(page.getByTestId('transcribe-popover')).toBeVisible()
      await page.locator('[data-testid=transcribe-model-option][data-model-id*="whisper-tiny"]').click()
      await page.getByTestId('replace-captions-button').click()

      await expect(page.getByTestId('job-error'), 'the coded fast-fail surfaces immediately').toHaveText('NETWORK', { timeout: 5_000 })
      await expect(
        page.getByTestId('transcribe-popover').getByText(/make available offline/iu),
        'US-204.2: the popover suggests "Make available offline" for next time',
      ).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId('streaming-segment-row'), 'no spinner: no streaming rows ever appear').toHaveCount(0)
      expect(audit.modelHost, 'the missing model short-circuits BEFORE fetch — zero model-host attempts').toEqual([])
      expect(audit.bypassedSw, 'the fast-fail reached no network').toEqual([])
      expect(audit.canaryLeaks(), 'canary text never reaches the console').toEqual([])
    } finally {
      await context.setOffline(false)
    }
  })
})

test.describe('CC-204.3: request audit on the offline run — zero network attempts (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test('CC-204.3: full offline session (shell + project + edit + sidecar) issues zero network requests', async ({ page, context }) => {
    test.setTimeout(240_000)
    const audit = attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await ensurePrecache(page)
    await openAppWithBridges(page)
    await openProjectWithLocalMedia(page, {
      asset: TAXI_ASSET,
      src: '/fixtures/taxi-en-accented-1.mp4',
      blocks: CANARY_BLOCKS,
      name: 'audit-project',
      fingerprint: TAXI_FINGERPRINT,
      fileBytesBase64: taxiBytesBase64(),
      fileType: 'video/mp4',
    })
    audit.reset()

    await context.setOffline(true)
    try {
      await openAppWithBridges(page) // offline navigation (navigateFallback)
      await expect(page.getByTestId('workbench-shell')).toBeVisible({ timeout: 20_000 })
      const rows = await projectRows(page)
      expect(rows.length, 'projects are listed from IndexedDB').toBeGreaterThan(0)
      await page.getByTestId(`project-open-${rows[0]?.id ?? ''}`).click()
      await expect.poll(() => editorBlockCount(page)).toBeGreaterThan(0)
      await page.getByTestId('export-button').click()
      await expect(page.getByTestId('export-dialog')).toBeVisible()
      await page.getByTestId('sidecar-format-srt').click()
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByTestId('sidecar-save').click()])
      expect(download.suggestedFilename(), 'the sidecar downloaded offline').toMatch(/\.srt$/u)

      // THE audit (CC-204.3): every request event the offline session emitted,
      // classified. Allowed: nothing. Even model-host attempts must have been
      // short-circuited before fetch (they simply never appear).
      expect(audit.bypassedSw, 'zero requests reached the network (all SW/memory-served)').toEqual([])
      expect(audit.modelHost, 'zero model-host attempts (short-circuited before fetch)').toEqual([])
      expect(audit.external, 'zero non-allowlisted hosts').toEqual([])
      expect(audit.cspViolations, 'no CSP violations against the built output').toEqual([])
      expect(audit.canaryLeaks(), 'SECURITY-03: canary transcript text never reaches any console channel').toEqual([])
    } finally {
      await context.setOffline(false)
    }
  })
})

function assertModelCachePresentSafe(): boolean {
  try {
    assertModelCachePresent()
    return true
  } catch {
    return false
  }
}
