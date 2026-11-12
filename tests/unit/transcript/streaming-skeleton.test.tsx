// FR-104.6 (L2, jsdom): streaming rows beyond the committed frontier — while
// a transcribe job accumulates `job:segments` (scripted over the fake engine
// port, worker-registry seam, NEVER a real worker/network), rows ahead of the
// committed project render as `[data-testid=transcript-skeleton-row]`
// shimmer: `aria-hidden="true"`, EMPTY of text (nothing speculative renders),
// and committed block rows keep rendering. No canary leak (spy).
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import type { TestApp } from '../editor/helpers/editor-app'
import { createProbingEngine, createFakeModelCache } from '../workbench/helpers/fake-engine'
import { createJobsStore } from '@state/jobs'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { transcriptBlocksProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'
import { word } from '../editor/helpers/fixture-project'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

async function mount(t: TestApp, jobs?: ReturnType<typeof createJobsStore>): Promise<void> {
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} jobs={jobs} heightPx={480} />)
  })
}

let currentDom: ReturnType<typeof installDomStubs> | null = null

afterEach(() => {
  cleanup()
  currentDom?.restore()
  currentDom = null
})

describe('FR-104.6 (L2): streaming skeleton rows beyond the committed frontier', () => {
  test('FR-104.6: accumulated job segments beyond the last block render as aria-hidden, textless skeleton rows', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      const engine = createProbingEngine()
      const jobs = createJobsStore({ engine, modelCache: createFakeModelCache() })
      await mount(t, jobs)
      expect(screen.queryAllByTestId('transcript-skeleton-row').length, 'no skeleton without a running job').toBe(0)
      const committedRows = screen.getAllByTestId('transcript-row').length

      act(() => {
        jobs.startTranscribe({ language: 'en', modelId: 'whisper-base_timestamped@608c49e6', diarize: false, mode: 'replace' })
      })
      const jobId = jobs.getState().running?.jobId
      expect(jobId, 'job running through the scripted engine port').not.toBeNull()
      act(() => {
        engine.emitAsr({
          t: 'job:segments',
          jobId: jobId!,
          segments: [
            { start: 10.0, end: 11.0, text: 'streamed ahead one', words: [word('streamed', 10.0, 10.5), word('ahead', 10.5, 10.8), word('one', 10.8, 11.0)] },
            { start: 12.0, end: 13.0, text: 'streamed ahead two', words: [word('streamed', 12.0, 12.6), word('ahead', 12.6, 12.8), word('two', 12.8, 13.0)] },
          ],
        })
      })

      const skeletons = screen.getAllByTestId('transcript-skeleton-row') as HTMLElement[]
      expect(skeletons.length, 'segments beyond the committed frontier (last block ends 7.75) render as skeletons').toBeGreaterThanOrEqual(2)
      for (const el of skeletons) {
        expect(el.getAttribute('aria-hidden'), 'shimmer rows are aria-hidden').toBe('true')
        expect(el.textContent, 'skeleton rows carry NO speculative text').toBe('')
      }
      expect(screen.getAllByTestId('transcript-row').length, 'committed rows keep rendering').toBe(committedRows)
      expect(redaction.settle().clean, ).toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })
})
