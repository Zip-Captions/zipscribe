// The populated workbench shell (unit-101) — three-region layout per
// knowledge/design.md: tabbed sidebar (Subtitles mount / Media asset card /
// Style Intent-3 placeholder), preview stage with the reserved canvas layer,
// bottom timeline region (empty until unit-103), header (project name, tier
// chip, Transcribe/Export) and the polite live-region status bar.
//
// Thin render layer: every behavior flows through the injected stores/
// services (frozen contract tests/unit/workbench/unit101-api-contract.d.ts
// § @ui/shell/Workbench). Keys go through the command registry via
// useCommands — components never bind keys (conventions § UI conventions).
//
// SECURITY-03: transcript/segment text is rendered verbatim (it is the user's
// own content on screen) but NEVER reaches a console channel — logging carries
// codes and numbers only, which is what the canary-redaction suites assert.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import type { Range, ReactVirtualizerOptions } from '@tanstack/react-virtual'
import type { Notice, RawSegment, Tier } from '../../engine/protocol'
import type { MediaAsset } from '../../engine/model'
import type { JobsState, JobsStore } from '../../state/jobs'
import type { SettingsStore, WorkbenchSettings } from '../../state/settings'
import type { ProjectStore } from '../../state/project'
import type { ImportReport, IntakeService } from '../../state/services/intake'
import { useCommands } from '../commands/useCommands'
import { TranscribePopover } from './TranscribePopover'
import './workbench.css'

export interface WorkbenchProps {
  jobs: JobsStore
  settings: SettingsStore
  project: ProjectStore
  intake: IntakeService
}

type SidebarTab = 'subtitles' | 'media' | 'style'

const TABS: readonly { id: SidebarTab; label: string }[] = [
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'media', label: 'Media' },
  { id: 'style', label: 'Style' },
]

// FR-2.0.3 feature flag: the styling surface is Intent 3 (unit-302) — the tab
// renders the reserved placeholder while disabled.
const STYLE_TAB_ENABLED = false

const TIER_LABEL: Record<Tier, string> = { T1: 'GPU', T2: 'CPU', T3: 'Limited', T4: 'Limited' }

// US-2.0.3: the UI owns code → copy (design.md § Degradation tiers); a bare
// notice code is never the whole tooltip.
function tierNoticeCopy(notice: Notice): string {
  const from = String(notice.params?.from ?? 'the GPU tier')
  const to = String(notice.params?.to ?? 'the CPU tier')
  switch (notice.code) {
    case 'TIER_DOWNGRADE':
      return `Hardware acceleration was reduced from ${from} to ${to} — inference runs slower here.`
    case 'MULTI_TRACK':
      return 'Only the loudest audio track is transcribed — multi-track mixing is not supported yet.'
    case 'FFMPEG_FALLBACK':
      return 'This container needed the on-device ffmpeg fallback; export speed may drop.'
    case 'WORKER_RECYCLED':
      return 'An inference worker was recycled to keep memory bounded.'
    case 'OFFLINE_MODEL_MISSING':
      return 'The selected model is not cached yet — it downloads on first use.'
    case 'PLAYBACK_STALL':
      return 'Preview playback stalled; transcription continues in the background.'
    case 'PREVIEW_UNSUPPORTED':
      return 'This media cannot be previewed, but transcription still works.'
    default:
      return 'A capability note was reported — see the status bar for details.'
  }
}

// architecture.md § Degradation tiers — T4 is a hard stop; requirements are
// stated in plain language, never as bare probe codes.
const BLOCKED_REQUIREMENT_COPY: Record<string, string> = {
  NO_WASM_SIMD: 'WebAssembly SIMD support (Chrome/Edge 91+ or Firefox 90+)',
  DEVICE_MEMORY_BELOW_4GB: 'At least 4 GB of device memory (navigator.deviceMemory)',
  NO_WEBGPU: 'A WebGPU-capable GPU, or a WASM-SIMD-capable browser for the CPU tier',
  NO_SECURE_CONTEXT: 'A secure (HTTPS) browsing context',
}

const BASELINE_REQUIREMENTS: readonly string[] = [
  'WebAssembly SIMD support (Chrome/Edge 91+ or Firefox 90+)',
  'At least 4 GB of device memory (navigator.deviceMemory)',
  'A Chromium- or Gecko-based desktop browser at ≥ 1280×720',
]

