// Transport registry handlers (FR-102.5 / US-2.2.4): binds the SHELL command
// ids added in slice C to the frozen editor commands. This is the ONLY path
// from a keyboard chord / button click into the transport: the registry owns
// the chords + the `not-editing` guard (useCommands routes every window
// keydown through `dispatchCommand`), and the editor reducers + the
// SyncArbitrator mirror own the truth (components never touch the element —
// FR-102.3). The transport RATE button (no design.md keyboard row) flows
// through the same command dispatch via `cycleRate`.

import { useEffect } from 'react'
import type { EditorApp } from '../../state/history'
import { registerCommandHandler } from './registry'

const RATE_STEPS: readonly number[] = [1, 1.5, 2, 0.5]

export function nextRate(current: number): number {
  const index = RATE_STEPS.indexOf(current)
  return RATE_STEPS[(index + 1) % RATE_STEPS.length] ?? 1
}

export function useTransportCommands(app: EditorApp | undefined): void {
  useEffect(() => {
    if (app === undefined) return
    const unsubscribes = [
      registerCommandHandler('transport.play-pause', () => {
        if (app.editor.getState().playing) void app.dispatch('transport-pause', undefined)
        else void app.dispatch('transport-play', undefined)
      }),
      registerCommandHandler('transport.skip-backward', () => {
        void app.dispatch('transport-skip', { seconds: -5 })
      }),
      registerCommandHandler('transport.skip-forward', () => {
        void app.dispatch('transport-skip', { seconds: 5 })
      }),
      registerCommandHandler('transport.skip-backward-large', () => {
        void app.dispatch('transport-skip', { seconds: -10 })
      }),
      registerCommandHandler('transport.skip-forward-large', () => {
        void app.dispatch('transport-skip', { seconds: 10 })
      }),
      registerCommandHandler('transport.step-backward', () => {
        void app.dispatch('transport-step-frame', { frames: -1 })
      }),
      registerCommandHandler('transport.step-forward', () => {
        void app.dispatch('transport-step-frame', { frames: 1 })
      }),
      registerCommandHandler('transport.step-second-backward', () => {
        void app.dispatch('transport-step-second', { seconds: -1 })
      }),
      registerCommandHandler('transport.step-second-forward', () => {
        void app.dispatch('transport-step-second', { seconds: 1 })
      }),
      registerCommandHandler('transport.loop-toggle', () => {
        void app.dispatch('transport-loop-toggle', undefined)
      }),
      registerCommandHandler('transport.loop-in', () => {
        void app.dispatch('transport-loop-in', undefined)
      }),
      registerCommandHandler('transport.loop-out', () => {
        void app.dispatch('transport-loop-out', undefined)
      }),
    ]
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [app])
}

export function cycleRate(app: EditorApp): void {
  void app.dispatch('transport-rate', { rate: nextRate(app.editor.getState().rate) })
}
