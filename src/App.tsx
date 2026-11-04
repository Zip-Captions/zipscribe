import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Workbench } from './ui/shell/Workbench'
import { createAppContext } from './app/context'
import type { AppContext } from './app/context'

export function App(): ReactNode {
  const [context, setContext] = useState<AppContext | null>(null)

  useEffect(() => {
    let mounted = true
    void createAppContext()
      .then(async (created) => {
        // E2E-only bridge (unit-101 frozen contract): STRICT `ziptest=1`
        // query check + lazy import, so the bridge never reaches the initial
        // bundle and production users (who never set the flag) never load it.
        if (new URLSearchParams(window.location.search).get('ziptest') === '1') {
          const { installWorkbenchBridge } = await import('./ui/testing/workbench-bridge')
          installWorkbenchBridge()
        }
        if (mounted) setContext(created)
      })
      .catch(() => {
        // Boot failure keeps the empty root; diagnostics are codes-only in
        // the qualification run (SECURITY-03 — nothing user-derived here).
      })
    return () => {
      mounted = false
    }
  }, [])

  if (context === null) return null
  return <Workbench jobs={context.jobs} settings={context.settings} project={context.project} intake={context.intake} />
}
