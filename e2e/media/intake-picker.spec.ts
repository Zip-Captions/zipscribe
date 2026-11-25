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
// SETTLE DOCTRINE (unit-109 CI hardening, PR #42 cold-run): no fixed sleeps,
// no double-sampling. Every journey settles on POSITIVE signals —
//   • autosave journeys await a CAUSAL proof sampled entirely in-page: the
//     save-state arc started at `idle`, EVER reached `saved` (only reachable
//     after `writeProjectRow` awaited its IDB write with pending ≥ 1), and
//     the project row reads back ≥ 1 — the transients `dirty`/`saving` are
//     not observable-assertable (a `visibilitychange → saveNow('hidden')`
//     flusher can collapse them under one sample tick; see
//     awaitAutosaveSequence's docblock);
//   • rejection journeys await PRESENCE of both coded outcomes (reason-CODE
//     toast AND status-bar `job-error` for the oversized file — jobs.ts
//     records job:error with no running job) before reading the signature,
//     then a bounded jobs-channel quiescence: an in-page MutationObserver
//     (subscribe) + wait-quiet-750 ms (capped 20 s) so late React commits
//     cannot skew the two paths' signatures.
// SECURITY-03 (CC-109.4): the absence-of-content console asserts run only
// AFTER full quiescence — strictly stronger than a time-boxed window.
//
// Doctrine honoured here: fixtures come from fixtures/ on the Node side and
// cross into the page as setInputFiles payloads / base64 drops — never
// fetched at test time, no network. Canaries are synthetic markers
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
  /** The reason-CODE toast text (presence asserted before the read). */
  toast: string | null
  /** The status-bar coded job error (unit-101 StatusBar `job-error`, presence asserted before the read). */
  jobError: string | null
  dropZoneVisible: boolean
  projectRows: number
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => {
    const w = window as unknown as { __zipPersistenceBridge?: unknown; __zipWorkbenchBridge?: unknown }
    return w.__zipPersistenceBridge !== undefined && w.__zipWorkbenchBridge !== undefined
  }, undefined, { timeout: 30_000 })
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

/**
 * Start the IN-PAGE autosave recorder (install it before the choosing
 * action): a page-side interval subscribes the bridge's save-state every
 * 50 ms and keeps an ordered transition arc. Page-side on purpose — a
 * Node-side poll starves behind long page commands.
 */
interface SaveArcWindow {
  __cc109SaveArc?: string[]
  __cc109SaveArcStop?: () => void
}

async function startAutosaveRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as SaveArcWindow
    const bridge = (window as unknown as { __zipPersistenceBridge: PersistenceBridge }).__zipPersistenceBridge
    const arc: string[] = []
    const push = (token: string): void => {
      if (arc[arc.length - 1] !== token) arc.push(token)
    }
    push(bridge.getSaveState().state)
    const timer = window.setInterval(() => push(bridge.getSaveState().state), 50)
    scope.__cc109SaveArc = arc
    scope.__cc109SaveArcStop = () => window.clearInterval(timer)
  })
}

/** Push the action boundary into the arc: everything counted must follow it. */
async function markIntakeAction(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as SaveArcWindow).__cc109SaveArc?.push('PICKED'))
}

/**
 * Await the CAUSAL autosave proof, all sampled in-page (no Node-side poll
 * starvation, no ordering race, no fixed sleep):
 *   1. the arc STARTED at `idle` (recorder installed before the action);
 *   2. the arc EVER reached `saved` — reachable only through
 *      persistence.performSave's success path, which requires
 *      `projectChanges > savedChanges` (an ACCEPTED project change: the
 *      machine passed through `dirty` and scheduled work) and is set only
 *      AFTER `writeProjectRow` awaited its IDB write;
 *   3. the project ROW exists in the store (`listProjects` ≥ 1) — the write
 *      itself, read back through the same service.
 * `dirty`/`saving` observability is deliberately NOT asserted: persistence
 * wires `visibilitychange → saveNow('hidden')` inside `open()` (the
 * file-chooser interception fires it), which can bypass the 2 s debounce the
 * instant the change lands — those transients then last under one sample
 * tick (measured: `idle → saved` with the whole write inside one 50 ms gap,
 * and `saved` can even precede a Node-side marker push). Sticky `saved` +
 * the row read-back carry the same guarantee race-free; a `PICKED` token is
 * recorded purely for diagnostics.
 */
