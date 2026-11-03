// CC-101.2 (L2, jsdom): import drop zone — media + caption fixture sets
// (incl. media+captions together), wrong types rejected with a toast and no
// silent drops, and the "Try a sample clip" action hitting the app-served
// /samples/ path.
//
// Contract: US-2.0.2 + FR-2.0.3 (Media tab re-import shares the intake) —
// "centered drop zone accepts every video and audio format … by content sniff
// + extension … and a 'Try a sample clip' action loading a bundled sample
// (copied from fixtures/speech-2min.mp4 into public/samples/ at build —
// fixtures themselves are never served)"; "media and a caption file dropped
// together → project created with the imported source track … import report
// is shown; Transcribe stays available".
//
// Caption CONTENT is our own inline string and parsing goes through the
// injectable `ImportCaptionsService` seam (unit-07 is not merged — its
// `engine/captions` module is never imported here; the fake importer returns a
// canned `ImportReport`).
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mountWorkbench } from './helpers/mount'
import { dispatchDrop } from './helpers/drop'
import { CANNED_BLOCKS, createFakeImportService, makeCaptionFile, makeMediaFile, makeWrongTypeFile, MEDIA_ASSET } from './helpers/fake-engine'
import { SAMPLE_CLIP_URL } from '@state/services/intake'

afterEach(cleanup)

function dropZone(): HTMLElement {
  return screen.getByTestId('drop-zone')
}

describe('CC-101.2: import drop zone and empty state', () => {
  test('CC-101.2: first run shows the centered drop zone with tier status and the sample-clip action', async () => {
    const { jobs } = await mountWorkbench()
    jobs.setCapability({ tier: 'T2', reasons: [] })
    expect(dropZone(), 'no project → the drop zone doubles as the first-run screen').toBeTruthy()
    expect(screen.getByTestId('sample-clip-button'), 'bundled sample affordance').toBeTruthy()
    expect(screen.getByTestId('status-bar').textContent, 'tier status from the jobs store (mocked)').toMatch(/CPU/)
  })

  test('CC-101.2: dropping a fixture media file posts a probe and creates the project', async () => {
    const { engine, project } = await mountWorkbench()
    dispatchDrop(dropZone(), [makeMediaFile()])
    await waitFor(() => expect(engine.mediaRequests.some((request) => request.t === 'probe' && request.file.name === 'speech-2min.mp4'), 'the real fixture bytes reach the media worker as a probe').toBe(true))
    await waitFor(() => expect(project.getState().project, 'media:probed creates the project').not.toBeNull())
    const created = project.getState().project
    expect(created?.asset.id).toBe(MEDIA_ASSET.id)
    expect(created?.captionOrigin, 'media alone → nothing imported yet').toBe('none')
    expect(screen.queryByTestId('drop-zone'), 'empty state yields to the workbench').toBeNull()
  })

  test('CC-101.2: dropping media + a caption file together creates the imported source track and shows the import report', async () => {
    const { project, importService } = await mountWorkbench({ importService: createFakeImportService().service })
    dispatchDrop(dropZone(), [makeMediaFile(), makeCaptionFile()])
    await waitFor(() => expect(project.getState().project?.blocks.length, 'imported source track (unit-07 seam, faked)').toBe(CANNED_BLOCKS.length))
    const created = project.getState().project
    expect(created?.captionOrigin, 'imported captions, not a transcription').toBe('imported')
    expect(created?.transcription).toBe('none')

    const report = screen.getByTestId('import-report')
    expect(report.textContent, 'report numbers only — cues/blocks (SECURITY-03 safe)').toMatch(/42/)
    expect(report.textContent).toMatch(/40/)
    expect(report.textContent, 'adjustment codes are surfaced verbatim').toContain('OVERLAP_CLAMPED')
    expect(report.textContent).toContain('EMPTY_CUE_DROPPED')
    expect(screen.getByTestId('transcribe-button'), 'Transcribe stays available (it would replace or align)').toBeTruthy()
    expect(importService.importCalls.length, 'the caption file went through the seam').toBe(1)
  })

  test('CC-101.2: wrong-type files are rejected with a toast — never silently dropped', async () => {
    const { engine, project } = await mountWorkbench()
    dispatchDrop(dropZone(), [makeWrongTypeFile()])
    await waitFor(() => expect(screen.getByTestId('toast').textContent, 'rejection carries the reason CODE, never the file name (SECURITY-03)').toContain('UNSUPPORTED_TYPE'))
    expect(screen.getByTestId('drop-zone'), 'a rejected drop does not leave the empty state').toBeTruthy()
    expect(project.getState().project, 'no silent project creation').toBeNull()
    expect(engine.mediaRequests.length, 'a rejected file never reaches the media worker').toBe(0)
  })

  test('CC-101.2: the sample-clip action loads the app-served /samples/ path — the fixtures directory itself is never fetched', async () => {
    const sampleBytes = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]) // mp4 ftyp prefix — content is irrelevant behind the probe fake
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => new Response(input.toString().endsWith('.mp4') ? sampleBytes : '', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const { engine } = await mountWorkbench()
      await userEvent.click(screen.getByTestId('sample-clip-button'))
      await waitFor(() => expect(fetchSpy.mock.calls.length, 'the sample is fetched from the app origin').toBeGreaterThanOrEqual(1))
      const urls = fetchSpy.mock.calls.map((call) => String(call[0]))
      expect(urls.some((url) => url.includes(SAMPLE_CLIP_URL)), `sample request hits ${SAMPLE_CLIP_URL} (build-copied public/samples/)`).toBe(true)
      expect(urls.some((url) => url.includes('/fixtures/')), 'fixtures/ is never served — the app must not fetch from it').toBe(false)
      await waitFor(() => expect(engine.mediaRequests.some((request) => request.t === 'probe'), 'the fetched sample runs through the same intake as a drop').toBe(true))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
