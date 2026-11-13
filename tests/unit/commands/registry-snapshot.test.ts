// CC-105.1 (L1, node): the registry snapshot equals the design-table —
// CI-enforced drift check (US-2.3.1). The oracle is the REAL
// .ai-dlc/knowledge/design.md § Keyboard shortcuts table parsed at test time
// (helpers/design-table.ts): every table row (except the two documented
// EXEMPTIONS — the editable-allowlist "Confirm/cancel edit" row and the
// non-keyboard "Ctrl + wheel" row, frozen with justification in
// unit105-api-contract.d.ts) maps to exact registry bindings
// (id/keys/when, frozen spellings of the unit-101/103/104 rows preserved —
// including the adjudicated Meta+ AND Ctrl+ zoom/merge/search-G spellings and
// the unit-104 Ctrl+G search chords), and every registered binding traces
// back to a table row. A new binding means a new row here FIRST.
// FR-105.6: getCommandCatalog() — JSON-serializable palette/docs data, one
// entry per unique command id, stable order, category ∈ five groups.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { DESIGN_ROW_CONTRACT, keyCellTokens, normalizeKeyCell, parseDesignShortcutRows } from './helpers/design-table'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

interface BindingRow {
  id: string
  keys: string
  when?: string
}

const designMarkdown = readFileSync(new URL('../../../.ai-dlc/knowledge/design.md', import.meta.url), 'utf8')

async function loadRegistry(): Promise<{
  getCommandBindings: () => readonly BindingRow[]
  getCommandCatalog: (() => readonly Record<string, unknown>[]) | undefined
}> {
  // Namespace import: the additive getCommandCatalog must not break the
  // module link before the builder ships it (helpers/seams.ts doctrine).
  const registry = (await import('@ui/commands/registry')) as unknown as {
    getCommandBindings: () => readonly BindingRow[]
    getCommandCatalog?: () => readonly Record<string, unknown>[]
  }
  return { getCommandBindings: registry.getCommandBindings, getCommandCatalog: registry.getCommandCatalog }
}

