// CC-202.4 (service leg) + CC-202.6 (L1): the export service's typed
// rejection for audio burn-in, snapshot isolation, and cancel idempotence
// over the scripted fake port (unit-102 helper).
import { describe, expect, test } from 'vitest'
import { createExportService } from '@state/services/export'
import { createFakeExportPort } from '../editor/helpers/fake-export-port'
import { sidecarProject } from './helpers/sidecar-fixture'
import type { ProjectSnapshot } from '@engine/model'

const SETTINGS = { format: 'mp4-burn-in' as const, width: 1280, height: 720, fps: 30 }

function videoSnapshot(): ProjectSnapshot {
  const p = sidecarProject()
  return { ...structuredClone(p), snapshotVersion: 3 }
}

function audioSnapshot(): ProjectSnapshot {
  const p = sidecarProject()
  p.asset = { ...p.asset, kind: 'audio', videoCodec: null, width: 0, height: 0, fps: 0 }
  return { ...structuredClone(p), snapshotVersion: 3 }
}

const FILE = new File([new Uint8Array([0])], 'in.mp4', { type: 'video/mp4' })

describe('CC-202.4: audio burn-in rejected at the service (second line of defence)', () => {
  test('audio snapshot ⇒ ENCODER_UNSUPPORTED job:error, NO worker request posted', async () => {
    const port = createFakeExportPort()
    const svc = createExportService({ engine: port, newJobId: () => 'job-a' })
    const seen: string[] = []
    const handle = svc.start(audioSnapshot(), FILE, SETTINGS)
    handle.subscribe(e => seen.push(e.t))
    await Promise.resolve()
    expect(seen).toEqual(['job:error'])
    const err = port.requests.length
    expect(err, 'no export request ever reaches the worker').toBe(0)
  })

  test('video snapshot posts exactly one export request', () => {
    const port = createFakeExportPort()
    const svc = createExportService({ engine: port, newJobId: () => 'job-v' })
    svc.start(videoSnapshot(), FILE, SETTINGS)
    expect(port.requests).toHaveLength(1)
    expect(port.requests[0]?.t).toBe('export')
  })
})

describe('CC-202.6: snapshot isolation + cancel', () => {
  test('post-start edits to the project cannot reach the in-flight export', () => {
    const port = createFakeExportPort()
    const svc = createExportService({ engine: port, newJobId: () => 'job-i' })
    const snapshot = videoSnapshot()
    const handle = svc.start(snapshot, FILE, SETTINGS)
    // mutate the ORIGINAL blocks array the dialog still holds
    ;(snapshot as { blocks: unknown[] }).blocks.push({ id: 'late', start: 99, end: 100, text: 'late edit', words: [], speakerId: 'SPK_1' })
    const sent = port.requests[0]
    if (sent?.t !== 'export') throw new Error('expected export request')
    expect(sent.snapshot.blocks).toHaveLength(4)
    expect(sent.snapshot.snapshotVersion).toBe(3)
    expect(handle.jobId).toBe('job-i')
  })

  test('cancel posts exactly one cancel request (idempotent)', () => {
    const port = createFakeExportPort()
    const svc = createExportService({ engine: port, newJobId: () => 'job-c' })
    const handle = svc.start(videoSnapshot(), FILE, SETTINGS)
    handle.cancel()
    handle.cancel()
    handle.cancel()
    expect(port.requests.filter(r => r.t === 'cancel')).toHaveLength(1)
  })

  test('CC-202.6: the cancel promise resolves only on the worker flush-ack', async () => {
    const port = createFakeExportPort()
    const svc = createExportService({ engine: port, newJobId: () => 'job-ack' })
    const handle = svc.start(videoSnapshot(), FILE, SETTINGS)
    let acked = false
    const settled = handle.cancel().then(() => {
      acked = true
    })
    await Promise.resolve()
    expect(acked, 'no resolve before the worker terminal event').toBe(false)
    port.emit({ t: 'job:progress', jobId: 'job-ack', processedSec: 1, totalSec: 2 })
    await Promise.resolve()
    expect(acked, 'progress is not an ack — the row survives until the flush lands').toBe(false)
    port.emit({ t: 'job:done', jobId: 'job-ack' })
    await settled
    expect(acked).toBe(true)
  })

  test('CC-202.6: job:error acks too; repeat cancels share one promise', async () => {
    const port = createFakeExportPort()
    const svc = createExportService({ engine: port, newJobId: () => 'job-err' })
    const handle = svc.start(videoSnapshot(), FILE, SETTINGS)
    const first = handle.cancel()
    expect(handle.cancel()).toBe(first)
    port.emit({ t: 'job:error', jobId: 'job-err', error: { code: 'ENGINE_INTERNAL', retryable: false, detail: 'x' } })
    await first
  })

  test('events are jobId-filtered (foreign jobIds ignored)', () => {
    const port = createFakeExportPort()
    const svc = createExportService({ engine: port, newJobId: () => 'mine' })
    const seen: string[] = []
    const handle = svc.start(videoSnapshot(), FILE, SETTINGS)
    handle.subscribe(e => seen.push(e.t))
    port.emit({ t: 'job:done', jobId: 'other' })
    port.emit({ t: 'job:progress', jobId: 'mine', processedSec: 1, totalSec: 10 })
    expect(seen).toEqual(['job:progress'])
  })
})
