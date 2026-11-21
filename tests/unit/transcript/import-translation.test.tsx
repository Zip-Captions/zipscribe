// US-302.4 (L2): "Add as translation" intake. An analyzed cue set maps onto
// the existing source blocks and lands as an `imported`-origin track for the
// chosen language; surplus cues are REPORTED (dialog stays open — no silent
// drop). SECURITY-03: a canary rides the imported cue text so the redaction spy
// is non-vacuous (imported text must never reach a console channel).
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { block, word, speaker, sampleProject } from '../editor/helpers/fixture-project'
import { installDomStubs } from './helpers/dom-stubs'
import { CaptionImportDialog } from '@ui/transcript/CaptionImportDialog'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'
import type { CaptionBlock, Project } from '@engine/model@104'
import type { CaptionImportPort } from '@state/services/caption-import'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'

const SPEAKERS = [speaker('SPK_1', 'Speaker 1', '#4c8dff')]
const SOURCE = [block('blk_a', 0, 2, 'SPK_1', [word('alpha', 0, 1)]), block('blk_b', 3, 5, 'SPK_1', [word('beta', 3, 4)]), block('blk_c', 6, 8, 'SPK_1', [word('gamma', 6, 7)])]

function baseProject(): Project {
  return sampleProject({ language: 'en', speakers: SPEAKERS.map((s) => ({ ...s })), blocks: SOURCE.map((b) => ({ ...b, words: b.words.map((w) => ({ ...w })) })) })
}

// Cue 0 carries the canary so any leak of imported text to a console channel
// (SECURITY-03) is caught; DOM rendering of it is expected and not a leak.
function stubPort(cueCount: number): CaptionImportPort {
  const blocks: CaptionBlock[] = Array.from({ length: cueCount }, (_, i) => {
    const text = i === 0 ? `${CANARY_MARKER} cue${String(i)}` : `cue${String(i)}`
    return block(`imp-${String(i)}`, i, i + 1, 'SPK_1', [word(text, i, i + 1)])
  })
  return {
    analyze: async () => ({
      report: { format: 'srt', encoding: 'utf-8', cues: cueCount, blocks: cueCount, detectedLanguage: 'fr', adjustments: [] } as never,
      blocks,
      speakers: SPEAKERS,
    }),
  }
}

const FILE = { arrayBuffer: async () => new Uint8Array([1]).buffer, name: 'fr.srt' } as unknown as File

async function openAsTranslation(pagePort: CaptionImportPort, onClose: () => void): Promise<void> {
  await act(async () => {
    render(<CaptionImportDialog file={FILE} port={pagePort} app={APP.app} onClose={onClose} />)
  })
  await act(async () => {
    await vi.waitFor(() => expect(screen.queryByTestId('caption-import-report')).toBeTruthy(), { timeout: 1000 })
  })
  act(() => fireEvent.click(screen.getByTestId('caption-import-use-translation')))
  await act(async () => {})
  const langInput = screen.getByTestId('caption-import-target-language') as HTMLInputElement
  await act(async () => {
    fireEvent.change(langInput, { target: { value: 'fr' } })
  })
}

let APP: ReturnType<typeof createTestApp>

afterEach(() => {
  cleanup()
  APP?.app.dispose()
})

describe('US-302.4: import as translation', () => {
  test('US-302.4: Add-as-translation creates an imported track and fills matched entries (clean import closes)', async () => {
    if (CHILD) return
    installDomStubs()
    const spy = createRedactionSpy()
    APP = createTestApp({ project: baseProject() })
    let done = false
    await openAsTranslation(stubPort(2), () => {
      done = true
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-import-confirm'))
    })
    expect(done, 'clean import (no surplus) closes the dialog').toBe(true)
    const track = APP.app.project.getState().project?.translations.find((x) => x.language === 'fr')
    expect(track?.origin, 'imported origin').toBe('imported')
    expect(Object.keys(track?.entries ?? {}).length, 'two cues matched to two source blocks').toBe(2)
    expect(spy.settle().clean, 'no imported text reached a console channel').toBe(true)
    spy.restore()
  })

  test('US-302.4: surplus cues are REPORTED (dialog stays open) and only matched blocks receive entries', async () => {
    if (CHILD) return
    installDomStubs()
    const spy = createRedactionSpy()
    APP = createTestApp({ project: baseProject() })
    let closed = false
    await openAsTranslation(stubPort(5), () => {
      closed = true
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-import-confirm'))
    })
    // 5 cues into a 3-block source → 2 unmatched, surfaced (dialog stays open).
    expect(closed, 'surplus keeps the dialog open to report unmatched').toBe(false)
    const report = screen.getByTestId('caption-import-unmatched')
    expect(report.textContent, 'the unmatched count is reported').toContain('2')
    expect(screen.getByTestId('caption-import-confirm').textContent).toBe('Done')
    const track = APP.app.project.getState().project?.translations.find((x) => x.language === 'fr')
    expect(Object.keys(track?.entries ?? {}).length, 'only the 3 source blocks receive entries').toBe(3)
    expect(spy.settle().clean, 'no imported text reached a console channel').toBe(true)
    spy.restore()
  })
})
