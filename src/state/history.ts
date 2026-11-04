// Editor app composition + zundo history (FR-102.1/FR-102.2, US-2.1.4).
//
// One zustand vanilla store roots `{ project, editor }`; `temporal` (zundo
// 2.3.0) wraps it with the FROZEN configuration: `limit: 150`,
// `partialize: { project }` — the UI-only `editor` slice is therefore
// `undoable:false` (no editor mutation creates a step, undo never moves the
// playhead/selection), and `equality` on the project REFERENCE (immer keeps
// the reference for untouched subtrees) makes project-unchanging commits
// step-free. `jumpable:false`: the history surface is undo/redo/clear only —
// ASSUMPTION (frozen contract): zundo 2.3.0 has NO jump API, so the setting
// is expressed by API absence (contract.test asserts none appears).
//
// US-2.1.4 merge window: consecutive accepted `block-edit-text` commands for
// the SAME blockId within EDIT_TEXT_MERGE_WINDOW_MS (injected `clock.now()`,
// exclusive upper bound — `< 1000 ms` coalesce, `≥ 1000 ms` separate) collapse
// into ONE undo step via temporal pause/resume around the coalesced commit.
// Any other accepted command ends the chain.
//
// Reducer invalid-payload discipline: `reduce` runs INSIDE an immer produce;
// a returned CommandReject throws a sentinel that aborts the draft — the
// store is never written, so "invalid payload → typed rejection, zero
// mutation, no history step" is structural (protocol Failure codes —
// SECURITY-03: rejections carry CODES + id/number tokens only).

import { createStore } from 'zustand/vanilla'
import { temporal } from 'zundo'
import { produce } from 'immer'

import type { Project } from '../engine/model'
import type { MediaClock } from './services/playback/media-clock'
import type { RafDriver, SyncArbitrator } from './services/playback/arbitrator'
import { NO_OP_TRANSLATION_RULES } from '../engine/translate/track'
import { buildEditorCommands, DEFAULT_BLOCKIZER, NOT_IMPLEMENTED_SPEAKER_ENGINE, type Blockizer, type CommandDeps, type SpeakerEngine } from './commands'
import type { CommandId, CommandPayloads, CommandReject, EditorCommand, BlockEditTextPayload } from './commands'
import type { EditorStore, EditorUiStateInternal } from './editor'
import { createInitialEditorState, makeEditorActions } from './editor'
import type { ProjectStore } from './project'
import { buildProjectFromAsset } from './project'
import { newUuid } from './ids'

export type { Blockizer, SpeakerEngine } from './commands'

/** Frozen zundo configuration (FR-102.2). */
export const ZUNDO_LIMIT = 150 as const
export const EDIT_TEXT_MERGE_WINDOW_MS = 1000 as const

/** Consecutive accepted `block-edit-text` commands for the SAME blockId within `EDIT_TEXT_MERGE_WINDOW_MS` (injected `clock.now()`, exclusive upper bound: `< 1000 ms` coalesce, `≥ 1000 ms` separate) collapse into ONE undo step. Any other accepted command ends the merge chain. */
export interface EditorHistoryApi {
  undo(steps?: number): void
  redo(steps?: number): void
  clear(): void
  undoCount(): number
  redoCount(): void
  isTracking(): boolean
}

export interface EditorAppDeps {
  /** Injected wall clock — the merge-window time source (fake in tests). */
  clock: { now(): number }
  rafs: RafDriver
  mediaClock?: MediaClock
  speakerEngine?: SpeakerEngine
  translationRules?: import('../engine/translate/track').TranslationRules
  blockizer?: Blockizer
  /** Test composition seam: start from a full project (the production
   * composition root omits it — projects arrive via `project.createProject`). */
  initialProject?: Project
}

export interface EditorApp {
  /** The unit-101-frozen ProjectStore (EXTENDS, never breaks its members). */
  project: ProjectStore
  editor: EditorStore
  /** Present when `deps.mediaClock` was given — the single clock owner. */
  arbitrator: SyncArbitrator | null
  getEditorCommands(): readonly EditorCommand[]
  getCommand(id: CommandId): EditorCommand | undefined
  /** Accepted → null (state changed, history step unless UI-only/merged).
   *  Invalid payload → CommandReject, state UNCHANGED, no history step.
   *  Unknown id → throws. */
  dispatch<Id extends CommandId>(id: Id, payload: CommandPayloads[Id]): CommandReject | null
  history: EditorHistoryApi
  dispose(): void
}

interface EditorRootInternal {
  project: Project | null
  editor: EditorUiStateInternal
}

const REJECT_SENTINEL = new Error('zipscribe.command-reject')