function requirementsFor(reasons: readonly string[]): string[] {
  const rows = reasons.map((reason) => BLOCKED_REQUIREMENT_COPY[reason] ?? `This device is missing a required capability (${reason}).`)
  for (const baseline of BASELINE_REQUIREMENTS) {
    if (rows.length >= 2) break
    if (!rows.includes(baseline)) rows.push(baseline)
  }
  return rows
}

/**
 * Store → React binding. The frozen L2 suites assert DOM synchronously after
 * store calls that originate outside `act()` (e.g. `jobs.setCapability(…)`
 * followed by a direct `expect(chip.textContent)`), so the subscription
 * flushes the render before returning instead of leaving it queued on the
 * concurrent scheduler.
 */
function useSnapshot<T>(store: { getState(): T; subscribe: (listener: () => void) => () => void }): T {
  const [snapshot, setSnapshot] = useState<T>(() => store.getState())
  useEffect(() => {
    const sync = (): void => {
      const next = store.getState()
      setSnapshot((current) => (Object.is(current, next) ? current : next))
    }
    sync() // catch mutations that landed between render and subscribe
    return store.subscribe(() => {
      flushSync(sync)
    })
  }, [store])
  return snapshot
}

function formatTimecode(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10))
  const minutes = Math.floor(tenths / 600)
  const rest = (tenths - minutes * 600) / 10
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

