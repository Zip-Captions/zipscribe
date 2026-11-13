// CC-105.4 (L2, jsdom): the ⌘/ shortcuts overlay (FR-105.4) — opened through
// the DOM seam (⌘/ keydown, the way keyboard.test.tsx drives keys) on the
// mounted shell; component seam '@ui/commands/ShortcutsOverlay' frozen in
// unit105-api-contract.d.ts (testids: shortcuts-overlay / shortcuts-filter /
// shortcuts-row + data-command-id). Assertions: role=dialog + aria-modal,
// focus trapped (Tab/Shift+Tab cycle inside), Esc closes AND restores focus
// to the opener, live filter narrows by LABEL and by KEY TOKEN, grouped under
// the five category headings, platform glyphs (mac → ⌘, windows → Ctrl text),
// and the COUNT assertion: one row per registered command id (minus the
// editable-owned exemptions — those never enter the registry, so the registry
// unique-id count is the oracle).
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { mountWorkbench } from '../workbench/helpers/mount'
import { loadSeamModule } from './helpers/seams'
import type { ReactElement } from 'react'
import type { ShortcutsOverlayProps } from '@ui/commands/ShortcutsOverlay'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

interface BindingRow {
  id: string
  keys: string
  when?: string
}

async function loadRegistry(): Promise<{ getCommandBindings: () => readonly BindingRow[] }> {
  const registry = (await import('@ui/commands/registry')) as unknown as { getCommandBindings: () => readonly BindingRow[] }
  return { getCommandBindings: registry.getCommandBindings }
}

async function loadOverlay(): Promise<(props: ShortcutsOverlayProps) => ReactElement> {
  const mod = await loadSeamModule<typeof import('@ui/commands/ShortcutsOverlay')>('@ui/commands/ShortcutsOverlay')
  return mod.ShortcutsOverlay
}

function pressKey(init: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }): void {
  act(() => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

async function mountShell(): Promise<void> {
  await mountWorkbench({ project: {} })
  const active = document.activeElement as HTMLElement | null
  active?.blur()
}

afterEach(cleanup)

describe('CC-105.4: the ⌘/ overlay — dialog semantics', () => {
  test('CC-105.4: ⌘/ opens the overlay as a modal dialog', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    await mountShell()
    pressKey({ key: '/', metaKey: true })
    const dialog = screen.getByRole('dialog')
    expect(dialog, 'the overlay is a dialog').toBeInTheDocument()
    expect(dialog.getAttribute('aria-modal'), 'aria-modal per FR-105.4').toBe('true')
    expect(dialog, 'frozen testid').toHaveAttribute('data-testid', 'shortcuts-overlay')
  })

  test('CC-105.4: Ctrl+/ opens it too (Windows spelling)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    await mountShell()
    pressKey({ key: '/', ctrlKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('CC-105.4: focus is trapped — Tab and Shift+Tab cycle inside the dialog', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    await mountShell()
    pressKey({ key: '/', metaKey: true })
    const dialog = screen.getByRole('dialog')
    for (const shiftKey of [false, true]) {
      for (let i = 0; i < 12; i++) {
        const target = (document.activeElement ?? dialog) as HTMLElement
        act(() => {
          target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }))
        })
        const active = document.activeElement as HTMLElement | null
        expect(active, `Tab${shiftKey ? '+Shift' : ''} #${String(i)} keeps focus inside the overlay`).not.toBeNull()
        expect(dialog.contains(active as Node), `focus stays trapped on Tab${shiftKey ? '+Shift' : ''} #${String(i)}`).toBe(true)
      }
    }
  })

  test('CC-105.4: Esc closes the overlay and restores focus to the opener', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    await mountShell()
    const opener = screen.getByTestId('transcribe-button') as HTMLElement
    act(() => {
      opener.focus()
    })
    pressKey({ key: '/', metaKey: true })
    expect(screen.getByRole('dialog'), 'opened').toBeInTheDocument()
    pressKey({ key: 'Escape' })
    expect(screen.queryByRole('dialog'), 'Esc closes').toBeNull()
    expect(document.activeElement, 'focus returns to the opener').toBe(opener)
  })
})

