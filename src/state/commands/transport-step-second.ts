// `transport-step-second` (US-2.2.4, Shift+←/→ = ±1 s) — relative seek of
// whole seconds, clamped to the media. UI-only (FR-102.2).

import type { CommandReject, EditorCommand, TransportStepSecondPayload } from './types'
import { isFiniteNumber, reject } from './validators'
import { setClampedPlayhead, transportEditor } from './transport-shared'

export function createTransportStepSecondCommand(): EditorCommand<'transport-step-second'> {
  return {
    id: 'transport-step-second',
    reduce(state, payload: TransportStepSecondPayload): CommandReject | null {
      if (!isFiniteNumber(payload.seconds)) return reject('INVALID_PAYLOAD', 'seconds')
      setClampedPlayhead(state, transportEditor(state).playhead + payload.seconds)
      return null
    },
  }
}
