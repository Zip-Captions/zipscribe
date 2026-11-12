// Mount-time registration seam for the E2E-only transcript bridge (unit-104
// frozen contract § Window __zipTranscriptBridge, tests/unit/transcript/
// unit104-api-contract.d.ts). The mounted Transcript panel exposes a
// numbers/ids-only read surface here; the bridge module
// (src/ui/testing/transcript-bridge.ts, lazily loaded ONLY under `?ziptest=1`)
// reads through it — the unit-103 timeline bridge-seam pattern. Production
// ships this module (the panel registers unconditionally) but NOTHING reads
// the handle unless the ziptest bridge was installed. SECURITY-03: the handle
// carries accessor functions returning numbers, protocol enums, generated
// synthetic block ids and booleans — never user text.

export interface TranscriptPanelRead {
  /** Rows currently mounted in the DOM (virtualized window + overscan). */
  renderedRows: number
  scrollTop: number
  scrollHeight: number
  viewportHeightPx: number
  searchOpen: boolean
  /** Slice-C-owned search state (frozen bridge fields) — 0/-1 until slice C fills the refs. */
  matchCount: number
  currentMatchIndex: number
  activeBlockId: string | null
  /** The block whose row currently holds the in-place editor (null = none). */
  editingBlockId: string | null
  /** FR-104.6 streaming rows beyond the committed frontier (aria-hidden). */
  skeletonRows: number
  focusedRowBlockId: string | null
  hiddenSpeakerIds: string[]
}

export interface TranscriptPanelHandle {
  read(): TranscriptPanelRead
  /** Follow-style jump (align 'nearest'/'auto' semantics of the pinned virtualizer). */
  scrollToIndex(index: number): void
}

let active: TranscriptPanelHandle | null = null

/** Registers the mounted panel; the returned disposer clears the slot only while it is still the registered one. */
export function registerTranscriptPanel(handle: TranscriptPanelHandle): () => void {
  active = handle
  return () => {
    if (active === handle) active = null
  }
}

export function getTranscriptPanel(): TranscriptPanelHandle | null {
  return active
}
