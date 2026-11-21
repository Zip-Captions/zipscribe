// Export dialog (FR-202.2/FR-202.6, US-3.2.1/US-3.2.2, unit-202). Thin
// React over the pure gating model + sidecar service. Snapshot taken by the
// caller at open (immutable; US-3.2.3 shows its snapshotVersion in the
// progress UI). SECURITY-03: no transcript text rendered beyond the dialog's
// own purpose — the dialog never logs.
import { useState } from 'react'
import type { ProjectSnapshot } from '../../engine/model'
import type { Capabilities } from '../../engine/model/capability'
import type { ExportSettings } from '../../engine/protocol'
import { burnInGate, fpsChoices, resolutionChoices, REQUIREMENTS_COPY } from './export-model'
import type { SidecarFormat } from '../../state/services/export-sidecar'
import type { SidecarTrack, SpeakerLabelMode } from '../../engine/export/cue-model'
import './export.css'

export interface ExportDialogProps {
  snapshot: ProjectSnapshot
  capabilities: Capabilities
  onClose: () => void
  onSidecar: (opts: { format: SidecarFormat; track: SidecarTrack; speakerLabels: SpeakerLabelMode }) => void
  onBurnIn: (settings: ExportSettings) => void
}

const FORMATS: readonly SidecarFormat[] = ['srt', 'vtt', 'json', 'tsv']
const LABEL_MODES: readonly { id: SpeakerLabelMode; label: string }[] = [
  { id: 'off', label: 'None' },
  { id: 'vtt-voice', label: 'VTT voice tags' },
  { id: 'prefix', label: '[Name]: prefix' },
]

export function ExportDialog(props: ExportDialogProps): React.JSX.Element | null {
  const { snapshot, capabilities, onClose, onSidecar, onBurnIn } = props
  const gate = burnInGate(capabilities, snapshot.asset.kind)
  const tracks: SidecarTrack[] = ['source', ...snapshot.translations.map((t) => t.language)]
  const [format, setFormat] = useState<SidecarFormat>('srt')
  const [track, setTrack] = useState<SidecarTrack>('source')
  const [speakerLabels, setSpeakerLabels] = useState<SpeakerLabelMode>('off')
  const [burnInTrack, setBurnInTrack] = useState<SidecarTrack>('source')
  const heights = resolutionChoices(snapshot.asset.height || 1080)
  const fpsOptions = fpsChoices(snapshot.asset.fps || 30)
  const [height, setHeight] = useState<number>(heights[0] ?? 1080)
  const [fps, setFps] = useState<number>(fpsOptions[fpsOptions.length - 1] ?? 24)

  return (
    <div className="zip-export-backdrop" role="dialog" aria-modal="true" data-testid="export-dialog">
      <div className="zip-export-card">
        <header className="zip-export-head">
          <h2>Export</h2>
          <button type="button" className="zip-export-close" data-testid="export-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <section className="zip-export-section" aria-label="Sidecar captions">
          <h3>Captions file</h3>
          <div className="zip-export-row" role="radiogroup" aria-label="Format">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={format === f}
                data-testid={`sidecar-format-${f}`}
                className={format === f ? 'zip-chip zip-chip-on' : 'zip-chip'}
                onClick={() => {
                  setFormat(f)
                }}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="zip-export-row">
            <label className="zip-export-label">
              Track
              <select
                data-testid="sidecar-track"
                value={track}
                onChange={(e) => {
                  setTrack(e.target.value)
                }}
              >
                {tracks.map((t) => (
                  <option key={t} value={t}>
                    {t === 'source' ? `Source${snapshot.language ? ` (${snapshot.language})` : ''}` : t}
                  </option>
                ))}
              </select>
            </label>
            <label className="zip-export-label">
              Speaker labels
              <select
                data-testid="sidecar-speaker-labels"
                value={speakerLabels}
                onChange={(e) => {
                  setSpeakerLabels(e.target.value as SpeakerLabelMode)
                }}
              >
                {LABEL_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="zip-export-primary"
            data-testid="sidecar-save"
            onClick={() => {
              onSidecar({ format, track, speakerLabels })
            }}
          >
            Save {format.toUpperCase()}
          </button>
          <button
            type="button"
            className="zip-export-secondary"
            data-testid="sidecar-all"
            disabled={snapshot.translations.length === 0}
            onClick={() => {
              // US-302.3: every language, one file per track (source + each
              // translation), named `{slug}.{lang}.{ext}` by the save seam.
              for (const t of tracks) onSidecar({ format, track: t, speakerLabels })
            }}
          >
            Export all languages
          </button>
        </section>

        {gate.mode === 'full' ? (
          <section className="zip-export-section" aria-label="Burn-in MP4">
            <h3>Burn-in MP4</h3>
            <div className="zip-export-row">
              <label className="zip-export-label">
                Resolution
                <select
                  data-testid="burnin-resolution"
                  value={height}
                  onChange={(e) => {
                    setHeight(Number(e.currentTarget.value))
                  }}
                >
                  {heights.map((h) => (
                    <option key={h} value={h}>
                      {h}p
                    </option>
                  ))}
                </select>
              </label>
              <label className="zip-export-label">
                FPS
                <select
                  data-testid="burnin-fps"
                  value={fps}
                  onChange={(e) => {
                    setFps(Number(e.currentTarget.value))
                  }}
                >
                  {fpsOptions.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="zip-export-row">
              <label className="zip-export-label">
                Track
                <select
                  data-testid="burnin-track"
                  value={burnInTrack}
                  onChange={(e) => {
                    setBurnInTrack(e.target.value)
                  }}
                >
                  {tracks.map((t) => (
                    <option key={t} value={t}>
                      {t === 'source' ? `Source${snapshot.language ? ` (${snapshot.language})` : ''}` : t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="zip-export-primary"
              data-testid="burnin-start"
              onClick={() => {
                const width = Math.round((height * (snapshot.asset.width || 16)) / (snapshot.asset.height || 9))
                onBurnIn({ format: 'mp4-burn-in', width: width % 2 === 0 ? width : width + 1, height, fps, track: burnInTrack })
              }}
            >
              Export MP4
            </button>
          </section>
        ) : gate.mode === 'absent-reason' ? (
          <p className="zip-export-note" data-testid="burnin-absent-reason">
            {gate.reason}
          </p>
        ) : gate.mode === 'requirements' ? (
          <p className="zip-export-note" data-testid="requirements-copy">
            {REQUIREMENTS_COPY}
          </p>
        ) : null}

        <footer className="zip-export-foot" data-testid="snapshot-version">
          snapshot v{String(snapshot.snapshotVersion)}
        </footer>
      </div>
    </div>
  )
}
