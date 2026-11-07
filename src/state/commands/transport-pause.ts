// `transport-pause` (US-2.2.4, Space while playing) — UI-only, no step.

import type { CommandReject, EditorCommand } from './types'
import { transportEditor } from './transport-shared'

export function createTransportPauseCommand(): EditorCommand<'transport-pause'> {
  return {
    id: 'transport-pause',
    reduce(state, _payload: undefined): CommandReject | null {
      transportEditor(state).playing = false
      return null
    },
  }
}
