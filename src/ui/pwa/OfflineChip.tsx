// FR-204.4 — the Offline chip (knowledge/design.md § Offline & install).
// Renders ONLY while offline; disappears on reconnect (useOnlineStatus).
// The title tooltip carries the honest explanation (spec: a non-empty
// tooltip of real length — never a bare badge).

import type { OnlineStatus } from './use-online-status'

export interface OfflineChipProps {
  status: OnlineStatus
}

export function OfflineChip({ status }: OfflineChipProps) {
  if (!status.offline) return null
  return (
    <span data-testid="offline-chip" className="shell-offline-chip" title="Offline — transcription needs a downloaded model; captions and editing keep working" role="status">
      Offline
    </span>
  )
}
