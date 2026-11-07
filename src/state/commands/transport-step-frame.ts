// `transport-step-frame` (US-2.2.4, ←/→): signed frame count at
// |1/fps| per frame from `project.asset.fps` (25 fps → 0.04 s). UI-only.

import type { CommandReject, EditorCommand, TransportStepFramePayload } from './types'
import { isFiniteNumber, reject } from './validators'
import { setClampedPlayhead, transportEditor, transportProject } from './transport-shared'

export function createTransportStepFrameCommand(): EditorCommand<'transport-step-frame'> {
  return {
    id: 'transport-step-frame',
    reduce(state, payload: TransportStepFramePayload): CommandReject | null {
      if (!isFiniteNumber(payload.frames)) return reject('INVALID_PAYLOAD', 'frames')
      const fps = transportProject(state)?.asset.fps ?? 0
      if (fps <= 0) return reject('INVALID_PAYLOAD', 'fps')
      setClampedPlayhead(state, transportEditor(state).playhead + payload.frames / fps)
      return null
    },
  }
}
