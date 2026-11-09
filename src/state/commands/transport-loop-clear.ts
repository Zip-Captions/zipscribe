// `transport-loop-clear` — drop the loop region (the last region stays
// armed in the internal loop memory for Y's re-arm). UI-only (FR-102.2).

import type { CommandReject, EditorCommand } from './types'
import { transportEditor } from './transport-shared'

export function createTransportLoopClearCommand(): EditorCommand<'transport-loop-clear'> {
  return {
    id: 'transport-loop-clear',
    reduce(state, _payload: undefined): CommandReject | null {
      transportEditor(state).loop = null
      return null
    },
  }
}