export function createEditorApp(deps: EditorAppDeps): EditorApp {
  // Slice boundary (unit-102 slice B): the SyncArbitrator implementation
  // (`createSyncArbitrator`, frozen contract § playback/arbitrator) ships
  // with the element MediaClock. An app composed WITH a clock is not
  // constructible until then — failing with a CODE beats a silent
  // `arbitrator: null` that violates the frozen contract.
  if (deps.mediaClock !== undefined) {
    throw new Error('PLAYBACK_ARBITRATOR_PENDING_SLICE_B')
  }

  const commandDeps: CommandDeps = {
    clock: deps.clock,
    speakerEngine: deps.speakerEngine ?? NOT_IMPLEMENTED_SPEAKER_ENGINE,
    translationRules: deps.translationRules ?? NO_OP_TRANSLATION_RULES,
    blockizer: deps.blockizer ?? DEFAULT_BLOCKIZER,
    newBlockId: () => newUuid('blk'),
  }
  const commands = buildEditorCommands(commandDeps)
  const commandsById = new Map<CommandId, EditorCommand>(commands.map((command) => [command.id, command]))

  let commitState: (next: EditorRootInternal) => void = () => undefined
  const store = createStore<EditorRootInternal>()(
    temporal(
      (set) => {
        commitState = (next) => set(next)
        return {
          project: deps.initialProject === undefined ? null : structuredClone(deps.initialProject),
          editor: createInitialEditorState(),
        }
      },
      {
        limit: ZUNDO_LIMIT,
        partialize: (state) => ({ project: state.project }),
        // Immer keeps subtree references for untouched slices — reference
        // equality IS "project unchanged" (UI-only/no-op commits stay
        // step-free, FR-102.2 `undoable:false` + no-op retime-all).
        equality: (a, b) => a.project === b.project,
      },
    ),
  )
  const temporalStore = () => store.temporal.getState()

  const commit = (mutate: (draft: EditorRootInternal) => void): void => {
    commitState(produce(store.getState(), mutate))
  }

  const editor: EditorStore = {
    getState: () => store.getState().editor,
    subscribe: store.subscribe,
    ...makeEditorActions((mutate) => commit((root) => mutate(root.editor))),
  }

  const project: ProjectStore = {
    getState: () => ({ project: store.getState().project }),
    subscribe: store.subscribe,
    createProject(asset, captionImport) {
      commit((root) => {
        root.project = buildProjectFromAsset(asset, captionImport, deps.clock.now())
      })
    },
    hasBlocks() {
      const current = store.getState().project
      return current !== null && current.blocks.length >= 1
    },
    setProjectName(name) {
      commit((root) => {
        if (root.project === null) return
        root.project.name = name
        root.project.updatedAt = deps.clock.now()
      })
    },
  }

  let mergeChain: { blockId: string; at: number } | null = null

  function dispatch<Id extends CommandId>(id: Id, payload: CommandPayloads[Id]): CommandReject | null {
    const command = commandsById.get(id)
    if (command === undefined) throw new Error(`UNKNOWN_COMMAND:${String(id)}`)
    let rejection: CommandReject | null = null
    let next: ReturnType<typeof store.getState>
    try {
      next = produce(store.getState(), (draft) => {
        // `as never`: the reducers' state parameter is frozen as the NON-null
        // `EditorRootState` (frozen contract) while the internal root allows a
        // null project (pre-intake apps); `null` makes the direct cast
        // non-assignable both ways, `never` dispatches through the bivariant
        // method parameter. Reducers guard the null case with a typed rejection.
        const result = command.reduce(draft as never, payload)
        if (result !== null) {
          rejection = result
          throw REJECT_SENTINEL
        }
      })
    } catch (error) {
      // The sentinel aborts the immer draft — the store is never written:
      // invalid payload → typed rejection, ZERO mutation, no history step.
      if (error === REJECT_SENTINEL) return rejection
      throw error
    }
    const editText = id === 'block-edit-text' ? (payload as BlockEditTextPayload) : null
    const now = deps.clock.now()
    const coalesce = editText !== null && mergeChain !== null && mergeChain.blockId === editText.blockId && now - mergeChain.at < EDIT_TEXT_MERGE_WINDOW_MS
    if (coalesce) temporalStore().pause()
    commitState(next)
    if (coalesce) temporalStore().resume()
    mergeChain = editText !== null ? { blockId: editText.blockId, at: now } : null
    return rejection
  }

  const history: EditorHistoryApi = {
    undo: (steps) => temporalStore().undo(steps),
    redo: (steps) => temporalStore().redo(steps),
    clear: () => {
      mergeChain = null
      temporalStore().clear()
    },
    undoCount: () => temporalStore().pastStates.length,
    redoCount: () => {
      // Frozen contract declares this surface `void` (the frozen d.ts is the
      // acceptance shape); the redo depth is observable through zundo's
      // temporal store for whoever needs the number.
    },
    isTracking: () => temporalStore().isTracking,
  }

  return {
    project,
    editor,
    arbitrator: null,
    getEditorCommands: () => commands,
    getCommand: (id) => commandsById.get(id),
    dispatch,
    history,
    dispose() {
      // Slice B extends this with the arbitrator teardown (its loop owns rAF).
    },
  }
}
