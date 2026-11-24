// unit-109 (FR-109.1/FR-109.2) — THE shared local file-picker entry for media
// intake: an INPUT SURFACE feeding the existing intake path, never a second
// pipeline. The hidden `<input type=file>` (the persistence.ts:170 picker
// doctrine — plain input, identical across Chromium/WebKit) lives INSIDE the
// testId root together with the real `<button>`: the e2e suites resolve the
// owner input from `data-testid` for `setInputFiles`/`filechooser`, so the
// containment is a pinned contract (tests/unit/workbench/
// media-intake-button.test.tsx). Nothing here classifies files —
// IntakeService.handleFiles stays the single validator (unit-109 § Risks: the
// two-pipeline bug). SECURITY-03: no file name ever reaches a console/log
// channel from this component; it never logs at all.

import { useRef } from 'react'
import type { ChangeEvent, ReactNode } from 'react'

// FR-109.1: `accept` is a HINT only — it mirrors the intake matrix in
// src/state/services/intake.ts (MEDIA_EXTENSIONS + CAPTION_EXTENSIONS; keep in
// sync with that authority). The browser may dim non-matching names; every
// chosen file still goes through the full intake validation (extension +
// content sniff) unchanged.
const ACCEPT_HINT = '.mp4,.m4v,.mov,.mkv,.webm,.ts,.mp3,.m4a,.m4b,.aac,.wav,.flac,.ogg,.oga,.opus,.weba,.mka,.aif,.aiff,.wma,.amr,.3gp,.3gpp,.caf,.vtt,.srt,.sbv,.ttml,.xml,.dfxp,.ass,.ssa,.json'

export interface MediaIntakeButtonProps {
  /** Accessible name of the real <button> (design.md button vocabulary). */
  label: string
  /** Receives the VERBATIM selection (every file, same references) — classification and rejection codes are IntakeService's. */
  onFiles: (files: File[]) => void
  /** Carried by the root element that CONTAINS the button and the hidden input (e2e owner-input contract). */
  testId: string
}

export function MediaIntakeButton({ label, onFiles, testId }: MediaIntakeButtonProps): ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null)

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? [])
    // A cancelled chooser answers with NOTHING selected — no-op, never a
    // phantom intake and never a toast (US-109.2).
    if (files.length > 0) onFiles(files)
    // CC-109.5: a real browser fires NO change event when the same value is
    // re-selected — clearing the value makes choosing the same file twice work.
    event.target.value = ''
  }

  // The root is a <label>: Playwright's setInputFiles/filechooser retarget a
  // test-id element through the ENCLOSING LABEL's control (coreBundle
  // `retarget(node, "follow-label")`) — a plain <span> wrapper resolves to
  // "Node is not an HTMLInputElement". The input precedes the button so
  // `label.control` (first labelable descendant) is the INPUT, never the
  // button; a click that lands on the button (interactive content) never
  // double-forwards through the label, and the button's own handler opens
  // the picker regardless.
  return (
    <label data-testid={testId} className="ws-intake-picker">
      {/* `multiple`: intake's handleFiles classifies a whole selection at once
          (media + captions in one go — US-2.0.2), so the picker mirrors it. */}
      <input ref={inputRef} type="file" multiple accept={ACCEPT_HINT} className="ws-intake-input" tabIndex={-1} aria-hidden="true" onChange={onChange} />
      <button
        type="button"
        className="ws-button"
        onClick={() => {
          inputRef.current?.click()
        }}
      >
        {label}
      </button>
    </label>
  )
}
