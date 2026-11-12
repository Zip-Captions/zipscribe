// PR #15 review round 2 (MINOR, test-integrity): the two fix-UI paths that
// slice C added but no frozen suite covered —
// (a) CC-104.7 align job FAILURE: a scripted `job:error` (EngineError, code
//     only — SECURITY-03) renders the coded notice `[data-testid=
//     transcript-align-error]` (role="status", data-code=<code>), NOTHING is
//     applied (no captions-align-apply dispatch, zero history steps, project
//     byte-identical) and the CANCELLED path stays silent (no notice at all);
// (b) CC-104.4 search close: the `Close search` button flips searchOpen off
//     and blurs the focused input first (Transcript.closeSearch).
// Job wiring follows streaming-skeleton.test.tsx (createJobsStore +
// createProbingEngine.emitAsr over the fake engine port — NEVER a real
// worker/network); panel interaction follows search-ui.test.tsx
// (dispatchCommand('transcript.search-open') + fireEvent). Canary discipline:
// redaction spy attached.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { dispatchCommand } from '@ui/commands/registry'
import { createTestApp } from '../editor/helpers/editor-app'
import type { TestApp } from '../editor/helpers/editor-app'
import { createProbingEngine, createFakeModelCache } from '../workbench/helpers/fake-engine'
import { createJobsStore } from '@state/jobs'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { searchProject, transcriptBlocksProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'
import type { Project } from '@engine/model@104'

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

function project(app: TestApp): Project {
  return app.app.project.getState().project as Project
}

describe('CC-104.7 (L2, jsdom): align failure notice + cancelled silence', () => {
  test('CC-104.7: scripted job:error renders the coded status notice, nothing applied, zero history steps', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      const engine = createProbingEngine()
      const jobs = createJobsStore({ engine, modelCache: createFakeModelCache() })
      await mount(t, jobs)
      const before = JSON.stringify(project(t).blocks)
      const undoBefore = t.app.history.undoCount()

      act(() => {
        jobs.startTranscribe({ language: 'en', modelId: 'whisper-base_timestamped@608c49e6', diarize: false, mode: 'align' })
      })
      const running = jobs.getState().running
      expect(running?.kind, 'align job running through the scripted engine port').toBe('align')
      const jobId = running!.jobId
      expect(screen.queryByTestId('transcript-align-error'), 'no notice before the failure').toBeNull()

      act(() => {
        engine.emitAsr({ t: 'job:error', jobId, error: { code: 'MODEL_UNLOADED', retryable: false, detail: 'engine detail 7 (codes/numbers only)' } })
      })

      const notice = screen.getByTestId('transcript-align-error')
      expect(notice.getAttribute('role'), 'coded notice is a status region').toBe('status')
      expect(notice.getAttribute('data-code'), 'EngineError code rides in data-code').toBe('MODEL_UNLOADED')
      expect(notice.textContent, 'plain-language copy says nothing was applied').toContain('nothing applied')
      expect(notice.textContent, 'SECURITY-03: never the detail').not.toContain('engine detail')
      expect(JSON.stringify(project(t).blocks), 'no apply — project byte-identical').toBe(before)
      expect(t.app.history.undoCount(), 'no apply — NO history step').toBe(undoBefore)
      expect(screen.queryByTestId('transcript-align-toast'), 'no success toast on failure').toBeNull()
      expect(redaction.settle().clean, 'no canary leak through the error path').toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })

  test('CC-104.7: a CANCELLED align job stays silent — late job:error renders no notice and no step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      const engine = createProbingEngine()
      const jobs = createJobsStore({ engine, modelCache: createFakeModelCache() })
      await mount(t, jobs)
      const before = JSON.stringify(project(t).blocks)
      const undoBefore = t.app.history.undoCount()

      act(() => {
        jobs.startTranscribe({ language: 'en', modelId: 'whisper-base_timestamped@608c49e6', diarize: false, mode: 'align' })
      })
      const jobId = jobs.getState().running!.jobId
      fireEvent.click(screen.getByTestId('transcript-align-cancel'))
      expect(jobs.getState().running, 'cancel stopped the job').toBeNull()

      act(() => {
        engine.emitAsr({ t: 'job:error', jobId, error: { code: 'MODEL_UNLOADED', retryable: false } })
      })
      expect(screen.queryByTestId('transcript-align-error'), 'cancelled path stays silent — no coded notice').toBeNull()
      expect(screen.queryByTestId('transcript-align-toast'), 'cancelled path renders no toast').toBeNull()
      expect(JSON.stringify(project(t).blocks), 'nothing applied').toBe(before)
      expect(t.app.history.undoCount(), 'NO history step').toBe(undoBefore)
      expect(redaction.settle().clean).toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })
})

describe('CC-104.4 (L2): close-search button — flips off, blurs the focused input', () => {
  test('CC-104.4: Close search blurs the focused query input and flips searchOpen off', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    try {
      const t = createTestApp({ project: searchProject() })
      await mount(t)
      act(() => {
        dispatchCommand('transcript.search-open')
      })
      const input = screen.getByTestId('transcript-search-input') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'alp' } })
      input.focus()
      expect(document.activeElement, 'focused before close').toBe(input)

      fireEvent.click(screen.getByTestId('transcript-search-close'))

      expect(screen.queryByTestId('transcript-search'), 'searchOpen flipped off').toBeNull()
      expect(document.activeElement, 'focused input blurred (not the input anymore)').not.toBe(input)
      expect(t.app.history.undoCount(), 'closing search is view-only — NO history step').toBe(0)
      expect(redaction.settle().clean, 'the query text never reaches logs').toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })
})
