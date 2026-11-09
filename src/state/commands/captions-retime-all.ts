// `captions-retime-all` (FR-102.1): uniform shift of the whole source track,
// CLAMPED so every block stays inside [0, asset.duration]; relative gaps are
// preserved and the media is never moved (invariant 9 — the asset stays
// byte-identical). A shift clamped to zero accepts without touching state
// (no history step — the store's project reference is unchanged).

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CaptionsRetimeAllPayload, CommandReject, EditorCommand, EditorRootState } from './types'
import { clamp, isFiniteNumber, reject, round3 } from './validators'

export function createCaptionsRetimeAllCommand(deps: CommandDeps): EditorCommand<'captions-retime-all'> {
  return {
    id: 'captions-retime-all',
    reduce(state: EditorRootState, payload: CaptionsRetimeAllPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (!isFiniteNumber(payload.offsetSec)) return reject('INVALID_PAYLOAD', 'offsetSec')
      if (project.blocks.length === 0) return null
      let minStart = Number.POSITIVE_INFINITY
      let maxEnd = Number.NEGATIVE_INFINITY
      for (const b of project.blocks) {
        if (b.start < minStart) minStart = b.start
        if (b.end > maxEnd) maxEnd = b.end
      }
      const shift = clamp(payload.offsetSec, -minStart, project.asset.duration - maxEnd)
      if (shift === 0) return null
      for (const b of project.blocks) {
        b.start = round3(b.start + shift)
        b.end = round3(b.end + shift)
        for (const w of b.words) {
          w.start = round3(w.start + shift)
          w.end = round3(w.end + shift)
        }
      }
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
