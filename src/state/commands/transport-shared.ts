// Shared helpers for the UI-only transport commands (FR-102.2
// `undoable:false`): playhead writes clamp to [0, asset.duration] and take
// the 3-decimal rule; `EditorRootState.editor` is widened to the internal
// slice shape for the loop memory. Slice B's SyncArbitrator becomes the
// playhead source (FR-102.3) — these reducers mirror it for the no-clock
// case (editor-store truth for transport UI rendering).

import type { Project, Seconds } from '../../engine/model'
import type { EditorRootState } from './types'
import type { EditorUiStateInternal } from '../editor'
import { clamp, round3 } from './validators'

export function transportProject(state: EditorRootState): Project | null {
  return state.project
}

export function transportEditor(state: EditorRootState): EditorUiStateInternal {
  return state.editor as EditorUiStateInternal
}

export function transportDuration(state: EditorRootState): Seconds {
  return transportProject(state)?.asset.duration ?? Number.POSITIVE_INFINITY
}

export function setClampedPlayhead(state: EditorRootState, target: Seconds): void {
  transportEditor(state).playhead = round3(clamp(target, 0, transportDuration(state)))
}
