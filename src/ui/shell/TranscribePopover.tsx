// Transcribe popover (unit-101 slice C) — knowledge/design.md § Transcribe
// popover. Language (last used → browser language when the model supports it →
// auto-detect), model (size + offline-ready badge, `modelOptions` from the
// jobs slice = registry × model cache) and the diarize toggle; Start dispatches
// the exact job payload through `jobs.startTranscribe` (FR-2.0.6 injectable
// engine — the frozen suite asserts the recorded requests). An uncached model
// is selectable — the engine's `model:confirm-required` gate renders the
// download confirmation (FR-2.0.2: never a disabled Start). With captions on
// the project the popover offers Replace vs Align instead of silently
// overwriting (US-2.0.4).
//
// SECURITY-03: everything rendered here is canned/derived (ids, sizes, codes,
// language tags) — no transcript or file-name strings, and nothing is logged.
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ModelId } from '../../engine/protocol'
import { defaultModelForTier } from '../../state/jobs'
import type { JobsState, JobsStore } from '../../state/jobs'

// BCP-47 primary tags offered for multilingual ('*') models. The frozen
// contract carries only per-model language support; the concrete offering is
// the UI's (design.md "language" row). Specific-support models (e.g. en-only)
// list exactly their own tags.
const CURATED_LANGUAGES: readonly string[] = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'sv', 'tr', 'ru', 'ar', 'hi', 'id', 'vi', 'ja', 'ko', 'zh']

function browserPrimaryLanguage(): string {
  if (typeof navigator === 'undefined') return ''
  return (navigator.language ?? '').split('-')[0]?.toLowerCase() ?? ''
}

export interface TranscribePopoverProps {
  jobs: JobsStore
  jobsState: JobsState
  /** US-2.0.4: ≥ 1 caption block on the project → Replace vs Align, no plain Start. */
  hasCaptions: boolean
}

export function TranscribePopover({ jobs, jobsState, hasCaptions }: TranscribePopoverProps): ReactNode {
  const [selectedModel, setSelectedModel] = useState<ModelId | null>(null)
  const [language, setLanguage] = useState<string | null>(null)
  const [diarize, setDiarize] = useState(false)

  const options = jobsState.modelOptions
  const selected = options.find((option) => option.id === selectedModel) ?? null
  const supported = selected?.languages ?? ['*']
  const offered = supported.includes('*') ? CURATED_LANGUAGES : [...supported]
  const defaultLanguage = offered.includes(browserPrimaryLanguage()) ? browserPrimaryLanguage() : ''
  const effectiveLanguage = language !== null && offered.includes(language) ? language : defaultLanguage

  function resolveModel(): ModelId {
    return selected?.id ?? options.find((option) => option.offlineReady)?.id ?? options[0]?.id ?? defaultModelForTier(jobsState.capability?.tier)
  }

  const dispatch = (mode: 'replace' | 'align'): void => {
    jobs.startTranscribe({
      language: effectiveLanguage === '' ? null : effectiveLanguage,
      modelId: resolveModel(),
      diarize,
      mode,
    })
  }

  const pendingConfirm = jobsState.pendingConfirmDownload
  return (
    <div data-testid="transcribe-popover" role="dialog" aria-label="Transcribe options" className="ws-popover">
      <label className="ws-popover-row">
        <span className="ws-popover-label">Language</span>
        <select data-testid="transcribe-language-select" value={effectiveLanguage} onChange={(event) => setLanguage(event.target.value)}>
          <option value="">Auto-detect</option>
          {offered.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <div className="ws-popover-row">
        <span className="ws-popover-label">Model</span>
        <div role="group" aria-label="Model" className="ws-model-list">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              data-testid="transcribe-model-option"
              data-model-id={option.id}
              aria-pressed={option.id === resolveModel()}
              className="ws-model-option"
              onClick={() => {
                setSelectedModel(option.id)
              }}
            >
              <span className="ws-model-name">{option.id}</span>
              <span className="ws-model-size">{option.sizeLabel}</span>
              {option.offlineReady && (
                <span data-testid="offline-badge" className="ws-offline-badge">
                  Offline ready
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <label className="ws-popover-row">
        <input
          type="checkbox"
          data-testid="diarize-toggle"
          checked={diarize}
          onChange={(event) => {
            setDiarize(event.target.checked)
          }}
        />
        <span>Diarize speakers (beta)</span>
      </label>
      {hasCaptions ? (
        <>
          <button
            type="button"
            data-testid="replace-captions-button"
            className="ws-button"
            onClick={() => {
              dispatch('replace')
            }}
          >
            Replace captions
          </button>
          <button
            type="button"
            data-testid="align-captions-button"
            className="ws-button ws-button-primary"
            onClick={() => {
              dispatch('align')
            }}
          >
            Align existing captions to audio
          </button>
        </>
      ) : (
        <button
          type="button"
          data-testid="transcribe-start-button"
          className="ws-button ws-button-primary"
          disabled={jobsState.running !== null}
          onClick={() => {
            dispatch('replace')
          }}
        >
          Start
        </button>
      )}
      {pendingConfirm !== null && (
        <div data-testid="model-download-confirm" role="alertdialog" aria-label="Model download confirmation" className="ws-confirm">
          <p className="ws-confirm-copy">
            {pendingConfirm.model} is not cached yet — {Math.round(pendingConfirm.bytes / 1_000_000)} MB downloads on first use.
          </p>
          <button
            type="button"
            data-testid="model-download-confirm-button"
            className="ws-button ws-button-primary"
            onClick={() => {
              jobs.confirmModelDownload(pendingConfirm.model)
            }}
          >
            Download and continue
          </button>
        </div>
      )}
    </div>
  )
}
