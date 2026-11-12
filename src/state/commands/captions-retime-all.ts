// `captions-retime-all` (FR-102.1; @104 EXTENDS FR-104.8 two-point sync):
// uniform shift of the whole source track, CLAMPED so every block stays
// inside [0, asset.duration]; relative gaps are preserved and the media is
// never moved (invariant 9 — the asset stays byte-identical). A shift clamped
// to zero accepts without touching state (no history step — the store's
// project reference is unchanged).
// @104 EXTENDS (CONTRACT.md captions-retime-all row, adjudicated 2026-11-12):
// optional `scale`/`anchorSec` (defaults identity) map every block AND word
// time t → anchor + (t − anchor)·scale + offset EXACTLY like the frozen
// engine `retimeAll` (src/engine/captions/retime.ts — round3 then clamp into
// [0, asset.duration]; scale < 0 repaired to the nearest monotone map there),
// called through the engine pure fn. With neither field present the frozen
// offset-only path runs byte-identically (whole-shift clamp).

import { retimeAll } from '../../engine/captions/retime'
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
      if (payload.scale !== undefined && !isFiniteNumber(payload.scale)) return reject('INVALID_PAYLOAD', 'scale')
      if (payload.anchorSec !== undefined && !isFiniteNumber(payload.anchorSec)) return reject('INVALID_PAYLOAD', 'anchorSec')
      if (project.blocks.length === 0) return null
      if (payload.scale !== undefined || payload.anchorSec !== undefined) {
        // FR-104.8 stretch: the frozen engine map, per time, clamped into
        // [0, asset.duration] (invariant 6 quantization inside the engine).
        const retimed = retimeAll(project, { offsetSec: payload.offsetSec, scale: payload.scale, anchorSec: payload.anchorSec })
        let changed = false
        for (let i = 0; i < retimed.blocks.length; i++) {
          const next = retimed.blocks[i]
          const current = project.blocks[i]
          if (next === undefined || current === undefined) return reject('INVALID_PAYLOAD', String(i))
          if (next.start !== current.start || next.end !== current.end) {
            changed = true
            break
          }
          for (let w = 0; w < next.words.length; w++) {
            const nw = next.words[w]
            const cw = current.words[w]
            if (nw !== undefined && cw !== undefined && (nw.start !== cw.start || nw.end !== cw.end)) {
              changed = true
              break
            }
          }
          if (changed) break
        }
        if (!changed) return null
        project.blocks = retimed.blocks
        project.updatedAt = deps.clock.now()
        return null
      }
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
