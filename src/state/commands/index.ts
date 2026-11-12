// Command registry (FR-102.1/FR-102.2): `{ id, reduce(state,payload), inverse? }`.
// Reducers are pure over the editor root — every impure/unmerged dependency
// (clock, speaker engine, translation rules, blockizer, id source) is
// injected via `CommandDeps` (`buildEditorCommands`, used by
// `createEditorApp`). The module-level `getEditorCommands()`/`getCommand()`
// expose the PRODUCTION default FROZEN table (NO-OP translation rules until
// unit-301, unit-05 blockizer, unit-06 `src/engine/diarize/assign` speaker
// functions per the frozen CONTRACT.md re-point). unit-104 EXTENDS
// (CONTRACT.md § Commands — unit-104 EXTENDS): the frozen 26-command table
// above stays FROZEN and UNCHANGED; the four new ids are built by
// `buildUnit104Commands(deps)` and APPENDED by the composition
// (`createEditorApp` dispatches 26 + 4 = 30).

import { newUuid } from '../ids'
import { NO_OP_TRANSLATION_RULES } from '../../engine/translate/track'
import { majoritySpeakerId, reassignWords, mergeSpeakers, splitSpeaker } from '../../engine/diarize/assign'
import { DEFAULT_BLOCKIZER, type CommandDeps } from './deps'
import type { CommandId, EditorCommand } from './types'

import { createBlockSplitCommand } from './block-split'
import { createBlockMergeCommand } from './block-merge'
import { createBlockRetimeCommand } from './block-retime'
import { createBlockEditTextCommand } from './block-edit-text'
import { createBlockDeleteCommand } from './block-delete'
import { createBlockDeleteCloseGapCommand } from './block-delete-close-gap'
import { createCaptionsRetimeAllCommand } from './captions-retime-all'
import { createCaptionsReflowCommand } from './captions-reflow'
import { createCaptionsImportCommand } from './captions-import'
import { createSpeakerAddCommand } from './speaker-add'
import { createSpeakerAssignCommand } from './speaker-assign'
import { createSpeakerRenameCommand } from './speaker-rename'
import { createSpeakerRecolorCommand } from './speaker-recolor'
import { createProjectRenameCommand } from './project-rename'
import { createTransportPlayCommand } from './transport-play'
import { createTransportPauseCommand } from './transport-pause'
import { createTransportSeekCommand } from './transport-seek'
import { createTransportSkipCommand } from './transport-skip'
import { createTransportStepFrameCommand } from './transport-step-frame'
import { createTransportStepSecondCommand } from './transport-step-second'
import { createTransportLoopSetCommand } from './transport-loop-set'
import { createTransportLoopInCommand } from './transport-loop-in'
import { createTransportLoopOutCommand } from './transport-loop-out'
import { createTransportLoopClearCommand } from './transport-loop-clear'
import { createTransportLoopToggleCommand } from './transport-loop-toggle'
import { createTransportRateCommand } from './transport-rate'
import { createSpeakerMergeCommand } from './speaker-merge'
import { createSpeakerSplitCommand } from './speaker-split'
import { createReplaceTextCommand } from './replace-text'
import { createCaptionsAlignApplyCommand } from './captions-align-apply'

export * from './types'
export { deriveBlockText } from './derive-text'
export { DEFAULT_BLOCKIZER, NOT_IMPLEMENTED_SPEAKER_ENGINE } from './deps'
export type { Blockizer, SpeakerEngine, CommandDeps } from './deps'

export function buildEditorCommands(deps: CommandDeps): readonly EditorCommand[] {
  return [
    createBlockSplitCommand(deps),
    createBlockMergeCommand(deps),
    createBlockRetimeCommand(deps),
    createBlockEditTextCommand(deps),
    createBlockDeleteCommand(deps),
    createBlockDeleteCloseGapCommand(deps),
    createCaptionsRetimeAllCommand(deps),
    createCaptionsReflowCommand(deps),
    createCaptionsImportCommand(deps),
    createSpeakerAddCommand(deps),
    createSpeakerAssignCommand(deps),
    createSpeakerRenameCommand(deps),
    createSpeakerRecolorCommand(deps),
    createProjectRenameCommand(deps),
    createTransportPlayCommand(),
    createTransportPauseCommand(),
    createTransportSeekCommand(),
    createTransportSkipCommand(),
    createTransportStepFrameCommand(),
    createTransportStepSecondCommand(),
    createTransportLoopSetCommand(),
    createTransportLoopInCommand(),
    createTransportLoopOutCommand(),
    createTransportLoopClearCommand(),
    createTransportLoopToggleCommand(),
    createTransportRateCommand(),
  ]
}

/**
 * unit-104 EXTENDS (CONTRACT.md § Commands — unit-104 EXTENDS): the four
 * registry entries appended to the frozen 26. `createEditorApp` composes
 * `buildEditorCommands(deps)` + `buildUnit104Commands(deps)` (30 dispatchable
 * ids); the frozen module-level table above stays 26 (seams-coverage
 * FR-102.1 pins it).
 */
export function buildUnit104Commands(deps: CommandDeps): readonly EditorCommand[] {
  return [createSpeakerMergeCommand(deps), createSpeakerSplitCommand(deps), createReplaceTextCommand(deps), createCaptionsAlignApplyCommand(deps)]
}

export const DEFAULT_COMMAND_DEPS: CommandDeps = {
  clock: { now: () => Date.now() },
  // CONTRACT.md § speaker-* family (frozen re-point clause, unit-06 merged):
  // the VERBATIM pure engine functions from `src/engine/diarize/assign.ts`.
  // `NOT_IMPLEMENTED_SPEAKER_ENGINE` stays exported (typed-not-implemented
  // seam for dispatch-without-engine contract coverage).
  // @104 EXTENDS: the unit-06 US-1.3.3 pair joins the re-point. The seam
  // direction is (from, into) (CONTRACT.md); `assign.mergeSpeakers(project,
  // a, b)` merges b→a, so merge is the engine fn behind a one-line direction
  // adapter; `assign.splitSpeaker` matches the seam argument order VERBATIM.
  speakerEngine: {
    majoritySpeakerId,
    reassignWords,
    mergeSpeakers: (project, from, into) => mergeSpeakers(project, into, from),
    splitSpeaker,
  },
  translationRules: NO_OP_TRANSLATION_RULES,
  blockizer: DEFAULT_BLOCKIZER,
  newBlockId: () => newUuid('blk'),
}

const defaultCommands = buildEditorCommands(DEFAULT_COMMAND_DEPS)
const defaultById = new Map<CommandId, EditorCommand>(defaultCommands.map((command) => [command.id, command]))

export function getEditorCommands(): readonly EditorCommand[] {
  return defaultCommands
}

export function getCommand(id: CommandId): EditorCommand | undefined {
  return defaultById.get(id)
}
