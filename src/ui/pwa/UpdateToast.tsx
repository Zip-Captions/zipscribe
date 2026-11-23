// FR-204.4 — the update toast (US-204.4 / design.md § Offline & install).
// Copy is the spec contract: text matching /new version ready/iu with
// "Reload" and "Later" buttons. Rendered by the Workbench (optional pwa
// slot) once per session; Later parks the waiting worker (the SW stays in
// `waiting` — the old version keeps controlling until the tab closes).

import type { SwUpdateState } from './use-sw-update'

export interface UpdateToastProps {
  update: SwUpdateState
}

export function UpdateToast({ update }: UpdateToastProps) {
  if (!update.visible) return null
  return (
    <div data-testid="update-toast" className="shell-update-toast" role="alert">
      <span className="shell-update-toast-text">New version ready — reload to update</span>
      <div className="shell-update-toast-actions">
        <button type="button" onClick={() => update.applyUpdate()}>
          Reload now
        </button>
        <button type="button" onClick={() => update.dismiss()}>
          Later
        </button>
      </div>
    </div>
  )
}
