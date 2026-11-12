// FR-104.8 second half — the "Shift / stretch timing…" dialog (design.md
// § QC panel: "offset field, or two-point sync (pick block → enter correct
// time, twice), preview of first/last block times before applying").
//
// Offset path: dispatches the frozen `captions-retime-all` { offsetSec } call
// site byte-identically. Two-point path: engine `solveRetime` (the frozen
// unit-07 solver) turns the two (source → correct) picks into
// { offsetSec, scale, anchorSec } and the @104 EXTENDS payload applies it —
// the preview renders the engine-mapped FIRST/LAST block times BEFORE the
// apply (retimeAll is pure; the preview is a throwaway run). Either path is
// EXACTLY ONE dispatch = one undo step; the MEDIA NEVER MOVES (invariant 9 —
// nothing here touches the transport/arbitrator).
//
// A degenerate two-point solve (identical source times) surfaces the engine
// TypeError as the CODE `RETIME_DEGENERATE` — numbers only (SECURITY-03).
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { EditorApp } from '../../state/history'
import { retimeAll, solveRetime } from '../../engine/captions/retime'

function parseTime(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export interface RetimeDialogProps {
  app: EditorApp
  onClose: () => void
}

export function RetimeDialog({ app, onClose }: RetimeDialogProps): ReactNode {
  const project = app.project.getState().project
  const selection = app.editor.getState().selection
  const [offsetText, setOffsetText] = useState('')
  const [twoPoint, setTwoPoint] = useState(false)
  const [aFrom, setAFrom] = useState('')
  const [aTo, setATo] = useState('')
  const [bFrom, setBFrom] = useState('')
  const [bTo, setBTo] = useState('')
  const [code, setCode] = useState<string | null>(null)

  const selectedBlock = project === null ? null : (project.blocks.find((block) => block.id === selection.anchorBlockId) ?? project.blocks.find((block) => block.id === selection.focusBlockId) ?? null)
  const selectedStart = selectedBlock === null ? null : selectedBlock.start

  const solution = useMemo(() => {
    if (!twoPoint) return null
    const fromA = parseTime(aFrom)
    const toA = parseTime(aTo)
    const fromB = parseTime(bFrom)
    const toB = parseTime(bTo)
    if (fromA === null || toA === null || fromB === null || toB === null || fromA === fromB) return null
    try {
      return solveRetime(fromA, toA, fromB, toB)
    } catch {
      return undefined // degenerate — rendered as a CODE below
    }
  }, [twoPoint, aFrom, aTo, bFrom, bTo])

  const preview = useMemo(() => {
    if (project === null || project.blocks.length === 0 || solution === null || solution === undefined) return null
    const mapped = retimeAll(project, { offsetSec: solution.offsetSec, scale: solution.scale, anchorSec: solution.anchorSec })
    const first = mapped.blocks[0]
    const last = mapped.blocks[mapped.blocks.length - 1]
    if (first === undefined || last === undefined) return null
    return { firstStart: first.start, lastEnd: last.end }
  }, [project, solution])

  const offsetValue = parseTime(offsetText)

  function apply(): void {
    if (project === null || project.blocks.length === 0) return
    if (twoPoint) {
      if (solution === undefined) {
        setCode('RETIME_DEGENERATE')
        return
      }
      if (solution === null) {
        setCode('RETIME_POINTS_INCOMPLETE')
        return
      }
      const rejection = app.dispatch('captions-retime-all', { offsetSec: solution.offsetSec, scale: solution.scale, anchorSec: solution.anchorSec })
      if (rejection === null) onClose()
      else setCode(rejection.code)
      return
    }
    if (offsetValue === null) {
      setCode('RETIME_OFFSET_INVALID')
      return
    }
    const rejection = app.dispatch('captions-retime-all', { offsetSec: offsetValue })
    if (rejection === null) onClose()
    else setCode(rejection.code)
  }

  function fillFromSelection(setter: (value: string) => void): void {
    if (selectedStart !== null) setter(String(selectedStart))
  }

  return (
    <div className="ts-import-backdrop" data-testid="retime-backdrop">
      <div data-testid="retime-dialog" role="dialog" aria-modal="true" aria-label="Shift / stretch timing" className="ts-import-dialog">
        <p className="ts-import-title">Shift / stretch timing…</p>
        {code !== null && (
          <p className="ts-import-error" data-testid="retime-code">
            {code}
          </p>
        )}
        <div className="ts-retime-modes" role="group" aria-label="Retime mode">
          <button type="button" data-testid="retime-mode-offset" className={twoPoint ? 'ts-popover-action' : 'ts-popover-action ts-popover-primary'} aria-pressed={!twoPoint} onClick={() => setTwoPoint(false)}>
            Offset
          </button>
          <button type="button" data-testid="retime-mode-two-point" className={twoPoint ? 'ts-popover-action ts-popover-primary' : 'ts-popover-action'} aria-pressed={twoPoint} onClick={() => setTwoPoint(true)}>
            Two-point sync
          </button>
        </div>
        {!twoPoint && (
          <p className="ts-import-row">
            <span className="ts-import-key">Offset (s)</span>
            <input
              data-testid="retime-offset"
              className="ts-import-language"
              type="number"
              step="0.001"
              inputMode="decimal"
              value={offsetText}
              aria-label="Offset in seconds"
              onChange={(event) => setOffsetText(event.target.value)}
            />
          </p>
        )}
        {twoPoint && (
          <div className="ts-retime-points">
            <p className="ts-import-row">
              <span className="ts-import-key">A — block time</span>
              <input data-testid="retime-point-a-from" className="ts-import-language" type="number" step="0.001" value={aFrom} aria-label="Point A current time" onChange={(event) => setAFrom(event.target.value)} />
              <button type="button" data-testid="retime-point-a-pick" className="ts-popover-action" disabled={selectedStart === null} onClick={() => fillFromSelection(setAFrom)}>
                Use selected
              </button>
            </p>
            <p className="ts-import-row">
              <span className="ts-import-key">A — correct</span>
              <input data-testid="retime-point-a-to" className="ts-import-language" type="number" step="0.001" value={aTo} aria-label="Point A correct time" onChange={(event) => setATo(event.target.value)} />
            </p>
            <p className="ts-import-row">
              <span className="ts-import-key">B — block time</span>
              <input data-testid="retime-point-b-from" className="ts-import-language" type="number" step="0.001" value={bFrom} aria-label="Point B current time" onChange={(event) => setBFrom(event.target.value)} />
              <button type="button" data-testid="retime-point-b-pick" className="ts-popover-action" disabled={selectedStart === null} onClick={() => fillFromSelection(setBFrom)}>
                Use selected
              </button>
            </p>
            <p className="ts-import-row">
              <span className="ts-import-key">B — correct</span>
              <input data-testid="retime-point-b-to" className="ts-import-language" type="number" step="0.001" value={bTo} aria-label="Point B correct time" onChange={(event) => setBTo(event.target.value)} />
            </p>
            {solution === undefined && (
              <p className="ts-import-error" data-testid="retime-degenerate">
                RETIME_DEGENERATE
              </p>
            )}
            {preview !== null && (
              // Preview BEFORE applying (design.md): engine-mapped first/last times.
              <p className="ts-import-row" data-testid="retime-preview">
                <span className="ts-import-key">Preview</span>
                <span>
                  first {String(preview.firstStart)} s → last {String(preview.lastEnd)} s
                </span>
              </p>
            )}
          </div>
        )}
        <div className="ts-import-actions">
          <button
            type="button"
            data-testid="retime-cancel"
            className="ts-popover-action"
            onClick={() => {
              onClose()
            }}
          >
            Cancel
          </button>
          <button type="button" data-testid="retime-apply" className="ts-popover-action ts-popover-primary" disabled={project === null || project.blocks.length === 0} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
