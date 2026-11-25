// @vitest-environment jsdom
// CC-109.5 + CC-109.3 (L2, jsdom): the shared MediaIntakeButton (unit-109
// Technical Specification) — hidden `<input type=file>` behind a REAL button.
// Pinned contract (test-author, per spec § Technical Specification):
//   props { label: string; onFiles: (files: File[]) => void; testId: string }
//   (the `testId`-prop pattern follows src/ui/editable/TimecodeInput.tsx),
//   the element carrying `data-testid={testId}` CONTAINS the button and the
//   hidden file input as descendants (so Playwright `setInputFiles` /
//   `filechooser` resolve the owner input from the test id — e2e/media/
//   intake-picker.spec.ts depends on this), the button's accessible name is
//   the label, and activation opens the picker via input.click().
//
// The button is an INPUT SURFACE, not a pipeline: it classifies nothing
// (validation stays server-of-truth in IntakeService — the unit's stated
// two-pipeline risk, CC-109.2 parity). CC-109.5 proves verbatim pass-through
// plus the `input.value` reset that makes re-choosing the same file fire
// again; CC-109.3's component half proves a real focusable button with an
// accessible name whose Enter activation opens the picker.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MediaIntakeButton } from '@ui/shell/MediaIntakeButton'

afterEach(cleanup)

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], name, { type })
}

function pickerRoot(testId: string): HTMLElement {
  return screen.getByTestId(testId)
}

function fileInput(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector('input[type="file"]')
  if (input === null) throw new Error(`[${String(root.dataset['testid'])}] contains no descendant <input type=file> — the hidden picker must live inside the testId root (e2e setInputFiles/filechooser owner-input contract)`)
  return input as HTMLInputElement
}

/** Emulates a real selection: `files` plus the fakepath `value` a real browser reports, then `change`. */
function selectFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { configurable: true, writable: true, value: files })
  Object.defineProperty(input, 'value', { configurable: true, writable: true, value: `C:\\fakepath\\${files[0]?.name ?? ''}` })
  fireEvent.change(input)
}

describe('CC-109.5: MediaIntakeButton selection pass-through and value reset', () => {
  test('CC-109.5: selected files reach onFiles verbatim — same File references, every file, no classification', () => {
    const onFiles = vi.fn<(files: File[]) => void>()
    render(<MediaIntakeButton label="Choose file…" onFiles={onFiles} testId="media-intake-button" />)
    const root = pickerRoot('media-intake-button')
    const input = fileInput(root)
    const media = makeFile('interview.wav', 'audio/wav')
    const stray = makeFile('notes.txt', 'text/plain')
    selectFiles(input, [media, stray])
    expect(onFiles, 'the change handler forwards the selection once').toHaveBeenCalledTimes(1)
    const passed = onFiles.mock.calls[0]?.[0]
    expect(passed, 'onFiles received the array').toBeDefined()
    expect(passed?.length, "every chosen file is forwarded — filtering is IntakeService's job (no second pipeline)").toBe(2)
    expect(passed?.[0]).toBe(media)
    expect(passed?.[1]).toBe(stray)
  })

  test('CC-109.5: input.value is cleared after forwarding so re-choosing the SAME file fires again', () => {
    const onFiles = vi.fn<(files: File[]) => void>()
    render(<MediaIntakeButton label="Choose file…" onFiles={onFiles} testId="project-intake-button" />)
    const root = pickerRoot('project-intake-button')
    const input = fileInput(root)
    const only = makeFile('take-one.wav', 'audio/wav')
    selectFiles(input, [only])
    expect(onFiles, 'first selection forwarded').toHaveBeenCalledTimes(1)
    expect(input.value, 'the picker must reset input.value — a real browser fires NO change event when the same value is re-selected').toBe('')
    selectFiles(input, [only])
    expect(onFiles, 're-choosing the same file refires the intake (value was reset)').toHaveBeenCalledTimes(2)
    expect(onFiles.mock.calls[1]?.[0]?.[0]).toBe(only)
  })
})

describe('CC-109.3: MediaIntakeButton is a real, accessible, keyboard-operable button', () => {
  test('CC-109.3: a real <button> with the label as accessible name; Enter opens the picker (input.click)', async () => {
    const onFiles = vi.fn<(files: File[]) => void>()
    render(<MediaIntakeButton label="Choose file…" onFiles={onFiles} testId="media-intake-button" />)
    const root = pickerRoot('media-intake-button')
    const button = screen.getByRole('button', { name: 'Choose file…' })
    expect(root.contains(button), 'the button is inside the testId root (e2e owner-input contract)').toBe(true)
    expect(button.tagName, 'a real focusable button, not a div with role').toBe('BUTTON')
    button.focus()
    expect(document.activeElement, 'the button is focusable').toBe(button)
    const input = fileInput(root)
    const clickSpy = vi.spyOn(input, 'click')
    await userEvent.keyboard('{Enter}')
    expect(clickSpy, 'Enter on the focused button opens the OS picker via input.click()').toHaveBeenCalledTimes(1)
    expect(onFiles, 'no phantom selection from mere activation').not.toHaveBeenCalled()
    clickSpy.mockRestore()
  })
})
