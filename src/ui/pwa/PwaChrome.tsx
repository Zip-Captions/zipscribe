// FR-204.4 / FR-204.1 — the app's PWA chrome, mounted by the Workbench via
// the optional `pwa` slot (frozen mount paths render it as null):
// the Offline chip (useOnlineStatus), the ⋯ menu (Offline models panel +
// honest Install entry), and the update toast (useSwUpdate). Hooks live
// HERE so the frozen Workbench renders byte-identically when the slot is
// absent.

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ModelCache } from '../../engine/model/cache'
import type { PersistenceDeps, PersistenceService } from '../../state/services/persistence'
import type { JobsStore } from '../../state/jobs'
import { OfflineChip } from './OfflineChip'
import { OfflineModelsPanel } from './OfflineModelsPanel'
import { UpdateToast } from './UpdateToast'
import { useInstallPrompt } from './use-install-prompt'
import { useOnlineStatus } from './use-online-status'
import { useSwUpdate } from './use-sw-update'

export interface PwaChromeProps {
  jobs: JobsStore
  persistence: PersistenceService | undefined
  modelCache: ModelCache
  persistenceDeps: PersistenceDeps
  /** Controlled by the Workbench so the TranscribePopover fast-fail
   *  suggestion ("Make available offline") can open the same panel. */
  panelOpen: boolean
  onPanelOpen: (open: boolean) => void
}

export function PwaChrome({ jobs, persistence, modelCache, persistenceDeps, panelOpen, onPanelOpen }: PwaChromeProps): ReactNode {
  const status = useOnlineStatus(jobs)
  const update = useSwUpdate(persistence)
  const install = useInstallPrompt()
  const [menuOpen, setMenuOpen] = useState(false)

  const openPanel = (): void => {
    setMenuOpen(false)
    onPanelOpen(true)
  }
  const closePanel = (): void => {
    onPanelOpen(false)
  }

  return (
    <>
      <div className="shell-pwa-chrome">
        <OfflineChip status={status} />
        <button type="button" className="shell-pwa-menu-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          ⋯
        </button>
        {menuOpen && (
          <div role="menu" aria-label="More" className="shell-pwa-menu">
            <button role="menuitem" type="button" data-testid="pwa-menu-offline-models" onClick={openPanel}>
              Offline models
            </button>
            {install.entry.kind === 'prompt' && (
              <button
                role="menuitem"
                type="button"
                data-testid="pwa-menu-install"
                onClick={() => {
                  setMenuOpen(false)
                  void install.install()
                }}
              >
                Install app
              </button>
            )}
            {install.entry.kind === 'instructions' && (
              <button role="menuitem" type="button" onClick={() => setMenuOpen(false)}>
                Install app — use your browser's Add to Home Screen
              </button>
            )}
          </div>
        )}
      </div>
      {panelOpen && <OfflineModelsPanel modelCache={modelCache} persistenceDeps={persistenceDeps} onClose={closePanel} />}
      <UpdateToast update={update} />
    </>
  )
}
