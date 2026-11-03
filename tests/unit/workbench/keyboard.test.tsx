// CC-101.5 (L2, jsdom): Alt+1/2/3 move focus to the sidebar/stage/timeline
// regions (registry dispatch → region.focus(), tabindex=-1 regions), and the
// `not-editing` guard keeps focus in the project-name inline edit while the
// user types. Focus-visible ring COLOR is a CSS concern verified by the axe
// scan in e2e/workbench/accessibility.spec.ts; here: reachability + focus
// targets + native tabbability of the header/tab controls.
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mountWorkbench } from './helpers/mount'
import { dispatchCommand } from '@ui/commands/registry'

afterEach(cleanup)

function activeRegion(): string | null {
  const active = document.activeElement
  return active instanceof Element ? active.getAttribute('data-region') : null
}

describe('CC-101.5: Alt+1/2/3 focus regions', () => {
  test('CC-101.5: Alt+1/2/3 focus the sidebar, stage and timeline regions', async () => {
    await mountWorkbench({ project: {} })
    const user = userEvent.setup()
    await user.keyboard('{Alt>1}')
    expect(activeRegion(), 'Alt+1 focuses the sidebar (Clipchamp Alt+N)').toBe('sidebar')
    await user.keyboard('{Alt>2}')
    expect(activeRegion(), 'Alt+2 focuses the preview stage').toBe('stage')
    await user.keyboard('{Alt>3}')
    expect(activeRegion(), 'Alt+3 focuses the timeline').toBe('timeline')
  })

  test('CC-101.5: the registry seam dispatches the focus commands directly', async () => {
    await mountWorkbench({ project: {} })
    dispatchCommand('focus.timeline')
    expect(activeRegion(), 'dispatchCommand("focus.timeline") focuses the region').toBe('timeline')
    dispatchCommand('focus.sidebar')
    expect(activeRegion()).toBe('sidebar')
  })

  test('CC-101.5: shortcuts never steal focus while the project-name inline edit has focus', async () => {
    await mountWorkbench({ project: {} })
    const nameInput = screen.getByTestId('project-name') as HTMLInputElement
    const user = userEvent.setup()
    await user.click(nameInput)
    expect(document.activeElement, 'the name input is focused (editing)').toBe(nameInput)

    await user.keyboard('{Alt>2}')
    expect(document.activeElement, 'Alt+2 is suppressed while editing (conventions § UI conventions)', ).toBe(nameInput)
  })

  test('CC-101.5: header and tab controls are natively tabbable (Tab order = visual order)', async () => {
    await mountWorkbench({ project: {} })
    for (const id of ['project-name', 'transcribe-button', 'export-button', 'tab-subtitles', 'tab-media', 'tab-style']) {
      const control = screen.getByTestId(id)
      const tabindex = control.getAttribute('tabindex')
      const tabbable = (control instanceof HTMLButtonElement || control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLAnchorElement) && tabindex !== '-1' || tabindex === '0'
      expect(tabbable, `${id} is reachable by Tab`).toBe(true)
    }
  })
})