describe('CC-105.4: the ⌘/ overlay — filter, grouping, glyphs, coverage', () => {
  test('CC-105.4: the live filter narrows rows by label AND by key token', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    await mountShell()
    pressKey({ key: '/', metaKey: true })
    const filter = screen.getByTestId('shortcuts-filter') as HTMLInputElement
    // By key token: only Play/pause carries 'Space'.
    fireEvent.change(filter, { target: { value: 'space' } })
    const byKey = screen.getAllByTestId('shortcuts-row')
    expect(byKey.map((row) => row.getAttribute('data-command-id')), 'filter "space" keeps the Space binding (key token match)').toContain('transport.play-pause')
    expect(byKey.length, 'exactly the one Space command survives the key-token filter').toBe(1)
    // By label: "zoom" appears in the zoom command labels.
    fireEvent.change(filter, { target: { value: 'zoom' } })
    const byLabel = screen.getAllByTestId('shortcuts-row')
    expect(byLabel.length, 'zoom commands match by label').toBeGreaterThanOrEqual(3)
    // No match → zero rows.
    fireEvent.change(filter, { target: { value: 'qqzz-no-such-command' } })
    // Orchestrator adjudication (CC-105.4, frozen-test defect amendment): RTL getAllBy* throws on an empty match set, so it can never assert a zero count; queryAllBy* is the zero-count spelling (same fix as the unit-104 getAllBy-empty amendment; precedent: search-ui.test.tsx, unit104-adversarial.test.tsx).
    expect(screen.queryAllByTestId('shortcuts-row').length, 'nonsense filter matches nothing').toBe(0)
  })

  test('CC-105.4: rows are grouped under the five category headings', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    await mountShell()
    pressKey({ key: '/', metaKey: true })
    for (const category of ['Transport', 'Edit', 'Timeline', 'Transcript', 'View']) {
      expect(screen.getByRole('heading', { name: category }), `${category} heading`).toBeInTheDocument()
    }
    const rows = screen.getAllByTestId('shortcuts-row')
    for (const row of rows) {
      const group = row.closest('[data-category]') ?? row.parentElement
      expect(group, 'every row renders inside a group').not.toBeNull()
    }
  })

  test('CC-105.4: platform glyphs — mac mount shows ⌘, windows mount shows Ctrl text', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const ShortcutsOverlay = await loadOverlay()
    const { getCommandBindings } = await loadRegistry()
    void getCommandBindings
    const mac = render(<ShortcutsOverlay platform="mac" />)
    expect(mac.container.textContent, 'mac renders the ⌘ glyph').toContain('⌘')
    mac.unmount()
    const win = render(<ShortcutsOverlay platform="windows" />)
    expect(win.container.textContent, 'windows renders Ctrl text').toContain('Ctrl')
    expect(win.container.textContent, 'windows does not render ⌘').not.toContain('⌘')
    win.unmount()
  })

  test('CC-105.4: COUNT assertion — one row per registered command id; every row shows its label', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const ShortcutsOverlay = await loadOverlay()
    const { getCommandBindings } = await loadRegistry()
    const uniqueIds = [...new Set(getCommandBindings().map((row) => row.id))]
    const { container } = render(<ShortcutsOverlay platform="mac" />)
    const rows = container.querySelectorAll('[data-testid="shortcuts-row"]')
    expect(rows.length, 'rendered rows == unique registered command ids (editable-owned commands are never registered — the exemption is by construction)').toBe(uniqueIds.length)
    const rendered = new Set([...rows].map((row) => row.getAttribute('data-command-id')))
    for (const id of uniqueIds) {
      expect(rendered.has(id), `row for ${id}`).toBe(true)
    }
    for (const row of rows) {
      expect((row.textContent ?? '').trim().length, `row ${String(row.getAttribute('data-command-id'))} shows its label`).toBeGreaterThan(0)
    }
  })
})
