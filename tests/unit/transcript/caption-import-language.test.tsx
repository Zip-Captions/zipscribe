// CC-112.5 / CC-112.6 (L2, jsdom): the Import-captions dialog Language field
// — the #54 gap. Today the field is `disabled` + permanently empty
// (CaptionImportDialog.tsx `title=CAPTION_IMPORT_LANGUAGE_UNBOUND`): the
// report's detected language is neither settable nor persisted. The unit-112
// acceptance (US-07.2, US-301.4): the field is NEVER permanently disabled —
// the detected language shows, the user can override it, the explicit choice
// wins at confirm, and the confirmed language persists through the frozen-
// legal seam (EditorApp.applyWithoutHistory — the same job-output doctrine
// unit-304's language plumbing uses; `CaptionsImportPayload` stays frozen).
//
// The stub port IS the analyzer (the engine port is covered at L1/L5); these
// legs pin the component contract: enabled-state logic (detected / user-set /
// honest null fallback) + confirm-time persistence.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { block, sampleProject, speaker, word } from '../editor/helpers/fixture-project'
import { installDomStubs } from './helpers/dom-stubs'
import { CaptionImportDialog } from '@ui/transcript/CaptionImportDialog'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import type { CaptionBlock, Project } from '@engine/model@104'
import type { CaptionImportPort } from '@state/services/caption-import'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'

const SPEAKERS = [speaker('SPK_1', 'Speaker 1', '#4c8dff')]
const SOURCE = [block('blk_a', 0, 2, 'SPK_1', [word('alpha', 0, 1)]), block('blk_b', 3, 5, 'SPK_1', [word('beta', 3, 4)]), block('blk_c', 6, 8, 'SPK_1', [word('gamma', 6, 7)])]
const IMPORTED: CaptionBlock[] = [block('imp-0', 0, 1, 'SPK_1', [word('one', 0, 1)]), block('imp-1', 2, 3, 'SPK_1', [word('two', 2, 3)])]

function baseProject(): Project {
  return sampleProject({ language: null, speakers: SPEAKERS.map((s) => ({ ...s })), blocks: SOURCE.map((b) => ({ ...b, words: b.words.map((w) => ({ ...w })) })) })
}

function stubPort(detectedLanguage: string | null): CaptionImportPort {
  return {
    analyze: async () => ({
      report: { format: 'srt', encoding: 'utf-8', cues: IMPORTED.length, blocks: IMPORTED.length, detectedLanguage, adjustments: [] } as never,
      blocks: IMPORTED.map((b) => ({ ...b, words: b.words.map((w) => ({ ...w })) })),
      speakers: SPEAKERS,
    }),
  }
}

const FILE = { arrayBuffer: async () => new Uint8Array([1]).buffer, name: 'captions.srt' } as unknown as File

let APP: ReturnType<typeof createTestApp>

async function openDialog(detectedLanguage: string | null): Promise<void> {
  await act(async () => {
    render(<CaptionImportDialog file={FILE} port={stubPort(detectedLanguage)} app={APP.app} onClose={() => undefined} />)
  })
  await act(async () => {
    await vi.waitFor(() => expect(screen.queryByTestId('caption-import-report')).toBeTruthy(), { timeout: 1000 })
  })
}

function languageField(): HTMLInputElement {
  return screen.getByTestId('caption-import-language') as HTMLInputElement
}

afterEach(() => {
  cleanup()
  APP?.app.dispose()
})

describe('CC-112.5: the Import dialog Language field is visible, settable, and drives persistence', () => {
  test('CC-112.5: with a detected language the field SHOWS it and is not permanently disabled (#54)', async () => {
    if (CHILD) return
    installDomStubs()
    APP = createTestApp({ project: baseProject() })
    await openDialog('en')
    const field = languageField()
    expect(field.value, 'the detected language is shown as evidence (US-07.2)').toBe('en')
    expect(field.disabled, 'the field is NOT permanently disabled — an explicit choice must be settable (US-301.4)').toBe(false)
    expect(field.readOnly, 'a settable field is not readOnly').toBe(false)
  })

  test('CC-112.5: with NO detected language the field stays settable (honest fallback — never a permanently dead control)', async () => {
    if (CHILD) return
    installDomStubs()
    APP = createTestApp({ project: baseProject() })
    await openDialog(null)
    const field = languageField()
    expect(field.value, 'nothing detected — honestly empty, not a fake value').toBe('')
    expect(field.disabled, 'the absent-detection fallback is still settable by the user').toBe(false)
    await act(async () => {
      fireEvent.change(field, { target: { value: 'es' } })
    })
    expect(field.value, 'the user can type a language even when detection answered nothing').toBe('es')
  })

  test('CC-112.5 CC-112.6: an explicitly typed language WINS over detection and persists at confirm (frozen-legal command/job-output seam)', async () => {
    if (CHILD) return
    installDomStubs()
    const spy = createRedactionSpy()
    APP = createTestApp({ project: baseProject() })
    await openDialog('en')
    const field = languageField()
    await act(async () => {
      fireEvent.change(field, { target: { value: 'fr' } })
    })
    expect(field.value, 'the user edit sticks against the detected value').toBe('fr')
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-import-confirm'))
    })
    const language = APP.app.project.getState().project?.language
    expect(language, 'the EXPLICIT choice persists — not the detection (#51/US-301.4 doctrine)').toBe('fr')
    expect(spy.settle().clean, 'no caption content reached a console channel').toBe(true)
    spy.restore()
  })

  test('CC-112.6: untouched, the detected language persists at confirm (Languages section truth, #54)', async () => {
    if (CHILD) return
    installDomStubs()
    APP = createTestApp({ project: baseProject() })
    await openDialog('en')
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-import-confirm'))
    })
    const language = APP.app.project.getState().project?.language
    expect(language, 'a detected language is recorded — the Languages section must stop lying (#54)').toBe('en')
  })
})
