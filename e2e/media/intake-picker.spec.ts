// CC-109.1–CC-109.4 (L5, chromium): local file-picker media intake on the
// production build (playwright.config webServer: vite preview, 4310 — same
// boot doctrine as e2e/workbench/import.spec.ts). The picker
// (`MediaIntakeButton`, unit-109) is an INPUT SURFACE feeding the existing
// intake path: both test ids drive `IntakeService.handleFiles` exactly like
// the drop (dropOntoZone copied from import.spec.ts), so the assertions reuse
// the unit-106 persistence-bridge autosave patterns (e2e/pwa/offline.spec.ts
// save-state poll; e2e/intent/caption-studio-ui.spec.ts listProjects) and
// the unit-101 toast-code vocabulary.
//
// Doctrine honoured here: fixtures come from fixtures/ on the Node side and
// cross into the page as setInputFiles payloads / base64 drops — never
// fetched at test time, no network. SECURITY-03 (CC-109.4): console capture
// only ever asserts ABSENCE of content; canaries are synthetic markers
// (src/test-support/redaction lineage), never user strings.
//
// PINNED against the builder (test-author contract, tests/unit/workbench/
// media-intake-button.test.tsx mirrors): the element carrying
// `data-testid=media-intake-button` / `project-intake-button` CONTAINS the
// hidden `<input type=file>` as a DESCENDANT (Playwright resolves the owner
// input from the test id for setInputFiles/filechooser), the button is a real
// focusable <button> with a visible "Choose file…" accessible name, and
// intake supports multi-select so the input carries `multiple`.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { CANARY_MARKER } from '../../src/test-support/redaction'

test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

interface PersistenceBridge {
  ready(): Promise<void>
  getSaveState(): { state: string; lastSavedAt: number | null; errorCode: string | null }
  listProjects(): Promise<Array<{ id: string; name: string; updatedAt: number }>>
}

interface DropFile {
  name: string
  type: string
  base64: string
}

interface IntakeSignature {
  /** The reason-CODE toast text, or null when absent. */
  toast: string | null
  /** The status-bar coded job error (unit-101 StatusBar `job-error`), or null. */
  jobError: string | null
  dropZoneVisible: boolean
  projectRows: number
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => {
    const w = window as unknown as { __zipPersistenceBridge?: unknown; __zipWorkbenchBridge?: unknown }
    return w.__zipPersistenceBridge !== undefined && w.__zipWorkbenchBridge !== undefined
  }, undefined, { timeout: 20_000 })
  await page.evaluate(() => (window as unknown as { __zipPersistenceBridge: PersistenceBridge }).__zipPersistenceBridge.ready())
}

function fixtureBuffer(rel: string): Buffer {
  return readFileSync(join(REPO_ROOT, 'fixtures', rel))
}

async function listProjects(page: Page): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
  return page.evaluate(() => (window as unknown as { __zipPersistenceBridge: PersistenceBridge }).__zipPersistenceBridge.listProjects())
}

async function saveState(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __zipPersistenceBridge: PersistenceBridge }).__zipPersistenceBridge.getSaveState().state)
}

/** Drop-path entry, byte-identical to e2e/workbench/import.spec.ts's doctrine. */
async function dropOnto(page: Page, selector: string, files: DropFile[]): Promise<void> {
  await page.evaluate(([sel, payload]) => {
    const zone = document.querySelector(sel)
    if (!zone) throw new Error(`${sel} missing — cannot drop`)
    const dataTransfer = new DataTransfer()
    for (const file of payload) {
      const binary = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0))
      dataTransfer.items.add(new File([binary], file.name, { type: file.type }))
    }
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  }, [selector, files] as [string, DropFile[]])
}

async function readSignature(page: Page): Promise<IntakeSignature> {
  const toastLoc = page.getByTestId('toast')
  const jobErrorLoc = page.getByTestId('job-error')
  const toast = (await toastLoc.count()) > 0 ? await toastLoc.first().textContent() : null
  const jobError = (await jobErrorLoc.count()) > 0 ? await jobErrorLoc.first().textContent() : null
  const dropZoneVisible = await page.getByTestId('drop-zone').isVisible()
  const projectRows = (await listProjects(page)).length
  return { toast, jobError, dropZoneVisible, projectRows }
}

/** Wait for the rejection toast (never silent — CC-101.2), then return the
 *  outcome once two consecutive samples agree (probe-side coded outcomes
 *  arrive asynchronously; a fixed grace would flake the parity compare). */
