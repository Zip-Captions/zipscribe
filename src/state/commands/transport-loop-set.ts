// `transport-loop-set` (FR-102.5): explicit in/out region. end must be
// strictly after start and the region inside the media (LOOP_RANGE_INVALID).
// UI-only (FR-102.2).

import type { CommandReject, EditorCommand, TransportLoopSetPayload } from './types'
import { isFiniteNumber, reject, round3 } from './validators'
import { transportDuration, transportEditor } from './transport-shared'

export function createTransportLoopSetCommand(): EditorCommand<'transport-loop-set'> {
  return {
    id: 'transport-loop-set',
    reduce(state, payload: TransportLoopSetPayload): CommandReject | null {
      if (!isFiniteNumber(payload.start) || !isFiniteNumber(payload.end)) return reject('LOOP_RANGE_INVALID', String(payload.end))
      if (payload.start < 0 || payload.end <= payload.start || payload.end > transportDuration(state)) return reject('LOOP_RANGE_INVALID', String(payload.end))
      const editor = transportEditor(state)
      editor.loop = [round3(payload.start), round3(payload.end)]
      editor.lastLoop = [round3(payload.start), round3(payload.end)]
      return null
    },
  }
}
