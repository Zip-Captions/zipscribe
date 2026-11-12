// CC-104.4 / FR-104.5 / FR-104.8 (L1): the frozen registry EXTENDS binding
// table for the transcript (src/state/CONTRACT.md § binding EXTENSION,
// unit104-api-contract.d.ts header — ids/chords/gates byte-exact; unit-103
// EXTENDS precedent; unit-105 owns the full-table snapshot).
// RED: `getCommandBindings()` does not contain the transcript rows yet.
import { describe, expect, test } from 'vitest'
import { getCommandBindings } from '@ui/commands/registry'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

// Local cast: the registry's `when` union EXTENDS additively per unit
// (unit-103 added 'timeline-focused'; unit-104 adds 'search-open').
type BindingRow = { id: string; keys: string; when?: string }

describe('unit-104 registry EXTENDS (frozen binding table)', () => {
  test('FR-104.5: transcript.search-open + search.next/previous rows with exact chords and gates', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const rows = getCommandBindings() as readonly BindingRow[]
    const expected: Array<[string, string, string | undefined]> = [
      ['transcript.search-open', 'Meta+F', 'not-editing'],
      ['transcript.search-open', 'Ctrl+F', 'not-editing'],
      ['search.next', 'F3', 'search-open'],
      ['search.next', 'Meta+G', 'search-open'],
      ['search.next', 'Ctrl+G', 'search-open'],
      ['search.previous', 'Shift+F3', 'search-open'],
      ['search.previous', 'Meta+Shift+G', 'search-open'],
      ['search.previous', 'Ctrl+Shift+G', 'search-open'],
    ]
    for (const [id, keys, when] of expected) {
      const row = rows.find((r) => r.id === id && r.keys === keys)
      expect(row, `binding ${id} ${keys}`).toBeDefined()
      expect(row?.when, `gate for ${id} ${keys}`).toBe(when)
    }
  })

  test('FR-104.8: qc.next-issue / qc.previous-issue rows ("Meta+\'" / "Meta+Shift+\'") gated not-editing', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const rows = getCommandBindings() as readonly BindingRow[]
    const expected: Array<[string, string, string | undefined]> = [
      ['qc.next-issue', "Meta+'", 'not-editing'],
      ['qc.previous-issue', "Meta+Shift+'", 'not-editing'],
    ]
    for (const [id, keys, when] of expected) {
      const row = rows.find((r) => r.id === id && r.keys === keys)
      expect(row, `binding ${id} ${keys}`).toBeDefined()
      expect(row?.when, `gate for ${id} ${keys}`).toBe(when)
    }
  })
})
