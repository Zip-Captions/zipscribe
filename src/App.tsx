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
        // E2E-only bridges (unit-101/unit-102 frozen contracts): STRICT
        // `ziptest=1` query check + lazy imports, so neither bridge reaches
        // the initial bundle and production users (who never set the flag)
        // never load them. No bridge module self-installs on import.
        if (new URLSearchParams(window.location.search).get('ziptest') === '1') {
          const [{ installWorkbenchBridge }, { installEditorBridge }] = await Promise.all([import('./ui/testing/workbench-bridge'), import('./ui/testing/editor-bridge')])
          installWorkbenchBridge()
          installEditorBridge()
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
  return <Workbench jobs={context.jobs} settings={context.settings} project={context.project} intake={context.intake} transport={{ app: context.editorApp, stage: context.stage }} />
}