function resolveTheme(settingsState: WorkbenchSettings): 'dark' | 'light' {
  if (settingsState.theme !== 'system') return settingsState.theme
  // FR-2.0.5: prefers-color-scheme is consulted only while the user never chose.
  if (typeof window === 'undefined' || !('matchMedia' in window)) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function TierChip({ tier, notice }: { tier: Tier | null; notice: Notice | null }): ReactNode {
  const tooltipId = useId()
  return (
    <span className="ws-tier-wrap">
      <span data-testid="tier-chip" className="ws-tier-chip" aria-describedby={notice === null ? undefined : tooltipId} title={notice === null ? undefined : tierNoticeCopy(notice)}>
        {tier === null ? '—' : TIER_LABEL[tier]}
      </span>
      {notice !== null && (
        <span data-testid="tier-tooltip" id={tooltipId} role="tooltip" className="ws-tier-tooltip">
          {tierNoticeCopy(notice)}
        </span>
      )}
    </span>
  )
}

const RESIZE_KEY_STEPS: Record<string, number> = { ArrowLeft: -8, ArrowRight: 8, ArrowUp: -8, ArrowDown: 8 }

function ResizeHandle({ region, value, onResize }: { region: 'sidebar' | 'timeline'; value: number; onResize: (px: number) => void }): ReactNode {
  const dragRef = useRef<{ origin: number; size: number } | null>(null)
  const vertical = region === 'sidebar'

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    dragRef.current = { origin: vertical ? event.clientX : event.clientY, size: value }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const delta = (vertical ? event.clientX : event.clientY) - dragRef.current.origin
    // Clamp/persist policy lives in the settings slice (MIN_*_PX, US-2.0.1).
    onResize(dragRef.current.size + delta)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>): void => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const step = RESIZE_KEY_STEPS[event.key]
    if (step === undefined) return
    event.preventDefault()
    onResize(value + step)
  }

  return (
    <div
      data-testid={`resize-handle-${region}`}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-label={vertical ? 'Resize sidebar' : 'Resize timeline'}
      tabIndex={0}
      className={`ws-resizer ${vertical ? 'ws-resizer-col' : 'ws-resizer-row'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  )
}

// Progressive transcription (design.md § Interaction specs): one row per
// accumulated `job:segments` entry, virtualized. jsdom has no layout, so the
// range extractor renders everything when the scroll element measures zero —
// a real browser keeps the virtualized window (CLS gate is e2e, slice D).
// jsdom (L2 suites) has no layout engine and no ResizeObserver: the scroll
// element measures 0×0, which blanks `calculateRange` and thus the rendered
// window. Real browsers (ResizeObserver present) keep the stock rect
// observer and true virtualization; in a layout-less environment the rect is
// reported as "everything visible" so streamed rows reach the DOM.
const LAYOUTLESS = typeof globalThis.ResizeObserver === 'undefined'
const syntheticElementRect: NonNullable<ReactVirtualizerOptions<HTMLDivElement, HTMLDivElement>['observeElementRect']> = (_instance, reportRect) => {
  reportRect({ width: 1, height: 1_000_000 })
  return () => {}
}

function TranscriptPane({ segments }: { segments: readonly RawSegment[] }): ReactNode {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rangeExtractor = useCallback((range: Range): number[] => {
    const element = scrollRef.current
    if (element === null || element.clientHeight === 0) return Array.from({ length: range.count }, (_unused, index) => index)
    return defaultRangeExtractor(range)
  }, [])
  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    // Generous overscan: streamed batches stay fully rendered (the frozen CLS
    // spec asserts rows reach the injected batch total), while a 10 000-block
    // transcript stays windowed (design.md § virtualization).
    overscan: 24,
    rangeExtractor,
    ...(LAYOUTLESS ? { observeElementRect: syntheticElementRect } : {}),
  })
  // Kick the estimate measurement pass explicitly when the stream grows (the
  // pattern in the TanStack dynamic-size example — jsdom never triggers it).
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, segments.length])

  return (
    <div ref={scrollRef} className="ws-transcript" role="list" aria-label="Streaming transcript">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const segment = segments[item.index]
          if (segment === undefined) return null
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              data-testid="streaming-segment-row"
              role="listitem"
              aria-label={`${formatTimecode(segment.start)} to ${formatTimecode(segment.end)}: ${segment.text}`}
              className="ws-segment-row"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: item.size, transform: `translateY(${item.start}px)` }}
            >
              <span className="ws-segment-time">
                {formatTimecode(segment.start)}–{formatTimecode(segment.end)}
              </span>
              <span className="ws-segment-text">{segment.text}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// FR-2.0.3 Media tab: asset card (name, duration, codec; res/fps for video).
function MediaTab({ asset }: { asset: MediaAsset | null }): ReactNode {
  if (asset === null) return <p className="ws-empty">No media loaded. Drop a video or audio file to begin.</p>
  return (
    <div className="ws-media-card" data-testid="media-asset-card">
      <p className="ws-media-name">{asset.name}</p>
      <dl className="ws-media-grid">
        <dt>Duration</dt>
        <dd className="ws-tabular">{formatTimecode(asset.duration)}</dd>
        <dt>Container</dt>
        <dd>{asset.container}</dd>
        <dt>Audio</dt>
        <dd>{asset.audioCodec ?? '—'}</dd>
        {asset.kind === 'video' && (
          <>
            <dt>Video</dt>
            <dd>{asset.videoCodec ?? '—'}</dd>
            <dt>Resolution</dt>
            <dd className="ws-tabular">
              {asset.width}×{asset.height} · {asset.fps} fps
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}

// CC-101.2: the import report renders the unit-07 `ImportReport` VERBATIM —
// numbers, format and adjustment codes only (SECURITY-03 safe; caption text
// never reaches this component, it came through the injectable seam).
function ImportReportBanner({ report }: { report: ImportReport }): ReactNode {
  return (
    <div data-testid="import-report" role="status" className="ws-import-report">
      <span className="ws-import-headline">
        Imported {report.format} ({report.encoding}) — {report.cues} cues, {report.blocks} blocks{report.detectedLanguage === null ? '' : `, language ${report.detectedLanguage}`}
      </span>
      {report.adjustments.map((adjustment) => (
        <span key={adjustment.code} className="ws-adjustment-code">
          {adjustment.code} ×{adjustment.count}
        </span>
      ))}
    </div>
  )
}

// CC-101.2: rejections are announced with the reason CODE only — never the
// file name (SECURITY-03); nothing is silently dropped.
function Toast({ codes }: { codes: readonly string[] }): ReactNode {
  return (
    <div data-testid="toast" role="alert" className="ws-toast">
      {codes.join(' · ')}
    </div>
  )
}

// CC-101.2 / US-2.0.2: the centered drop zone doubles as the first-run screen
// (media + caption intake by content sniff + extension through the intake
// service; caption parsing stays behind the unit-07 seam) and carries the
// model/tier status from the jobs store.
function DropZone({ jobsState, onFiles, onSample }: { jobsState: JobsState; onFiles: (files: File[]) => void; onSample: () => void }): ReactNode {
  const capability = jobsState.capability
  return (
    <div
      data-testid="drop-zone"
      className="ws-drop-zone"
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length > 0) onFiles(files)
      }}
    >
      <p className="ws-drop-title">Drop a video or audio file to begin</p>
      <p className="ws-drop-hint">Caption files (.srt .vtt .sbv .ttml .dfxp .xml .ass .ssa .zipscribe.json) may come along — they import as the source track.</p>
      <button
        type="button"
        data-testid="sample-clip-button"
        className="ws-button ws-button-primary"
        onClick={() => {
          onSample()
        }}
      >
        Try a sample clip
      </button>
      <p className="ws-drop-status">
        {capability === null ? 'Checking device capability…' : `Tier ${capability.tier} · ${TIER_LABEL[capability.tier]} · ${capability.reasons.length === 0 ? 'model cache local' : 'capability notes apply'}`}
      </p>
    </div>
  )
}

// FR-2.0.4: polite live region — progress % while a job runs, model · tier ·
// cache otherwise. Numbers and codes only.
function StatusBar({ jobsState }: { jobsState: JobsState }): ReactNode {
  const percent = jobsState.progress !== null && jobsState.progress.totalSec > 0 ? `${Math.round((jobsState.progress.processedSec / jobsState.progress.totalSec) * 100)}%` : 'Idle'
  const model = jobsState.running === null ? 'no model' : jobsState.running.kind === 'align' ? 'aligning' : 'transcribing'
  const tier = jobsState.capability === null ? 'tier pending' : TIER_LABEL[jobsState.capability.tier]
  return (
    <footer data-testid="status-bar" role="status" aria-live="polite" className="ws-status">
      {`${percent} · ${model} · ${tier} · cache local`}
    </footer>
  )
}

// US-2.0.3 (CC-101.4): T4 is a hard stop — no panels, no actions, stated
// requirements only.
function BlockedScreen({ reasons }: { reasons: readonly string[] }): ReactNode {
  return (
    <div data-testid="blocked-screen" role="alert" className="ws-blocked">
      <h1>Zipscribe can’t run on this device</h1>
      <p>On-device transcription needs more capability than this browser reports. Zipscribe requires:</p>
      <ul className="ws-blocked-requirements">
        {requirementsFor(reasons).map((requirement) => (
          <li key={requirement} data-testid="blocked-requirement">
            {requirement}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Workbench(props: WorkbenchProps): ReactNode {
  const { jobs, settings, project, intake } = props

  useCommands(settings)
  const jobsState = useSnapshot(jobs)
  const settingsState = useSnapshot(settings)
  const { project: currentProject } = useSnapshot(project)
  const [tab, setTab] = useState<SidebarTab>('subtitles')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [toastCodes, setToastCodes] = useState<readonly string[] | null>(null)
  const [importReport, setImportReport] = useState<ImportReport | null>(null)

  // Intake flows (drop / sample): outcomes are pushed into local UI state —
  // rejections as reason CODES, the latest import as the report. flushSync so
  // the DOM settles before awaiting callers resume (same contract as
  // useSnapshot's store binding).
  async function runIntake(files: readonly File[]): Promise<void> {
    try {
      const outcome = await intake.handleFiles(files)
      flushSync(() => {
        setToastCodes(outcome.rejected.length > 0 ? [...new Set(outcome.rejected.map((entry) => entry.reason))] : null)
        setImportReport(outcome.importedCaptions.at(-1)?.report ?? null)
      })
    } catch {
      // IN.9 (adversary adjudication, CC-101.2): a rejecting intake (seam or
      // engine) is announced honestly at the UI boundary — mirror of
      // loadSample's catch — and never escapes as an unhandled rejection.
      flushSync(() => {
        setToastCodes(['INTAKE_FAILED'])
      })
    }
  }

  // Always-on: the whole shell accepts drops (FR-2.0.3 Media-tab re-import
  // shares this intake); the first-run drop zone stops propagation so a drop
  // is never processed twice.
  const onShellDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length > 0) void runIntake(files)
  }

  const theme = resolveTheme(settingsState)
  // FR-2.0.5: the theme attribute lives on the document root so the design
  // tokens (:root[data-theme], design.md) resolve for ported overlays too.
  // (Hook order: this effect runs before the T4 early return as well.)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  if (jobsState.capability?.tier === 'T4') return <BlockedScreen reasons={jobsState.capability.reasons} />

  return (
    <div data-testid="workbench-shell" className="ws-shell" onDragOver={(event) => event.preventDefault()} onDrop={onShellDrop}>
      <header role="banner" className="ws-header">
        <span className="ws-brand">Zipscribe</span>
        {/* FR-1.0.8 deploy-smoke contract: the build identity stays visible.
            typeof-guarded because the vite `define` is absent under vitest. */}
        <span data-testid="build-info" className="ws-build-info">
          {typeof __ZIP_VERSION__ === 'string' ? __ZIP_VERSION__ : ''}
        </span>
        <input
          data-testid="project-name"
          className="ws-project-name"
          aria-label="Project name"
          value={currentProject?.name ?? ''}
          disabled={currentProject === null}
          onChange={(event) => {
            project.setProjectName(event.target.value)
          }}
        />
        <TierChip tier={jobsState.capability?.tier ?? null} notice={jobsState.tierNotice} />
        <span className="ws-transcribe-wrap">
          <button
            type="button"
            data-testid="transcribe-button"
            className="ws-button ws-button-primary"
            disabled={currentProject === null || jobsState.running !== null}
            onClick={() => {
              setPopoverOpen((open) => !open)
            }}
          >
            Transcribe
          </button>
          {popoverOpen && currentProject !== null && <TranscribePopover jobs={jobs} jobsState={jobsState} hasCaptions={currentProject.blocks.length > 0} />}
        </span>
        <button type="button" data-testid="export-button" className="ws-button" disabled={!project.hasBlocks()}>
          Export
        </button>
      </header>
      {importReport !== null && <ImportReportBanner report={importReport} />}
      <main className="ws-body">
        {!settingsState.collapsed.sidebar && (
          <>
            <section data-region="sidebar" data-testid="panel-sidebar" tabIndex={-1} role="region" aria-label="Sidebar" className="ws-sidebar" style={{ width: settingsState.panels.sidebarPx }}>
              <div role="tablist" aria-label="Sidebar panels" className="ws-tabs">
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    id={`tab-${entry.id}`}
                    data-testid={`tab-${entry.id}`}
                    aria-selected={tab === entry.id}
                    aria-controls={`tabpanel-${entry.id}`}
                    className="ws-tab"
                    onClick={() => {
                      setTab(entry.id)
                    }}
                  >
                    {entry.label}
                    {entry.id === 'style' && !STYLE_TAB_ENABLED && <span className="ws-intent-badge">Intent 3</span>}
                  </button>
                ))}
              </div>
              {tab === 'subtitles' && (
                <div role="tabpanel" id="tabpanel-subtitles" aria-labelledby="tab-subtitles" className="ws-tabpanel">
                  <TranscriptPane segments={jobsState.segments} />
                </div>
              )}
              {tab === 'media' && (
                <div role="tabpanel" id="tabpanel-media" aria-labelledby="tab-media" className="ws-tabpanel">
                  <MediaTab asset={currentProject?.asset ?? null} />
                </div>
              )}
              {tab === 'style' && (
                <div role="tabpanel" id="tabpanel-style" aria-labelledby="tab-style" className="ws-tabpanel">
                  <p className="ws-empty">{STYLE_TAB_ENABLED ? 'Styling surface arrives with Intent 3 (unit-302).' : 'Styling arrives in Intent 3.'}</p>
                </div>
              )}
            </section>
            <ResizeHandle
              region="sidebar"
              value={settingsState.panels.sidebarPx}
              onResize={(px) => {
                settings.setPanelSize('sidebar', px)
              }}
            />
          </>
        )}
        <div className="ws-center">
          <section data-region="stage" data-testid="panel-stage" tabIndex={-1} role="region" aria-label="Preview stage" className="ws-stage">
            <div data-testid="preview-canvas-layer" className="ws-canvas-layer" aria-hidden="true" />
            {currentProject === null && (
              <DropZone
                jobsState={jobsState}
                onFiles={(files) => {
                  void runIntake(files)
                }}
                onSample={() => {
                  void intake.loadSample().catch(() => {
                    flushSync(() => {
                      setToastCodes(['SAMPLE_FAILED'])
                    })
                  })
                }}
              />
            )}
          </section>
          {!settingsState.collapsed.timeline && (
            <>
              <ResizeHandle
                region="timeline"
                value={settingsState.panels.timelinePx}
                onResize={(px) => {
                  settings.setPanelSize('timeline', px)
                }}
              />
              <section data-region="timeline" data-testid="panel-timeline" tabIndex={-1} role="region" aria-label="Timeline" className="ws-timeline" style={{ height: settingsState.panels.timelinePx }}>
                <p className="ws-empty">Timeline arrives with unit-103.</p>
              </section>
            </>
          )}
        </div>
      </main>
      {toastCodes !== null && <Toast codes={toastCodes} />}
      <StatusBar jobsState={jobsState} />
    </div>
  )
}
