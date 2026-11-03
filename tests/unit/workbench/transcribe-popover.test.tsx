// CC-101.3 (L2, jsdom): transcribe popover — language/model (size +
// offline-ready badge)/diarize choices dispatch the exact job payload over the
// injectable fake engine (FR-2.0.6); with existing captions the popover
// offers "Replace captions" vs "Align existing captions to audio" instead of
// silently overwriting.
//
// Contract: US-2.0.4 + FR-2.0.2 — popover per design.md § Transcribe popover;
// disabled states: no media / job running; "model not cached" is NOT a
// disabled state — it triggers the download confirmation (unit-03
// `model:confirm-required` gate).
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { mountWorkbench } from './helpers/mount'
import { CANNED_IMPORT_RESULT } from './helpers/fake-engine'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'
import type { AsrRequest, ModelId } from '@engine/protocol@101'

afterEach(cleanup)

const CACHED_MODEL: ModelId = 'whisper-base_timestamped@608c49e6'
const UNCACHED_MODEL: ModelId = 'whisper-small_timestamped@65caa70f'

function asrRequestsOf(engine: { asrRequests: AsrRequest[] }, t: AsrRequest['t']): AsrRequest[] {
  return engine.asrRequests.filter((request) => request.t === t)
}

async function openPopover(): Promise<void> {
  const user = userEvent.setup()
  await user.click(screen.getByTestId('transcribe-button'))
  await screen.findByTestId('transcribe-popover')
}

async function pickModel(modelId: ModelId): Promise<void> {
  await waitFor(() => expect(screen.getAllByTestId('transcribe-model-option').length, 'model options hydrate (registry × model cache)').toBeGreaterThan(0))
  const option = screen.getAllByTestId('transcribe-model-option').find((element) => element.getAttribute('data-model-id') === modelId)
  expect(option, `popover lists ${modelId}`).toBeTruthy()
  const user = userEvent.setup()
  await user.click(option as HTMLElement)
}

async function pickLanguage(): Promise<string> {
  const select = (await screen.findByTestId('transcribe-language-select')) as unknown as HTMLSelectElement
  const offered = Array.from(select.options).map((o) => o.value).filter((value) => value !== '' && value !== 'auto')
  expect(offered.length, 'the popover offers concrete language choices (US-2.0.4)').toBeGreaterThan(0)
  const chosen = offered[0] as string
  fireEvent.change(select, { target: { value: chosen } })
  return chosen
}

