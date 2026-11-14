// FR-106.5 (CC-106.5 / CC-106.2) — the Media-tab project list. Thin render
// layer over the injected PersistenceService (props seam pinned by
// tests/unit/editor/unit106-api-contract.d.ts § @ui/shell/ProjectList):
// rows render in the SERVICE's updatedAt-DESC order (never re-sorted here),
// open/duplicate/delete/new dispatch into the service, the delete-undo toast
// expires on the INJECTED timers (conventions § Principles 3 — the component
// never reaches for the global setTimeout), and opening a project with the
// `editor` seam restores `panelState.lastPlayhead`/`selection` into the
// EditorStore (FR-106.5). No async logic lives in components: handlers are
// one-call dispatches whose `.then` refreshes UI state (the Workbench
// runIntake pattern), all IndexedDB work staying in the service.
//
// SECURITY-03: the banners and the delete toast are numbers and codes only —
// block counts, relink field names, persist state. Block TEXT never reaches
// these elements (the canary suites assert it); project names render on
// screen like the unit-101 header does, never into a console channel.
//
// The relink mismatch warning is PRESENTATIONAL: the app-level relink flow
// (slice D, via Workbench's relinkMismatch/onRelinkKeep/onRelinkReplace
// props) reports `relinkMedia → {kind:'mismatch', differs}` and owns the
// decision. This component never swaps media — neither does the service.
import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import type { LoadedProject, PersistenceService, PersistenceTimers, ProjectRow, RelinkField, StorageEstimateView } from '../../state/services/persistence'
import type { EditorStore } from '../../state/generated/contract-types'

/** The frozen ProjectListProps (unit106-api-contract.d.ts) EXTENDED with the
 *  optional slice-D relink seam — every pinned mount path stays untouched. */
export interface ProjectListProps {
  persistence: PersistenceService
  /** Called with the loaded reopen context (FR-106.5) — null when the row vanished. */
  onOpen: (projectId: string, loaded: LoadedProject | null) => void
  /** Injected timers for the delete-undo toast expiry (deterministic L2). */
  timers?: PersistenceTimers
  /** FR-106.5 reopen-context restore seam: playhead + selection into the EditorStore. */
  editor?: EditorStore
  /** CC-106.4 / US-2.4.2: set by the app when `relinkMedia` reported a fingerprint mismatch. */
  relinkMismatch?: readonly RelinkField[] | null
  /** "Keep the stored media" — app-owned decision callback (the service never overwrites). */
  onRelinkKeep?: () => void
  /** "Replace with the picked file" — app-owned decision callback (never auto-invoked). */
  onRelinkReplace?: () => void
}

/** Toast-undoable delete window (US-2.4.3 product rule) on the injected timers. */
const DELETE_TOAST_MS = 5_000

/** createProjectRow owns the blank payload; the name is the caller's placeholder. */
const NEW_PROJECT_NAME = 'Untitled project'

/** Production timer source (tests always inject the fake). */
const DEFAULT_TIMERS: PersistenceTimers = {
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (id) => window.clearTimeout(id),
}

