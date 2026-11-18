// unit-108 CC-108.6 (L2, jsdom): the StatusBar job-error notice — a coded,
// single-line `[data-testid=job-error]` inside the frozen footer when the
// jobs store carries an EngineError; cleared when the next job starts; NEVER
// content (SECURITY-03 — redaction spy over a canary detail string).
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { act } from 'react'
import { mountWorkbench } from './helpers/mount'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'

afterEach(cleanup)

describe('CC-108.6: StatusBar job-error notice — one coded line, no modal, codes only', () => {
  test('CC-108.6: a job:error renders exactly one [data-testid=job-error] with the code (never detail/content), and the next start clears it', async () => {
    const spy = createRedactionSpy()
    try {
      const { engine, jobs } = await mountWorkbench({ project: {} })
      expect(screen.queryByTestId('job-error'), 'no notice without an error').toBeNull()

      act(() => {
        engine.emitAsr({ t: 'job:error', jobId: 'job-err-1', error: { code: 'DECODE_STALL', retryable: true, detail: `ffmpeg choked on ${CANARY_MARKER}` } })
      })
      const notices = screen.getAllByTestId('job-error')
      expect(notices, 'exactly one coded line').toHaveLength(1)
      expect(notices[0]!.textContent).toBe('DECODE_STALL')
      expect(notices[0]!.textContent, 'the detail string never renders (SECURITY-03)').not.toContain(CANARY_MARKER)
      expect(screen.queryByRole('dialog'), 'the notice is not a modal').toBeNull()

      act(() => {
        jobs.startTranscribe({ language: 'en', modelId: 'whisper-base_timestamped@608c49e6', diarize: false, mode: 'replace' })
      })
      expect(screen.queryByTestId('job-error'), 'a fresh start clears the notice').toBeNull()

      const verdict = spy.settle()
      expect(verdict.leaks, 'SECURITY-03: zero content in console surfaces').toEqual([])
      expect(verdict.clean).toBe(true)
    } finally {
      spy.restore()
    }
  })
})