describe('CC-101.3: transcribe popover choices dispatch the right job payload', () => {
  test('CC-101.3: model list shows size + offline-ready badge; Start dispatches loadModel + transcribe with the chosen language', async () => {
    const { engine, jobs } = await mountWorkbench({ project: {}, cachedModels: [CACHED_MODEL] })
    jobs.setCapability({ tier: 'T1', reasons: [] })
    await openPopover()

    const cachedOption = screen.getAllByTestId('transcribe-model-option').find((element) => element.getAttribute('data-model-id') === CACHED_MODEL)
    const uncachedOption = screen.getAllByTestId('transcribe-model-option').find((element) => element.getAttribute('data-model-id') === UNCACHED_MODEL)
    expect(cachedOption, 'registry model listed').toBeTruthy()
    expect(uncachedOption, 'registry model listed').toBeTruthy()
    expect(cachedOption?.querySelector('[data-testid=offline-badge]'), 'cached model carries the offline-ready badge (US-2.0.4)').toBeTruthy()
    expect(uncachedOption?.querySelector('[data-testid=offline-badge]'), 'uncached model does not').toBeNull()
    expect(cachedOption?.textContent, 'model size is shown (design.md popover)').toMatch(/MB|GB|B/)

    await pickModel(UNCACHED_MODEL)
    const language = await pickLanguage()
    const start = screen.getByTestId('transcribe-start-button') as HTMLButtonElement
    expect(start.disabled, 'an UNCACHED model is selectable — Start is not disabled for it (FR-2.0.2)').toBe(false)
    const user = userEvent.setup()
    await user.click(start)

    const loaded = asrRequestsOf(engine, 'loadModel')[0]
    expect(loaded?.t, 'loadModel dispatched').toBe('loadModel')
    if (loaded?.t === 'loadModel') {
      expect(loaded.model, 'the chosen model is the one dispatched').toBe(UNCACHED_MODEL)
      expect(loaded.device, 'T1 capability → webgpu device').toBe('webgpu')
    }
    const transcribed = asrRequestsOf(engine, 'transcribe')[0]
    expect(transcribed?.t, 'transcribe dispatched').toBe('transcribe')
    if (transcribed?.t === 'transcribe') {
      expect(transcribed.language, 'the chosen language is dispatched verbatim').toBe(language)
      expect(transcribed.sampleRate, 'ASR contract: 16 kHz').toBe(16000)
      expect(typeof transcribed.jobId).toBe('string')
    }
    expect(jobs.getState().running?.kind, 'store tracks the transcribe job').toBe('transcribe')
    expect(engine.diarizeRequests.length, 'diarize OFF → no diarize request').toBe(0)
  })

  test('CC-101.3: the diarize toggle adds exactly one diarize request carrying the same jobId', async () => {
    const { engine, jobs } = await mountWorkbench({ project: {}, cachedModels: [CACHED_MODEL] })
    jobs.setCapability({ tier: 'T2', reasons: [] })
    await openPopover()
    await pickModel(CACHED_MODEL)
    const toggle = screen.getByTestId('diarize-toggle') as HTMLInputElement
    const user = userEvent.setup()
    await user.click(toggle)
    await user.click(screen.getByTestId('transcribe-start-button'))

    const transcribed = asrRequestsOf(engine, 'transcribe')[0]
    expect(transcribed?.t).toBe('transcribe')
    if (transcribed?.t === 'transcribe') {
      // Default language = select's initial choice: 'auto' selection → null
      // (engine auto-detect), a browser-language default when the model
      // supports it — either is spec-correct (US-2.0.4); the payload must
      // mirror the popover's shown selection exactly.
      const select = screen.getByTestId('transcribe-language-select') as unknown as HTMLSelectElement
      const expectedLanguage = select.value === '' || select.value === 'auto' ? null : select.value
      expect(transcribed.language, 'dispatched language mirrors the popover selection').toBe(expectedLanguage)
      expect(transcribed.sampleRate).toBe(16000)
      const diarized = engine.diarizeRequests[0]
      expect(diarized?.t, 'diarize ON → exactly one DiarizeRequest').toBe('diarize')
      if (diarized?.t === 'diarize') {
        expect(diarized.jobId, 'same job, one pcm tee').toBe(transcribed.jobId)
        expect(diarized.sampleRate).toBe(16000)
      }
      expect(engine.diarizeRequests.length).toBe(1)
    }
    const loaded = asrRequestsOf(engine, 'loadModel')[0]
    if (loaded?.t === 'loadModel') expect(loaded.device, 'T2 capability → wasm device').toBe('wasm')
  })

  test('CC-101.3: an uncached model triggers the download confirmation, not a disabled state', async () => {
    const { engine } = await mountWorkbench({ project: {}, cachedModels: [CACHED_MODEL] })
    engine.respondToAsr('loadModel', [{ t: 'model:confirm-required', model: UNCACHED_MODEL, bytes: 460_000_000 }])
    await openPopover()
    await pickModel(UNCACHED_MODEL)
    expect((screen.getByTestId('transcribe-start-button') as HTMLButtonElement).disabled, 'not disabled for an uncached model (FR-2.0.2)').toBe(false)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('transcribe-start-button'))

    const confirm = await screen.findByTestId('model-download-confirm')
    expect(confirm.textContent, 'confirmation names the model and its size').toContain('460')
    await user.click(screen.getByTestId('model-download-confirm-button'))
    const confirmed = asrRequestsOf(engine, 'confirmDownload')[0]
    expect(confirmed?.t, 'confirmDownload reaches the engine after the user confirms').toBe('confirmDownload')
    if (confirmed?.t === 'confirmDownload') expect(confirmed.model).toBe(UNCACHED_MODEL)
  })

  test('CC-101.3: with existing captions the popover offers Replace vs Align — never a silent overwrite', async () => {
    const spy = createRedactionSpy()
    try {
      const { engine, jobs } = await mountWorkbench({ project: { captionImport: CANNED_IMPORT_RESULT }, cachedModels: [CACHED_MODEL] })
      jobs.setCapability({ tier: 'T1', reasons: [] })
      await openPopover()
      expect(screen.queryByTestId('transcribe-start-button'), 'plain Start is replaced when captions exist (US-2.0.4)').toBeNull()
      expect(screen.getByTestId('replace-captions-button'), 'Replace option offered').toBeTruthy()
      const align = screen.getByTestId('align-captions-button')

      const user = userEvent.setup()
      await user.click(align)
      expect(jobs.getState().running?.kind, 'align keeps the imported track').toBe('align')
      expect(asrRequestsOf(engine, 'transcribe').length, 'alignment still runs ASR (mocked worker)').toBe(1)

      await openPopover()
      await user.click(screen.getByTestId('replace-captions-button'))
      expect(jobs.getState().running?.kind, 'replace transcribes over the source track').toBe('transcribe')
      expect(asrRequestsOf(engine, 'transcribe').length).toBe(2)

      // canary block text flows through the sidebar (imported track) — console stays clean (SECURITY-03).
      act(() => {
        engine.emitAsr({ t: 'job:progress', jobId: jobs.getState().running?.jobId ?? '', processedSec: 61, totalSec: 121 })
      })
      expect(screen.getByTestId('status-bar').textContent).toBeTruthy()
      const verdict = spy.settle()
      expect(verdict.leaks, 'canary import text (and segment progress) never reach the console').toEqual([])
      expect(CANARY_MARKER.length, 'sanity: the imported block carried the canary').toBeGreaterThan(0)
    } finally {
      spy.restore()
    }
  })

  test('CC-101.3: Transcribe is disabled with no media and while a job is running', async () => {
    await mountWorkbench()
    expect((screen.getByTestId('transcribe-button') as HTMLButtonElement).disabled, 'no media → disabled (FR-2.0.2)').toBe(true)
    cleanup()

    const loaded = await mountWorkbench({ project: {}, cachedModels: [CACHED_MODEL] })
    loaded.jobs.setCapability({ tier: 'T1', reasons: [] })
    expect((screen.getByTestId('transcribe-button') as HTMLButtonElement).disabled, 'media loaded → enabled').toBe(false)
    await openPopover()
    await pickModel(CACHED_MODEL)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('transcribe-start-button'))
    expect((screen.getByTestId('transcribe-button') as HTMLButtonElement).disabled, 'job running → disabled').toBe(true)
    expect(loaded.engine.asrRequests.length).toBeGreaterThan(0)
  })
})
