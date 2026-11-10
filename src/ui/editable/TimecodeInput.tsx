// Unit-103 US-2.2.5 — THE shared timecode input (conventions § UI conventions:
// this `src/ui/**\/editable/**` path is the ONLY place a component may bind
// onKeyDown, and only for Enter/Esc). Shape frozen by
// tests/unit/timeline/unit103-api-contract.d.ts § '@ui/editable/TimecodeInput'.
//
// Formatting goes through the single `@ui/format.formatTimecode` (never a
// second formatter); parsing accepts millisecond precision for the inspector
// strip ('00:12.350' → 12.35) via the additive `{ ms: true }` parse option
// (orch adjudication 1 — the frozen tenths default of existing callers is
// untouched). Recovery UX: invalid text sets `aria-invalid="true"`, `onCommit`
// is NEVER called, and there is never a silent clamp (US-2.2.5).

import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import type { Seconds } from '../../engine/model'
import { formatTimecode, parseTimecode } from '../format'

export interface TimecodeInputProps {
  value: Seconds
  label: string
  /** The <input> carries this data-testid. */
  testId: string
  /** Enter (or blur) commits a PARSED value; invalid text shows the error state (`aria-invalid="true"`) and never calls onCommit — no silent clamp, recovery UX (US-2.2.5). */
  onCommit: (t: Seconds) => void
  /** Frame-precision mode (MM:SS:FF) for fps-backed assets. */
  fps?: number
  /** Unit-103 additive: the inspector strip disables the pair when no block is targeted. */
  disabled?: boolean
}

function formatValue(value: Seconds, fps: number | undefined): string {
  return fps === undefined ? formatTimecode(value) : formatTimecode(value, { fps })
}

function parseValue(text: string, fps: number | undefined): Seconds | null {
  return fps === undefined ? parseTimecode(text, { ms: true }) : parseTimecode(text, { fps })
}

export function TimecodeInput({ value, label, testId, onCommit, fps, disabled }: TimecodeInputProps): ReactElement {
  const [text, setText] = useState<string>(() => formatValue(value, fps))
  const [invalid, setInvalid] = useState(false)
  const dirtyRef = useRef(false)
  const syncedValueRef = useRef(value)

  // Keep the display synced with the externally-committed value (another
  // gesture moved the block) until the user types — invalid draft text is
  // never silently overwritten (recovery UX).
  useEffect(() => {
    if (!dirtyRef.current && syncedValueRef.current !== value) {
      syncedValueRef.current = value
      setText(formatValue(value, fps))
      setInvalid(false)
    }
  }, [value, fps])

  function commit(): void {
    const parsed = parseValue(text, fps)
    if (parsed === null) {
      setInvalid(true) // error state; onCommit NEVER called (never a silent clamp)
      return
    }
    setInvalid(false)
    dirtyRef.current = false
    onCommit(parsed)
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      dirtyRef.current = false
      syncedValueRef.current = value
      setText(formatValue(value, fps))
      setInvalid(false)
    }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value
    dirtyRef.current = true
    setText(next)
    setInvalid(parseValue(next, fps) === null)
  }

  return (
    <label className="tl-timecode">
      <span className="tl-timecode-label">{label}</span>
      <input
        data-testid={testId}
        type="text"
        className="tl-timecode-input"
        value={text}
        disabled={disabled}
        aria-invalid={invalid ? 'true' : undefined}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={commit}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      />
    </label>
  )
}
