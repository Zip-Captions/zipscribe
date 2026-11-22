// Shared e2e glue for the unit-204 PWA/offline specs (CC-204.2/.3/.5/.6/.7/.8).
//
// Doctrine (conventions § Testing strategy): specs run against `vite preview`
// of the production build (SW disabled in dev — knowledge/conventions.md
// "Other rules"); offline via context.setOffline; request audit + CSP
// violation listener + canary console scan on every suite (SECURITY-03).
//
// SECURITY-03: the audit collects URL HOSTS, codes and numbers only — never
// page content, never transcript text. The canary marker rides in seeded
// caption text; any appearance in console output or a request URL fails.
//
// Service-worker request visibility (verified against the Playwright Service
// Workers guide, https://playwright.dev/docs/service-workers): SW-owned
// network requests surface on the BrowserContext events and are routable via
// context.route; page-served responses report response.fromServiceWorker().
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { REPO_ROOT } from '../../../tests/helpers/repo'
import { CANARY_MARKER } from '../../../src/test-support/redaction'

export const PREVIEW_BASE = 'http://127.0.0.1:4310'
export const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
export const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit'

/** settings.yml operations.model_hosts — the audit allowlist mirrors the CSP. */
export function isModelHost(host: string): boolean {
  return host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co')
}

function isLocalHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost'
}

/** Allowlist = self + model hosts + the unit-201 OPT-IN font origins (the app
 *  ships self-hosted subsets, so a font request itself is still suspicious —
 *  the offline tests additionally assert zero network at all). */
function isAllowlisted(host: string): boolean {
  return isLocalHost(host) || isModelHost(host) || host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com'
}

export interface PwaSecurityAudit {
  /** non-allowlisted request hosts (must stay empty — unit-01 request audit). */
  readonly external: string[]
  /** every model-host request attempt (offline legs must show ZERO). */
  readonly modelHost: string[]
  /** successful non-SW responses from the preview origin (an offline run must
   *  show zero: everything is served by the SW cache or from memory). */
  readonly bypassedSw: string[]
  readonly cspViolations: string[]
  /** console texts that leaked the canary marker (must stay empty). */
  canaryLeaks(): string[]
  /** reset the per-phase counters (offline legs audit only their own phase). */
  reset(): void
}

export function attachSecurityGuards(context: BrowserContext, page: Page): PwaSecurityAudit {
  const audit: PwaSecurityAudit = {
    external: [],
    modelHost: [],
    bypassedSw: [],
    cspViolations: [],
    canaryLeaks: () => consoleTexts.filter((t) => t.includes(CANARY_MARKER)),
    reset: () => {
      audit.external.length = 0
      audit.modelHost.length = 0
      audit.bypassedSw.length = 0
    },
  }
  const consoleTexts: string[] = []

  context.on('request', (request) => {
    const url = request.url()
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return
    const host = new URL(url).host
    if (isModelHost(host)) audit.modelHost.push(url)
    else if (!isAllowlisted(host)) audit.external.push(`${host} ${request.method()}`)
  })
  context.on('response', (response) => {
    const url = response.url()
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return
    const host = new URL(url).host
    if (isLocalHost(host) && !response.fromServiceWorker()) audit.bypassedSw.push(url)
  })
  // A failed attempt is still an attempt: on an offline run nothing may even
  // reach the network layer (CC-204.3 "zero network attempts … short-
  // circuited before fetch" — the short-circuit means NO request event).
  context.on('requestfailed', (request) => {
    const url = request.url()
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return
    if (isLocalHost(new URL(url).host)) audit.bypassedSw.push(url)
  })
  page.on('console', (message) => {
    const text = message.text()
    consoleTexts.push(text)
    if (text.includes('Content Security Policy') || text.includes('content-type') && text.includes('Refused to')) audit.cspViolations.push(text.slice(0, 200))
  })
  page.on('pageerror', (error) => {
    consoleTexts.push(`${error.name}: ${error.message}`)
  })
  return audit
}

// --- service-worker lifecycle (implementation-agnostic waiting) -------------

/**
 * Load the app, wait for the SW to activate, reload so the page is actually
 * controlled (the controllerchange-safe pattern from the Playwright Service
 * Workers guide). A spec that then goes offline is testing the SW cache, not
 * the server: the `controller !== null` wait is itself the first assertion of
 * offline capability.
 */
