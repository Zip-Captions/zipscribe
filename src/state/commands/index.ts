// Command registry (FR-102.1/FR-102.2): `{ id, reduce(state,payload), inverse? }`.
// Reducers are pure over the editor root — every impure/unmerged dependency
// (clock, speaker engine, translation rules, blockizer, id source) is
// injected via `CommandDeps` (`buildEditorCommands`, used by
// `createEditorApp`). The module-level `getEditorCommands()`/`getCommand()`
// expose the PRODUCTION default table (NO-OP translation rules until
// unit-301, unit-05 blockizer, engine-06 seam typed-not-implemented until
// unit-06 merges).

import { newUuid } from '../ids'
import { NO_OP_TRANSLATION_RULES } from '../../engine/translate/track'
import { DEFAULT_BLOCKIZER, NOT_IMPLEMENTED_SPEAKER_ENGINE, type CommandDeps } from './deps'
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

export const DEFAULT_COMMAND_DEPS: CommandDeps = {
  clock: { now: () => Date.now() },
  speakerEngine: NOT_IMPLEMENTED_SPEAKER_ENGINE,
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
