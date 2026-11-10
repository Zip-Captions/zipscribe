// Mount-time registration seam for the E2E-only timeline bridge (unit-103
// frozen contract § Window __zipTimelineBridge, tests/unit/timeline/
// unit103-api-contract.d.ts). The mounted Timeline panel exposes its
// controller + viewport here; the bridge module (src/ui/testing/
// timeline-bridge.ts, lazily loaded ONLY under `?ziptest=1`) reads through it.
// Production ships this module (the panel must register unconditionally) but
// NOTHING reads the handle unless the ziptest bridge was installed — no
// global leaks, and the handle carries only object references, never data
// copies (SECURITY-03 lives at the bridge read surface, not here).

import type { TimelineController } from './controller'
import type { ViewportState } from './viewport'

export interface TimelinePanelHandle {
  viewport: ViewportState
  controller: TimelineController
  /** The toolbar snap toggle's current state (design.md: snap "toggleable"). */
  isSnapping(): boolean
}

let active: TimelinePanelHandle | null = null

/** Registers the mounted panel; the returned disposer clears the slot only while it is still the registered one. */
export function registerTimelinePanel(handle: TimelinePanelHandle): () => void {
  active = handle
  return () => {
    if (active === handle) active = null
  }
}

export function getTimelinePanel(): TimelinePanelHandle | null {
  return active
}
