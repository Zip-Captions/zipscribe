// The unit-105 command-handler wiring (useTransportCommands precedent): binds
// the unit-105 design-table command ids to the frozen editor commands. Like
// the transport hook this registers HANDLERS ONLY — useCommands stays the
// single window-keydown consumer (window keydown → dispatchCommand → registry
// → these handlers), so composing both hooks never double-dispatches.
//
// Deliberately unregistered here:
//  * translate.cycle-view — handler arrives with unit-302 (dispatch of an
//    unhandled id is the registry's documented no-op, registry.ts);
//  * view.captions-toggle — caption overlay rendering/preview is Intent 3
//    (the shell only reserves the canvas overlay layer), so the binding is
//    the documented no-op until that intent lands;
//  * view.shortcuts-overlay — the overlay mount is the ShortcutsOverlay/
//    Workbench owner (frozen seam, unit105-api-contract.d.ts); the chord
//    resolves through the registry either way.
// `platform` is accepted for CmdOrCtrl-aware consumers (overlay glyphs);
// chord resolution itself reads the event's modifier flags in useCommands,
// so no handler here branches on it.

import { useEffect, useRef } from 'react'
import type { EditorApp } from '../../state/history'
import type { CommandPlatform } from './keyspec'
import { detectPlatform } from './keyspec'
import { registerCommandHandler } from './registry'

export interface EditorCommandDeps {
  /** ⌘S/Ctrl+S save hook (FR-102.9 autosave/snapshot path; the L2 suites
   *  inject a spy). Default: documented no-op — unit-106 owns the autosave
   *  provider. */
  onSave?: () => void
  /** Platform for CmdOrCtrl resolution (default: userAgent detection). */
  platform?: CommandPlatform
}

export function useEditorCommands(app: EditorApp | undefined, deps: EditorCommandDeps = {}): void {
  const onSaveRef = useRef(deps.onSave)
  onSaveRef.current = deps.onSave
  const platform = deps.platform ?? detectPlatform()

  useEffect(() => {
    if (app === undefined) return
    const selectedBlockId = (): string | null => app.editor.getState().selection.focusBlockId
    const unsubscribes = [
      registerCommandHandler('transport.seek-start', () => {
        void app.dispatch('transport-seek', { time: 0 })
      }),
      registerCommandHandler('transport.seek-end', () => {
        const project = app.project.getState().project
        if (project === null) return
        void app.dispatch('transport-seek', { time: project.asset.duration })
      }),
      registerCommandHandler('transport.loop-clear', () => {
        void app.dispatch('transport-loop-clear', undefined)
      }),
      registerCommandHandler('timeline.delete', () => {
        const blockId = selectedBlockId()
        if (blockId === null) return
        void app.dispatch('block-delete', { blockId })
      }),
      registerCommandHandler('timeline.delete-close-gap', () => {
        const blockId = selectedBlockId()
        if (blockId === null) return
        void app.dispatch('block-delete-close-gap', { blockId })
      }),
      registerCommandHandler('transcript.select-all', () => {
        const blocks = app.project.getState().project?.blocks ?? []
        const first = blocks.at(0)
        const last = blocks.at(-1)
        if (first === undefined || last === undefined) return
        app.editor.setSelection({ anchorBlockId: first.id, focusBlockId: last.id })
      }),
      registerCommandHandler('transcript.deselect', () => {
        app.editor.setSelection({ anchorBlockId: null, focusBlockId: null })
      }),
      registerCommandHandler('edit.undo', () => {
        app.history.undo()
      }),
      registerCommandHandler('edit.redo', () => {
        app.history.redo()
      }),
      registerCommandHandler('view.save-snapshot', () => {
        onSaveRef.current?.()
      }),
    ]
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [app, platform])
}
