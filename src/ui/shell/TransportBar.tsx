// Transport bar (FR-102.5, design.md § Layout: `◀◀ 5s ▶/⏸ 5s▶▶ | 00:12.3/10:00`
// + loop region toggle + I/O). testids frozen by
// tests/unit/editor/unit102-api-contract.d.ts § data-testid contract.
//
// Buttons never mutate anything: every control dispatches its registry
// command id (single keyboard/button surface — components never bind keys,
// conventions § UI conventions); the registry handlers flow the intent into
// the frozen command system (UI-only reducers) which mirrors the
// SyncArbitrator (FR-102.3 single clock owner). Time displays render through
// THE shared `formatTimecode` (ui/format.ts — carried-101 minor-11 pin).

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { EditorStore } from '../../state/editor'
import { dispatchCommand } from '../commands/registry'
import { formatTimecode } from '../format'

export interface TransportBarProps {
  editor: EditorStore
  /** Media length (`asset.duration`) for the total-time display. */
  duration: number
  /** Rate menu button (no design.md keyboard row — a direct command callback from the shell). */
  onCycleRate: () => void
}

/** Editor-slice binding WITHOUT flushSync: the playhead commits every rAF
 *  frame while playing — synchronous rendering per frame would starve the
 *  frame budget (CC-102.6 ≥ 55 FPS). React batches; the DOM settles in the
 *  same frame. */
function useEditorValue<T>(editor: EditorStore, select: (state: ReturnType<EditorStore['getState']>) => T): T {
  const [value, setValue] = useState<T>(() => select(editor.getState()))
  useEffect(() => {
    const sync = (): void => {
      const next = select(editor.getState())
      setValue((current) => (Object.is(current, next) ? current : next))
    }
    sync()
    return editor.subscribe(sync)
  }, [editor])
  return value
}

export function TransportBar({ editor, duration, onCycleRate }: TransportBarProps): ReactNode {
  const playhead = useEditorValue(editor, (s) => s.playhead)
  const playing = useEditorValue(editor, (s) => s.playing)
  const loop = useEditorValue(editor, (s) => s.loop)
  const rate = useEditorValue(editor, (s) => s.rate)

  return (
    <div data-testid="transport-bar" className="ws-transport" role="group" aria-label="Transport">
      <button type="button" data-testid="transport-skip-back" className="ws-button ws-transport-button" aria-label="Back 5 seconds" onClick={() => dispatchCommand('transport.skip-backward')}>
        ⏪5s
      </button>
      <button
        type="button"
        data-testid="transport-play-pause"
        role="button"
        aria-pressed={playing}
        className="ws-button ws-button-primary ws-transport-button"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => dispatchCommand('transport.play-pause')}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button type="button" data-testid="transport-skip-forward" className="ws-button ws-transport-button" aria-label="Forward 5 seconds" onClick={() => dispatchCommand('transport.skip-forward')}>
        5s⏩
      </button>
      <span className="ws-transport-time">
        <span data-testid="transport-time-current" className="ws-tabular">
          {formatTimecode(playhead)}
        </span>
        {'/'}
        <span data-testid="transport-time-total" className="ws-tabular">
          {formatTimecode(duration)}
        </span>
      </span>
      <button
        type="button"
        data-testid="transport-loop-toggle"
        aria-pressed={loop !== null}
        className="ws-button ws-transport-button"
        aria-label="Loop region"
        onClick={() => dispatchCommand('transport.loop-toggle')}
      >
        ↻
      </button>
      <button
        type="button"
        data-testid="transport-loop-in"
        aria-disabled={loop === null}
        className="ws-button ws-transport-button"
        aria-label="Set loop in from playhead"
        onClick={() => dispatchCommand('transport.loop-in')}
      >
        I
      </button>
      <button
        type="button"
        data-testid="transport-loop-out"
        aria-disabled={loop === null}
        className="ws-button ws-transport-button"
        aria-label="Set loop out from playhead"
        onClick={() => dispatchCommand('transport.loop-out')}
      >
        O
      </button>
      <button
        type="button"
        data-testid="transport-rate"
        aria-haspopup="true"
        className="ws-button ws-transport-button"
        aria-label={`Playback rate ${rate}×`}
        onClick={onCycleRate}
      >
        {`${rate}×`}
      </button>
    </div>
  )
}