async function awaitAutosaveSequence(page: Page, timeoutMs = 90_000): Promise<void> {
  try {
    await page.waitForFunction(
      async () => {
        const arc = (window as unknown as SaveArcWindow).__cc109SaveArc ?? []
        if (arc[0] !== 'idle' || !arc.includes('saved')) return false
        const rows = await (window as unknown as { __zipPersistenceBridge: PersistenceBridge }).__zipPersistenceBridge.listProjects()
        return rows.length >= 1
      },
      undefined,
      { timeout: timeoutMs, polling: 100 },
    )
  } catch (error) {
    const arc = await page.evaluate(() => (window as unknown as SaveArcWindow).__cc109SaveArc ?? [])
    throw new Error(`autosave never proved idle → … → saved + row ≥ 1 within ${String(timeoutMs)} ms — recorded arc: ${arc.length > 0 ? arc.join(' → ') : '(no sample)'}`, { cause: error })
  } finally {
    await page.evaluate(() => (window as unknown as SaveArcWindow).__cc109SaveArcStop?.())
  }
}

/** Subscribe to DOM quiescence: last-mutation clock on the app subtree
 *  (statuses, toasts, rows — everything the jobs store can re-render). */
async function installQuiescenceProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { __cc109LastMutationAt?: number }
    scope.__cc109LastMutationAt = Date.now()
    const observer = new MutationObserver(() => {
      scope.__cc109LastMutationAt = Date.now()
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
  })
}

/** Wait until the subscribed channel has been quiet for `quietMs`, capped.
 *  Bounded grace — callers already hard-asserted the positive outcomes, so a
 *  cap overrun proceeds into the (deterministic) read, it never skips it. */
