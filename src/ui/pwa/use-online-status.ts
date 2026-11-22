// FR-204.4 (unit-204) `useOnlineStatus` — the Offline chip's source of truth.
//
// knowledge/design.md § Offline & install: the chip shows OFFLINE (never a
// fake "online" claim — product.md rule 4) and disappears on reconnect.
// Two signals (spec FR-204.4):
// - `navigator.onLine` + the `online`/`offline` window events; and
// - a model-host fetch failure from the jobs slice (a coded NETWORK job
//   error after the last `online` event): a plane-Wi-Fi portal that keeps
//   onLine true but kills the model host is honest-offline for the parts
//   that matter, and the chip stays until the user reconnects (the `online`
//   event clears the sticky model-host signal).

import { useEffect, useState } from 'react'
import type { JobsStore } from '../../state/jobs'

export interface OnlineStatus {
  /** True when offline (either signal). */
  offline: boolean
}

export function useOnlineStatus(jobs: JobsStore): OnlineStatus {
  const [browserOffline, setBrowserOffline] = useState(() => globalThis.navigator?.onLine === false)
  const [networkError, setNetworkError] = useState(false)

  useEffect(() => {
    const onOnline = (): void => {
      setBrowserOffline(false)
      setNetworkError(false) // the reconnect clears the sticky fetch-failure signal
    }
    const onOffline = (): void => setBrowserOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const sync = (): void => {
      const state = jobs.getState()
      if (state.error?.code === 'NETWORK') setNetworkError(true)
    }
    sync()
    const unsubscribe = jobs.subscribe(sync)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      unsubscribe()
    }
  }, [jobs])

  return { offline: browserOffline || networkError }
}
