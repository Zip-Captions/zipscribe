// FR-204.4 / US-204.4 — the SW update flow (toast-driven, never auto).
//
// workbox-window events (https://developer.chrome.com/docs/workbox/modules/workbox-window/):
// - `waiting` with `isUpdate === true` → a NEW deployment's worker is parked
//   (first installs are `isUpdate: false` — no toast for the first visit).
// - The Reload click activates the parked worker via unregister +
//   re-register (see applyUpdate — `messageSkipWaiting` is deliberately NOT
//   used: the generated workbox worker never completes activation from a
//   SKIP_WAITING message in Chromium, measured unit-204).
// - The click FIRST flushes autosave through the persistence service (the
//   e2e witness: the edited row's updatedAt lands before the reload).
//
// Quiet-window rule (design.md: updates never lose work): the toast waits
// for a settle (idle | saved | not-saved — nothing in flight); it never
// interrupts a `saving…` moment, and ignoring it parks the worker until the
// tab closes (the `waiting` state persists — Later only hides the toast).

import { useCallback, useEffect, useState } from 'react'
import type { PersistenceService } from '../../state/services/persistence'
import { getPwaWorkbox } from './register'

export interface SwUpdateState {
  /** Toast visible: a waiting update the user has not dismissed. */
  visible: boolean
  /** Click "Reload": flush autosave → unregister+re-register → reload. */
  applyUpdate(): void
  /** Click "Later": park the waiting worker (design.md: it stays parked). */
  dismiss(): void
}

export function useSwUpdate(persistence: PersistenceService | undefined): SwUpdateState {
  const [waiting, setWaiting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [skipRequested, setSkipRequested] = useState(false)
  const [settled, setSettled] = useState(persistence === undefined || isSettled(persistence))

  useEffect(() => {
    const workbox = getPwaWorkbox()
    if (workbox === undefined) return
    const onWaiting = (event: { isUpdate?: boolean }): void => {
      if (event.isUpdate === true) setWaiting(true)
    }
    const onControlling = (): void => {
      // The only reload path (US-204.4 "never auto-reloads"): we asked, it
      // took control — hot-swap the document.
      if (skipRequested) window.location.reload()
    }
    workbox.addEventListener('waiting', onWaiting)
    workbox.addEventListener('controlling', onControlling)
    return () => {
      workbox.removeEventListener('waiting', onWaiting)
      workbox.removeEventListener('controlling', onControlling)
    }
  }, [skipRequested])

  useEffect(() => {
    if (persistence === undefined) return
    const sync = (): void => setSettled(isSettled(persistence))
    sync()
    return persistence.subscribeSaveState(sync)
  }, [persistence])

  const applyUpdate = useCallback((): void => {
    const workbox = getPwaWorkbox()
    if (workbox === undefined || skipRequested) return
    // Measured (unit-204, Chromium): the generated workbox worker NEVER
    // completes the installed→activating transition after a SKIP_WAITING
    // message (CDP shows the version parked forever). Drop the registration
    // and let the app's boot-time register() create the fresh one — the new
    // worker installs ALONE (no parked peer) and activates normally; the
    // precache survives unregister(). An immediate register() here is
    // deliberately avoided: racing the uncommitted unregister() hands back
    // the OLD registration and the swap never happens (measured).
    const activate = async (): Promise<void> => {
      setSkipRequested(true)
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        await registration?.unregister()
        await new Promise((resolve) => window.setTimeout(resolve, 300))
      } catch {
        // proceed anyway — the reload at least returns the served build
      }
      window.location.reload()
    }
    // FR-204.4: flush the autosave BEFORE the swap. Any settle proceeds
    // (a failed flush must still not strand the user on a stale version).
    if (persistence === undefined) {
      void activate()
      return
    }
    void persistence.saveNow('manual').then(activate, activate)
  }, [persistence, skipRequested])

  const dismiss = useCallback((): void => {
    setDismissed(true)
  }, [])

  return { visible: waiting && !dismissed && settled, applyUpdate, dismiss }
}

function isSettled(persistence: PersistenceService): boolean {
  const state = persistence.getSaveState().state
  return state === 'idle' || state === 'saved' || state === 'not-saved'
}