describe('CC-105.1: the design-table snapshot equals the registry (drift = CI fail)', () => {
  test('CC-105.1: design.md declares exactly the contract rows — the exemption list is EXACT', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const rows = parseDesignShortcutRows(designMarkdown)
    const tableActions = rows.map((row) => row.action).sort()
    const contractActions = DESIGN_ROW_CONTRACT.map((entry) => entry.action).sort()
    expect(tableActions, 'every design row has a contract entry and vice versa (new binding = new row first)').toEqual(contractActions)
    const exempt = DESIGN_ROW_CONTRACT.filter((entry) => entry.owner !== 'registry').map((entry) => entry.action)
    expect(exempt.sort(), 'exactly the two documented exemptions (editable allowlist + wheel)').toEqual(['Confirm/cancel edit', 'Timeline zoom (wheel/pinch)'])
    for (const entry of DESIGN_ROW_CONTRACT) {
      const row = rows.find((candidate) => candidate.action === entry.action)
      expect(row, `row "${entry.action}" exists`).toBeDefined()
      expect(keyCellTokens(row?.key ?? ''), `Key cell tokens of "${entry.action}" unchanged (prose may drift, chords may not)`).toEqual([...entry.tokens])
    }
  })

  test('CC-105.1: the Key cells normalize to exactly the contracted chords (parser ↔ table)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const rows = parseDesignShortcutRows(designMarkdown)
    for (const entry of DESIGN_ROW_CONTRACT) {
      if (entry.owner !== 'registry') continue
      const row = rows.find((candidate) => candidate.action === entry.action)
      const normalized = normalizeKeyCell(row?.key ?? '')
      const fromBindings = [...new Set(entry.bindings.map((binding) => binding.keys))].sort()
      expect(normalized, `normalized chords of "${entry.action}"`).toEqual(fromBindings)
    }
    // Held-letter chords per US-2.3.2 (unit-103 frozen ids) — explicit rows.
    const trimRow = rows.find((row) => row.action === 'Trim block start/end to playhead')
    expect(normalizeKeyCell(trimRow?.key ?? '')).toEqual(['C+ArrowLeft', 'C+ArrowRight', 'Z+ArrowLeft', 'Z+ArrowRight'])
  })

  test('CC-105.1: every design row (minus the exemption list) has its registry bindings with exact id/keys/when', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { getCommandBindings } = await loadRegistry()
    const rows = getCommandBindings()
    for (const entry of DESIGN_ROW_CONTRACT) {
      if (entry.owner !== 'registry') continue
      for (const binding of entry.bindings) {
        const row = rows.find((candidate) => candidate.id === binding.id && candidate.keys === binding.keys)
        expect(row, `binding ${binding.id} "${binding.keys}" (design row "${entry.action}")`).toBeDefined()
        expect(row?.when, `gate of ${binding.id} "${binding.keys}"`).toBe(binding.when)
      }
    }
  })

  test('CC-105.1: the currently-MISSING design rows exist (unit-105 RED core)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { getCommandBindings } = await loadRegistry()
    const rows = getCommandBindings()
    const required: Array<[string, string]> = [
      ['transport.seek-start', 'Meta+ArrowLeft'],
      ['transport.seek-start', 'Ctrl+ArrowLeft'],
      ['transport.seek-start', 'Home'],
      ['transport.seek-end', 'Meta+ArrowRight'],
      ['transport.seek-end', 'Ctrl+ArrowRight'],
      ['transport.seek-end', 'End'],
      ['timeline.delete', 'Delete'],
      ['timeline.delete', 'Backspace'],
      ['timeline.delete-close-gap', 'Shift+Delete'],
      ['transport.loop-clear', 'Shift+I'],
      ['transport.loop-clear', 'Shift+O'],
      ['transcript.select-all', 'Meta+A'],
      ['transcript.select-all', 'Ctrl+A'],
      ['transcript.deselect', 'Escape'],
      ['edit.undo', 'Meta+Z'],
      ['edit.undo', 'Ctrl+Z'],
      ['edit.redo', 'Meta+Shift+Z'],
      ['edit.redo', 'Ctrl+Shift+Z'],
      ['edit.redo', 'Meta+Y'],
      ['edit.redo', 'Ctrl+Y'],
      ['view.save-snapshot', 'Meta+S'],
      ['view.save-snapshot', 'Ctrl+S'],
      ['view.captions-toggle', 'Meta+\\'],
      ['view.captions-toggle', 'Ctrl+\\'],
      ['view.shortcuts-overlay', 'Meta+/'],
      ['view.shortcuts-overlay', 'Ctrl+/'],
      ['translate.cycle-view', 'Meta+Shift+L'],
      ['translate.cycle-view', 'Ctrl+Shift+L'],
      ['qc.next-issue', "Ctrl+'"],
      ['qc.previous-issue', "Ctrl+Shift+'"],
    ]
    for (const [id, keys] of required) {
      expect(rows.some((row) => row.id === id && row.keys === keys), `missing binding ${id} "${keys}"`).toBe(true)
    }
    // translate.cycle-view: the unit-302 handler is intentionally absent —
    // the registry's no-op-for-unmounted precedent governs; the BINDING is
    // what the table (and this suite) freezes.
  })

  test('CC-105.1: every registered binding traces to a design-table row (reverse check)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { getCommandBindings } = await loadRegistry()
    const contract = new Set<string>()
    for (const entry of DESIGN_ROW_CONTRACT) {
      for (const binding of entry.bindings) contract.add(`${binding.id}|${binding.keys}|${binding.when ?? ''}`)
    }
    for (const row of getCommandBindings()) {
      expect(contract.has(`${row.id}|${row.keys}|${row.when ?? ''}`), `binding ${row.id} "${row.keys}" (when: ${row.when ?? 'none'}) is not in the design table — add the row first`).toBe(true)
    }
  })
})

describe('FR-105.6: the registry exposes palette/docs JSON', () => {
  test('FR-105.6: getCommandCatalog is JSON-serializable, covers every id, stable order', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { getCommandBindings, getCommandCatalog } = await loadRegistry()
    if (typeof getCommandCatalog !== 'function') throw new Error('unit-105 RED seam: "getCommandCatalog" is not implemented yet')
    const catalog = getCommandCatalog()
    expect(JSON.parse(JSON.stringify(catalog)), 'JSON round-trip deep-equals the input').toEqual(catalog)
    expect(getCommandCatalog(), 'stable order across calls').toEqual(catalog)
    const bindings = getCommandBindings()
    const uniqueIds = [...new Set(bindings.map((row) => row.id))]
    expect(catalog.length, 'one entry per unique command id').toBe(uniqueIds.length)
    const categories = new Set(['Transport', 'Edit', 'Timeline', 'Transcript', 'View'])
    for (const entry of catalog) {
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.label, `label of ${String(entry.id)}`).toBe('string')
      expect((entry.label as string).length, `non-empty label of ${String(entry.id)}`).toBeGreaterThan(0)
      expect(Array.isArray(entry.keys), `keys of ${String(entry.id)}`).toBe(true)
      expect((entry.keys as readonly string[]).length, `keys of ${String(entry.id)}`).toBeGreaterThan(0)
      expect(categories.has(entry.category as string), `category of ${String(entry.id)}`).toBe(true)
      const id = entry.id as string
      const chords = [...new Set(bindings.filter((row) => row.id === id).map((row) => row.keys))].sort()
      expect([...(entry.keys as readonly string[])].sort(), `catalog keys of ${id}`).toEqual(chords)
    }
    expect([...new Set(catalog.map((entry) => entry.id))].sort(), 'catalog ids are the registered ids').toEqual([...uniqueIds].sort())
  })
})
