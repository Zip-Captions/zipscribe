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

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { EngineError } from '../../engine/protocol'
import type { JobsStore } from '../../state/jobs'

export interface OnlineStatus {
  /** True when offline (either signal). */
  offline: boolean
}

export function useOnlineStatus(jobs: JobsStore): OnlineStatus {
  const [browserOffline, setBrowserOffline] = useState(() => globalThis.navigator?.onLine === false)
  const [networkError, setNetworkError] = useState(false)
  // The fetch-failure signal is an EVENT, not a level (US-204.2 "it
  // disappears on reconnect"): each coded NETWORK error object is consumed
  // ONCE. The jobs slice keeps `error` until the next startTranscribe, so a
  // level-read would re-latch the chip on every later store mutation
  // (notices, capability refresh) even though no new failure occurred.
  const consumedRef = useRef<EngineError | null>(null)

  useEffect(() => {
    // flushSync: chip flips are synchronous with the window event / store
    // notification (the hook renders a status the UI asserts on immediately;
    // batching would race React's scheduler against event-driven reads).
    const onOnline = (): void => {
      flushSync(() => {
        setBrowserOffline(false)
        setNetworkError(false) // the reconnect clears the sticky fetch-failure signal
      })
      // Consume whatever the store still holds: it predates the reconnect.
      const current = jobs.getState().error
      if (current !== null) consumedRef.current = current
    }
    const onOffline = (): void => {
      flushSync(() => {
        setBrowserOffline(true)
      })
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const sync = (): void => {
      const error = jobs.getState().error
      if (error?.code === 'NETWORK' && error !== consumedRef.current) {
        consumedRef.current = error
        flushSync(() => {
          setNetworkError(true)
        })
      }
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
