// ADVERSARY (unit-204, category: empty/absent/degenerate inputs + SECURITY-03)
// — the `launchQueue` consumer (CC-204.7 / US-204.5) driven with hostile
// LaunchParams the OS could hand it. The frozen launch-queue.spec pins the
// happy delivery (taxi mp4 → project row) and the missing-API boot. This file
// feeds it: a ZERO-file launch event, a `getFile()` that REJECTS (permission
// revoked between pick and read — real Chromium behaviour), and an UNKNOWN
// EXTENSION (a manifest the OS accepted via a stale/wider handler match).
// Contract (src/app/launch-queue.ts header, spec § boot tolerance): "a broken
// consumer must not take the app down", "never a hang" — so each hostile
// launch must leave the app error-free AND still able to land a real file
// afterwards (proves no wedged consumer, not merely no throw).
//
// SECURITY-03 leg: a launched file NAMED with the canary marker exercises the
// one user-visible string a launch carries (filename → project name is by
// design) — the console/error channels must stay marker-free.
import { expect, test } from '@playwright/test'
import { attachSecurityGuards, CHILD, CHILD_REASON, openAppWithBridges, PREVIEW_BASE, projectRows, taxiBytesBase64, warmShell } from './helpers/pwa-harness'
import { CANARY_MARKER } from '../../src/test-support/redaction'

// Same install pattern as the frozen launch-queue.spec: capture the consumer
// the app registers, BEFORE app code runs.
function installLaunchQueueCapture(): void {
  Object.defineProperty(window, 'launchQueue', {
    configurable: true,
    get: () => ({
      setConsumer: (consumer: (params: unknown) => void) => {
        ;(window as unknown as Record<string, unknown>).__zipLaunchConsumer = consumer
      },
    }),
  })
}

interface LaunchFileSpec {
  name: string
  type: string
  /** base64 bytes, decoded in-page (no closures cross the boundary). */
  b64?: string
  /** when true, getFile() rejects instead of resolving (permission revoked). */
  reject?: boolean
}

// page.evaluate cannot serialize function values, so the hostile LaunchParams
// are described with plain data and CONSTRUCTED in the page.
async function deliver(page: import('@playwright/test').Page, files: LaunchFileSpec[] | 'no-files-key'): Promise<void> {
  await page.evaluate((payload) => {
    const consumer = (window as unknown as Record<string, ((p: unknown) => void) | undefined>).__zipLaunchConsumer
    if (typeof consumer !== 'function') throw new Error('launchQueue consumer was never registered')
    if (payload === 'no-files-key') {
      consumer({})
      return
    }
    const entries = payload.map((file) => ({
      getFile: async (): Promise<File> => {
        if (file.reject === true) throw new Error(`NotReadableError: ${file.name}`)
        const bytes = Uint8Array.from(atob(file.b64 ?? ''), (c) => c.charCodeAt(0))
        return new File([bytes], file.name, { type: file.type })
      },
    }))
    consumer({ files: entries })
  }, files)
}

test.describe('CC-204.7 (adversary): launchQueue degenerate deliveries (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test('zero-file event + rejected getFile() + unknown extension leave the app alive and the import flow usable', async ({ page, context }) => {
    test.setTimeout(180_000)
    await context.addInitScript(installLaunchQueueCapture)
    const audit = attachSecurityGuards(context, page)
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await openAppWithBridges(page)
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__zipLaunchConsumer), 'consumer registered').toBe('function')

    // 1. ZERO-file launch event — must return, not hang, not throw.
    await deliver(page, [])
    await deliver(page, 'no-files-key')

    // 2. getFile() REJECTS for every entry — skipped, never fatal.
    await deliver(page, [{ name: 'stolen-a.mp4', type: 'video/mp4', reject: true }, { name: 'stolen-b.mp4', type: 'video/mp4', reject: true }])

    // 3. UNKNOWN EXTENSION — not in the manifest accept list; the intake
    //    path must reject it by CODE without killing the consumer.
    await deliver(page, [{ name: 'adversarial-note.unknownext', type: 'application/octet-stream', b64: 'AQIDBAU=' }])

    // No page crashes from any hostile delivery.
    expect(errors.map((error) => error.name), 'hostile launch params must never crash the app').toEqual([])

    // The import flow is NOT wedged: a real launch afterwards still lands.
    const b64 = taxiBytesBase64()
    await deliver(page, [{ name: 'adversarial-taxi.mp4', type: 'video/mp4', b64 }])
    await expect.poll(async () => (await projectRows(page)).some((row) => /adversarial-taxi/iu.test(row.name)), 'the consumer still delivers after degenerate launches').toBe(true)
    await expect(page.getByTestId('workbench-shell')).toBeVisible()
    expect(audit.external, 'no non-allowlisted host touched').toEqual([])
    expect(audit.canaryLeaks(), 'no canary content in console output').toEqual([])
  })

  test('a launch filename carrying the SECURITY-03 canary lands the project but never reaches console/errors', async ({ page, context }) => {
    test.setTimeout(180_000)
    await context.addInitScript(installLaunchQueueCapture)
    const audit = attachSecurityGuards(context, page)
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await warmShell(page, PREVIEW_BASE, '/?ziptest=1')
    await openAppWithBridges(page)
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__zipLaunchConsumer), 'consumer registered').toBe('function')

    const b64 = taxiBytesBase64()
    await deliver(page, [{ name: `${CANARY_MARKER}.mp4`, type: 'video/mp4', b64 }])
    await expect.poll(async () => (await projectRows(page)).some((row) => row.name.includes('canary')), 'launched file becomes a project row (name is user-visible by design)').toBe(true)

    expect(errors.map((error) => error.message), 'pageerrors must not carry the launched filename').toEqual([])
    expect(audit.canaryLeaks(), 'SECURITY-03: the launch filename must never reach console output').toEqual([])
  })
})
