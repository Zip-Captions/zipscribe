// `transport-seek` (US-2.2.4, timeline click / bridge seek) — playhead to an
// absolute time, clamped into [0, duration]. UI-only (FR-102.2). Slice B:
// dispatch proxies exactly ONE `SyncArbitrator.seek` (single-seek rule,
// asserted via the fake clock's seekCalls).

import type { CommandReject, EditorCommand, TransportSeekPayload } from './types'
import { isFiniteNumber, reject } from './validators'
import { setClampedPlayhead } from './transport-shared'

export function createTransportSeekCommand(): EditorCommand<'transport-seek'> {
  return {
    id: 'transport-seek',
    reduce(state, payload: TransportSeekPayload): CommandReject | null {
      if (!isFiniteNumber(payload.time)) return reject('INVALID_PAYLOAD', 'time')
      setClampedPlayhead(state, payload.time)
      return null
    },
  }
}
