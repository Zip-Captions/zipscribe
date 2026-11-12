// Mount-time seam for the ⌘'/⌘⇧' QC-issue cursor (FR-104.8, design.md
// § Keyboard shortcuts). The BINDINGS are registered by slice C (frozen
// registry EXTENDS); the issue LIST/cursor is the slice-D "Issues (n)"
// component's state — it registers its navigator here while mounted, and the
// Transcript-owned `qc.next-issue`/`qc.previous-issue` handlers step it.
// No cursor mounted (pre-slice-D, filter closed) ⇒ the commands stay safe
// no-ops (never throw, never mutate). SECURITY-03: ids and numbers only.

export interface QcIssueCursor {
  /** Advance to the next issue's block (wrap): seek + selection, UI-only. */
  nextIssue(): void
  /** Retreat to the previous issue's block (wrap). */
  previousIssue(): void
}

let cursor: QcIssueCursor | null = null

/** Registers the mounted cursor; the disposer restores the previous one only while it is still the registered one. */
export function registerQcIssueCursor(next: QcIssueCursor | null): () => void {
  const previous = cursor
  cursor = next
  return () => {
    if (cursor === next) cursor = previous
  }
}

export function getQcIssueCursor(): QcIssueCursor | null {
  return cursor
}
