// `transport-skip` (US-2.2.4, J/L ±5 s, Shift+J/L ±10 s — the command
// carries the step) — relative seek clamped to the media, never negative,
// never past duration. UI-only (FR-102.2).

import type { CommandReject, EditorCommand, TransportSkipPayload } from './types'
import { isFiniteNumber, reject } from './validators'
import { setClampedPlayhead, transportEditor } from './transport-shared'

export function createTransportSkipCommand(): EditorCommand<'transport-skip'> {
  return {
    id: 'transport-skip',
    reduce(state, payload: TransportSkipPayload): CommandReject | null {
      if (!isFiniteNumber(payload.seconds)) return reject('INVALID_PAYLOAD', 'seconds')
      setClampedPlayhead(state, transportEditor(state).playhead + payload.seconds)
      return null
    },
  }
}
