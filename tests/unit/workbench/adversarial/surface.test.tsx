// ADVERSARY unit-101 (category 2b: SURFACE) — the shell/drop-zone/keyboard/
// bridge against hostile user sequences: a rejecting importer dropped onto the
// live shell (unhandled rejections? silent drops?), the editing guards on the
// FULL keydown path (not just the registry seam), unsupported-only drops
// (toast only, no partial project), and the ziptest bridge's production-path
// strictness (nothing exposed without a strict `?ziptest=1`).
//
// Reuses the frozen helpers (mount.tsx, drop.ts, fake-engine.ts) — additive
// probes only. Red tests here are FINDINGS; green tests are honest passes.
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { mountWorkbench } from '../helpers/mount'
import { dispatchDrop } from '../helpers/drop'
import { CANNED_IMPORT_RESULT, makeCaptionFile, makeMediaFile, makeWrongTypeFile, MEDIA_ASSET } from '../helpers/fake-engine'
import type { ImportCaptionsService } from '@state/services/intake'
import { App } from '../../../../src/App'

afterEach(cleanup)

function dropZoneEl(): HTMLElement {
  return screen.getByTestId('drop-zone')
}

describe('ADVERSE SURF: the shell under hostile drops, hostile typing and hostile URLs', () => {
  test('ADVERSE IN.9: CC-101.2 no-silent-drops (L2) — dropping media + a caption whose import REJECTS must surface a toast and still probe the media, never escape as an unhandled rejection (attack: hostile seam through the live drop path)', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onRejection)
    try {
      const hostile: ImportCaptionsService = {
        sniff: async (file) => (file.name.endsWith('.vtt') ? 'vtt' : null),
        importCaptions: () => Promise.reject(new Error('caption_import_failure')),
      }
      const { engine } = await mountWorkbench({ importService: hostile })
      dispatchDrop(dropZoneEl(), [makeMediaFile(), makeCaptionFile('broken.vtt')])

      await waitFor(
        () => {
          expect(screen.getByTestId('toast'), 'a failing drop must be announced (CC-101.2: no silent drops)').toBeTruthy()
        },
        { timeout: 2000 },
      )
      expect(engine.mediaRequests.filter((request) => request.t === 'probe').length, 'the healthy media of the drop must still reach the media worker').toBe(1)
      expect(rejections, 'the intake failure must be caught at the UI boundary, not escape as an unhandled rejection').toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  test('ADVERSE SURF.1: CC-101.5 editing guards on the full keydown path — Alt+1 must not steal focus from the project-name input and Ctrl+Alt+2 must not collapse while it is edited (attack: window keydown with the inline edit focused)', async () => {
    const { settings } = await mountWorkbench({ project: {} })
    const input = screen.getByTestId('project-name')

    fireEvent.keyDown(window, { key: '3', altKey: true })
    expect((document.activeElement as HTMLElement).getAttribute('data-region'), 'sanity: Alt+3 reaches the timeline when not editing').toBe('timeline')

    act(() => {
      input.focus()
    })
    fireEvent.keyDown(window, { key: '1', altKey: true })
    expect(document.activeElement, 'Alt+1 must NOT move focus out of the inline project-name edit').toBe(input)

    fireEvent.keyDown(window, { key: '2', altKey: true, ctrlKey: true })
    expect(settings.getState().collapsed.sidebar, 'Ctrl+Alt+2 must NOT collapse while the inline edit has focus').toBe(false)

    act(() => {
      input.blur()
    })
    fireEvent.keyDown(window, { key: '1', altKey: true })
    expect((document.activeElement as HTMLElement).getAttribute('data-region'), 'outside the editing path the chord works again').toBe('sidebar')
  })

  test('ADVERSE SURF.2: CC-101.5 guard covers the popover SELECT — Alt+1 while the language select is focused must not steal focus (attack: keyboard focus inside the popover during chord use)', async () => {
    await mountWorkbench({ project: {} })
    fireEvent.click(screen.getByTestId('transcribe-button'))
    const select = screen.getByTestId('transcribe-language-select')
    act(() => {
      select.focus()
    })

    fireEvent.keyDown(window, { key: '1', altKey: true })
    expect(document.activeElement, 'the select is a keyboard-editing path — focus must stay').toBe(select)
  })

  test('ADVERSE SURF.3: CC-101.2 unsupported-only drop — toast with reason CODES and NOTHING else (attack: mixed unsupported types must produce no probe, no project, no import report)', async () => {
    const { engine, project } = await mountWorkbench()
    dispatchDrop(dropZoneEl(), [makeWrongTypeFile('notes.txt'), new File(['{"not":"zipscribe"}'], 'data.json', { type: 'application/json' })])

    await waitFor(() => expect(screen.getByTestId('toast')).toBeTruthy())
    const toast = screen.getByTestId('toast')
    expect(toast.textContent).toContain('UNSUPPORTED_TYPE')
    expect(toast.textContent).toContain('UNSUPPORTED_CAPTION')
    expect(engine.mediaRequests.length, 'no probe for unsupported files').toBe(0)
    expect(project.getState().project, 'toast only — no partial project').toBeNull()
    expect(screen.queryByTestId('import-report'), 'no import report for a drop that imported nothing').toBeNull()
  })

  test('ADVERSE SURF.4: US-2.0.2 caption-first through the UI — dropping [caption, media] (caption first) creates the project WITH the imported track and shows the report (attack: order dependence in the live drop path)', async () => {
    const { project } = await mountWorkbench()
    dispatchDrop(dropZoneEl(), [makeCaptionFile('vendor.vtt'), makeMediaFile()])

    await waitFor(() => expect(screen.getByTestId('import-report')).toBeTruthy())
    expect(project.getState().project?.captionOrigin).toBe('imported')
    expect(project.getState().project?.blocks.length).toBe(CANNED_IMPORT_RESULT.blocks.length)
    expect((screen.getByTestId('export-button') as HTMLButtonElement).disabled, 'imported blocks enable Export (FR-2.0.2)').toBe(false)
  })

  test('ADVERSE BRIDGE.1: contract § Window __zipWorkbenchBridge production-path strictness — NO flag variant other than the strict `ziptest=1` may expose the bridge (attack: ?ziptest=0/1x/true/empty and a case-mismatched param; importing the bridge module itself must not self-install)', async () => {
    const variants: readonly { search: string; expectsBridge: boolean }[] = [
      { search: '', expectsBridge: false },
      { search: '?ziptest=0', expectsBridge: false },
      { search: '?ziptest=1x', expectsBridge: false },
      { search: '?ziptest=true', expectsBridge: false },
      { search: '?ziptest', expectsBridge: false },
      { search: '?ZIptest=1', expectsBridge: false },
      { search: '?ziptest=1', expectsBridge: true },
    ]
    for (const { search, expectsBridge } of variants) {
      cleanup()
      delete (window as unknown as Record<string, unknown>).__zipWorkbenchBridge
      window.history.replaceState({}, '', `/${search}`)
      render(<App />)
      await waitFor(() => expect(screen.getByTestId('workbench-shell')).toBeTruthy(), { timeout: 5000 })
      if (expectsBridge) {
        await waitFor(() => expect(window.__zipWorkbenchBridge).toBeDefined(), { timeout: 2000 })
        const bridge = window.__zipWorkbenchBridge
        expect(bridge).toBeDefined()
        for (const method of ['injectMediaEvent', 'injectAsrEvent', 'setCaptionImportOverride', 'openProject'] as const) {
          expect(typeof bridge?.[method], `bridge method ${method} present under the strict flag`).toBe('function')
        }
      } else {
        expect(window.__zipWorkbenchBridge, `search '${search}' must NOT expose the test bridge on the production path`).toBeUndefined()
      }
    }

    // Loading the module must never self-install (the gate lives in App, not in module side effects).
    cleanup()
    delete (window as unknown as Record<string, unknown>).__zipWorkbenchBridge
    await import('@ui/testing/workbench-bridge')
    expect(window.__zipWorkbenchBridge, 'a mere import of the bridge module must not expose it').toBeUndefined()
  })

  test('ADVERSE BRIDGE.2: positive control — under strict `?ziptest=1` the bridge reaches the SAME production receivers (attack: prove BRIDGE.1 can fail by making openProject work for real)', async () => {
    delete (window as unknown as Record<string, unknown>).__zipWorkbenchBridge
    window.history.replaceState({}, '', '/?ziptest=1')
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('workbench-shell')).toBeTruthy(), { timeout: 5000 })
    await waitFor(() => expect(window.__zipWorkbenchBridge).toBeDefined(), { timeout: 2000 })

    act(() => {
      window.__zipWorkbenchBridge?.openProject(MEDIA_ASSET)
    })
    await waitFor(() => expect(screen.queryByTestId('drop-zone')).toBeNull())
    expect((screen.getByTestId('project-name') as HTMLInputElement).value, 'the bridge project flows through the same intake path a probe reply takes').toBe('speech-2min')
    fireEvent.click(screen.getByTestId('tab-media'))
    expect(screen.queryByTestId('media-asset-card'), 'Media tab renders the bridged asset').not.toBeNull()
  })
})
