import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Workbench } from './ui/shell/Workbench'
import { createAppContext } from './app/context'
import type { AppContext } from './app/context'
import type { RelinkField } from './state/services/persistence'

export function App(): ReactNode {
  const [context, setContext] = useState<AppContext | null>(null)
  // CC-106.4 / US-2.4.2 (slice D): the relink decision is APP-owned — the
  // mismatch appears when the post-open relink reports a fingerprint drift,
  // and only the keep/replace handlers below clear it. Nothing here swaps
  // media by itself.
  const [relink, setRelink] = useState<{ projectId: string; differs: readonly RelinkField[] } | null>(null)

  useEffect(() => {
    let mounted = true
    void createAppContext()
      .then(async (created) => {
        // E2E-only bridges (unit-101/unit-102 frozen contracts): STRICT
        // `ziptest=1` query check + lazy imports, so neither bridge reaches
        // the initial bundle and production users (who never set the flag)
        // never load them. No bridge module self-installs on import.
        if (new URLSearchParams(window.location.search).get('ziptest') === '1') {
          const [{ installWorkbenchBridge }, { installEditorBridge }, { installTimelineBridge }, { installTranscriptBridge }, { installPersistenceBridge }] = await Promise.all([
            import('./ui/testing/workbench-bridge'),
            import('./ui/testing/editor-bridge'),
            import('./ui/testing/timeline-bridge'),
            import('./ui/testing/transcript-bridge'),
            import('./ui/testing/persistence-bridge'),
          ])
          installWorkbenchBridge()
          installEditorBridge()
          installTimelineBridge()
          installTranscriptBridge()
          installPersistenceBridge()
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
  return (
    <Workbench
      jobs={context.jobs}
      settings={context.settings}
      project={context.project}
      intake={context.intake}
      transport={{ app: context.editorApp, stage: context.stage, rafs: context.rafs, captionImport: context.captionImport }}
      persistence={context.persistence}
      onTabChange={(tab) => {
        context.setActiveTab(tab)
      }}
      interceptProjectFile={(file) => context.detectAndOpenProjectFile(file)}
      onOpenProject={(projectId, loaded) => {
        // FR-106.5: the loaded reopen context lands through the
        // composition-root seam; FR-106.4: opening triggers the silent
        // relink attempt — a mismatch hands the decision to the user.
        if (loaded !== null) context.applyLoadedProject(loaded)
        setRelink(null)
        void context
          .relinkAfterOpen(projectId)
          .then((outcome) => {
            if (outcome.kind === 'mismatch') setRelink({ projectId, differs: outcome.differs })
          })
          .catch(() => undefined)
      }}
      relinkMismatch={relink?.differs ?? null}
      onRelinkKeep={() => {
        setRelink(null)
      }}
      onRelinkReplace={() => {
        if (relink === null) return
        void context.replaceRelinkedMedia(relink.projectId).then((replaced) => {
          if (replaced) setRelink(null)
        })
      }}
    />
  )
}
