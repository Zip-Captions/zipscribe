// Test-only timeline bridge (unit-103 frozen contract § Window
// __zipTimelineBridge, tests/unit/timeline/unit103-api-contract.d.ts). App.tsx
// imports this module ONLY when the URL query carries `ziptest=1` (lazy
// import → out of the initial bundle; sibling of the unit-101/102 bridges,
// which stay installed untouched). STRICT gate: nothing installs itself on
// import; without the query flag this module is never loaded. The bridge is
// DIAGNOSTICS ONLY — keyboard/mouse never cross here (real trusted input
// drives the panel); reads flow through the mounted panel's registration seam
// (src/ui/timeline/bridge-seam.ts) and the shared app context. SECURITY-03:
// everything crossing here is numbers, generated synthetic block ids and
// viewport scalars — never block text, nothing logs content.

import { getAppContext } from '../../app/context'
import { getTimelinePanel } from '../timeline/bridge-seam'
import { timeToX, xToTime } from '../timeline/viewport'

interface TimelineBridgeState {
  t0: number
  pxPerSec: number
  focusedBlockId: string | null
  selectionAnchorBlockId: string | null
  selectionFocusBlockId: string | null
  blockCount: number
  dragging: boolean
  snapEnabled: boolean
}

interface TimelineBridge {
  getTimelineState(): TimelineBridgeState
  /** Numbers only (SECURITY-03): bounds + word count — never block text. */
  getBlock(blockId: string): { start: number; end: number; wordCount: number } | null
  /** Canvas-relative CSS pixels (frozen contract). */
  timeAtX(x: number): number
  xAtTime(t: number): number
}

export function installTimelineBridge(): void {
  const { editorApp } = getAppContext()

  const bridge: TimelineBridge = {
    getTimelineState(): TimelineBridgeState {
      const panel = getTimelinePanel()
      const editor = editorApp.editor.getState()
      const project = editorApp.project.getState().project
      const viewport = panel?.viewport.get()
      return {
        t0: viewport?.t0 ?? 0,
        pxPerSec: viewport?.pxPerSec ?? 0,
        focusedBlockId: panel?.controller.focusedBlockId() ?? null,
        selectionAnchorBlockId: editor.selection.anchorBlockId,
        selectionFocusBlockId: editor.selection.focusBlockId,
        blockCount: project?.blocks.length ?? 0,
        dragging: panel !== null && panel.controller.dragState() !== null,
        snapEnabled: panel?.isSnapping() ?? true,
      }
    },
    getBlock(blockId: string): { start: number; end: number; wordCount: number } | null {
      const block = editorApp.project.getState().project?.blocks.find((candidate) => candidate.id === blockId)
      if (block === undefined) return null
      return { start: block.start, end: block.end, wordCount: block.words.length }
    },
    timeAtX(x: number): number {
      const panel = getTimelinePanel()
      if (panel === null) return 0
      return xToTime(x, panel.viewport.get())
    },
    xAtTime(t: number): number {
      const panel = getTimelinePanel()
      if (panel === null) return 0
      return timeToX(t, panel.viewport.get())
    },
  }
  ;(window as unknown as { __zipTimelineBridge?: TimelineBridge }).__zipTimelineBridge = bridge
  // Page-side accessor for the frozen keyboard-only spec: its `page.evaluate`
  // / `waitForFunction` callbacks call `tl()` INSIDE the page, and Playwright
  // does not serialize Node-side closures (probe-verified: ReferenceError).
  // Same doctrine as the specs' own `window.__zipPerf` sampler install — a
  // ziptest-only global (this module never loads without `?ziptest=1`),
  // diagnostics-only, numbers and ids only (SECURITY-03).
  ;(window as unknown as { tl?: () => TimelineBridge | undefined }).tl = () => bridge
}
