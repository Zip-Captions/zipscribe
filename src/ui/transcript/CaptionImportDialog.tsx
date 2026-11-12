// FR-104.9 / design.md § Bring-your-own captions — the import dialog opened
// when a caption file is dropped on an OPEN project (Workbench drop intercept).
// The engine port `analyze`s the file WITHOUT touching the project: detected
// format/encoding/language + counts + adjustment codes render BEFORE the user
// confirms (design.md: "…report… before confirming"). Confirm dispatches
// EXACTLY ONE `captions-import` (replace:true) — one undo step (CC-104.7);
// Cancel dispatches nothing (no history entry).
//
// "Add as translation" is honestly DISABLED: translation-track intake is
// Intent 4 scope (caption-translation/unit-301+; the frozen unit-104 spec
// only pins Replace + report). The tooltip carries the CODE, not marketing
// copy. The encoding override re-analyzes through the same port (FR-07.1);
// format is the content-sniff truth (FR-07.2 — an editable format would
// contradict the pinned sniffing).
//
// SECURITY-03: everything rendered is report DATA (format/encoding/counts/
// codes) and canned labels — caption text never reaches this component.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { EditorApp } from '../../state/history'
import type { CaptionAnalyzeOutcome, CaptionImportPort } from '../../state/services/caption-import'
import type { ImportReport } from '../../engine/captions/import'

// UI-owned copy per adjustment code (design.md: the UI owns code → copy).
const ADJUSTMENT_COPY: Record<ImportReport['adjustments'][number]['code'], string> = {
  OVERLAP_CLAMPED: 'Overlapping cues clamped',
  ZERO_DURATION_FIXED: 'Zero durations fixed',
  TAGS_STRIPPED: 'Styling tags removed',
  POSITION_DROPPED: 'Positioning dropped',
  STYLE_DROPPED: 'Style blocks dropped',
  EMPTY_CUE_DROPPED: 'Empty cues dropped',
  CUE_UNMATCHED: 'Cues unmatched',
}

const ENCODINGS: readonly ('utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252')[] = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252']

interface FailureShape {
  code: string
}

function failureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) return String((error as FailureShape).code)
  return 'CAPTION_IMPORT_FAILED'
}

export interface CaptionImportDialogProps {
  file: File
  port: CaptionImportPort
  app: EditorApp
  onClose: () => void
}