/** FR-106.7 honest display: humanized usage/quota (1.5 MB / 5 GB style). */
function humanizeBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? String(value) : String(Math.round(value * 10) / 10)} ${units[unit]}`
}

type PendingDelete = { id: string; handle: { commit(): Promise<void>; undo(): void } }

export function ProjectList(props: ProjectListProps): ReactNode {
  const { persistence, onOpen, editor, relinkMismatch = null, onRelinkKeep, onRelinkReplace } = props
  const timers = props.timers ?? DEFAULT_TIMERS
  const [rows, setRows] = useState<readonly ProjectRow[]>([])
  const [estimate, setEstimate] = useState<StorageEstimateView | null>(null)
  const [opened, setOpened] = useState<{ id: string; loaded: LoadedProject | null } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  // Re-pull through the service (the established thin pattern: one await, one
  // flushSync — same contract as Workbench's runIntake/useSnapshot binding).
  const refresh = useCallback((): void => {
    void persistence
      .listProjects()
      .then((next) => {
        flushSync(() => setRows(next))
      })
      .catch(() => undefined) // transient read failures stay silent — the save-state indicator owns persistence errors
    void persistence
      .storageEstimate()
      .then((next) => {
        flushSync(() => setEstimate(next))
      })
      .catch(() => undefined)
  }, [persistence])

  // Mount pull + keep live: every save-state push re-reads the rows and the
  // estimate (CC-106.5 storage display, FR-106.7).
  useEffect(() => {
    refresh()
    return persistence.subscribeSaveState(refresh)
  }, [persistence, refresh])

  // Toast expiry on the injected timers → commit the purge (all three stores).
  // Identity-keyed: undo/replacement unmounts the effect and clears the timer.
  useEffect(() => {
    if (pendingDelete === null) return
    const { handle } = pendingDelete
    const timer = timers.setTimeout(() => {
      void handle
        .commit()
        .then(() => {
          flushSync(() => setPendingDelete(null))
          refresh()
        })
        .catch(() => undefined)
    }, DELETE_TOAST_MS)
    return (): void => {
      timers.clearTimeout(timer)
    }
  }, [pendingDelete, timers, refresh])

  // FR-106.5: openProject (the lastOpened touch — never loadProject here),
  // restore the reopen context when the editor seam is given, then notify.
  function handleOpen(id: string): void {
    void persistence
      .openProject(id)
      .then((loaded) => {
        if (loaded !== null && editor !== undefined && loaded.panelState !== null) {
          editor.setPlayhead(loaded.panelState.lastPlayhead)
          if (loaded.panelState.selection !== null) editor.setSelection(loaded.panelState.selection)
        }
        flushSync(() => setOpened({ id, loaded }))
        onOpen(id, loaded)
      })
      .catch(() => undefined)
  }

  function handleDelete(id: string): void {
    // Replacing an undecided toast commits the previous purge — the user
    // re-confirmed deletion intent by deleting again (no silent row leak).
    if (pendingDelete !== null) void pendingDelete.handle.commit().catch(() => undefined)
    void persistence
      .deleteProject(id)
      .then((handle) => {
        flushSync(() => setPendingDelete({ id, handle }))
      })
      .catch(() => undefined)
  }

  function handleUndoDelete(): void {
    if (pendingDelete === null) return
    pendingDelete.handle.undo()
    flushSync(() => setPendingDelete(null))
    refresh()
  }

  return (
    <div data-testid="project-list" role="list" aria-label="Projects" className="ws-project-list">
      {relinkMismatch !== null && (
        <div data-testid="relink-mismatch-warning" role="alert" className="ws-relink-warning">
          <p className="ws-relink-headline">Different file — replace or keep?</p>
          <p className="ws-relink-fields">{`differs: ${relinkMismatch.join(', ')}`}</p>
          <button type="button" data-testid="relink-keep-button" className="ws-button" onClick={onRelinkKeep}>
            Keep
          </button>
          <button type="button" data-testid="relink-replace-button" className="ws-button" onClick={onRelinkReplace}>
            Replace
          </button>
        </div>
      )}
      {opened?.loaded?.project.transcription === 'partial' && (
        <div data-testid="interrupted-transcription" role="status" className="ws-interrupted-transcription">
          {`Transcription was interrupted — ${String(opened.loaded.project.blocks.length)} blocks kept.`}
        </div>
      )}
      {opened?.loaded?.readOnly === true && (
        <div data-testid="read-only-banner" role="status" className="ws-read-only-banner">
          This project uses a newer format and is open in read-only mode.
        </div>
      )}
      {rows.map((row) => (
        <div key={row.id} data-testid={`project-row-${row.id}`} role="listitem" className="ws-project-row">
          <span className="ws-project-row-name">{row.name}</span>
          <button
            type="button"
            data-testid={`project-open-${row.id}`}
            className="ws-button"
            aria-label={`Open ${row.name}`}
            onClick={() => {
              handleOpen(row.id)
            }}
          >
            Open
          </button>
          <button
            type="button"
            data-testid={`project-duplicate-${row.id}`}
            className="ws-button"
            aria-label={`Duplicate ${row.name}`}
            onClick={() => {
              void persistence
                .duplicateProject(row.id)
                .then(refresh)
                .catch(() => undefined)
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            data-testid={`project-delete-${row.id}`}
            className="ws-button"
            aria-label={`Delete ${row.name}`}
            onClick={() => {
              handleDelete(row.id)
            }}
          >
            Delete
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid="new-project-button"
        className="ws-button ws-button-primary"
        onClick={() => {
          void persistence
            .createProjectRow(NEW_PROJECT_NAME)
            .then(refresh)
            .catch(() => undefined)
        }}
      >
        New project
      </button>
      <p data-testid="storage-estimate" className="ws-storage-estimate">
        {estimate === null ? 'storage pending' : `${humanizeBytes(estimate.usage)} of ${humanizeBytes(estimate.quota)} · persistent ${estimate.persisted ? 'on' : 'off'}`}
      </p>
      {pendingDelete !== null && (
        <div data-testid="delete-undo-toast" role="status" className="ws-toast">
          <span>Project deleted</span>
          <button type="button" data-testid="delete-undo-button" className="ws-button" onClick={handleUndoDelete}>
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
