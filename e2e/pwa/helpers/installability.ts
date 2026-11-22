// CDP installability probe for CC-204.1, ISOLATED in one helper on purpose:
// `Page.getInstallabilityErrors` / `Page.getAppManifest` are experimental
// DevTools protocol (unit-204 Risks: "CDP installability API is experimental →
// isolate in one helper; fall back to manifest-field assertions if it
// changes"). If the domains move, only this file changes.
//
// Protocol reference: https://chromedevtools.github.io/devtools-protocol/tot/Page/
//   #method-getInstallabilityErrors  → { errors: [{ errorType }] }
//   #method-getAppManifest           → { url, errors, manifest }
// Chrome evaluates installability from the loaded document; the spec must
// warm the page (manifest link parsed) before calling.
import { expect, type Page, type Response } from '@playwright/test'

interface CdpInstallabilityError {
  errorType?: string
}

interface CdpAppManifest {
  url?: string
  errors?: CdpInstallabilityError[]
  manifest?: Record<string, unknown>
}

export interface InstallabilityReport {
  /** Chrome's installability error types — CC-204.1 pins this to []. */
  installErrors: string[]
  manifestUrl: string | null
  manifestParseErrors: string[]
  /** CDP's parsed view (field-shape assertions use the FETCHED manifest). */
  cdpManifest: Record<string, unknown> | null
}

export async function getInstallability(page: Page): Promise<InstallabilityReport> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Page.enable')
    const errors = await cdp.send('Page.getInstallabilityErrors')
    const manifest = await cdp.send('Page.getAppManifest')
    const errorList = (errors as { errors?: CdpInstallabilityError[] }).errors ?? []
    const manifestResponse = manifest as unknown as CdpAppManifest
    return {
      installErrors: errorList.map((entry) => entry.errorType ?? 'unspecified'),
      manifestUrl: manifestResponse.url ?? null,
      manifestParseErrors: (manifestResponse.errors ?? []).map((entry) => entry.errorType ?? 'unspecified'),
      cdpManifest: manifestResponse.manifest ?? null,
    }
  } finally {
    await cdp.detach()
  }
}

export interface WebManifest {
  [key: string]: unknown
}

/**
 * The REAL generated manifest, fetched from the `vite preview` server — the
 * field-shape assertions run against the artifact Chrome installs from, not
 * against CDP's `Page.Manifest` projection, which only carries its named
 * struct members (e.g. no `launch_handler`).
 */
export async function fetchManifest(request: Page['request'], base: string): Promise<WebManifest> {
  const response = await request.get(`${base}/manifest.webmanifest`)
  expect(response.status(), '/manifest.webmanifest must exist on the production build (FR-204.1 — RED until vite-plugin-pwa ships it)').toBe(200)
  return (await response.json()) as WebManifest
}

export function iconPurposes(manifest: WebManifest): { sizes: string; purposes: string[] }[] {
  const icons = Array.isArray(manifest['icons']) ? (manifest['icons'] as Record<string, unknown>[]) : []
  return icons.map((icon) => ({
    sizes: String(icon['sizes'] ?? ''),
    purposes: typeof icon['purpose'] === 'string' ? icon['purpose'].trim().toLowerCase().split(/\s+/) : ['any'],
  }))
}
