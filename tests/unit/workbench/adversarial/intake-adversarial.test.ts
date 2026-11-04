// ADVERSARY unit-101 (category 2a: INTAKE) — the intake service against
// hostile importers: rejecting `sniff`/`importCaptions`, slow (deferred)
// replies, duplicate/concurrent drops and mixed-type orders. Additive probes
// only; every interaction is through the frozen public seams (EnginePort
// double, ImportCaptionsService seam, ProjectStore view).
//
// The documented invariant under attack (intake.ts): "Nothing is silently
// dropped: every rejected file is reported with a reason CODE only" and
// "Captions of THIS drop attach to the probes of THIS drop; a stale queue
// must never leak into a later media-only drop" — plus US-2.0.2 (media +
// captions dropped together create the project WITH the imported source
// track) and CC-101.2 (no silent drops).
//
// Red tests here are FINDINGS; green tests are honest passes.
import { describe, expect, test, vi } from 'vitest'
import { createIntakeService } from '@state/services/intake'
import type { CaptionImportResult, ImportCaptionsService, IntakeOutcome } from '@state/services/intake'
import { createJobsStore } from '@state/jobs'
import { createProjectStore } from '@state/project'
import { FakeEnginePort, probedEvent, createFakeModelCache } from '../helpers/fake-engine'
import type { MediaAsset, CaptionBlock } from '@engine/model@101'
import type { ImportReport } from '@engine/captions@101'

const ASSET: MediaAsset = {
  id: 'ASSET_test_video_1',
  name: 'speech-2min.mp4',
  kind: 'video',
  container: 'mp4',
  audioCodec: 'aac',
  videoCodec: 'avc1',
  duration: 121.44,
  width: 1280,
  height: 720,
  fps: 25,
  fingerprint: { name: 'speech-2min.mp4', size: 2_000_000, durationMs: 121_440, sampleHashes: ['h1', 'h2', 'h3'] },
}

function report(format: ImportReport['format']): ImportReport {
  return { format, encoding: 'utf-8', cues: 2, blocks: 1, detectedLanguage: 'en', adjustments: [] }
}

function block(id: string): CaptionBlock {
  return { id, start: 0.2, end: 2.4, text: `block ${id}`, words: [{ text: id, start: 0.2, end: 2.4, timing: 'estimated' }], speakerId: 'SPK_1' }
}

const IMPORT_A: CaptionImportResult = { report: report('vtt'), blocks: [block('blk_a1')] }
const IMPORT_B: CaptionImportResult = { report: report('srt'), blocks: [block('blk_b1')] }

function mediaFile(name = 'speech-2min.mp4'): File {
  return new File([new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])], name, { type: 'video/mp4' })
}

function captionFile(name = 'vendor.vtt'): File {
  return new File(['WEBVTT\n\n00:00:00.000 --> 00:00:02.400\nhello world\n'], name, { type: 'text/vtt' })
}

function wrongTypeFile(name = 'notes.txt'): File {
  return new File(['just notes'], name, { type: 'text/plain' })
}

interface HarnessOptions {
  /** When true (default) every `probe` answers `media:probed` synchronously. */
  autoProbe?: boolean
  /** Importer override; default accepts .vtt only, resolving the canned results by name. */
  importService?: ImportCaptionsService
}

function createHarness(options: HarnessOptions = {}): { engine: FakeEnginePort; intake: ReturnType<typeof createIntakeService>; project: ReturnType<typeof createProjectStore>; probeJobIds: () => string[] } {
  const engine = new FakeEnginePort()
  if (options.autoProbe !== false) engine.respondToMedia('probe', (request) => (request.t === 'probe' ? [probedEvent(request.jobId, ASSET)] : []))
  const jobs = createJobsStore({ engine, modelCache: createFakeModelCache() })
  const project = createProjectStore({ clock: { now: () => 1_730_000_000_000 } })
  const importService: ImportCaptionsService =
    options.importService ?? {
      sniff: async (file) => (file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : null),
      importCaptions: async (file) => (file.name.includes('b') ? IMPORT_B : IMPORT_A),
    }
  const intake = createIntakeService({ engine, jobs, project, importService })
  return {
    engine,
    intake,
    project,
    probeJobIds: () => engine.mediaRequests.filter((request) => request.t === 'probe').map((request) => (request.t === 'probe' ? request.jobId : '')),
  }
}