export function CaptionImportDialog({ file, port, app, onClose }: CaptionImportDialogProps): ReactNode {
  const [analysis, setAnalysis] = useState<CaptionAnalyzeOutcome | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [prefixMode, setPrefixMode] = useState<'auto' | 'on' | 'off'>('auto')
  const [encodingOverride, setEncodingOverride] = useState<'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' | null>(null)
  const [language, setLanguage] = useState('')
  const [pending, setPending] = useState(false)
  const [rejectCode, setRejectCode] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const name = file.name
  const [bytes, setBytes] = useState<Uint8Array | null>(null)

  useEffect(() => {
    let cancelled = false
    void file.arrayBuffer().then((buffer) => {
      if (!cancelled) setBytes(new Uint8Array(buffer))
    })
    return () => {
      cancelled = true
    }
  }, [file])

  useEffect(() => {
    if (bytes === null) return
    const project = app.project.getState().project
    if (project === null) {
      setFailure('NO_PROJECT')
      return
    }
    let cancelled = false
    setAnalysis(null)
    setFailure(null)
    void port
      .analyze(project, { name, bytes }, { speakerPrefixes: prefixMode, ...(encodingOverride === null ? {} : { encoding: encodingOverride }) })
      .then((outcome) => {
        if (cancelled) return
        setAnalysis(outcome)
        setLanguage(outcome.report.detectedLanguage ?? '')
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(failureCode(error))
      })
    return () => {
      cancelled = true
    }
    // `nonce` re-runs the analysis on an encoding/prefix override; `void nonce`
    // keeps the linter honest about the deliberate dependency.
  }, [app, port, name, bytes, prefixMode, encodingOverride, nonce])
  void nonce

  function confirm(): void {
    if (analysis === null || pending) return
    setPending(true)
    const rejection = app.dispatch('captions-import', { blocks: analysis.blocks, speakers: [...analysis.speakers], replace: true })
    if (rejection === null) onClose()
    else {
      setPending(false)
      setRejectCode(rejection.code)
    }
  }

  const report = analysis?.report ?? null
  return (
    <div className="ts-import-backdrop" data-testid="caption-import-backdrop">
      <div data-testid="caption-import-dialog" role="dialog" aria-modal="true" aria-label="Import captions" className="ts-import-dialog">
        <p className="ts-import-title">Import captions</p>
        {failure !== null && (
          <p className="ts-import-error" data-testid="caption-import-failure">
            {failure}
          </p>
        )}
        {rejectCode !== null && (
          <p className="ts-import-error" data-testid="caption-import-reject">
            {rejectCode}
          </p>
        )}
        {report !== null && (
          <div data-testid="caption-import-report" className="ts-import-report">
            <p className="ts-import-row">
              <span className="ts-import-key">Format</span>
              <span data-testid="caption-import-report-format">{report.format}</span>
            </p>
            <p className="ts-import-row">
              <span className="ts-import-key">Encoding</span>
              <span data-testid="caption-import-report-encoding">{report.encoding}</span>
              <label className="ts-import-override">
                <span className="ts-sr-only">Override encoding</span>
                <select
                  data-testid="caption-import-encoding-select"
                  aria-label="Override encoding"
                  value={encodingOverride ?? report.encoding}
                  onChange={(event) => {
                    const next = event.target.value as 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
                    setEncodingOverride(next)
                    setNonce((n) => n + 1)
                  }}
                >
                  {ENCODINGS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            <p className="ts-import-row">
              <span className="ts-import-key">Cues</span>
              <span data-testid="caption-import-report-cues">{String(report.cues)}</span>
            </p>
            <p className="ts-import-row">
              <span className="ts-import-key">Blocks</span>
              <span data-testid="caption-import-report-blocks">{String(report.blocks)}</span>
            </p>
            <p className="ts-import-row">
              <span className="ts-import-key">Language</span>
              {/* Editable (design.md); the report value is the detection default. */}
              <input data-testid="caption-import-language" className="ts-import-language" value={language} aria-label="Caption language" placeholder="—" onChange={(event) => setLanguage(event.target.value)} />
            </p>
            {report.adjustments.map((adjustment) => (
              <p key={adjustment.code} className="ts-import-adjustment" data-testid="caption-import-report-adjustment" data-code={adjustment.code}>
                {ADJUSTMENT_COPY[adjustment.code]} — {String(adjustment.count)}
              </p>
            ))}
          </div>
        )}
        <div className="ts-import-use" role="group" aria-label="Use as">
          <label>
            <input type="radio" data-testid="caption-import-use-replace" name="caption-import-use" defaultChecked disabled />
            Replace source captions
          </label>
          <label title="TRANSLATION_TRACKS_INTENT_3_SCOPE">
            <input type="radio" data-testid="caption-import-use-translation" name="caption-import-use" disabled />
            Add as translation
          </label>
        </div>
        <label className="ts-import-prefix">
          <input
            type="checkbox"
            data-testid="caption-import-prefix-toggle"
            checked={prefixMode !== 'off'}
            onChange={(event) => {
              setPrefixMode(event.target.checked ? 'auto' : 'off')
            }}
          />
          Read speaker prefixes from cue text
        </label>
        <div className="ts-import-actions">
          <button
            type="button"
            data-testid="caption-import-cancel"
            className="ts-popover-action"
            onClick={() => {
              onClose()
            }}
          >
            Cancel
          </button>
          <button type="button" data-testid="caption-import-confirm" className="ts-popover-action ts-popover-primary" disabled={analysis === null || pending} onClick={confirm}>
            Import
          </button>
        </div>
      </div>
    </div>
  )
}
