// `transport-loop-toggle` (FR-102.5, Y): off disarms but REMEMBERS the
// region; on again re-arms the previous region (frozen FR-102.5 behavior —
// the test toggles twice and expects the original [start,end] back). UI-only
// (FR-102.2).

import type { CommandReject, EditorCommand } from './types'
import { transportEditor } from './transport-shared'

export function createTransportLoopToggleCommand(): EditorCommand<'transport-loop-toggle'> {
  return {
    id: 'transport-loop-toggle',
    reduce(state, _payload: undefined): CommandReject | null {
      const editor = transportEditor(state)
      if (editor.loop !== null) {
        editor.lastLoop = [editor.loop[0], editor.loop[1]]
        editor.loop = null
      } else if (editor.lastLoop !== null) {
        editor.loop = [editor.lastLoop[0], editor.lastLoop[1]]
      }
      return null
    },
  }
}
