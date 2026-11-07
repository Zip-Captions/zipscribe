// `transport-loop-in` (FR-102.5, I): set the loop IN from the playhead. With
// no active region the OUT defaults to the media end; an OUT in the past is
// allowed transiently (the user sets O next — design.md in/out pair), only a
// from-playhead region with no media left rejects. UI-only (FR-102.2).

import type { CommandReject, EditorCommand } from './types'
import { reject, round3 } from './validators'
import { transportDuration, transportEditor } from './transport-shared'

export function createTransportLoopInCommand(): EditorCommand<'transport-loop-in'> {
  return {
    id: 'transport-loop-in',
    reduce(state, _payload: undefined): CommandReject | null {
      const editor = transportEditor(state)
      const playhead = round3(editor.playhead)
      if (editor.loop === null) {
        const duration = transportDuration(state)
        if (playhead >= duration) return reject('LOOP_RANGE_INVALID', String(playhead))
        editor.loop = [playhead, duration]
        editor.lastLoop = [playhead, duration]
        return null
      }
      editor.loop = [playhead, editor.loop[1]]
      editor.lastLoop = editor.loop
      return null
    },
  }
}