async function settleSignature(page: Page): Promise<IntakeSignature> {
  await expect(page.getByTestId('toast'), 'every rejected file is announced with its reason CODE — never silent (CC-101.2 doctrine the picker must share)').toBeVisible({ timeout: 20_000 })
  let previous = ''
  let last: IntakeSignature | null = null
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await readSignature(page)
    if (last !== null && JSON.stringify(current) === previous) return current
    previous = JSON.stringify(current)
    last = current
    await page.waitForTimeout(500)
  }
  return readSignature(page)
}

test.describe('CC-109.x: local file-picker media intake', () => {
  test('CC-109.1: setInputFiles via media-intake-button creates asset, preview and autosaves the project', async ({ page }) => {
    test.setTimeout(90_000)
    await boot(page)
    await expect(page.getByTestId('drop-zone'), 'first-run screen (no asset)').toBeVisible({ timeout: 10_000 })
    await page.getByTestId('media-intake-button').setInputFiles({ name: 'tone-30s.wav', mimeType: 'audio/wav', buffer: fixtureBuffer('tone-30s.wav') })
    await expect(page.getByTestId('drop-zone'), 'the chosen file runs the existing probe → createProject path (real media worker)').toBeHidden({ timeout: 20_000 })
    await page.getByTestId('tab-media').click()
    await expect(page.getByTestId('media-asset-card'), 'asset card appears from the probe asset').toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('stage-media'), 'preview stage mounts').toBeVisible()
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid=stage-video]') as HTMLMediaElement | null
      return el !== null && el.readyState >= 1
    }, undefined, { timeout: 30_000 })
    await expect.poll(() => saveState(page), { timeout: 30_000, message: 'the picker journey autosaves — no manual save called' }).toBe('saved')
    const rows = await listProjects(page)
    expect(rows.length, 'autosaved project row (persistence bridge, unit-106 pattern)').toBe(1)
  })

  test('CC-109.1: project-intake-button creates AND opens a project from the Projects empty state', async ({ page }) => {
    test.setTimeout(90_000)
    await boot(page)
    await page.getByTestId('tab-media').click()
    await expect(page.getByTestId('project-list'), 'Projects area on the production build').toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('media-asset-card'), 'empty state — no media yet').toBeHidden()
    await page.getByTestId('project-intake-button').setInputFiles({ name: 'tone-30s.wav', mimeType: 'audio/wav', buffer: fixtureBuffer('tone-30s.wav') })
    await expect(page.getByTestId('drop-zone'), 'project created through the same path the drop uses').toBeHidden({ timeout: 20_000 })
    await expect(page.getByTestId('media-asset-card'), 'and OPENED — asset card renders').toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('project-name'), 'opened project owns the header').not.toHaveValue('', { timeout: 10_000 })
    const rows = await listProjects(page)
    expect(rows.length, 'the created project persisted').toBe(1)
  })

  test('CC-109.2: cancelling the picker is a no-op — no asset, no project, no toast', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`))
    await boot(page)
    await expect(page.getByTestId('drop-zone'), 'first-run screen').toBeVisible({ timeout: 10_000 })
    const rowsBefore = await listProjects(page)
    const stateBefore = await saveState(page)
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10_000 }),
      page.getByTestId('media-intake-button').click(),
    ])
    // Playwright 1.64.1 has no FileChooser.cancel() — `setFiles([])` is its
    // documented "clears the selected files" cancel surrogate: the chooser
    // answers with NOTHING selected. A correct picker must treat that as the
    // same no-op as dismissing the dialog (US-109.2).
    await chooser.setFiles([])
    await expect(page.getByTestId('drop-zone'), 'cancel leaves the empty state untouched').toBeVisible()
    await expect(page.getByTestId('toast'), 'cancel never raises a toast (US-109.2)').toHaveCount(0)
    expect(await listProjects(page), 'cancel creates no project').toEqual(rowsBefore)
    expect(await saveState(page), 'cancel never dirties the save state').toBe(stateBefore)
    expect(errors, 'cancel never throws').toEqual([])
  })

  test('CC-109.2: picker and drop produce the SAME coded outcome for an unsupported/oversized selection (parity)', async ({ page }) => {
    test.setTimeout(120_000)
    // Unsupported by extension/MIME (.txt → UNSUPPORTED_TYPE) and oversized
    // garbage past any sane intake size cap (32 MiB of zeros — fails the
    // media-worker probe). Multi-file selection also pins the `multiple`
    // affordance the intake path supports (FR-109.1).
    const badFiles: DropFile[] = [
      { name: 'notes.txt', type: 'text/plain', base64: Buffer.from('user meeting notes — definitely not media\n', 'utf8').toString('base64') },
      { name: 'giant.wav', type: 'audio/wav', base64: Buffer.alloc(32 * 1024 * 1024).toString('base64') },
    ]
    await boot(page)
    await expect(page.getByTestId('drop-zone'), 'first-run screen before the drop').toBeVisible({ timeout: 10_000 })
    await dropOnto(page, '[data-testid=drop-zone]', badFiles)
    const dropOutcome = await settleSignature(page)

    await boot(page)
    await expect(page.getByTestId('drop-zone'), 'first-run screen before the picker selection').toBeVisible({ timeout: 10_000 })
    await page.getByTestId('media-intake-button').setInputFiles(badFiles.map((file) => ({ name: file.name, mimeType: file.type, buffer: Buffer.from(file.base64, 'base64') })))
    const pickerOutcome = await settleSignature(page)

    // Anchors keep the deepEqual honest: the DROP path is proven to produce a
    // real coded outcome (unit-101 CC-101.2) — two silent no-ops would not
    // compare as "parity", they would fail here.
    expect(dropOutcome.toast, 'the drop path codes the unsupported file (unit-101 baseline)').toContain('UNSUPPORTED_TYPE')
    expect(dropOutcome.projectRows, 'the drop path creates no project from bad files').toBe(0)
    expect(pickerOutcome, 'the picker surfaces the identical coded outcome — same pipeline, no new error surface (US-109.2)').toEqual(dropOutcome)
    expect(pickerOutcome.projectRows, 'the picker path creates no project from bad files either').toBe(0)
  })

  test('CC-109.3: keyboard Enter on media-intake-button opens the file chooser (Playwright filechooser event)', async ({ page }) => {
    await boot(page)
    await expect(page.getByTestId('drop-zone')).toBeVisible({ timeout: 10_000 })
    const button = page.getByTestId('drop-zone').getByRole('button', { name: /choose file/i })
    await expect(button, 'E1: visible, accessible button beside the drop copy (FR-109.2)').toBeVisible({ timeout: 10_000 })
    await button.focus()
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10_000 }),
      page.keyboard.press('Enter'),
    ])
    expect(chooser, 'Enter on the focused button opens the OS file picker').not.toBeNull()
    expect(await chooser.element().getAttribute('type'), 'the chooser is bound to the component hidden file input').toBe('file')
    await chooser.setFiles([])
  })

  test('CC-109.4: console stays codes/counts during the picker journey — no file names, no transcript strings (SECURITY-03)', async ({ page }) => {
    test.setTimeout(90_000)
    const lines: string[] = []
    const errors: string[] = []
    page.on('console', (message) => lines.push(`${message.type()}: ${message.text()}`))
    page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`))
    await boot(page)
    await expect(page.getByTestId('drop-zone')).toBeVisible({ timeout: 10_000 })
    // Transcript-side canary (synthetic marker, conventions § Principles 4):
    // rides the SAME injection seam a worker reply uses, so any future path
    // that logs segment text lands in the capture below.
    await page.evaluate((marker) => {
      const w = window as unknown as { __zipWorkbenchBridge?: { injectAsrEvent(event: Record<string, unknown>): void } }
      w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:segments', jobId: 'cc109-canary', segments: [{ start: 0, end: 2, speaker: 'S1', text: `canary transcript ${marker} must never be logged`, words: [{ start: 0, end: 1, text: marker }] }] })
    }, CANARY_MARKER)
    const canaryFileName = 'canary-recording-9f4c1e.wav'
    await page.getByTestId('media-intake-button').setInputFiles({ name: canaryFileName, mimeType: 'audio/wav', buffer: fixtureBuffer('tone-30s.wav') })
    await expect(page.getByTestId('drop-zone'), 'the journey runs through intake — the canary NAME flows through the app as asset/project name').toBeHidden({ timeout: 20_000 })
    await expect.poll(() => saveState(page), { timeout: 30_000, message: 'autosave runs during the journey (another leak channel: error details)' }).toBe('saved')
    await page.waitForTimeout(1_500)
    const joined = lines.join('\n')
    expect(joined, 'the chosen file NAME never reaches the console (SECURITY-03 — codes/counts only)').not.toContain('canary-recording')
    expect(joined, 'transcript-derived strings never reach the console').not.toContain(CANARY_MARKER)
    expect(errors, 'no uncaught errors escape the picker journey (FR-109.3)').toEqual([])
  })
})
