// Editor slice — UI-only state (FR-102.1/FR-102.2). Shapes frozen by
// tests/unit/editor/unit102-api-contract.d.ts § '@state/editor'.
//
// EVERY field is UI-only: the zundo `partialize` in `src/state/history.ts`
// keeps `{ project }` only, so no editor mutation ever creates a history step
// and undo/redo never move the playhead or selection (FR-102.2
// `undoable:false`). The playhead's truth is the SyncArbitrator (FR-102.3) —
// this slice mirrors its `onPlayhead` sink for renderers.

import { createStore } from 'zustand/vanilla'
import { produce } from 'immer'
import type { Seconds } from '../engine/model'

export interface Selection {
  anchorBlockId: string | null
  focusBlockId: string | null
}

export interface EditorUiState {
  playhead: Seconds
  playing: boolean
  rate: number
  loop: [Seconds, Seconds] | null
  selection: Selection
  searchOpen: boolean
}

/** Internal storage shape: the frozen `EditorUiState` plus the last non-null loop region so `transport-loop-toggle` (Y) can re-arm it (FR-102.5). Never part of the frozen contract surface. */
export interface EditorUiStateInternal extends EditorUiState {
  lastLoop: [Seconds, Seconds] | null
}

export interface EditorStore {
  getState(): EditorUiState
  subscribe(listener: () => void): () => void
  setPlayhead(t: Seconds): void
  setPlaying(playing: boolean): void
  setRate(rate: number): void
  setLoop(loop: [Seconds, Seconds] | null): void
  setSelection(selection: Selection): void
  setSearchOpen(open: boolean): void
}

export const DEFAULT_EDITOR_STATE: EditorUiState = {
  playhead: 0,
  playing: false,
  rate: 1,
  loop: null,
  selection: { anchorBlockId: null, focusBlockId: null },
  searchOpen: false,
}

export function createInitialEditorState(): EditorUiStateInternal {
  return { ...DEFAULT_EDITOR_STATE, selection: { ...DEFAULT_EDITOR_STATE.selection }, lastLoop: null }
}

/** The setter bodies shared by the standalone store and the app-composed facade (single implementation of the loop-memory rule). */
export function makeEditorActions(commit: (mutate: (editor: EditorUiStateInternal) => void) => void): Omit<EditorStore, 'getState' | 'subscribe'> {
  return {
    setPlayhead: (t) => commit((e) => void (e.playhead = t)),
    setPlaying: (playing) => commit((e) => void (e.playing = playing)),
    setRate: (rate) => commit((e) => void (e.rate = rate)),
    setLoop: (loop) =>
      commit((e) => {
        e.loop = loop === null ? null : [loop[0], loop[1]]
        if (loop !== null) e.lastLoop = [loop[0], loop[1]]
      }),
    setSelection: (selection) => commit((e) => void (e.selection = { anchorBlockId: selection.anchorBlockId, focusBlockId: selection.focusBlockId })),
    setSearchOpen: (open) => commit((e) => void (e.searchOpen = open)),
  }
}

/** Standalone editor store (the app path composes the same state inside the history-rooted store — `src/state/history.ts`). */
export function createEditorStore(): EditorStore {
  const store = createStore<EditorUiStateInternal>(() => createInitialEditorState())
  const commit = (mutate: (editor: EditorUiStateInternal) => void): void => {
    store.setState((state) => produce(state, mutate))
  }
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    ...makeEditorActions(commit),
  }
}
