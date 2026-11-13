// CC-106.5 + FR-106.5 (L2, jsdom): the Media-tab project list — rows sorted
// updatedAt DESC with the pinned testids (project-list / project-row-<id> /
// project-open-<id> / project-duplicate-<id> / project-delete-<id> /
// new-project-button / storage-estimate), open/new/duplicate/delete buttons
// dispatch into the service, opening restores lastPlayhead + selection into
// the EditorStore (FR-106.5), the delete undo toast (delete-undo-toast /
// delete-undo-button) cancels the purge on click and COMMITS it (all three
// stores) when the injected timers expire, the interrupted-transcription
// banner renders for a `partial` project (copy = kept-block count, a number
// only — SECURITY-03), and a future-schema row shows `read-only-banner`.
// Seam pinned in unit106-api-contract.d.ts: `ProjectList({ persistence,
// onOpen, timers?, editor? })`. RED until the builder ships
// `src/ui/shell/ProjectList.tsx` (dynamic import — intended missing-module
// seam; self-skips under the gates-scaffold child run).
// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { createEditorStore } from '@state/editor'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'
import { CANNED_PANEL_STATE, createFakePersistenceService, createFakeTimers, makeProjectRow } from './helpers/fake-persistence'
import type { FakePersistenceService, FakeTimers } from './helpers/fake-persistence'
import type { LoadedProject, ProjectRow } from '@state/services/persistence'
import type { Project } from '@engine/model@102'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const PROJECT_LIST_MODULE = '@ui/shell/ProjectList'
type ProjectListModule = typeof import('@ui/shell/ProjectList')

interface Mounted {
  persistence: FakePersistenceService
  timers: FakeTimers
  opened: { id: string; loaded: LoadedProject | null }[]
  editor: ReturnType<typeof createEditorStore>
}

async function mountList(seed: (persistence: FakePersistenceService) => void = () => undefined): Promise<Mounted> {
  const persistence = createFakePersistenceService()
  seed(persistence)
  const timers = createFakeTimers()
  const editor = createEditorStore()
  const opened: Mounted['opened'] = []
  const mod = (await import(/* @vite-ignore */ PROJECT_LIST_MODULE)) as unknown as ProjectListModule
  await act(async () => {
    render(
      <mod.ProjectList
        persistence={persistence}
        editor={editor}
        timers={timers}
        onOpen={(id, loaded) => {
          opened.push({ id, loaded })
        }}
      />,
    )
  })
  await screen.findByTestId('project-list')
  return { persistence, timers, opened, editor }
}

function rowIds(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="project-row-"]')).map((el) => (el.getAttribute('data-testid') ?? '').replace('project-row-', ''))
}

function canaryProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj_canary',
    name: `Canary ${CANARY_MARKER.slice(0, 0)}project`,
    schemaVersion: 1,
    asset: { id: 'A', name: 'm.mp4', kind: 'video', container: 'mp4', audioCodec: 'aac', videoCodec: 'avc1', duration: 10, width: 640, height: 360, fps: 25, fingerprint: { name: 'm.mp4', size: 10, durationMs: 10000, sampleHashes: ['a', 'b', 'c'] } },
    blocks: [
      { id: 'blk_a', start: 0, end: 1, text: 'alpha', words: [{ text: 'alpha', start: 0, end: 1 }], speakerId: 'SPK_1' },
      { id: 'blk_b', start: 2, end: 3, text: `${CANARY_MARKER} tail`, words: [{ text: CANARY_MARKER, start: 2, end: 2.5 }, { text: 'tail', start: 2.5, end: 3 }], speakerId: 'SPK_1' },
    ],
    captionOrigin: 'transcribed',
    translations: [],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#4c8dff' }],
    speakerSource: 'auto-beta',
    language: 'en',
    modelId: null,
    style: { fontFamily: 'Inter', fontWeight: 400, fontSizePct: 8, textTransform: 'none', color: '#e8eaed', highlightColor: '#4c8dff', outlineColor: '#0d0f12', outlineWidth: 2, backgroundOpacity: 0, position: 'bottom', marginVPct: 6, alignment: 'center', maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false },
    outputAspect: 'source',
    transcription: 'complete',
    updatedAt: 1,
    ...overrides,
  }
}

