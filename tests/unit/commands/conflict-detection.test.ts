// CC-105.5 (L1, node): registration-time conflict detection (FR-105.1).
// Frozen seams (unit105-api-contract.d.ts § registry augmentation):
// createRegistry({ dev }) — isolated instance, no global-registry mutation —
// and registerBinding(binding, { dev, scope }) on the real registry. Dev mode
// THROWS code 'DUPLICATE_BINDING' on a duplicate (id, keys) and on a
// same-scope duplicate keys; browser-reserved chords always throw code
// 'BROWSER_RESERVED' (design.md: never bind them); prod mode registers and
// resolves precedence focused-panel scope > global — the pure resolver shows
// the timeline-focused ArrowLeft winning over the transport step while the
// timeline region is focused, and the transport step winning otherwise.
import { describe, expect, test } from 'vitest'
import * as registryModule from '@ui/commands/registry'
import { requireSeamApi } from './helpers/seams'
import type { CommandRegistry, CreateRegistryOptions, RegisterBindingOptions } from '@ui/commands/registry'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

type Binding = { id: string; keys: string; when?: string }

function getCreateRegistry(): (options?: CreateRegistryOptions) => CommandRegistry {
  return requireSeamApi(registryModule.createRegistry as ((options?: CreateRegistryOptions) => CommandRegistry) | undefined, 'createRegistry')
}

function getRegisterBinding(): (binding: Binding, options?: RegisterBindingOptions) => void {
  return requireSeamApi(registryModule.registerBinding as ((binding: Binding, options?: RegisterBindingOptions) => void) | undefined, 'registerBinding')
}

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code
}

function captureCode(fn: () => void): string | undefined {
  try {
    fn()
  } catch (error) {
    return codeOf(error)
  }
  return undefined
}

function transportRows(): Binding[] {
  return [
    { id: 'transport.step-backward', keys: 'ArrowLeft', when: 'not-editing' },
    { id: 'timeline.focus-prev', keys: 'ArrowLeft', when: 'timeline-focused' },
  ]
}

describe('CC-105.5: dev-mode conflict detection', () => {
  test('CC-105.5: dev registration of a duplicate (id, keys) THROWS code DUPLICATE_BINDING', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const createRegistry = getCreateRegistry()
    const registry = createRegistry({ dev: true })
    registry.register({ id: 'x.split', keys: 'S' })
    expect(captureCode(() => registry.register({ id: 'x.split', keys: 'S' })), 'same id + same keys rejected in dev').toBe('DUPLICATE_BINDING')
  })

  test('CC-105.5: dev registration of a same-scope duplicate keys (different id) THROWS DUPLICATE_BINDING', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const createRegistry = getCreateRegistry()
    const registry = createRegistry({ dev: true })
    registry.register({ id: 'a.one', keys: 'F9' }, { scope: 'global' })
    expect(captureCode(() => registry.register({ id: 'b.two', keys: 'F9' }, { scope: 'global' })), 'same chord, same scope, different id rejected in dev').toBe('DUPLICATE_BINDING')
    // Different scope is the sanctioned coexistence (gated panel vs global).
    registry.register({ id: 'c.panel', keys: 'F9' }, { scope: 'panel' })
    expect(registry.bindings().length, 'cross-scope coexistence registers fine').toBe(2)
  })

  test('CC-105.5: registering a browser-reserved chord throws BROWSER_RESERVED (dev)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const createRegistry = getCreateRegistry()
    const registry = createRegistry({ dev: true })
    for (const spec of ['Meta+W', 'Meta+T', 'Meta+N', 'Meta+Q', 'Ctrl+Tab']) {
      expect(captureCode(() => registry.register({ id: `r.${spec}`, keys: spec })), `${spec} cannot be bound (design.md rules)`).toBe('BROWSER_RESERVED')
    }
  })

  test('CC-105.5: registerBinding (global seam) rejects reserved chords with the typed code', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const registerBinding = getRegisterBinding()
    expect(captureCode(() => registerBinding({ id: 'r.w', keys: 'Meta+W' }, { dev: true }))).toBe('BROWSER_RESERVED')
  })

  test('CC-105.5: prod mode does NOT throw on same-chord different-id (precedence, not error)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const createRegistry = getCreateRegistry()
    const registry = createRegistry({ dev: false })
    expect(() => {
      registry.register({ id: 'a.one', keys: 'F9' })
      registry.register({ id: 'b.two', keys: 'F9' })
    }, 'prod resolves by precedence — registration itself never throws').not.toThrow()
  })
})

describe('CC-105.5: prod precedence — focused-panel scope > global', () => {
  test('CC-105.5: timeline-focused ArrowLeft wins over the transport step while the region is focused', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const createRegistry = getCreateRegistry()
    const registry = createRegistry({ dev: false })
    for (const row of transportRows()) {
      registry.register(row, { scope: row.when === 'timeline-focused' ? 'panel' : 'global' })
    }
    const focused = registry.resolve('ArrowLeft', { timelineFocused: true, editing: false })
    expect(focused?.id, 'focused-panel scope wins while the timeline region has focus').toBe('timeline.focus-prev')
    const unfocused = registry.resolve('ArrowLeft', { timelineFocused: false, editing: false })
    expect(unfocused?.id, 'without the gate open, the global transport step wins').toBe('transport.step-backward')
  })

  test('CC-105.5: gated bindings are skipped while their gate is closed', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const createRegistry = getCreateRegistry()
    const registry = createRegistry({ dev: false })
    registry.register({ id: 'search.next', keys: 'F3', when: 'search-open' }, { scope: 'panel' })
    expect(registry.resolve('F3', { searchOpen: false }), 'closed gate → nothing').toBeUndefined()
    expect(registry.resolve('F3', { searchOpen: true })?.id).toBe('search.next')
  })

  test('CC-105.5: unknown chords resolve to nothing', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const createRegistry = getCreateRegistry()
    const registry = createRegistry({ dev: false })
    for (const row of transportRows()) registry.register(row)
    expect(registry.resolve('F8'), 'unbound chord hits nothing').toBeUndefined()
  })
})
