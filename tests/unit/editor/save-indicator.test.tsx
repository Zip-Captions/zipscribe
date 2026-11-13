// CC-106.1 (L2, jsdom): the save-state indicator — the unit-106 EXTENDS of
// the unit-101 StatusBar (`src/ui/shell/Workbench.tsx`). Seam pinned in
// unit106-api-contract.d.ts: `SaveStateIndicator({ persistence:
// SaveStateSource })` renders `<span data-testid="save-state"
// aria-live="polite">` with the EXACT copy `saved` | `saving…` | `not saved`
// | `unsaved changes`, inside the unit-101 `data-testid="status-bar"` footer.
// The persistent-failure rule (CC-I2.12 backing): once `not saved`, it STAYS
// `not saved` through further dirty/saving transitions until a later
// successful save. `idle` renders neither pinned copy (nothing to claim).
// The component reaches Workbench via a dynamic import — RED while the
// builder has not added the `SaveStateIndicator` export / the status-bar
// wiring (missing export / assertion failures are the intended RED; the
// suite self-skips under the gates-scaffold child run).
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import type { SaveState } from '@state/services/persistence'
import type { SaveStateSource } from '@ui/shell/Workbench'

const WORKBENCH_MODULE = '@ui/shell/Workbench'
type WorkbenchModule = typeof import('@ui/shell/Workbench')

function makeSource(initial: SaveState): { source: SaveStateSource; set: (next: Partial<SaveState>) => void; listenerCount(): number } {
  let state = { ...initial }
  const listeners = new Set<() => void>()
  return {
    source: {
      getSaveState: () => state,
      subscribeSaveState: (cb: () => void) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    },
    set: (next: Partial<SaveState>) => {
      state = { ...state, ...next }
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}

async function mount(source: SaveStateSource): Promise<void> {
  const mod = (await import(/* @vite-ignore */ WORKBENCH_MODULE)) as unknown as WorkbenchModule
  await act(async () => {
    render(<mod.SaveStateIndicator persistence={source} />)
  })
}

function indicatorText(): string {
  return screen.getByTestId('save-state').textContent ?? ''
}

let redaction: ReturnType<typeof createRedactionSpy>
afterEach(() => {
  cleanup()
  const verdict = redaction.settle()
  redaction.restore()
  expect(verdict.leaks, 'no canary content reached any console channel').toEqual([])
})

describe('CC-106.1 (L2): the save-state indicator in the status bar', () => {
  test('CC-106.1: renders the pinned span contract (testid + polite live region)', async () => {
    redaction = createRedactionSpy()
    const { source } = makeSource({ state: 'idle', lastSavedAt: null, errorCode: null })
    await mount(source)
    const span = screen.getByTestId('save-state')
    expect(span.tagName, 'a <span>, as pinned').toBe('SPAN')
    expect(span.getAttribute('aria-live'), 'screen-reader announcements are polite').toBe('polite')
    expect(['', 'idle'], 'idle claims nothing from the pinned copy set').toContain(indicatorText())
  })

  test('CC-106.1: each save state renders its EXACT copy', async () => {
    redaction = createRedactionSpy()
    const { source, set } = makeSource({ state: 'idle', lastSavedAt: null, errorCode: null })
    await mount(source)

    await act(async () => set({ state: 'dirty' }))
    expect(indicatorText()).toBe('unsaved changes')
    await act(async () => set({ state: 'saving' }))
    expect(indicatorText()).toBe('saving…')
    await act(async () => set({ state: 'saved', lastSavedAt: 1_730_000_000_000 }))
    expect(indicatorText()).toBe('saved')
    await act(async () => set({ state: 'not-saved', lastSavedAt: null, errorCode: 'QUOTA_EXCEEDED' }))
    expect(indicatorText()).toBe('not saved')
  })

  test('CC-106.1 (CC-I2.12 backing): `not saved` persists through re-dirty/re-saving until a later save succeeds', async () => {
    redaction = createRedactionSpy()
    const { source, set } = makeSource({ state: 'idle', lastSavedAt: null, errorCode: null })
    await mount(source)

    await act(async () => set({ state: 'not-saved', errorCode: 'DB_WRITE_FAILED' }))
    expect(indicatorText()).toBe('not saved')
    await act(async () => set({ state: 'dirty' }))
    expect(indicatorText(), 'further edits must NOT hide the failure').toBe('not saved')
    await act(async () => set({ state: 'saving' }))
    expect(indicatorText(), 'a retry in flight must NOT masquerade as progress').toBe('not saved')
    await act(async () => set({ state: 'saved', lastSavedAt: 1_730_000_000_000, errorCode: null }))
    expect(indicatorText(), 'the first success clears it').toBe('saved')
  })

  test('CC-106.1: the indicator re-renders from the subscription and unsubscribes on unmount', async () => {
    redaction = createRedactionSpy()
    const { source, set, listenerCount } = makeSource({ state: 'idle', lastSavedAt: null, errorCode: null })
    expect(listenerCount(), 'not subscribed before mount').toBe(0)
    await mount(source)
    expect(listenerCount(), 'subscribed exactly once').toBe(1)
    await act(async () => set({ state: 'saving' }))
    expect(indicatorText(), 'a listener push re-renders without any manual act from the app').toBe('saving…')
    cleanup()
    expect(listenerCount(), 'unmount releases the subscription (no leak per panel remount)').toBe(0)
  })

  test('CC-106.1: the status bar mounts the indicator (unit-101 footer EXTENDS)', async () => {
    redaction = createRedactionSpy()
    // [106-ADJ 4] orchestrator environment fix (slice-B Test finding 1): the
    // jsdom environment gives a non-file `import.meta.url`, so the URL-base
    // read throws ERR_INVALID_URL_SCHEME — same documented pitfall as
    // tests/unit/transcript/editing.test.tsx § cwd-relative note. Assertions
    // unchanged.
    const workbench = readFileSync(join(process.cwd(), 'src/ui/shell/Workbench.tsx'), 'utf8')
    expect(workbench, 'the unit-101 status-bar testid survives the EXTENDS').toContain('data-testid="status-bar"')
    expect(workbench, 'the footer renders the unit-106 save-state indicator').toContain('SaveStateIndicator')
    expect(workbench, 'the indicator span carries the polite live region').toContain('aria-live="polite"')
  })
})
