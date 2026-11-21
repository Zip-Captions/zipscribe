// FR-302.1 / US-302.1 (unit-302) — the Languages section in the Subtitles tab.
// Thin render layer (conventions § UI conventions): reads the `jobs.translation`
// slice + the editor project through selector subscriptions, drives the jobs
// store's `runTranslation`/`cancelTranslation`/`refreshAvailability`, and
// dispatches ONLY the translation command family. Downloads start inside the
// Add click (user activation — the built-in Translator requires it). SECURITY-03:
// nothing caption/translation-bearing is ever logged; only codes + numbers.

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { EditorApp } from '../../state/history'
import type { JobsStore, TranslationJobState } from '../../state/jobs'

/** Candidate target languages for the picker (BCP-47). A pragmatic common set;
 *  the built-in Translator's own availability decides Ready/Download/Unavailable
 *  per pair at runtime — this list only seeds the menu. */
export const TARGET_LANGUAGES: readonly string[] = ['es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'ru', 'ja', 'ko', 'zh', 'zh-Hant', 'ar', 'he', 'hi', 'id', 'vi', 'th', 'uk']

const LABEL: Record<string, string> = {
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  'zh-Hant': 'Chinese (Traditional)',
  ar: 'Arabic',
  he: 'Hebrew',
  hi: 'Hindi',
  id: 'Indonesian',
  vi: 'Vietnamese',
  th: 'Thai',
  uk: 'Ukrainian',
}

const AVAILABILITY_LABEL: Record<string, string> = { ready: 'Ready', download: 'Download', downloading: 'Downloading', unavailable: 'Unavailable', unknown: 'Checking…' }
const STATUS_LABEL: Record<string, string> = { idle: 'Idle', downloading: 'Downloading…', translating: 'Translating…', done: 'Complete', partial: 'Partial', cancelled: 'Cancelled', failed: 'Failed' }

export interface LanguagesSectionProps {
  app: EditorApp
  jobs: JobsStore
  /** US-302.4: open the import-translation-file flow for a language (gating + normal paths). */
  onImportTranslation?: (language: string) => void
  /** A source language override (tests); defaults to the project language. */
  source?: string
}

interface Readable<S> {
  getState(): S
  subscribe(listener: () => void): () => void
}

function useStoreValue<S, V>(store: Readable<S>, select: (state: S) => V): V {
  const [value, setValue] = useState<V>(() => select(store.getState()))
  useEffect(() => {
    const sync = (): void => {
      const next = select(store.getState())
      setValue((current) => (Object.is(current, next) ? current : next))
    }
    sync()
    return store.subscribe(sync)
    // select is a pure inline projection; store identity drives resubscription (Transcript doctrine).
  }, [store])
  return value
}

export function LanguagesSection({ app, jobs, onImportTranslation, source }: LanguagesSectionProps): ReactElement {
  const project = useStoreValue(app.project, (s) => s.project)
  const state = useStoreValue(jobs, (s) => s)
  const [pickerOpen, setPickerOpen] = useState(false)

  const resolvedSource = source ?? project?.language ?? null
  const supported = state.translationSupport === 'supported'
  const tracked = project?.translations ?? []
  const trackedLangs = new Set(tracked.map((t) => t.language))

  // Hydrate the picker badges whenever a source language is known. A background
  // probe only — never downloads (downloads happen in the Add click handler).
  useEffect(() => {
    if (resolvedSource === null) return
    void jobs.refreshAvailability(resolvedSource, TARGET_LANGUAGES)
  }, [jobs, resolvedSource])

  const startRun = (language: string, mode: 'missing' | 'stale'): void => {
    const current = app.project.getState().project
    if (current === null) return
    // Fire inside the click handler so a `Download` pair starts its pack
    // download under user activation; the store flips downloading → translating.
    void jobs.runTranslation(current, language, { mode }).catch(() => undefined)
  }

  const addManualTrack = (language: string): void => {
    app.dispatch('translation-add-track', { language, origin: 'manual' })
  }

  if (resolvedSource === null) {
    return <section aria-label="Languages" className="lang-section"><p className="lang-empty">Transcribe or set a source language to enable translation.</p></section>
  }

  return (
    <section aria-label="Languages" className="lang-section">
      <header className="lang-header">
        <h3>Languages</h3>
        <button type="button" data-testid="languages-add" className="zip-btn" disabled={!supported} onClick={() => setPickerOpen((open) => !open)}>
          Add language
        </button>
      </header>

      {/* US-302.1: a polite live region announces run progress (label + percent,
          never transcript text — SECURITY-03). One region for the whole section. */}
      <div data-testid="languages-live" role="status" aria-live="polite" className="lang-live">
        {liveAnnouncement(state.translation, tracked)}
      </div>

      {state.translationSupport === 'unsupported' && (
        <div data-testid="languages-gating" role="note" className="lang-gating">
          <p>On-device translation needs Chrome or Edge on desktop.</p>
          <div className="lang-gating-actions">
            <button type="button" data-testid="languages-import" className="zip-btn" onClick={() => onImportTranslation?.(nextUntracked(trackedLangs))}>
              Import translation file
            </button>
            <button type="button" data-testid="languages-manual" className="zip-btn" onClick={() => addManualTrack(nextUntracked(trackedLangs))}>
              Add empty track (translate manually)
            </button>
          </div>
        </div>
      )}

      {pickerOpen && supported && (
        <div role="listbox" aria-label="Target languages" className="lang-picker">
          {TARGET_LANGUAGES.filter((lang) => !trackedLangs.has(lang)).map((lang) => {
            const availability = state.translation[lang]?.availability ?? 'unknown'
            return (
              <div key={lang} role="option" data-testid="languages-picker-item" data-language={lang} data-availability={availability} className="lang-picker-item">
                <span className="lang-picker-label">{LABEL[lang] ?? lang}</span>
                <span className={`lang-badge lang-badge-${availability}`}>{AVAILABILITY_LABEL[availability] ?? availability}</span>
                <button type="button" data-testid="languages-picker-add" className="zip-btn" disabled={availability === 'unavailable' || availability === 'unknown'} onClick={() => startRun(lang, 'missing')}>
                  {availability === 'download' ? 'Download & translate' : 'Add'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <ul className="lang-list" aria-label="Translation tracks">
        {tracked.map((track) => {
          const job: TranslationJobState | undefined = state.translation[track.language]
          const status = job?.status ?? 'idle'
          const running = status === 'downloading' || status === 'translating'
          const progress = job?.progress ?? null
          return (
            <li key={track.language} data-testid="languages-row" data-language={track.language} className="lang-row">
              <span className="lang-row-label">{LABEL[track.language] ?? track.language}</span>
              <span data-testid="languages-status" className={`lang-status lang-status-${status}`}>{STATUS_LABEL[status] ?? status}</span>
              {running && (
                <progress data-testid="languages-progress" aria-label={`${LABEL[track.language] ?? track.language} progress`} value={progress?.done ?? 0} max={progress?.total ?? 1} />
              )}
              {running ? (
                <button type="button" data-testid="languages-cancel" className="zip-btn" onClick={() => jobs.cancelTranslation(track.language)}>
                  Cancel
                </button>
              ) : (
                <div className="lang-row-actions">
                  <button type="button" data-testid="languages-translate-all" className="zip-btn" onClick={() => startRun(track.language, 'missing')}>
                    Translate all
                  </button>
                  <button type="button" data-testid="languages-retranslate-stale" className="zip-btn" onClick={() => startRun(track.language, 'stale')}>
                    Retranslate stale
                  </button>
                  <button type="button" data-testid="languages-remove" className="zip-btn zip-btn-ghost" aria-label={`Remove ${LABEL[track.language] ?? track.language}`} onClick={() => app.dispatch('translation-remove-track', { language: track.language })}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function nextUntracked(trackedLangs: ReadonlySet<string>): string {
  return TARGET_LANGUAGES.find((lang) => !trackedLangs.has(lang)) ?? TARGET_LANGUAGES[0]!
}

// US-302.1: build the polite announcement from RUNNING tracks only — language
// label, phase and percent (numbers). Empty while nothing runs (no chatter).
function liveAnnouncement(translation: Record<string, TranslationJobState>, tracked: readonly { language: string }[]): string {
  const parts: string[] = []
  for (const { language } of tracked) {
    const job = translation[language]
    if (job === undefined) continue
    if (job.status !== 'downloading' && job.status !== 'translating') continue
    const label = LABEL[language] ?? language
    const phase = STATUS_LABEL[job.status] ?? job.status
    const pct = job.progress !== null && job.progress.total > 0 ? ` ${String(Math.round((job.progress.done / job.progress.total) * 100))}%` : ''
    parts.push(`${label} ${phase}${pct}`)
  }
  return parts.join('. ')
}
