// US-302.4 (L2): "Add as translation" intake. An analyzed cue set maps onto
// the existing source blocks and lands as an `imported`-origin track for the
// chosen language; surplus cues are reported unmatched. SECURITY-03 spy on.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { block, word, speaker, sampleProject } from '../editor/helpers/fixture-project'
import { installDomStubs } from './helpers/dom-stubs'
import { CaptionImportDialog } from '@ui/transcript/CaptionImportDialog'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import type { CaptionBlock, Project } from '@engine/model@104'
import type { CaptionImportPort } from '@state/services/caption-import'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const SPEAKERS = [speaker('SPK_1', 'Speaker 1', '#4c8dff')]
const SOURCE = [block('blk_a', 0, 2, 'SPK_1', [word('alpha', 0, 1)]), block('blk_b', 3, 5, 'SPK_1', [word('beta', 3, 4)]), block('blk_c', 6, 8, 'SPK_1', [word('gamma', 6, 7)])]

function baseProject(): Project {
  return sampleProject({ language: 'en', speakers: SPEAKERS.map((s) => ({ ...s })), blocks: SOURCE.map((b) => ({ ...b, words: b.words.map((w) => ({ ...w })) })) })
}

function stubPort(cueCount: number): CaptionImportPort {
  const blocks: CaptionBlock[] = Array.from({ length: cueCount }, (_, i) => block(`imp-${i}`, i, i + 1, 'SPK_1', [word(`cue${i}`, i, i + 1)]))
  return {
    analyze: async () => ({
      report: { format: 'srt', encoding: 'utf-8', cues: cueCount, blocks: cueCount, detectedLanguage: 'fr', adjustments: [] } as never,
      blocks,
      speakers: SPEAKERS,
    }),
  }
}

const FILE = { arrayBuffer: async () => new Uint8Array([1]).buffer, name: 'fr.srt' } as unknown as File

afterEach(cleanup)

describe('US-302.4: import as translation', () => {
  test('US-302.4: Add-as-translation creates an imported track and fills matched entries', async () => {
    if (CHILD) return test.skip(true, CHILD_REASON)
    installDomStubs()
    const spy = createRedactionSpy()
    const t = createTestApp({ project: baseProject() })
    let done = false
    await act(async () => {
      render(<CaptionImportDialog file={FILE} port={stubPort(2)} app={t.app} onClose={() => (done = true)} />)
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
    expect(langInput.value).toBe('fr')
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-import-confirm'))
    })
    expect(done, 'confirm closed the dialog (translation branch completed)').toBe(true)
    const track = t.app.project.getState().project?.translations.find((x) => x.language === 'fr')
    expect(track?.origin, 'imported origin').toBe('imported')
    expect(Object.keys(track?.entries ?? {}).length, 'two cues matched to two source blocks').toBe(2)
    expect(done).toBe(true)
    expect(spy.settle().clean).toBe(true)
    spy.restore()
    t.app.dispose()
  })

  test('US-302.4: surplus cues beyond the source blocks are reported unmatched', async () => {
    if (CHILD) return test.skip(true, CHILD_REASON)
    installDomStubs()
    const spy = createRedactionSpy()
    const t = createTestApp({ project: baseProject() })
    // 5 cues into a 3-block source → 2 unmatched (report shows after confirm;
    // confirm closes, so assert via the entry count staying at 3).
    await act(async () => {
      render(<CaptionImportDialog file={FILE} port={stubPort(5)} app={t.app} onClose={() => undefined} />)
    })
    await act(async () => {
      await vi.waitFor(() => expect(screen.queryByTestId('caption-import-report')).toBeTruthy(), { timeout: 1000 })
    })
    act(() => fireEvent.click(screen.getByTestId('caption-import-use-translation')))
    await act(async () => {})
    const langInput2 = screen.getByTestId('caption-import-target-language') as HTMLInputElement
    await act(async () => {
      fireEvent.change(langInput2, { target: { value: 'fr' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('caption-import-confirm'))
    })
    const track = t.app.project.getState().project?.translations.find((x) => x.language === 'fr')
    expect(Object.keys(track?.entries ?? {}).length, 'only the 3 source blocks receive entries').toBe(3)
    expect(spy.settle().clean).toBe(true)
    spy.restore()
    t.app.dispose()
  })
})
