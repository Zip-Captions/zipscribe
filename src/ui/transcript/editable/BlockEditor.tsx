// Unit-104 slice C — the in-place block editor (FR-104.4, US-2.1.3/2.1.6,
// CC-104.3). This is a text-editing component on the conventions
// § UI conventions onKeyDown allowlist (`ui/**/editable/**`) — the ONLY
// onKeyDown home outside `ui/commands/**` and `TimecodeInput`: Enter commits,
// Shift+Enter inserts a manual line break (CapCut convention, invariant 2 —
// the '\n' reaches `block-edit-text` and re-derives as `breakAfter`), Esc
// reverts with NO dispatch, blur auto-commits. IME-safe (FR-104.4): while a
// composition is active NOTHING dispatches — commit waits for compositionEnd
// (+ Enter/blur). Paste is sanitized to `text/plain` — HTML never reaches the
// project, and pasted line breaks are the manual-break tokens (the draft
// carries '\n'; the frozen tokenizer turns them into `breakAfter`). The
// commit is exclusively the `block-edit-text` command (FR-104.4 — the parent
// dispatches; this component never touches stores). SECURITY-03: nothing here
// logs the draft text.

import { useEffect, useRef } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'

export interface BlockEditorProps {
  /** The block's text at open time (invariant-2 form — '\n' after a `breakAfter` word). */
  initialText: string
  /** Enter / Shift+Enter / blur → parent dispatches `block-edit-text` with this text. */
  onSubmit: (text: string) => void
  /** Esc → parent closes the editor WITHOUT a dispatch. */
  onCancel: () => void
}

export function BlockEditor({ initialText, onSubmit, onCancel }: BlockEditorProps): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const composingRef = useRef(false)
  /** One terminal action per editor: Enter/blur past commit (or Esc) never double-dispatches. */
  const settledRef = useRef(false)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    // Uncontrolled surface: the DOM is the draft. Set once; React never
    // reconciles children into the user's typing (store ticks re-render the
    // row while the user types).
    element.textContent = initialText
    element.focus()
    const selection = window.getSelection()
    if (selection !== null) {
      const range = document.createRange()
      range.selectNodeContents(element)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }, [initialText])

  function draftText(): string {
    return ref.current?.textContent ?? ''
  }

  function commit(): void {
    if (settledRef.current) return
    settledRef.current = true
    onSubmit(draftText())
  }

  function cancel(): void {
    if (settledRef.current) return
    settledRef.current = true
    onCancel()
  }

  /** Plain-text insertion at the caret (paste + Shift+Enter break) — no execCommand, no HTML. */
  function insertPlainText(text: string): void {
    const element = ref.current
    if (element === null) return
    const selection = window.getSelection()
    if (selection !== null && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      if (element.contains(range.startContainer)) {
        range.deleteContents()
        const node = document.createTextNode(text)
        range.insertNode(node)
        const after = document.createRange()
        after.setStartAfter(node)
        after.collapse(true)
        selection.removeAllRanges()
        selection.addRange(after)
        return
      }
    }
    element.appendChild(document.createTextNode(text))
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // FR-104.4 IME guard: mid-composition keystrokes belong to the IME —
    // NOTHING dispatches (and nothing preventDefaults) until compositionEnd.
    if (event.nativeEvent.isComposing || composingRef.current) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) insertPlainText('\n')
      else commit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  function onPaste(event: ReactClipboardEvent<HTMLDivElement>): void {
    // Sanitize at the door: ONLY text/plain survives; \r\n → \n so pasted
    // multi-line text becomes manual-break tokens, NEVER new blocks.
    event.preventDefault()
    const plain = event.clipboardData?.getData('text/plain') ?? ''
    if (plain !== '') insertPlainText(plain.replace(/\r\n?/g, '\n'))
  }

  return (
    <div
      ref={ref}
      data-testid="transcript-editor"
      className="ts-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Edit block text"
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onBlur={commit}
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={() => {
        composingRef.current = false
      }}
    />
  )
}
