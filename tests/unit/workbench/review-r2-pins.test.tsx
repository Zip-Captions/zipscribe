// Unit-101 review round 2 — unpinned guarantees pinned (ADDITIVE: new file,
// frozen suites untouched). Reviewer items #12/#13 + the MAJOR-1 fix:
//  (a) FR-2.0.2 / 69f784c: with a job running the plain Start is `disabled`
//      (no double-fire) while Replace/Align STAY enabled (frozen US-2.0.4
//      sequence dispatches a second job on purpose);
//  (b) FR-2.0.2 no-orphan: a second start cannot leave two live jobs — the
//      store posts the displaced-job cancel triple (jobs.ts) before replacing
//      (asserted through the fake engine's recorded requests);
//  (c) review #12 honesty: a rejecting intake surfaces the honest
//      INTAKE_FAILED toast at the UI boundary (Workbench runIntake catch) and
//      nothing escapes as an unhandled rejection (process-level sentinel).
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mountWorkbench } from './helpers/mount'
import { dispatchDrop } from './helpers/drop'
import { CANNED_IMPORT_RESULT, makeMediaFile } from './helpers/fake-engine'
import type { AsrRequest } from '@engine/protocol@101'

afterEach(cleanup)

const MODEL = 'whisper-base_timestamped@608c49e6'

async function openPopover(): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByTestId('transcribe-button'))
  await screen.findByTestId('transcribe-popover')
}

function transcribeJobs(engine: { asrRequests: AsrRequest[] }): string[] {
  return engine.asrRequests.filter((request) => request.t === 'transcribe').map((request) => (request.t === 'transcribe' ? request.jobId : ''))
}

function canceledAsrJobs(engine: { asrRequests: AsrRequest[] }): string[] {
  return engine.asrRequests.filter((request) => request.t === 'cancel').map((request) => (request.t === 'cancel' ? request.jobId : ''))
}

describe('CC-101 review R2 pins: Start-disabled, displaced-cancel, intake-catch honesty', () => {
  test('CC-101.3 (FR-2.0.2, 69f784c pin): plain Start is disabled while a job runs — it cannot double-fire', async () => {
    const { engine, jobs } = await mountWorkbench({ project: {}, cachedModels: [MODEL] })
    jobs.setCapability({ tier: 'T1', reasons: [] })
    await openPopover()

    const start = screen.getByTestId('transcribe-start-button') as HTMLButtonElement
    expect(start.disabled, 'idle → enabled').toBe(false)
    const user = userEvent.setup()
    await user.click(start)
    expect(jobs.getState().running, 'first Start started the job').not.toBeNull()

    expect(start.disabled, 'Start is disabled while the job runs (FR-2.0.2: disabled state job-running)').toBe(true)
    fireEvent.click(start) // jsdom suppresses clicks on disabled buttons — the pin is the property AND the inertness
    expect(transcribeJobs(engine).length, 'the disabled Start cannot dispatch a second job').toBe(1)
  })

  test('CC-101.3 (US-2.0.4 pin): Replace/Align stay enabled while a job runs and keep dispatching', async () => {
    const { engine, jobs } = await mountWorkbench({ project: { captionImport: CANNED_IMPORT_RESULT }, cachedModels: [MODEL] })
    jobs.setCapability({ tier: 'T1', reasons: [] })
    await openPopover()

    const replace = screen.getByTestId('replace-captions-button') as HTMLButtonElement
    const align = screen.getByTestId('align-captions-button') as HTMLButtonElement
    expect(replace.disabled, 'Replace is not disabled-while-running (frozen sequence dispatches on purpose)').toBe(false)
    expect(align.disabled, 'Align is not disabled-while-running').toBe(false)

    const user = userEvent.setup()
    await user.click(align)
    expect(jobs.getState().running?.kind).toBe('align')
    // The popover stays mounted; both options must remain usable mid-job.
    expect(replace.disabled, 'Replace stays enabled while the align job runs').toBe(false)
    expect(align.disabled, 'Align stays enabled while the align job runs').toBe(false)
    await user.click(replace)
    expect(jobs.getState().running?.kind, 'the second dispatch lands as transcribe') .toBe('transcribe')
    expect(transcribeJobs(engine).length).toBe(2)
  })

  test('FR-2.0.2 (no-orphan pin): a second startTranscribe cancels the displaced job — exactly one job stays live', async () => {
    const { engine, jobs } = await mountWorkbench({ project: {}, cachedModels: [MODEL] })
    jobs.setCapability({ tier: 'T1', reasons: [] })

    jobs.startTranscribe({ language: null, modelId: MODEL, diarize: false, mode: 'replace' })
    const first = jobs.getState().running
    expect(first, 'first job live').not.toBeNull()
    const firstJobId = first?.jobId ?? ''

    jobs.startTranscribe({ language: null, modelId: MODEL, diarize: false, mode: 'replace' })
    const second = jobs.getState().running
    expect(second, 'second job live').not.toBeNull()
    expect(second?.jobId, 'the running slot holds the NEW job').not.toBe(firstJobId)
    expect(transcribeJobs(engine), 'both jobs were posted to the engine').toEqual([firstJobId, second?.jobId])

    // Displaced-cancel contract (jobs.ts 7444621): the SAME cancel triple
    // cancel() posts must hit the displaced jobId BEFORE the new transcribe —
    // the old job can never keep running uncancellable (no orphans).
    expect(canceledAsrJobs(engine), 'asr cancel posted for the displaced jobId').toContain(firstJobId)
    expect(engine.diarizeRequests.some((request) => request.t === 'cancel' && request.jobId === firstJobId), 'diarize cancel posted for the displaced jobId').toBe(true)
    expect(engine.mediaRequests.some((request) => request.t === 'cancel' && request.jobId === firstJobId), 'media cancel posted for the displaced jobId').toBe(true)
    const asrOrder = engine.asrRequests.map((request) => request.t)
    expect(asrOrder.indexOf('cancel'), 'the displaced cancel precedes the new transcribe').toBeLessThan(asrOrder.lastIndexOf('transcribe'))
  })

  test('CC-101.2 (review #12 honesty): a rejecting intake surfaces the INTAKE_FAILED toast with no unhandled rejection', async () => {
    const rejections: unknown[] = []
    const sentinel = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', sentinel)
    try {
      const { engine, project } = await mountWorkbench()
      // Simulated worker death: the probe post itself rejects INSIDE
      // intake.handleFiles (only sniff/importCaptions degrade to codes), so
      // handleFiles rejects — the Workbench runIntake catch owns it.
      engine.postMedia = (): void => {
        throw new Error('media worker gone (simulated)')
      }
      dispatchDrop(screen.getByTestId('drop-zone'), [makeMediaFile()])

      await waitFor(() => expect(screen.getByTestId('toast').textContent, 'the failure is announced honestly, not swallowed').toContain('INTAKE_FAILED'))
      expect(project.getState().project, 'a failed intake creates nothing').toBeNull()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(rejections.length, 'the rejection never escapes the UI boundary unhandled').toBe(0)
    } finally {
      process.off('unhandledRejection', sentinel)
    }
  })
})