describe('ADVERSE IN: intake service against hostile importers and hostile drop orders', () => {
  test('ADVERSE IN.1: CC-101.2 no-silent-drops — a `sniff` that REJECTS must not take the whole drop down with it (attack: hostile seam rejection; media in the same drop must still be probed and the failure reported as a code)', async () => {
    const { engine, intake } = createHarness({
      importService: {
        sniff: (file) => (file.name.includes('evil') ? Promise.reject(new Error('sniff_failure')) : Promise.resolve(file.name.endsWith('.vtt') ? 'vtt' : null)),
        importCaptions: async () => IMPORT_A,
      },
    })

    let outcome: IntakeOutcome | 'rejected' = 'rejected'
    try {
      outcome = await intake.handleFiles([mediaFile(), captionFile('evil.vtt')])
    } catch {
      // handled below: the rejection IS the finding
    }

    expect(outcome !== 'rejected', 'a throwing seam must degrade to a REJECTED report (CC-101.2: nothing is silently dropped), not reject the drop').toBe(true)
    if (outcome === 'rejected') return
    expect(outcome.rejected).toEqual([{ reason: 'UNSUPPORTED_CAPTION' }])
    expect(engine.mediaRequests.filter((request) => request.t === 'probe').length, 'the healthy media file must still reach the media worker').toBe(1)
  })

  test('ADVERSE IN.2: CC-101.2 no-silent-drops — an `importCaptions` rejection must not silently drop the media of the same drop (attack: seam throws mid-pipeline; probes never run)', async () => {
    const { engine, intake } = createHarness({
      importService: {
        sniff: async (file) => (file.name.endsWith('.vtt') ? 'vtt' : null),
        importCaptions: () => Promise.reject(new Error('caption_parse_failure')),
      },
    })

    let outcome: IntakeOutcome | 'rejected' = 'rejected'
    try {
      outcome = await intake.handleFiles([mediaFile(), captionFile('broken.vtt')])
    } catch {
      // handled below
    }

    expect(outcome !== 'rejected', 'importer failure must report a reason code and continue, never reject the drop (CC-101.2)').toBe(true)
    if (outcome === 'rejected') return
    expect(outcome.rejected).toEqual([{ reason: 'UNSUPPORTED_CAPTION' }])
    expect(engine.mediaRequests.filter((request) => request.t === 'probe').length).toBe(1)
  })

  test('ADVERSE IN.3: intake stale-queue invariant — a caption from drop B must never attach to the media of drop A when A replies late (attack: slow probe reply reorders the global pending-caption queue)', async () => {
    const { engine, intake, project, probeJobIds } = createHarness({ autoProbe: false })

    await intake.handleFiles([mediaFile(), captionFile('a.vtt')]) // drop A: media + caption A, probe still unanswered
    await intake.handleFiles([captionFile('b.vtt')]) // drop B: caption-only, its import lands in the shared queue

    const [probeA] = probeJobIds()
    expect(typeof probeA).toBe('string')
    engine.emitMedia(probedEvent(probeA as string, ASSET)) // A's probe finally answers — AFTER B queued its import

    const created = project.getState().project
    expect(created, 'the probed reply must create the project').not.toBeNull()
    expect(created?.blocks.map((entry) => entry.id), 'media of drop A pairs with caption A — never with the later drop’s caption B (intake.ts stale-queue invariant)').toEqual(['blk_a1'])
  })

  test('ADVERSE IN.4: US-2.0.2 double drop — dropping media+captions twice must leave the FINAL project with the imported source track (attack: two deferred probe replies drain one shared queue; last project loses its captions)', async () => {
    const { engine, intake, project, probeJobIds } = createHarness({ autoProbe: false })

    await intake.handleFiles([mediaFile(), captionFile('a.vtt')])
    await intake.handleFiles([mediaFile(), captionFile('a2.vtt')])

    const [probe1, probe2] = probeJobIds()
    expect([probe1, probe2].filter((id) => typeof id === 'string').length, 'two drops post two probes').toBe(2)

    engine.emitMedia(probedEvent(probe1 as string, ASSET))
    engine.emitMedia(probedEvent(probe2 as string, ASSET))

    const final = project.getState().project
    expect(final, 'the last probe still creates the project').not.toBeNull()
    expect(final?.captionOrigin, 'both drops carried captions — the final project must keep the imported source track (US-2.0.2)').toBe('imported')
    expect(final?.blocks.length).toBe(1)
  })

  test('ADVERSE IN.5: CC-101.2 caption-first order — [caption, media] behaves exactly like [media, caption] (attack: drop order must not change classification)', async () => {
    const { engine, intake, project } = createHarness()
    const outcome = await intake.handleFiles([captionFile('first.vtt'), mediaFile()])

    expect(outcome.mediaPosted).toBe(1)
    expect(outcome.importedCaptions.length).toBe(1)
    expect(engine.mediaRequests.filter((request) => request.t === 'probe').length).toBe(1)
    expect(project.getState().project?.captionOrigin).toBe('imported')
    expect(project.getState().project?.blocks.map((entry) => entry.id)).toEqual(['blk_a1'])
  })

  test('ADVERSE IN.6: CC-101.2 mixed drop — unsupported types interleaved with media+caption still probe the media, import the caption and report ONLY codes for the rejects (attack: interleaved unsupported must not poison the accepted half, nor create a partial project)', async () => {
    const { engine, intake, project } = createHarness()
    const outcome = await intake.handleFiles([wrongTypeFile('notes.txt'), mediaFile(), new File(['{"not":"zipscribe"}'], 'data.json', { type: 'application/json' })])

    expect(outcome.mediaPosted, 'the media still probes').toBe(1)
    expect(outcome.importedCaptions, 'the .json (not .zipscribe.json) is denied by the seam → UNSUPPORTED_CAPTION; notes.txt → UNSUPPORTED_TYPE').toEqual([])
    expect(outcome.rejected).toEqual([{ reason: 'UNSUPPORTED_TYPE' }, { reason: 'UNSUPPORTED_CAPTION' }])
    expect(engine.mediaRequests.filter((request) => request.t === 'probe').length).toBe(1)
    expect(project.getState().project?.captionOrigin, 'project comes from the accepted media only — no partial/failed-project state').toBe('none')
  })

  test('ADVERSE IN.7: CC-101.2 captions-only drop creates NO project and its (unpaired) import never resurfaces (attack: caption import without media leaks into the next media-only drop)', async () => {
    const { intake, project } = createHarness()

    const first = await intake.handleFiles([captionFile('orphan.vtt')])
    expect(first.importedCaptions.length).toBe(1)
    expect(project.getState().project, 'no media → no project').toBeNull()

    const second = await intake.handleFiles([mediaFile()])
    expect(second.mediaPosted).toBe(1)
    const created = project.getState().project
    expect(created).not.toBeNull()
    expect(created?.captionOrigin, 'the later media-only drop stays clean (frozen intake.test pins this; the ADVERSE variant is the slow-import race of IN.3/IN.4)').toBe('none')
  })

  test('ADVERSE IN.8: US-2.0.2 sample clip — a rejecting fetch must reject loadSample (the caller toasts SAMPLE_FAILED; the attack is that it must not hang forever)', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network_down')))
    try {
      const { intake } = createHarness()
      await expect(intake.loadSample()).rejects.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
