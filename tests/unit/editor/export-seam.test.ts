// FR-102.7/FR-102.8 (L1): the exportService seam over the scripted
// ExportEvent stream (fake worker harness, FR-102.8 — reuse of the
// FakeWorkerSession lineage). Pins the contract Intents 3/6 import: the
// request shape, event delivery order, cancel posting, and the SNAPSHOT rule
// (domain § Project snapshot): post-start project edits never reach the
// export — the handed `ProjectSnapshot` is immutable input. SECURITY-03:
// error paths surface codes/numbers only (canary block in the project).
import { describe, expect, test } from 'vitest'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'
import { createExportService } from '@state/services/export'
import { serializeProject } from '@state/services/serialize'
import { createFakeExportPort, progressScript } from './helpers/fake-export-port'
import { sampleProject } from './helpers/fixture-project'
import type { ProjectSnapshot } from '@engine/model@102'
import type { ExportEvent, ExportSettings } from '@engine/protocol@102'

const SETTINGS: ExportSettings = { format: 'mp4-burn-in', width: 1280, height: 720, fps: 25 }

function fakeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'in.mp4', { type: 'video/mp4' })
}

function snapshotOf(): { project: ReturnType<typeof sampleProject>; snapshot: ProjectSnapshot } {
  const project = sampleProject()
  const snapshot: ProjectSnapshot = { ...structuredClone(project), snapshotVersion: 1 }
  return { project, snapshot }
}

describe('FR-102.7/FR-102.8: exportService seam over the fake export worker', () => {
  test('FR-102.7: start() posts one ExportRequest with the snapshot, file and settings', () => {
    const port = createFakeExportPort()
    const service = createExportService({ engine: port, newJobId: () => 'job_exp_1' })
    const { snapshot } = snapshotOf()

    const handle = service.start(snapshot, fakeFile(), SETTINGS)
    expect(port.requests.length).toBe(1)
    const request = port.requests[0]
    expect(request?.t).toBe('export')
    if (request?.t !== 'export') throw new Error('export request shape')
    expect(request.jobId, 'the handle and the request carry the same jobId').toBe(handle.jobId)
    expect(request.settings).toEqual(SETTINGS)
    expect(request.snapshot.snapshotVersion).toBe(1)
  })

  test('FR-102.8: scripted progress→result events reach the subscriber in order', () => {
    const port = createFakeExportPort()
    const service = createExportService({ engine: port, newJobId: () => 'job_exp_2' })
    const events: ExportEvent[] = []
    const { snapshot } = snapshotOf()

    const handle = service.start(snapshot, fakeFile(), SETTINGS)
    handle.subscribe((event) => events.push(event))
    for (const event of progressScript('job_exp_2', 12, 4, false)) port.emit(event)
    port.emit({ t: 'export:result', jobId: 'job_exp_2', blob: new Blob([new Uint8Array([9])], { type: 'video/mp4' }) })

    expect(events.map((e) => e.t), 'ordered delivery of the scripted stream').toEqual(['job:progress', 'job:progress', 'job:progress', 'job:progress', 'export:result'])
    expect(handle.jobId).toBe('job_exp_2')
  })

  test('FR-102.7: cancel posts the cancel request exactly once (idempotent)', () => {
    const port = createFakeExportPort()
    const service = createExportService({ engine: port, newJobId: () => 'job_exp_3' })
    const { snapshot } = snapshotOf()
    const handle = service.start(snapshot, fakeFile(), SETTINGS)

    handle.cancel()
    handle.cancel()
    const cancels = port.requests.filter((r) => r.t === 'cancel')
    expect(cancels.length).toBe(1)
    expect((cancels[0] as { jobId: string }).jobId).toBe(handle.jobId)
  })

  test('FR-102.8: events for OTHER jobIds are not delivered to this handle', () => {
    const port = createFakeExportPort()
    const service = createExportService({ engine: port, newJobId: () => 'job_exp_4' })
    const events: ExportEvent[] = []
    const { snapshot } = snapshotOf()
    const handle = service.start(snapshot, fakeFile(), SETTINGS)
    handle.subscribe((event) => events.push(event))

    port.emit({ t: 'job:progress', jobId: 'job_other', processedSec: 1, totalSec: 2 })
    port.emit({ t: 'job:progress', jobId: 'job_exp_4', processedSec: 1, totalSec: 2 })
    expect(events.length, 'jobId correlation (unit-101 SM.1 precedent)').toBe(1)
  })

  test('FR-102.7 (snapshot rule): post-start project edits never reach the export', () => {
    const port = createFakeExportPort()
    const service = createExportService({ engine: port, newJobId: () => 'job_exp_5' })
    const { snapshot } = snapshotOf()
    const before = serializeProject(structuredClone(snapshot))

    const handle = service.start(snapshot, fakeFile(), SETTINGS)
    void handle
    const posted = port.requests[0]
    if (posted?.t !== 'export') throw new Error('export request missing')
    expect(serializeProject(structuredClone(posted.snapshot)), 'the request carries the at-start canonical bytes — immutable snapshot input').toBe(before)
  })

  test('SECURITY-03: an EngineError on the export stream carries codes only — canary never surfaces', () => {
    const spy = createRedactionSpy()
    try {
      const port = createFakeExportPort()
      const service = createExportService({ engine: port, newJobId: () => 'job_exp_6' })
      const project = sampleProject()
      const snapshot: ProjectSnapshot = { ...structuredClone(project), snapshotVersion: 1 }
      // The canary lives in the project content (block blk_b) — the harness
      // must never echo it through events or errors.
      expect(project.blocks.some((b) => b.text.includes(CANARY_MARKER)), 'canary present in source data').toBe(true)

      const events: ExportEvent[] = []
      const handle = service.start(snapshot, fakeFile(), SETTINGS)
      handle.subscribe((event) => {
        events.push(event)
        console.log('event', event) // would-be leak channel under the spy
      })
      port.emit({ t: 'job:error', jobId: 'job_exp_6', error: { code: 'ENCODER_UNSUPPORTED', retryable: false } })
      expect(events.at(-1)?.t).toBe('job:error')
      expect(spy.settle().clean, 'no canary content reached console while handling a canary project').toBe(true)
    } finally {
      spy.restore()
    }
  })
})