async function waitForJobsQuiescence(page: Page, quietMs = 750, capMs = 20_000): Promise<void> {
  const deadline = Date.now() + capMs
  for (;;) {
    const quietFor = await page.evaluate(() => {
      const scope = window as unknown as { __cc109LastMutationAt?: number }
      return Date.now() - (scope.__cc109LastMutationAt ?? 0)
    })
    if (quietFor >= quietMs) return
    if (Date.now() > deadline) return
    await page.waitForTimeout(100)
  }
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

/**
 * Settle the rejection outcome for BOTH paths identically (parity legs):
 * hard-await presence of every coded outcome — the reason-CODE toast
 * (CC-101.2 never-silent) AND the probe-side status-bar `job-error` for the
 * oversized file (jobs.ts records job:error even with no running job) — then
 * jobs-channel quiescence, then ONE signature read. No time-boxed window
 * decides when the outcome is "done": presence is the gate.
 */
async function settleOutcomes(page: Page): Promise<IntakeSignature> {
  await expect(page.getByTestId('toast'), 'every rejected file is announced with its reason CODE — never silent (CC-101.2 doctrine the picker must share)').toBeVisible({ timeout: 40_000 })
  await expect(page.getByTestId('job-error'), 'the oversized file must surface its probe-side coded job:error — the unit-101 drop baseline does (jobs.ts job:error records even with no running job)').toBeVisible({ timeout: 90_000 })
  await waitForJobsQuiescence(page)
  return readSignature(page)
}

test.describe('CC-109.1: picker creates, previews and autosaves projects (chromium)', () => {
  test('CC-109.1: setInputFiles via media-intake-button creates asset, preview and autosaves the project', async ({ page }) => {
    test.setTimeout(240_000)
    await boot(page)
    await expect(page.getByTestId('drop-zone'), 'first-run screen (no asset)').toBeVisible({ timeout: 10_000 })
    await installQuiescenceProbe(page)
    await startAutosaveRecorder(page)
    await page.getByTestId('media-intake-button').setInputFiles({ name: 'tone-30s.wav', mimeType: 'audio/wav', buffer: fixtureBuffer('tone-30s.wav') })
    await markIntakeAction(page)
    await expect(page.getByTestId('drop-zone'), 'the chosen file runs the existing probe → createProject path (real media worker)').toBeHidden({ timeout: 40_000 })
    await page.getByTestId('tab-media').click()
    await expect(page.getByTestId('media-asset-card'), 'asset card appears from the probe asset').toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('stage-media'), 'preview stage mounts').toBeVisible()
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid=stage-video]') as HTMLMediaElement | null
      return el !== null && el.readyState >= 1
    }, undefined, { timeout: 60_000 })
    await awaitAutosaveSequence(page)
    const rows = await listProjects(page)
    expect(rows.length, 'autosaved project row (persistence bridge, unit-106 pattern — read after the in-page saved + row ≥ 1 gate)').toBe(1)
  })

  test('CC-109.1: project-intake-button creates AND opens a project from the Projects empty state', async ({ page }) => {
    test.setTimeout(240_000)
    await boot(page)
    await page.getByTestId('tab-media').click()
    await expect(page.getByTestId('project-list'), 'Projects area on the production build').toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('media-asset-card'), 'empty state — no media yet').toBeHidden()
    await installQuiescenceProbe(page)
    await startAutosaveRecorder(page)
    await page.getByTestId('project-intake-button').setInputFiles({ name: 'tone-30s.wav', mimeType: 'audio/wav', buffer: fixtureBuffer('tone-30s.wav') })
    await markIntakeAction(page)
    await expect(page.getByTestId('drop-zone'), 'project created through the same path the drop uses').toBeHidden({ timeout: 40_000 })
    await expect(page.getByTestId('media-asset-card'), 'and OPENED — asset card renders').toBeVisible({ timeout: 40_000 })
    await expect(page.getByTestId('project-name'), 'opened project owns the header').not.toHaveValue('', { timeout: 20_000 })
    await awaitAutosaveSequence(page)
    const rows = await listProjects(page)
    expect(rows.length, 'the created project persisted (read after the in-page saved + row ≥ 1 gate — on a cold page the row only exists once the autosave flushed)').toBe(1)
  })

})

