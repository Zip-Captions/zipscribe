// CC-304.5 (L2, jsdom): the popover-label half of #63 — the transcribe
// popover renders FRIENDLY model labels and HUMAN language names, with
// Auto-detect as the honest default. Today (unit-304 pre-implementation) the
// popover renders the raw registry id (`whisper-tiny_timestamped@51724429`)
// in the model rows and bare ISO codes (`en`, `es`, …) in the language
// select, and preselects the browser language whenever it is in the offered
// list — so all three tests below are RED on real value assertions.
//
// Derived only from the unit spec's CC-304.5 ("model rows show friendly
// labels — never raw registry ids or revision hashes; language options show
// human names — never bare codes; Auto-detect is the default"). Assertions
// read the rendered text; nothing here constrains WHICH friendly label the
// builder picks beyond "not the raw id/hash/code" (design.md owns copy).
//
// SECURITY-03: only ids, codes and canned option text cross assertions.
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TranscribePopover } from '@ui/shell/TranscribePopover'
import type { JobsState, JobsStore, ModelOptionView } from '@state/jobs'
import type { RunStats } from '@engine/translate/session'

const RUN_STATS: RunStats = { planned: 0, translated: 0, passThrough: 0, failed: 0, discarded: 0, cancelled: false, pairDownloadable: false, failureCodes: [] }

const MODEL_OPTIONS: ModelOptionView[] = [
  { id: 'whisper-tiny_timestamped@51724429', sizeLabel: '125 MB', offlineReady: true, languages: ['*'] },
  { id: 'whisper-base_timestamped@608c49e6', sizeLabel: '290 MB', offlineReady: false, languages: ['*'] },
  { id: 'sherpa-zipformer-en-int8@11a70a47', sizeLabel: '130 MB', offlineReady: false, languages: ['en'] },
]

function state(): JobsState {
  return {
    capability: null,
    tierNotice: null,
    modelOptions: MODEL_OPTIONS,
    running: null,
    progress: null,
    segments: [],
    error: null,
    notices: [],
    pendingConfirmDownload: null,
    translation: {},
    translationSupport: 'unknown',
  }
}

function stubStore(): JobsStore {
  return {
    getState: state,
    subscribe: () => () => undefined,
    onEngineEvent: () => () => undefined,
    setCapability: () => undefined,
    setTierNotice: () => undefined,
    startTranscribe: () => undefined,
    cancel: () => undefined,
    confirmModelDownload: () => undefined,
    runTranslation: () => Promise.resolve(RUN_STATS),
    cancelTranslation: () => undefined,
    refreshAvailability: () => Promise.resolve(),
  }
}

function mount(): void {
  render(<TranscribePopover jobs={stubStore()} jobsState={state()} hasCaptions={false} />)
}

afterEach(cleanup)

describe('CC-304.5: popover labels are friendly, never raw', () => {
  test('CC-304.5: model rows render friendly labels — never the raw registry id, never a revision hash', () => {
    mount()
    const rows = screen.getAllByTestId('transcribe-model-option')
    expect(rows.length, 'every registry row is listed').toBe(MODEL_OPTIONS.length)
    for (const row of rows) {
      const rawId = row.getAttribute('data-model-id') ?? ''
      expect(rawId.length, 'the row is identified by its registry id').toBeGreaterThan(0)
      const text = row.textContent ?? ''
      expect(text.length, 'the row renders visible label text').toBeGreaterThan(0)
      expect(text, `the row never renders the raw registry id (${rawId})`).not.toContain(rawId)
      expect(text, 'the label never embeds the revision hash').not.toMatch(/@[0-9a-f]{6,}/u)
      const revision = rawId.split('@')[1] ?? ''
      if (revision !== '') expect(text, `the label never embeds the id's revision fragment (${revision})`).not.toContain(revision)
      expect(text, 'a friendly label carries real words').toMatch(/[A-Za-z]{3,}/u)
    }
  })

  test('CC-304.5: language options render human names — never bare ISO codes', () => {
    mount()
    const select = (screen.getByTestId('transcribe-language-select') as unknown) as HTMLSelectElement
    const coded = Array.from(select.options).filter((option) => option.value !== '')
    expect(coded.length, 'a multilingual model offers the curated language set').toBeGreaterThan(1)
    for (const option of coded) {
      const label = (option.textContent ?? '').trim()
      expect(label.length, `option ${option.value} renders a label`).toBeGreaterThan(0)
      expect(label.toLowerCase(), `option label is not the bare code (${option.value})`).not.toBe(option.value)
      expect(label, `option ${option.value} renders a human name, not a code`).not.toMatch(/^[a-z]{2,3}$/iu)
      expect(label, `option ${option.value} renders name-like copy`).toMatch(/^[A-Za-z][A-Za-z ()''-]*$/u)
    }
  })

  test('CC-304.5: Auto-detect is the default language selection even when the browser language is supported', () => {
    // Headless Chromium reports en-US and 'en' is in the curated offering —
    // the browser-language preselect must NOT win (US-304.1: Auto-detect is
    // the honest default; preselecting a language is what made a real
    // "auto-detect" story untestable from the popover).
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'en-US' })
    mount()
    const select = (screen.getByTestId('transcribe-language-select') as unknown) as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.value), 'the Auto-detect option exists').toContain('')
    expect(select.value, 'the select opens on Auto-detect (empty selection = engine detects)').toBe('')
    expect(select.selectedOptions[0]?.textContent, 'the visible default is Auto-detect').toBe('Auto-detect')
  })
})