let redaction: ReturnType<typeof createRedactionSpy>
afterEach(() => {
  cleanup()
  const verdict = redaction.settle()
  redaction.restore()
  expect(verdict.leaks, 'no canary content reached any console channel').toEqual([])
})

describe('CC-106.5 (L2): the project list rows, buttons and storage display', () => {
  test('CC-106.5: rows render in updatedAt DESC order with the pinned testids', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    redaction = createRedactionSpy()
    await mountList((p) => {
      p.rows.set('a', makeProjectRow('a', canaryProject({ id: 'a', name: 'Old', updatedAt: 100 })))
      p.rows.set('b', makeProjectRow('b', canaryProject({ id: 'b', name: 'Newest', updatedAt: 300 })))
      p.rows.set('c', makeProjectRow('c', canaryProject({ id: 'c', name: 'Middle', updatedAt: 200 })))
    })
    expect(rowIds(), 'sorted updatedAt DESC').toEqual(['b', 'c', 'a'])
    for (const id of ['b', 'c', 'a']) {
      expect(screen.getByTestId(`project-row-${id}`)).toBeTruthy()
      expect(screen.getByTestId(`project-open-${id}`), `open button for ${id}`).toBeTruthy()
      expect(screen.getByTestId(`project-duplicate-${id}`), `duplicate button for ${id}`).toBeTruthy()
      expect(screen.getByTestId(`project-delete-${id}`), `delete button for ${id}`).toBeTruthy()
    }
    expect(screen.getByTestId('new-project-button'), 'the FR-106.5 button set is complete').toBeTruthy()
  })

  test('CC-106.5: open / new / duplicate / delete buttons call the service', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    redaction = createRedactionSpy()
    const { persistence, opened } = await mountList((p) => {
      p.rows.set('x', makeProjectRow('x', canaryProject({ id: 'x', updatedAt: 5 })))
    })
    const user = userEvent.setup()

    await user.click(screen.getByTestId('project-open-x'))
    expect(persistence.calls.openProject, 'open uses openProject (the lastOpened touch), not loadProject').toEqual(['x'])
    expect(opened.at(-1)?.id, 'the caller learns which project opened').toBe('x')

    await user.click(screen.getByTestId('project-duplicate-x'))
    expect(persistence.calls.duplicateProject).toEqual(['x'])

    await user.click(screen.getByTestId('new-project-button'))
    expect(persistence.calls.createProjectRow.length, 'new flows through createProjectRow').toBe(1)

    await user.click(screen.getByTestId('project-delete-x'))
    expect(persistence.calls.deleteProject, 'delete is deferred until the toast decides').toEqual(['x'])
  })

  test('CC-106.5 / FR-106.7: the storage estimate renders from storageEstimate() (honest persisted flag)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    redaction = createRedactionSpy()
    const { persistence } = await mountList()
    persistence.setEstimate({ usage: 1_572_864, quota: 5 * 1024 ** 3, persisted: true, blobCacheBytes: 0 })
    await act(async () => {
      persistence.setSaveState({ state: 'idle' })
    })
    const estimate = await screen.findByTestId('storage-estimate')
    expect(estimate.textContent).toContain('MB')
    expect(estimate.textContent).toContain('GB')
    expect(estimate.textContent, 'the persist result is shown honestly').toContain('persistent on')
  })

  test('FR-106.5: opening a project restores lastPlayhead + selection into the EditorStore', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    redaction = createRedactionSpy()
    const { editor, opened } = await mountList((p) => {
      p.rows.set('r', makeProjectRow('r', canaryProject({ id: 'r' }), { panelState: { ...CANNED_PANEL_STATE, lastPlayhead: 42.5, selection: { anchorBlockId: 'blk_a', focusBlockId: 'blk_b' } } }))
    })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('project-open-r'))
    expect(editor.getState().playhead, 'lastPlayhead restored').toBe(42.5)
    expect(editor.getState().selection, 'selection restored').toEqual({ anchorBlockId: 'blk_a', focusBlockId: 'blk_b' })
    expect(opened.at(-1)?.loaded?.panelState?.lastPlayhead, 'the context also reaches the caller via onOpen').toBe(42.5)
  })

  test('CC-106.5: delete → undo toast cancels the purge; expiry on the injected timers COMMITS it (all three stores purged)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    redaction = createRedactionSpy()
    const { persistence, timers } = await mountList((p) => {
      p.rows.set('d', makeProjectRow('d', canaryProject({ id: 'd', updatedAt: 7 })))
      void p.storeMediaHandle('d', null, { name: 'm.mp4', size: 1, durationMs: 10, sampleHashes: ['a', 'b', 'c'] })
      void p.cacheMediaBlob('d', new Blob([new Uint8Array(4)]))
    })
    const user = userEvent.setup()

    await user.click(screen.getByTestId('project-delete-d'))
    const toast = await screen.findByTestId('delete-undo-toast')
    expect(toast.textContent, 'SECURITY-03: the toast is content-free (no project name/text)').not.toContain(CANARY_MARKER)

    await user.click(screen.getByTestId('delete-undo-button'))
    expect(persistence.deletions.get('d'), 'undo clicked').toEqual({ committed: 0, undone: 1 })
    await waitFor(() => expect(screen.queryByTestId('delete-undo-toast')).toBeNull())
    expect(persistence.rows.has('d'), 'undo keeps every row').toBe(true)
    expect(persistence.blobs.has('d'), 'blobCache row survives').toBe(true)

    await user.click(screen.getByTestId('project-delete-d'))
    await screen.findByTestId('delete-undo-toast')
    act(() => {
      timers.advance(600_000)
    })
    await waitFor(() => expect(persistence.deletions.get('d'), 'expiry committed the purge').toEqual({ committed: 1, undone: 1 }))
    expect(persistence.rows.has('d'), 'projects store purged').toBe(false)
    expect(persistence.handles.has('d'), 'mediaHandles store purged').toBe(false)
    expect(persistence.blobs.has('d'), 'blobCache store purged').toBe(false)
  })

  test('CC-106.2: a loaded project with transcription `partial` renders the interrupted-transcription banner (count only — SECURITY-03)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    redaction = createRedactionSpy()
    const { persistence } = await mountList((p) => {
      p.rows.set('i', makeProjectRow('i', canaryProject({ id: 'i', transcription: 'partial' })))
    })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('project-open-i'))
    const banner = await screen.findByTestId('interrupted-transcription')
    const copy = banner.textContent ?? ''
    expect(copy, 'copy contains the kept-block count (2)').toContain('2')
    expect(copy, 'the banner is a NUMBER — never transcript content').not.toContain(CANARY_MARKER)
    expect(persistence.calls.openProject, 'the banner follows a real open').toEqual(['i'])
  })

  test('CC-106.3: a future-schemaVersion row shows the read-only banner', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    redaction = createRedactionSpy()
    const { persistence } = await mountList((p) => {
      const row: ProjectRow = makeProjectRow('f', canaryProject({ id: 'f' }))
      p.rows.set('f', { ...row, schemaVersion: 2 })
    })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('project-open-f'))
    const loaded = (await persistence.loadProject('f')) as LoadedProject
    expect(loaded.readOnly, 'the fake derives readOnly from the future schemaVersion — same rule the service pins').toBe(true)
    expect(await screen.findByTestId('read-only-banner'), 'future-schema projects announce read-only mode').toBeTruthy()
  })

  test('CC-106.5: empty list renders the container (no rows, no crash) and the create path still works', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    redaction = createRedactionSpy()
    const { persistence } = await mountList()
    expect(rowIds()).toEqual([])
    const user = userEvent.setup()
    await user.click(screen.getByTestId('new-project-button'))
    expect(persistence.calls.createProjectRow.length).toBe(1)
  })
})
