// ADVERSARIAL (review R2 MAJOR-1, jobs.ts job:progress correlation —
// 14ef213): `job:progress` must correlate by the RUNNING jobId exactly like
// job:done/job:error/job:segments do (SM.1 class). The MAJOR-1 bug: an
// orphaned/stale worker's progress event overwrote the live job's displayed
// percent in the status bar. The frozen pre-start exception (jobs.ts:205
// semantics): before ANY job has been started there is no correlation target,
// so a progress event still folds in (status bar shows it) — that half of the
// semantics is pinned separately so neither side can silently regress.
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { act } from 'react'
import { mountWorkbench } from '../helpers/mount'
import type { ModelId } from '@engine/protocol@101'

afterEach(cleanup)

const MODEL: ModelId = 'whisper-base_timestamped@608c49e6'

function statusText(): string {
  return screen.getByTestId('status-bar').textContent ?? ''
}

describe('ADVERSE SM.9: FR-2.0.6 job:progress jobId correlation', () => {
  test('ADVERSE SM.9: FR-2.0.6 — foreign-jobId job:progress must not overwrite the running job displayed percent', async () => {
    const { engine, jobs } = await mountWorkbench({ project: {}, cachedModels: [MODEL] })
    jobs.setCapability({ tier: 'T1', reasons: [] })
    jobs.startTranscribe({ language: null, modelId: MODEL, diarize: false, mode: 'replace' })
    const running = jobs.getState().running
    expect(running, 'a live job owns the display').not.toBeNull()
    const liveJobId = running?.jobId ?? ''

    act(() => {
      engine.emitAsr({ t: 'job:progress', jobId: liveJobId, processedSec: 60, totalSec: 120 })
    })
    expect(jobs.getState().progress, 'the running job updates its percent').toEqual({ processedSec: 60, totalSec: 120 })
    expect(statusText(), 'status bar shows the live job at 50%').toContain('50%')

    // The attack: a stale/orphaned worker flush claims the job is nearly done.
    act(() => {
      engine.emitAsr({ t: 'job:progress', jobId: 'job-orphan-from-a-dead-run', processedSec: 118, totalSec: 120 })
    })
    expect(jobs.getState().progress, 'a foreign jobId must not overwrite the running job progress (MAJOR-1)').toEqual({ processedSec: 60, totalSec: 120 })
    expect(statusText(), 'the displayed percent stays the live job 50% — never the orphan 98%').toContain('50%')
    expect(statusText()).not.toContain('98%')

    // The live job keeps controlling its own display afterwards.
    act(() => {
      engine.emitAsr({ t: 'job:progress', jobId: liveJobId, processedSec: 90, totalSec: 120 })
    })
    expect(jobs.getState().progress).toEqual({ processedSec: 90, totalSec: 120 })
  })

  test('ADVERSE SM.9 (frozen exception): with no job started, job:progress still folds in (pre-start semantics preserved)', async () => {
    const { engine, jobs } = await mountWorkbench({ project: {}, cachedModels: [MODEL] })
    expect(jobs.getState().running, 'no job running').toBeNull()
    expect(jobs.getState().progress, 'clean slate').toBeNull()

    act(() => {
      engine.emitAsr({ t: 'job:progress', jobId: 'job-announced-before-start', processedSec: 30, totalSec: 120 })
    })
    expect(jobs.getState().progress, 'pre-start progress folds (no correlation target exists yet — jobs.ts:205 exception class)').toEqual({ processedSec: 30, totalSec: 120 })
    expect(statusText(), 'and the status bar displays it').toContain('25%')
  })
})
