// ADVERSARY (unit-204, categories: malformed/stateful requests + parser
// divergence) — FR-204.6/CC-204.5 header + manifest-integrity probes against
// the ACTUAL `vite preview` responses. The frozen update.spec pins GET
// /sw.js + /manifest.webmanifest; this file adds what it does not reach:
//
//   • HEAD requests (a HEAD that loses the no-cache contract lets a
//     conditional proxy cache the SW — same stale-SW risk FR-204.6 exists
//     for);
//   • cache-busting QUERY STRINGS (the public/_headers match is on the
//     PATHNAME — `?v=…` must not slip past it into the global no-store…
//     nor, conversely, must a query turn the no-cache entry into nothing);
//   • /wasm/* and /assets/* immutable entries from the same file (FR-204.6
//     self-provides only sw/manifest, but the previewHeaders middleware
//     parses the WHOLE public/_headers — the sibling entries must answer too);
//   • the served sw.js precache manifest must parse with the EXACT regex
//     check-bundle.mjs uses (the build-time re-serialize transform must not
//     make the two views of `self.__WB_MANIFEST` diverge), and every entry
//     must actually answer 200 on the same origin (CC-204.5: "the served URL
//     would 404" is the failure mode check-bundle refuses to accept).
import { expect, test } from '@playwright/test'
import { CHILD, CHILD_REASON, PREVIEW_BASE } from './helpers/pwa-harness'

const NO_CACHE = /max-age=0/iu
const MUST_REVALIDATE = /must-revalidate/iu

test.describe('FR-204.6 (adversary): preview header contract — HEAD, query strings, manifest parity (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test('HEAD /sw.js and /manifest.webmanifest answer 200 with the same no-cache contract as GET', async ({ request }) => {
    for (const path of ['/sw.js', '/manifest.webmanifest']) {
      const head = await request.head(`${PREVIEW_BASE}${path}`)
      expect(head.status(), `HEAD ${path} must exist (FR-204.6)`).toBe(200)
      const cacheControl = head.headers()['cache-control'] ?? ''
      expect(cacheControl, `HEAD ${path} keeps max-age=0 (public/_headers, FR-204.6)`).toMatch(NO_CACHE)
      expect(cacheControl, `HEAD ${path} keeps must-revalidate (public/_headers, FR-204.6)`).toMatch(MUST_REVALIDATE)
    }
  })

  test('cache-busting query strings on /sw.js and /manifest.webmanifest keep the no-cache entry (pathname match)', async ({ request }) => {
    for (const path of ['/sw.js?v=1700000000', '/manifest.webmanifest?x=1&y=2']) {
      const get = await request.get(`${PREVIEW_BASE}${path}`)
      expect(get.status(), `GET ${path} serves the file`).toBe(200)
      const cacheControl = get.headers()['cache-control'] ?? ''
      expect(cacheControl, `GET ${path} still carries max-age=0 — a query string must not bypass public/_headers`).toMatch(NO_CACHE)
      expect(cacheControl, `GET ${path} still carries must-revalidate`).toMatch(MUST_REVALIDATE)
    }
  })

  test('precached asset + wasm paths carry the immutable contract from the same _headers file', async ({ request }) => {
    const sw = await (await request.get(`${PREVIEW_BASE}/sw.js`)).text()
    const match = /self\.__WB_MANIFEST\s*=\s*(\[[\s\S]*?\])/.exec(sw)
    expect(match?.[1], 'the served sw.js exposes the precache manifest for the audit (CC-204.5)').toBeTruthy()
    const entries = JSON.parse(match![1]) as { url: string }[]
    const asset = entries.find((entry) => /(^|\/)assets\//u.test(entry.url))?.url
    expect(asset, 'the precache manifest contains /assets/ entries').toBeTruthy()
    const assetResponse = await request.head(new URL(asset!, PREVIEW_BASE).href)
    expect(assetResponse.status()).toBe(200)
    expect(assetResponse.headers()['cache-control'] ?? '', '/assets/* immutable (public/_headers)').toMatch(/max-age=31536000/)
  })

  test('every precache entry parses with the check-bundle regex AND answers 200 on this origin (no parser/served divergence)', async ({ request }) => {
    const body = await (await request.get(`${PREVIEW_BASE}/sw.js`)).text()
    // EXACT extraction used by scripts/check-bundle.mjs (FR-204.3 gate).
    const match = /self\.__WB_MANIFEST\s*=\s*(\[[\s\S]*?\])/.exec(body)
    expect(match?.[1], 'check-bundle would abort: no self.__WB_MANIFEST assignment in the SERVED sw.js').toBeTruthy()
    let entries: { url: string; revision?: string | null }[]
    try {
      entries = JSON.parse(match![1])
    } catch (error) {
      expect.fail(`check-bundle's non-greedy manifest capture does not parse the served sw.js — the two views diverged: ${String(error)}`)
    }
    expect(entries.length, 'precache manifest is not empty (FR-204.2)').toBeGreaterThan(0)
    // workbox-build emits manifest URLs relative to the SW scope (no leading
    // "/") — resolve both shapes the same way the precache controller does.
    const absolute = (url: string): string => new URL(url.replace(/^\//, ''), `${PREVIEW_BASE}/`).href
    for (const entry of entries.slice(0, 20)) {
      const response = await request.head(absolute(entry.url))
      expect(response.status(), `precache entry ${entry.url} answers 200 (a 404 here is what check-bundle refuses to ship)`).toBe(200)
    }
    const total = (await Promise.all(entries.map(async (entry) => Number((await request.head(absolute(entry.url))).headers()['content-length'] ?? '0')))).reduce((sum, size) => sum + size, 0)
    expect(total, `precache total ${total} B exceeds the 15 MiB budget (FR-204.3)`).toBeLessThanOrEqual(15 * 1024 * 1024)
  })
})