export async function warmShell(page: Page, base: string = PREVIEW_BASE, path = '/'): Promise<void> {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => navigator.serviceWorker.ready.then((registration) => registration.active !== null), undefined, { timeout: 60_000 })
  await page.goto(base + path, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 })
}

/** The Workbox precache cache exists and the app shell URLs are in it —
 *  without this, an offline reload fails for the wrong reason. */
export async function ensurePrecache(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const names = await caches.keys()
      const precache = names.find((n) => /precache/i.test(n))
      if (precache === undefined) return false
      const cache = await caches.open(precache)
      return (await cache.match('/index.html')) !== undefined || (await cache.match('/')) !== undefined
    },
    undefined,
    { timeout: 60_000 },
  )
}

// --- bridges (same globals the unit-102/106 e2e suites drive) ---------------

interface BridgeWindow {
  __zipEditorBridge?: {
    openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
    setProjectName(name: string): void
    setExportMedia(bytes: ArrayBuffer, type: string): Promise<void>
    getEditorState(): { blockCount: number }
  }
  __zipPersistenceBridge?: {
    ready(): Promise<void>
    saveNow(reason: 'idle' | 'manual' | 'hidden'): Promise<'saved' | 'not-dirty' | 'failed'>
    getSaveState(): { state: string; lastSavedAt: number | null; errorCode: string | null }
    listProjects(): Promise<{ id: string; name: string; updatedAt: number }[]>
    openProject(id: string): Promise<{ readOnly: boolean } | null>
    seedMediaHandle(projectId: string, handleLike: { queryPermission(d?: { mode?: string }): Promise<string>; getFile(): Promise<File> }, fingerprint: unknown): Promise<void>
    setProbeResult(fingerprint: unknown): void
    relinkMedia(projectId: string): Promise<{ kind: string }>
  }
}

async function bridges(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as BridgeWindow
      return w.__zipEditorBridge !== undefined && w.__zipPersistenceBridge !== undefined
    },
    undefined,
    { timeout: 20_000 },
  )
  await page.evaluate(() => (window as unknown as BridgeWindow).__zipPersistenceBridge?.ready())
}

/** Load the app with the test bridges (`?ziptest=1`, served offline too via
 *  the navigateFallback — the query string must survive the precache match). */
export async function openAppWithBridges(page: Page, base: string = PREVIEW_BASE): Promise<void> {
  await page.goto(`${base}/?ziptest=1`, { waitUntil: 'domcontentloaded' })
  await bridges(page)
}

/**
 * Open a project whose media is a LOCAL File (unit-106 relink path — the
 * honest "media never needs the network" story, so offline legs cannot fail
 * on a /fixtures fetch). Returns the persisted project row id.
 */
export async function openProjectWithLocalMedia(
  page: Page,
  opts: {
    asset: Record<string, unknown>
    src: string
    blocks: readonly unknown[]
    name: string
    fingerprint: { name: string; size: number; durationMs: number; sampleHashes: string[] }
    fileBytesBase64: string
    fileType: string
  },
): Promise<string> {
  await page.evaluate(
    ([asset, src, blocks, name, fp]) => {
      const w = window as unknown as BridgeWindow
      const e = w.__zipEditorBridge
      const p = w.__zipPersistenceBridge
      if (e === undefined || p === undefined) throw new Error('test bridges missing (ziptest=1)')
      p.setProbeResult(fp)
      e.openProjectWithMedia(asset, src)
      e.setProjectName(name)
    },
    [opts.asset, opts.src, opts.blocks, opts.name, opts.fingerprint] as const,
  )
  await page.waitForFunction(() => ((window as unknown as BridgeWindow).__zipEditorBridge?.getEditorState().blockCount ?? 0) > 0, undefined, { timeout: 30_000 })
  const saved = await page.evaluate(() => (window as unknown as BridgeWindow).__zipPersistenceBridge?.saveNow('manual'))
  if (saved !== 'saved') throw new Error(`baseline manual save returned ${String(saved)} — seeded project never reached the store`)
  const rows = await page.evaluate(() => (window as unknown as BridgeWindow).__zipPersistenceBridge?.listProjects())
  const row = rows?.find((r) => r.name === opts.name)
  if (row === undefined) throw new Error('seeded project row not listed after save')

  await page.evaluate(
    async ([projectId, fp, b64, type]) => {
      const w = window as unknown as BridgeWindow
      const p = w.__zipPersistenceBridge
      if (p === undefined) throw new Error('persistence bridge missing')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      await p.seedMediaHandle(
        projectId,
        {
          queryPermission: async (): Promise<string> => 'granted',
          getFile: async (): Promise<File> => new File([bytes], fp.name, { type }),
        },
        fp,
      )
    },
    [row.id, opts.fingerprint, opts.fileBytesBase64, opts.fileType] as const,
  )
  const outcome = await page.evaluate((projectId) => (window as unknown as BridgeWindow).__zipPersistenceBridge?.relinkMedia(projectId), row.id)
  if (outcome?.kind !== 'silent') throw new Error(`local media relink did not restore silently (kind: ${String(outcome?.kind)})`)
  return row.id
}

