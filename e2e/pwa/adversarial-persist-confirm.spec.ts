// ADVERSARY (unit-204, categories: absent-action boundary + missing contract
// affordance) — two FR-204.5/US-204.3 probes the frozen suites do not make:
//
// A) FR-204.5 (unit file line 48): persistent storage is requested "on
// install (`appinstalled`), on first 'Make available offline', and from the
// panel button; NEVER on page load without user action." A plain production
// load (plus a fired `beforeinstallprompt` — capture must not escalate) must
// produce ZERO navigator.storage.persist() calls. Spy installed via
// addInitScript (Navigator.prototype.storage proxy — the models-panel
// doctrine: `this` stays the navigator instance).
//
// B) US-204.3 (unit file line 28): "'Make available offline' downloads +
// verifies via `ensureOffline` (with the > 100 MB confirmation)". The panel
// row for a > 100 MB registry model (whisper-base ≈ 211 MB —
// src/engine/model/registry.ts) must NOT begin the download before the
// confirmation gate resolves. Counterexample shape: either a confirmation
// affordance appears first, or the download is withheld — the honest
// either/or. Model-host routes are ABORTED so a (violating) premature
// download cannot touch the network; only the fetch ATTEMPT is counted.
import { expect, test } from '@playwright/test'
import { attachSecurityGuards, CHILD, CHILD_REASON, PREVIEW_BASE, warmShell } from './helpers/pwa-harness'

const WHISPER_BASE_ID = 'whisper-base_timestamped@608c49e6'

function installPersistSpy(): void {
  const w = window as unknown as Record<string, unknown>
  w.__zipPersistCalls = 0
  const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'storage')
  const original = descriptor?.get
  Object.defineProperty(Navigator.prototype, 'storage', {
    configurable: true,
    // function (not arrow): `this` must stay the navigator INSTANCE.
    get: function () {
      const real = (original?.call(this) ?? {}) as object
      return new Proxy(real, {
        get: (target, prop, receiver) =>
          prop === 'persist'
            ? async () => {
                w.__zipPersistCalls = (w.__zipPersistCalls as number) + 1
                return false
              }
            : Reflect.get(target, prop, receiver),
      })
    },
  })
}

function installOffsiteFetchCounter(): void {
  const w = window as unknown as Record<string, unknown>
  w.__zipOffsiteFetches = 0
  const original = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.origin !== window.location.origin) w.__zipOffsiteFetches = (w.__zipOffsiteFetches as number) + 1
    } catch {
      /* unparseable input: nothing to count */
    }
    return original(input as RequestInfo, init)
  }
}

async function persistCalls(page: import('@playwright/test').Page): Promise<number> {
  return (await page.evaluate(() => (window as unknown as Record<string, unknown>).__zipPersistCalls)) as number
}

test.describe('FR-204.5 / US-204.3 (adversary): persist triggers + the > 100 MB confirmation (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test('FR-204.5: a plain production load (and a fired beforeinstallprompt) calls persist() ZERO times', async ({ page, context }) => {
    test.setTimeout(120_000)
    await context.addInitScript(installPersistSpy)
    const audit = attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/')
    await page.waitForTimeout(3_000) // let any late-boot task (register, hydration) settle
    expect(await persistCalls(page), 'FR-204.5: persist() must never fire on page load without user action').toBe(0)

    // A `beforeinstallprompt` firing (capture only — NOT appinstalled) must
    // not escalate into a persist request either (register.ts only persists
    // on `appinstalled`).
    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeinstallprompt'))
    })
    await page.waitForTimeout(1_000)
    expect(await persistCalls(page), 'beforeinstallprompt capture must not call persist()').toBe(0)
    expect(audit.external, 'plain load touched no non-allowlisted host').toEqual([])
  })

  test('US-204.3: Make-available-offline on a > 100 MB model gates the download behind the confirmation', async ({ page, context }) => {
    test.setTimeout(180_000)
    // Tests never touch the network: the pinned model-host URLs are aborted —
    // the spy below counts the ATTEMPT (a premature download is the
    // counterexample, successful bytes are irrelevant).
    await context.route('**huggingface.co/**', (route) => route.abort())
    await context.addInitScript(installOffsiteFetchCounter)
    await context.addInitScript(installPersistSpy)
    attachSecurityGuards(context, page)
    await warmShell(page, PREVIEW_BASE, '/')
    await page.getByRole('button', { name: '⋯' }).click()
    await page.getByRole('menuitem', { name: /offline models/iu }).click()
    const row = page.getByTestId(`offline-model-row-${WHISPER_BASE_ID}`)
    await expect(row, 'the panel lists the registry model (211 MB)').toBeVisible({ timeout: 60_000 })
    const makeOffline = row.getByRole('button', { name: /make available offline/iu })
    await expect(makeOffline, 'whisper-base is not cached → the ensure button is offered').toBeVisible({ timeout: 60_000 })

    await makeOffline.click()
    const confirmed = await page
      .getByTestId('model-download-confirm-button')
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false)
    const offsite = (await page.evaluate(() => (window as unknown as Record<string, unknown>).__zipOffsiteFetches)) as number

    expect(
      confirmed || offsite === 0,
      `US-204.3 (unit file line 28): "Make available offline" downloads "with the > 100 MB confirmation" — a 211 MB model started fetching ${offsite} off-site bytes with no confirmation affordance shown`,
    ).toBe(true)
  })
})
