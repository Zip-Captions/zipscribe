// Test-only injection bridge (unit-101 frozen contract § Window
// __zipWorkbenchBridge). App.tsx imports this module ONLY when the URL query
// carries `ziptest=1` (lazy import → it stays out of the initial bundle).
// Every method dispatches into the SAME receivers the worker replies reach
// (FR-2.0.6 fake-engine doctrine); production users never set the flag.
// SECURITY-03: events cross in as protocol objects and are stored verbatim —
// nothing here logs content.

import { getAppContext } from '../../app/context'
import type { AsrEvent, MediaEvent } from '../../engine/protocol'
import type { MediaAsset } from '../../engine/model'
import type { CaptionImportResult } from '../../state/services/intake'

interface WorkbenchBridge {
  injectMediaEvent(event: MediaEvent): void
  injectAsrEvent(event: AsrEvent): void
  setCaptionImportOverride(result: CaptionImportResult | null): void
  openProject(asset: MediaAsset): void
}

/** The jobId the synthetic probe reply carries (test furniture, never shown). */
const OPEN_PROJECT_JOB_ID = 'ziptest-open'

export function installWorkbenchBridge(): void {
  const context = getAppContext()
  const bridge: WorkbenchBridge = {
    injectMediaEvent(event: MediaEvent): void {
      context.engine.injectMediaEvent(event)
    },
    injectAsrEvent(event: AsrEvent): void {
      context.engine.injectAsrEvent(event)
    },
    setCaptionImportOverride(result: CaptionImportResult | null): void {
      context.setCaptionImportOverride(result)
    },
    openProject(asset: MediaAsset): void {
      // The same intake path a real `media:probed` reply takes: the intake
      // service's media listener turns the asset into the project.
      context.engine.injectMediaEvent({ t: 'media:probed', jobId: OPEN_PROJECT_JOB_ID, asset })
    },
  }
  ;(window as unknown as { __zipWorkbenchBridge?: WorkbenchBridge }).__zipWorkbenchBridge = bridge
}
