// `transport-loop-out` (FR-102.5, O): set the loop OUT from the playhead.
// With no active region the IN defaults to 0; an IN in the future is allowed
// transiently (the design pairs I then O). UI-only (FR-102.2).

import type { CommandReject, EditorCommand } from './types'
import { reject, round3 } from './validators'
import { transportEditor } from './transport-shared'

export function createTransportLoopOutCommand(): EditorCommand<'transport-loop-out'> {
  return {
    id: 'transport-loop-out',
    reduce(state, _payload: undefined): CommandReject | null {
      const editor = transportEditor(state)
      const playhead = round3(editor.playhead)
      if (editor.loop === null) {
        if (playhead <= 0) return reject('LOOP_RANGE_INVALID', String(playhead))
        editor.loop = [0, playhead]
        editor.lastLoop = [0, playhead]
        return null
      }
      editor.loop = [editor.loop[0], playhead]
      editor.lastLoop = editor.loop
      return null
    },
  }
}