export async function projectRows(page: Page): Promise<{ id: string; name: string; updatedAt: number }[]> {
  return (await page.evaluate(() => (window as unknown as BridgeWindow).__zipPersistenceBridge?.listProjects())) ?? []
}

export async function editorBlockCount(page: Page): Promise<number> {
  return (await page.evaluate(() => (window as unknown as BridgeWindow).__zipEditorBridge?.getEditorState().blockCount ?? 0)) ?? 0
}

export async function saveState(page: Page): Promise<string> {
  return (await page.evaluate(() => (window as unknown as BridgeWindow).__zipPersistenceBridge?.getSaveState().state)) ?? 'unknown'
}

export async function manualSave(page: Page): Promise<string> {
  return (await page.evaluate(() => (window as unknown as BridgeWindow).__zipPersistenceBridge?.saveNow('manual'))) ?? 'failed'
}

// --- transcription (real jobs slice → real asr.worker) ----------------------

const TINY_SELECTOR = '[data-testid=transcribe-model-option][data-model-id*="whisper-tiny"]'

/** Drive the real Transcribe popover: open, pin the CI-served tiny row,
 *  start (Replace path — the seeded project carries blocks). Honors the
 *  unit-03 > 100 MB `model-download-confirm` gate (tiny ≈ 125 MB). */
export async function startTranscription(page: Page): Promise<void> {
  await page.getByTestId('transcribe-button').click()
  await expectVisible(page.getByTestId('transcribe-popover'))
  await page.locator(TINY_SELECTOR).click()
  await page.getByTestId('replace-captions-button').click()
  const confirmButton = page.getByTestId('model-download-confirm-button')
  if (await confirmButton.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmButton.click()
}

function expectVisible(locator: Locator): Promise<void> {
  return expect(locator).toBeVisible({ timeout: 10_000 })
}

// --- fixtures on disk --------------------------------------------------------

export function taxiBytesBase64(): string {
  const path = join(REPO_ROOT, 'fixtures', 'taxi-en-accented-1.mp4')
  if (!existsSync(path)) throw new Error('fixtures/taxi-en-accented-1.mp4 missing — run `pnpm fixtures` (setup step, never during a test)')
  return readFileSync(path).toString('base64')
}

/** Fingerprint truth for setProbeResult — matches the seeded File name/size. */
export const TAXI_FINGERPRINT = { name: 'taxi-en-accented-1.mp4', size: 147352, durationMs: 29888, sampleHashes: ['a', 'b', 'c'] }

export const TAXI_ASSET = {
  id: 'ASSET_204_TAXI',
  name: 'taxi-en-accented-1.mp4',
  kind: 'video',
  container: 'mp4',
  audioCodec: 'aac',
  videoCodec: 'h264',
  duration: 29.888,
  width: 320,
  height: 180,
  fps: 10,
  sampleRate: 16000,
  channels: 1,
  fingerprint: TAXI_FINGERPRINT,
}

/** Canary seed: marker-carrying caption text (SECURITY-03 canary-transcript
 *  convention — its appearance in any output channel fails the suite). */
export const CANARY_BLOCKS = [
  {
    id: 'blk_204_canary',
    start: 0.5,
    end: 3.25,
    text: `${CANARY_MARKER} hello world`,
    words: [
      { text: CANARY_MARKER, start: 0.5, end: 1.5 },
      { text: 'hello', start: 1.6, end: 2.4 },
      { text: 'world', start: 2.5, end: 3.25 },
    ],
    speakerId: 'SPK_1',
  },
]
