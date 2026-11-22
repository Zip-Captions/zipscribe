// CC-204.5 (L5, chromium): the SW never stores model-host responses, and the
// precache budget holds. Two independent legs:
//
// 1. Cache inspection: after a session that touched huggingface.co (tiny model
//    served from the LOCAL model cache through the shared route spy — tests
//    never download), enumerate EVERY CacheStorage entry across ALL caches: no
//    URL may point at a model-host origin (FR-204.2 "bypass model hosts
//    entirely" — unit-03's verified `zipscribe-models` cache owns models;
//    double-caching hundreds of MB in the SW is forbidden).
// 2. Precache budget: parse the REAL generated sw.js from the preview server
//    (workbox generateSW embeds the manifest as self.__WB_MANIFEST) and size
//    every entry against the server: total ≤ 15 MiB (FR-204.3), each file
//    ≤ 25 MiB (Cloudflare Pages limit), and the lazy chunks FR-204.2 names
//    (worker, mediabunny, export, ffmpeg-loader) plus fonts/icons/sample are
//    in the precache manifest.
//
// This spec runs the REAL service worker from the REAL build — no mocking of
// the module under test (conventions § Principles 1).
import { expect, test } from '@playwright/test'
import { assertModelCachePresent, routeAsrNetwork, type NetworkCounters } from '../asr/helpers/asr'
import {
  attachSecurityGuards,
  CANARY_BLOCKS,
  CHILD,
  CHILD_REASON,
  ensurePrecache,
  openAppWithBridges,
  openProjectWithLocalMedia,
  PREVIEW_BASE,
  startTranscription,
  TAXI_FINGERPRINT,
  taxiBytesBase64,
  warmShell,
} from './helpers/pwa-harness'
import { TAXI_ASSET } from '../export/helpers/export-harness'

const PRECACHE_TOTAL_BUDGET_BYTES = 15 * 1024 * 1024 // FR-204.3: ≤ 15 MB
const SINGLE_FILE_BUDGET_BYTES = 25 * 1024 * 1024 // FR-204.3: each file ≤ 25 MiB

interface PrecacheEntry {
  url: string
  revision?: string
}

function parsePrecacheManifest(swSource: string): PrecacheEntry[] {
  // workbox-build's generateSW inlines the manifest at the injection point:
  // `self.__WB_MANIFEST=[{"revision":"…","url":"…"},…]`.
  // https://developer.chrome.com/docs/workbox/modules/workbox-build
  const match = /self\.__WB_MANIFEST\s*=\s*(\[[\s\S]*?\])/.exec(swSource)
  if (match === null || match[1] === undefined) return []
  return JSON.parse(match[1]) as PrecacheEntry[]
}

test.describe('CC-204.5: SW cache policy — no model-host entries + precache budgets (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test('CC-204.5: after an HF-touched session, no cache anywhere holds a model-host response', async ({ page, context }) => {
    test.skip(!modelCacheReady(), 'model cache missing — run `pnpm models:fetch` (setup step)')
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
      name: 'cache-policy',
      fingerprint: TAXI_FINGERPRINT,
      fileBytesBase64: taxiBytesBase64(),
      fileType: 'video/mp4',
    })
    await startTranscription(page)
    await expect(page.getByTestId('status-bar'), 'the model run completed').toContainText(/no model/, { timeout: 300_000 })
    expect(counters.modelHost, 'the session really touched huggingface.co (via the cache-served route)').toBeGreaterThan(0)

    // Enumerate EVERY cache's entries via the page (CacheStorage is per-origin,
    // and the SW owns them — page.evaluate sees the same storage).
    const cachedUrls = await page.evaluate(async () => {
      const urls: string[] = []
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        for (const request of await cache.keys()) urls.push(request.url)
      }
      return urls
    })
    expect(cachedUrls.length, 'caches exist at all (the SW precached)').toBeGreaterThan(0)
    const modelHostEntries = cachedUrls.filter((url) => {
      const host = new URL(url).hostname
      return host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co')
    })
    expect(modelHostEntries, 'FR-204.2: the SW bypasses model hosts — none of its caches may store them').toEqual([])
    expect(audit.canaryLeaks(), 'canary text never reaches the console').toEqual([])
  })

  test('CC-204.5: precache manifest ≤ 15 MiB total, ≤ 25 MiB per file, lazy chunks + assets included', async ({ page, request }) => {
    test.setTimeout(120_000)
    await page.goto(`${PREVIEW_BASE}/`)
    const sw = await request.get(`${PREVIEW_BASE}/sw.js`)
    expect(sw.status(), 'the production build ships /sw.js (FR-204.1 — RED until vite-plugin-pwa lands)').toBe(200)
    const entries = parsePrecacheManifest(await sw.text())
    expect(entries.length, 'sw.js embeds a non-empty workbox precache manifest (self.__WB_MANIFEST)').toBeGreaterThan(0)

    let total = 0
    const oversized: string[] = []
    for (const entry of entries) {
      const response = await request.head(`${PREVIEW_BASE}${entry.url.startsWith('/') ? entry.url : `/${entry.url}`}`)
      expect(response.status(), `precache entry ${entry.url} must exist on the server`).toBe(200)
      const lengthHeader = response.headers()['content-length']
      const size = lengthHeader !== undefined ? Number(lengthHeader) : (await (await request.get(`${PREVIEW_BASE}${entry.url}`)).body()).byteLength
      expect(Number.isFinite(size) && size >= 0, `content-length for ${entry.url}`).toBe(true)
      if (size > SINGLE_FILE_BUDGET_BYTES) oversized.push(`${entry.url} (${size} B)`)
      total += size
    }
    expect(oversized, `no precache file may exceed the 25 MiB Cloudflare Pages limit (FR-204.3)`).toEqual([])
    expect(total, `precache total ${total} B must stay within the 15 MiB budget (FR-204.3) — models are NEVER precached`).toBeLessThanOrEqual(PRECACHE_TOTAL_BUDGET_BYTES)

    const urls = entries.map((entry) => entry.url)
    const joined = urls.join('\n')
    // FR-204.2 named lazy chunks must be PRECACHED (offline-capable), even
    // though they stay out of the initial graph (check-bundle's exclusion).
    expect(joined, 'worker chunk precached (FR-204.2)').toMatch(/worker[.-].*\.js/u)
    expect(joined, 'mediabunny chunk precached (FR-204.2)').toMatch(/mediabunny/iu)
    expect(joined, 'export chunk precached (FR-204.2)').toMatch(/export/iu)
    expect(joined, 'ffmpeg-loader chunk precached (FR-204.2)').toMatch(/ffmpeg/iu)
    // FR-204.2 also names the shell extras: bundled font subsets, icons, the
    // sample clip (public/samples, copied at build time).
    expect(joined, 'bundled font subsets precached (FR-204.2)').toMatch(/\.woff2$/mu)
    expect(joined, 'icons precached (FR-204.2)').toMatch(/\.(png|svg)$/mu)
    expect(joined, 'sample clip precached (FR-204.2)').toMatch(/samples\//u)
  })
})

function modelCacheReady(): boolean {
  try {
    assertModelCachePresent()
    return true
  } catch {
    return false
  }
}
