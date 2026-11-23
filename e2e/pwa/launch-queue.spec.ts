// CC-204.7 (L5, chromium): US-204.5 — opening a media file from the OS via
// `launchQueue` (File Handling, registered in the manifest by CC-204.1's
// file_handlers leg). Chromium only (the only launchQueue engine; design.md
// § Offline & install).
//
// Simulated launchQueue (binding choice from the criterion: "simulated
// launchQueue in test"): addInitScript installs a launchQueue stand-in BEFORE
// app boot that captures the consumer the app registers; the test then
// delivers a LaunchParams carrying a real File (taxi fixture bytes, decoded
// from base64 in-page — no network). The app must route it through its
// normal file-open path (project created from the drop-zone/import machinery,
// ProjectList row named after the file). Unsupported-engine path is
// approximated with a launchQueue that reads as absent: the app boots and
// stays usable with zero page errors (a missing launchQueue must never throw
// at startup).
import { expect, test } from '@playwright/test'
import {
  attachSecurityGuards,
  CHILD,
  CHILD_REASON,
  openAppWithBridges,
  PREVIEW_BASE,
  projectRows,
  taxiBytesBase64,
  warmShell,
} from './helpers/pwa-harness'

const FILE_NAME = 'launch-queue-taxi.mp4'

test.describe('CC-204.7: launchQueue file open (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test('CC-204.7: OS file open via launchQueue creates a project named after the file', async ({ page, context }) => {
    test.setTimeout(120_000)
    await context.addInitScript(() => {
      // Install the queue BEFORE app code runs; capture the registered
      // consumer so the test can deliver a LaunchParams (MDN:
      // https://developer.mozilla.org/en-US/docs/Web/API/LaunchQueue).
      Object.defineProperty(window, 'launchQueue', {
        configurable: true,
        get: () => ({
          setConsumer: (consumer: (params: unknown) => void) => {
            ;(window as unknown as Record<string, unknown>).__zipLaunchConsumer = consumer
          },
        }),
      })
    })
    const audit = attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await openAppWithBridges(page)

    await expect
      .poll(() => page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__zipLaunchConsumer), 'the app registers a launchQueue consumer at boot (US-204.5)')
      .toBe('function')

    const b64 = taxiBytesBase64()
    await page.evaluate(async ({ name, b64: data }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
      const file = new File([bytes], name, { type: 'video/mp4' })
      const consumer = (window as unknown as Record<string, ((params: unknown) => void) | undefined>).__zipLaunchConsumer
      if (typeof consumer !== 'function') throw new Error('launchQueue consumer was never registered')
      consumer({ files: [{ getFile: async () => file }] })
    }, { name: FILE_NAME, b64 })

    await expect
      .poll(async () => (await projectRows(page)).some((row) => /launch-queue-taxi/iu.test(row.name)), `launching with ${FILE_NAME} opens it straight into a project`)
      .toBe(true)
    expect(audit.external, 'file-open touched no non-allowlisted host').toEqual([])
    expect(audit.modelHost, 'opening a file does not fetch models').toEqual([])
  })

  test('CC-204.7: engine without launchQueue support boots cleanly', async ({ page, context }) => {
    test.setTimeout(60_000)
    await context.addInitScript(() => {
      // Approximates the unsupported engine (real absence is unreachable in
      // Chromium): the property reads as undefined, so a `?.`-less consumer
      // registration would throw at boot.
      Object.defineProperty(window, 'launchQueue', { configurable: true, get: () => undefined })
    })
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    // No SW wait here: this leg only proves BOOT tolerates a missing
    // launchQueue — the shell appearing (not the SW) is the precondition.
    await page.goto(`${PREVIEW_BASE}/?ziptest=1`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('workbench-shell')).toBeVisible({ timeout: 20_000 })
    expect(errors.map((error) => error.message), 'a missing launchQueue must never break boot').toEqual([])
  })
})