test.describe('CC-109.2: picker cancellation and picker/drop parity (chromium)', () => {
  test('CC-109.2: cancelling the picker is a no-op — no asset, no project, no toast', async ({ page }) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`))
    await boot(page)
    await expect(page.getByTestId('drop-zone'), 'first-run screen').toBeVisible({ timeout: 10_000 })
    const rowsBefore = await listProjects(page)
    const stateBefore = await saveState(page)
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15_000 }),
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
    test.setTimeout(300_000)
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
    await installQuiescenceProbe(page)
    await dropOnto(page, '[data-testid=drop-zone]', badFiles)
    const dropOutcome = await settleOutcomes(page)

    await boot(page)
    await expect(page.getByTestId('drop-zone'), 'first-run screen before the picker selection').toBeVisible({ timeout: 10_000 })
    await installQuiescenceProbe(page)
    await page.getByTestId('media-intake-button').setInputFiles(badFiles.map((file) => ({ name: file.name, mimeType: file.type, buffer: Buffer.from(file.base64, 'base64') })))
    const pickerOutcome = await settleOutcomes(page)

    // Anchors keep the deepEqual honest: the DROP path is proven to produce
    // REAL coded outcomes (unit-101 CC-101.2 + probe-side job:error) — two
    // silent no-ops would fail here, they would not "compare as parity".
    expect(dropOutcome.toast, 'the drop path codes the unsupported file (unit-101 baseline)').toContain('UNSUPPORTED_TYPE')
    expect(dropOutcome.jobError, 'the drop path codes the oversized file through the probe (parity anchor on BOTH outcomes)').not.toBeNull()
    expect(dropOutcome.projectRows, 'the drop path creates no project from bad files').toBe(0)
    expect(pickerOutcome, 'the picker surfaces the identical coded outcome — same pipeline, no new error surface (US-109.2)').toEqual(dropOutcome)
    expect(pickerOutcome.projectRows, 'the picker path creates no project from bad files either').toBe(0)
  })

})

test.describe('CC-109.3: keyboard activation opens the file chooser (chromium)', () => {
  test('CC-109.3: keyboard Enter on media-intake-button opens the file chooser (Playwright filechooser event)', async ({ page }) => {
    test.setTimeout(120_000)
    await boot(page)
    await expect(page.getByTestId('drop-zone')).toBeVisible({ timeout: 10_000 })
    const button = page.getByTestId('drop-zone').getByRole('button', { name: /choose file/i })
    await expect(button, 'E1: visible, accessible button beside the drop copy (FR-109.2)').toBeVisible({ timeout: 10_000 })
    await button.focus()
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 15_000 }),
      page.keyboard.press('Enter'),
    ])
    expect(chooser, 'Enter on the focused button opens the OS file picker').not.toBeNull()
    expect(await chooser.element().getAttribute('type'), 'the chooser is bound to the component hidden file input').toBe('file')
    await chooser.setFiles([])
  })

})

test.describe('CC-109.4: console hygiene during the picker journey (chromium)', () => {
  test('CC-109.4: console stays codes/counts during the picker journey — no file names, no transcript strings (SECURITY-03)', async ({ page }) => {
    test.setTimeout(240_000)
    const lines: string[] = []
    const errors: string[] = []
    page.on('console', (message) => lines.push(`${message.type()}: ${message.text()}`))
    page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`))
    await boot(page)
    await expect(page.getByTestId('drop-zone')).toBeVisible({ timeout: 10_000 })
    // Transcript-side canary (synthetic marker, conventions § Principles 4):
    // rides the SAME injection seam a worker reply takes and FOLDS (pre-start
    // job:segments record verbatim per jobs.ts), so segment text genuinely
    // enters app state — any future path that logs it lands in the capture.
    await page.evaluate((marker) => {
      const w = window as unknown as { __zipWorkbenchBridge?: { injectAsrEvent(event: Record<string, unknown>): void } }
      w.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:segments', jobId: 'cc109-canary', segments: [{ start: 0, end: 2, speaker: 'S1', text: `canary transcript ${marker} must never be logged`, words: [{ start: 0, end: 1, text: marker }] }] })
    }, CANARY_MARKER)
    await installQuiescenceProbe(page)
    await startAutosaveRecorder(page)
    const canaryFileName = 'canary-recording-9f4c1e.wav'
    await page.getByTestId('media-intake-button').setInputFiles({ name: canaryFileName, mimeType: 'audio/wav', buffer: fixtureBuffer('tone-30s.wav') })
    await markIntakeAction(page)
    await expect(page.getByTestId('drop-zone'), 'the journey runs through intake — the canary NAME flows through the app as asset/project name').toBeHidden({ timeout: 40_000 })
    await awaitAutosaveSequence(page)
    // Absence-of-content is asserted only AFTER full quiescence: the save
    // arc completed AND the app subtree has been mutation-quiet (any late
    // async log lands before the read, never after it).
    await waitForJobsQuiescence(page, 1_000, 20_000)
    const joined = lines.join('\n')
    expect(joined, 'the chosen file NAME never reaches the console (SECURITY-03 — codes/counts only)').not.toContain('canary-recording')
    expect(joined, 'transcript-derived strings never reach the console').not.toContain(CANARY_MARKER)
    expect(errors, 'no uncaught errors escape the picker journey (FR-109.3)').toEqual([])
  })
})
