// CC-101.1 (L2, jsdom): layout spec — resize persistence via the settings
// store + fake storage, Ctrl+Alt+2/3 collapse, minimum-size enforcement, and
// the streaming-update path (status live-region + canary redaction).
//
// Contract: US-2.0.1 + FR-2.0.1/FR-2.0.4 — "only panel sizes change; no
// layout thrash … minimum panel sizes enforced, sizes persisted to settings
// (IDB via unit-106 seam)"; collapse `Ctrl+Alt+2/3` (Clipchamp-style,
// design.md shortcut table); status bar job progress as a polite live region.
// Pointer-drag physics is unit-102+ behavior; this suite drives resize through
// the frozen `setPanelSize` seam and asserts handle presence + clamping +
// persistence (the CLS half of CC-101.1 is e2e/workbench/layout.spec.ts).
//
// RED: `@ui/shell/Workbench`, `@state/*` (not built) and `@testing-library/*`
// (approved devDeps, not yet installed) fail module resolution.
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { mountWorkbench } from './helpers/mount'
import { MIN_SIDEBAR_PX, MIN_TIMELINE_PX, SETTINGS_STORAGE_KEY } from '@state/settings'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'

afterEach(cleanup)

describe('CC-101.1: workbench layout primitives', () => {
  test('CC-101.1: the shell renders three focusable regions, resize handles, the reserved canvas layer and the Style placeholder', async () => {
    await mountWorkbench({ project: {} })
    for (const region of ['sidebar', 'stage', 'timeline'] as const) {
      const panel = screen.getByTestId(`panel-${region}`)
      expect(panel.getAttribute('data-region'), `panel-${region} carries data-region`).toBe(region)
      expect(panel.getAttribute('tabindex'), `panel-${region} is programmatically focusable (Alt+N)`).toBe('-1')
    }
    const sidebarHandle = screen.getByTestId('resize-handle-sidebar')
    expect(sidebarHandle.getAttribute('role'), 'sidebar resize handle is a separator').toBe('separator')
    expect(screen.getByTestId('resize-handle-timeline').getAttribute('role')).toBe('separator')
    expect(screen.getByTestId('preview-canvas-layer'), 'stage reserves the Intent-3 canvas overlay layer').toBeTruthy()
    expect(screen.getByTestId('tab-style').textContent, 'Style tab is the Intent-3 placeholder (FR-2.0.3)').toMatch(/Intent 3/)
  })

  test('CC-101.1: setPanelSize enforces minimums and persists the clamped size to the settings storage seam', async () => {
    const { settings, writes } = await mountWorkbench({ project: {} })
    settings.setPanelSize('sidebar', 90)
    expect(settings.getState().panels.sidebarPx, 'undersized sidebar clamps to MIN_SIDEBAR_PX').toBe(MIN_SIDEBAR_PX)
    settings.setPanelSize('timeline', 10)
    expect(settings.getState().panels.timelinePx, 'undersized timeline clamps to MIN_TIMELINE_PX').toBe(MIN_TIMELINE_PX)
    settings.setPanelSize('sidebar', 420)
    expect(settings.getState().panels.sidebarPx).toBe(420)

    await waitFor(() => expect(writes.length, 'every resize persists through the unit-106 storage seam').toBeGreaterThanOrEqual(3))
    const last = writes.at(-1)
    expect(last?.key, 'writes go to the frozen settings key').toBe(SETTINGS_STORAGE_KEY)
    const persisted = JSON.parse(last?.value ?? '{}') as { panels?: { sidebarPx?: number; timelinePx?: number } }
    expect(persisted.panels?.sidebarPx, 'the CLAMPED value — never the rejected request — is what persists').toBe(420)
    expect(persisted.panels?.timelinePx).toBe(MIN_TIMELINE_PX)
  })

  test('CC-101.1: a fresh store hydrates the persisted panel sizes (reload keeps the layout)', async () => {
    const first = await mountWorkbench({ project: {} })
    first.settings.setPanelSize('sidebar', 500)
    await waitFor(() => expect(first.writes.length).toBeGreaterThanOrEqual(1))
    cleanup()

    const again = await mountWorkbench({ project: {}, storageInitial: { [SETTINGS_STORAGE_KEY]: first.writes.at(-1)?.value ?? '' } })
    expect(again.settings.getState().panels.sidebarPx, 'sizes survive the reload through the storage seam (US-2.0.1)').toBe(500)
  })

  test('CC-101.1: Ctrl+Alt+2 collapses the sidebar and Ctrl+Alt+3 the timeline (Clipchamp-style)', async () => {
    const { settings } = await mountWorkbench({ project: {} })
    fireEvent.keyDown(window, { key: '2', ctrlKey: true, altKey: true })
    expect(settings.getState().collapsed.sidebar, 'Ctrl+Alt+2 collapses the sidebar').toBe(true)
    await waitFor(() => expect(screen.queryByTestId('panel-sidebar'), 'collapsed sidebar leaves the layout').toBeNull())

    fireEvent.keyDown(window, { key: '3', ctrlKey: true, altKey: true })
    expect(settings.getState().collapsed.timeline, 'Ctrl+Alt+3 collapses the timeline').toBe(true)
    await waitFor(() => expect(screen.queryByTestId('panel-timeline')).toBeNull())

    fireEvent.keyDown(window, { key: '2', ctrlKey: true, altKey: true })
    expect(settings.getState().collapsed.sidebar, 'the chord toggles back').toBe(false)
    await waitFor(() => expect(screen.queryByTestId('panel-sidebar')).toBeTruthy())
  })

  test('CC-101.1: streaming job:segments renders rows and the status bar announces progress in a polite live region — canary stays out of the console', async () => {
    const spy = createRedactionSpy()
    try {
      const { engine, jobs } = await mountWorkbench({ project: {} })
      const jobId = 'job-stream-1'
      act(() => {
        engine.emitAsr({ t: 'job:progress', jobId, processedSec: 60, totalSec: 120 })
      })
      const status = screen.getByTestId('status-bar')
      expect(status.getAttribute('aria-live'), 'job progress is announced politely (FR-2.0.4)').toBe('polite')
      expect(status.textContent, 'progress % visible while running (60/120 s)').toMatch(/50\s?%/)

      act(() => {
        engine.emitAsr({
          t: 'job:segments',
          jobId,
          segments: [
            { start: 0, end: 1.5, text: 'first streamed line', words: [{ text: 'first', start: 0, end: 0.7 }] },
            { start: 1.5, end: 3, text: CANARY_MARKER, words: [{ text: CANARY_MARKER, start: 1.5, end: 3 }] },
          ],
        })
      })
      expect(jobs.getState().segments.length, 'jobs slice accumulates streamed segments (FR-2.0.6)').toBe(2)
      await waitFor(() => expect(screen.getAllByTestId('streaming-segment-row').length, 'streaming rows render beyond the frontier').toBe(2))

      act(() => {
        engine.emitAsr({ t: 'job:done', jobId, stats: { language: 'en' } })
      })
      expect(jobs.getState().running, 'job:done clears the running job').toBeNull()

      const verdict = spy.settle()
      expect(verdict.leaks, 'canary transcript text never reaches a console channel (SECURITY-03)').toEqual([])
    } finally {
      spy.restore()
    }
  })
})
