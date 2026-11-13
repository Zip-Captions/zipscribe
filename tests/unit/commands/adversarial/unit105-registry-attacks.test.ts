// unit-105 AUDIT — adversarial counterexample suite, registry + keyspec +
// platform (test-adversary, re-derived from FR-105.1/.2, the frozen
// unit105-api-contract.d.ts error contract and unit105-registry-augmentation.d.ts).
// ADDITIVE ONLY. Attacks: the DUPLICATE_BINDING edge cases the frozen
// conflict-detection suite leaves unpinned (different `when`, same (id,keys)
// with a changed gate, unknown-gate fail-open), dispatchCommand reentrancy and
// mid-dispatch unsubscribe, catalog stability across handler churn, the
// SECURITY-03 INVALID_SPEC message, post-resolution reserved evasion
// ('CmdOrCtrl+W' — the reserved check must run AFTER CmdOrCtrl resolution),
// case-variant evasion, and the detectPlatform/actualKeyLabel feature-detect
// branches (navigator absent, getLayoutMap throwing, map missing the code).
// Runtime surface via the frozen loadSeamModule doctrine (helpers/seams.ts,
// keyspec.test.ts precedent — the ambient contracts are the acceptance shape).
import { describe, expect, test, vi } from 'vitest'
import { loadSeamModule } from '../helpers/seams'
import type { CommandPlatform } from '@ui/commands/keyspec'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

interface BindingRow {
  id: string
  keys: string
  when?: string
}

interface RegistryModule {
  createRegistry(options?: { dev?: boolean }): {
    register(binding: BindingRow, options?: { scope?: 'global' | 'panel' }): void
    bindings(): readonly BindingRow[]
    resolve(keys: string, ctx?: { timelineFocused?: boolean; searchOpen?: boolean; editing?: boolean }): BindingRow | undefined
  }
  registerBinding(binding: BindingRow, options?: { dev?: boolean; scope?: 'global' | 'panel' }): void
  dispatchCommand(id: string): void
  getCommandBindings(): readonly BindingRow[]
  getCommandCatalog(): readonly { id: string; label: string; keys: readonly string[]; when?: string; category: string }[]
  registerCommandHandler(id: string, handler: () => void): () => void
}

interface KeyspecModule {
  parseKeySpec(spec: string, platform: CommandPlatform): unknown
  actualKeyLabel(codeToken: string): Promise<string>
  detectPlatform(): CommandPlatform
}

const loadRegistry = () => loadSeamModule<RegistryModule>('@ui/commands/registry')
const loadKeyspec = () => loadSeamModule<KeyspecModule>('@ui/commands/keyspec')

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code
}

function captureCode(fn: () => void): { code?: string; error?: unknown } {
  try {
    fn()
  } catch (error) {
    return { code: codeOf(error), error }
  }
  return {}
}

describe('AUDIT registry: conflict-detection edges the frozen suite does not pin', () => {
  test('CC-105.5 AUDIT: same chord, same scope, DIFFERENT gates still conflicts (frozen doctrine: same-scope duplicate keys conflict — coexistence is by scope)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { createRegistry } = await loadRegistry()
    const registry = createRegistry({ dev: true })
    registry.register({ id: 'probe.transport', keys: 'ArrowLeft', when: 'not-editing' }, { scope: 'global' })
    const second = captureCode(() => registry.register({ id: 'probe.timeline', keys: 'ArrowLeft', when: 'timeline-focused' }, { scope: 'global' }))
    expect(second.code, 'frozen d.ts: same-scope duplicate keys THROW regardless of the `when` spelling — the sanctioned coexistence for the ArrowLeft transport+timeline pair is panel-vs-global scope').toBe('DUPLICATE_BINDING')
    // The sanctioned spelling registers fine and the precedence resolves both ways.
    registry.register({ id: 'probe.timeline', keys: 'ArrowLeft', when: 'timeline-focused' }, { scope: 'panel' })
    expect(registry.bindings().length).toBe(2)
    expect(registry.resolve('ArrowLeft', { timelineFocused: true, editing: false })?.id, 'gated panel row wins while the gate is open').toBe('probe.timeline')
    expect(registry.resolve('ArrowLeft', { timelineFocused: false, editing: false })?.id, 'the global transport row wins otherwise').toBe('probe.transport')
  })

  test('CC-105.5 AUDIT: registerBinding (global seam) mirrors the same-scope conflict and allows cross-scope coexistence', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { registerBinding } = await loadRegistry()
    const base = { id: 'adversary.probe-a', keys: 'F9', when: 'not-editing' } as const
    expect(() => registerBinding(base, { dev: true })).not.toThrow()
    expect(captureCode(() => registerBinding({ id: 'adversary.probe-b', keys: 'F9', when: 'timeline-focused' }, { dev: true })).code, 'different id, different gate, same scope → conflict per the frozen registration contract').toBe('DUPLICATE_BINDING')
    expect(() => registerBinding({ id: 'adversary.probe-c', keys: 'F9', when: 'timeline-focused' }, { dev: true, scope: 'panel' })).not.toThrow()
  })

  test('CC-105.5 AUDIT: same (id, keys) with a CHANGED gate is still DUPLICATE_BINDING — `when` is not part of the dedup key', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { createRegistry } = await loadRegistry()
    const registry = createRegistry({ dev: true })
    registry.register({ id: 'probe.split', keys: 'S' })
    expect(captureCode(() => registry.register({ id: 'probe.split', keys: 'S', when: 'not-editing' })).code, 're-registering the same (id, keys) under a new gate is a duplicate').toBe('DUPLICATE_BINDING')
    expect(registry.bindings().length, 'the rejected registration left no trace').toBe(1)
  })

  test('CC-105.5 AUDIT (OBSERVATION pin): an unknown `when` value is fail-OPEN on both registration surfaces (measured) — createRegistry keeps the token and resolves it OPEN; registerBinding drops it to un-gated', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { createRegistry, registerBinding, getCommandBindings } = await loadRegistry()
    const registry = createRegistry({ dev: true })
    expect(() => registry.register({ id: 'probe.fail-open', keys: 'F8', when: 'not-a-real-gate' })).not.toThrow()
    expect(registry.bindings()[0]?.when, 'createRegistry stores the raw token (no WHEN_VALUES normalization)').toBe('not-a-real-gate')
    expect(registry.resolve('F8', { editing: true })?.id, 'gateOpen default-returns true for an unknown gate → resolves even while the would-be gate is closed (fail-open, reported as OBSERVATION — a typed rejection would be the fail-closed alternative)').toBe('probe.fail-open')
    registerBinding({ id: 'adversary.probe-d', keys: 'F11', when: 'not-a-real-gate' }, { dev: true })
    const row = getCommandBindings().find((binding) => binding.id === 'adversary.probe-d')
    expect(row?.when, 'the GLOBAL registerBinding path strips an unknown gate to undefined — an un-gated (always-live) row (fail-open, measured)').toBeUndefined()
  })

  test('CC-105.5 AUDIT: prod mode keeps registration ORDER as the deterministic tie-break for a same-scope same-chord duplicate', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { createRegistry } = await loadRegistry()
    const registry = createRegistry({ dev: false })
    registry.register({ id: 'probe.first', keys: 'F7' })
    registry.register({ id: 'probe.second', keys: 'F7' })
    expect(registry.resolve('F7')?.id, 'equal precedence → first registered wins (stable, no randomness)').toBe('probe.first')
  })

  test('CC-105.5 AUDIT: not-editing rows resolve to NOTHING while the editing context is open', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { createRegistry } = await loadRegistry()
    const registry = createRegistry({ dev: false })
    registry.register({ id: 'probe.gated', keys: 'F6', when: 'not-editing' })
    expect(registry.resolve('F6', { editing: true }), 'closed gate → nothing (not a fallback to an inert handler)').toBeUndefined()
    expect(registry.resolve('F6', { editing: false })?.id).toBe('probe.gated')
  })
})

describe('AUDIT registry: dispatchCommand reentrancy, mid-dispatch unsubscribe, catalog stability', () => {
  test('CC-105.1 AUDIT: a handler that dispatches another command runs both exactly once (reentrant dispatch is safe, not double-run)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { dispatchCommand, registerCommandHandler } = await loadRegistry()
    let toggles = 0
    let clears = 0
    const offToggle = registerCommandHandler('transport.loop-toggle', () => {
      toggles += 1
      dispatchCommand('transport.loop-clear')
    })
    const offClear = registerCommandHandler('transport.loop-clear', () => {
      clears += 1
    })
    try {
      dispatchCommand('transport.loop-toggle')
      expect(toggles, 'outer handler once').toBe(1)
      expect(clears, 'inner dispatch reached its handler once (no reentrancy lock swallowing it, no double-run)').toBe(1)
      dispatchCommand('transport.loop-toggle')
      expect(toggles).toBe(2)
      expect(clears, 'the nested dispatch does not accumulate across outer calls').toBe(2)
    } finally {
      offToggle()
      offClear()
    }
  })

  test('CC-105.1 AUDIT: a handler unsubscribing itself mid-dispatch takes effect from the NEXT dispatch on; a later handler must not revive the replaced one', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { dispatchCommand, registerCommandHandler } = await loadRegistry()
    let selfCalls = 0
    const offSelf = registerCommandHandler('view.captions-toggle', () => {
      selfCalls += 1
      offSelf()
    })
    dispatchCommand('view.captions-toggle')
    dispatchCommand('view.captions-toggle')
    expect(selfCalls, 'ran once, then its own unsubscribe took effect').toBe(1)
    expect(() => offSelf(), 'double-unsubscribe is safe (identity guard)').not.toThrow()

    let first = 0
    const offFirst = registerCommandHandler('view.captions-toggle', () => {
      first += 1
    })
    let second = 0
    const offSecond = registerCommandHandler('view.captions-toggle', () => {
      second += 1
    })
    try {
      dispatchCommand('view.captions-toggle')
      expect(second, 'last registration wins (Map replace, not a stack)').toBe(1)
      expect(first, 'the replaced handler is gone').toBe(0)
      offSecond()
      dispatchCommand('view.captions-toggle')
      expect(second, 'unsubscribing the CURRENT handler removes it').toBe(1)
      expect(first, 'the replaced handler stays gone (stale unsubscribe must not resurrect it)').toBe(0)
    } finally {
      offFirst()
    }
  })

  test('FR-105.6 AUDIT: getCommandCatalog is stable across handler mount/unmount — handlers never enter the palette JSON', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { getCommandCatalog, registerCommandHandler } = await loadRegistry()
    const before = JSON.stringify(getCommandCatalog())
    const off = registerCommandHandler('view.save-snapshot', () => undefined)
    registerCommandHandler('edit.undo', () => undefined)
    const after = JSON.stringify(getCommandCatalog())
    off()
    expect(after, 'registering/unregistering handlers never perturbs the catalog').toBe(before)
  })
})

describe('AUDIT keyspec: SECURITY-03 messages, reserved evasion, case variants', () => {
  test('CC-105.3 AUDIT: parseKeySpec("bogus garbage!!") fails with the CODE only — the input never echoes into message or stack (SECURITY-03)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await loadKeyspec()
    const { error } = captureCode(() => parseKeySpec('bogus garbage!!', 'mac'))
    expect(error, 'rejected').toBeInstanceOf(Error)
    const err = error as Error & { code?: string }
    expect(err.code, 'typed code').toBe('INVALID_SPEC')
    expect(err.message, 'message equals the code').toBe('INVALID_SPEC')
    expect(err.message, 'no echo of the input').not.toContain('bogus')
    expect(err.stack ?? '', 'the stack carries no echo either').not.toContain('garbage')
  })

  test('CC-105.3 AUDIT: reserved check runs AFTER CmdOrCtrl resolution — CmdOrCtrl+W is BROWSER_RESERVED on mac (post-resolution, not literal Meta+W only)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await loadKeyspec()
    expect(captureCode(() => parseKeySpec('CmdOrCtrl+W', 'mac')).code, 'CmdOrCtrl resolves to Meta on mac → the reserved set hits').toBe('BROWSER_RESERVED')
    expect(captureCode(() => parseKeySpec('Cmd+W', 'mac')).code, 'the Cmd spelling hits too').toBe('BROWSER_RESERVED')
    expect(captureCode(() => parseKeySpec('CmdOrCtrl+Q', 'mac')).code, '⌘Q via CmdOrCtrl').toBe('BROWSER_RESERVED')
    expect(captureCode(() => parseKeySpec('CmdOrCtrl+W', 'windows')).code, 'the frozen reserved set covers ⌘W/⌘T/⌘N/⌘Q + Ctrl+Tab only — Ctrl+W stays registrable (design.md list is the contract)').toBeUndefined()
  })

  test('CC-105.3 AUDIT: case variants never sneak past — "meta+w" does not resolve to a bindable Meta+W (measured: parser is case-SENSITIVE → INVALID_SPEC)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await loadKeyspec()
    const { code } = captureCode(() => parseKeySpec('meta+w', 'mac'))
    expect(code, 'lower-case "meta" is not the Meta modifier — rejected, and specifically NOT accepted as ⌘W').toBe('INVALID_SPEC')
    const shifted = captureCode(() => parseKeySpec('SHIFT+Meta+W', 'mac'))
    expect(shifted.code, 'the case-sensitivity is total: an upper-cased modifier is INVALID_SPEC too — a case-insensitive parser that silently resolved ⌘W would fail this pin').toBe('INVALID_SPEC')
    expect(captureCode(() => parseKeySpec('Meta+w', 'mac')).code, 'the BASE token is case-folded (single chars uppercase) — the reserved check sees the folded form').toBe('BROWSER_RESERVED')
  })

  test('CC-105.3 AUDIT: Ctrl+Tab is rejected on EVERY platform spelling (mac, windows, linux)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await loadKeyspec()
    for (const platform of ['mac', 'windows', 'linux'] as const) {
      expect(captureCode(() => parseKeySpec('Ctrl+Tab', platform)).code, `Ctrl+Tab rejected on ${platform}`).toBe('BROWSER_RESERVED')
    }
  })
})

describe('AUDIT platform: detectPlatform determinism + actualKeyLabel feature-detection branches', () => {
  test('US-2.3.1 AUDIT: detectPlatform with no navigator (node) is the deterministic windows default; mac is detected from userAgentData.platform and navigator.platform', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { detectPlatform } = await loadKeyspec()
    try {
      vi.stubGlobal('navigator', undefined)
      expect(detectPlatform(), 'absent navigator → the windows/Ctrl side is the deterministic default').toBe('windows')
      vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, platform: 'Brave', userAgent: 'brave' })
      expect(detectPlatform(), 'userAgentData.platform wins').toBe('mac')
      vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'safari-ish' })
      expect(detectPlatform(), 'navigator.platform fallback').toBe('mac')
      vi.stubGlobal('navigator', { userAgent: 'X11; Linux x86_64' })
      expect(detectPlatform(), 'linux user-agent → the shared Ctrl side').toBe('windows')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('FR-105.2 AUDIT: actualKeyLabel — absent getLayoutMap, THROWING getLayoutMap, and a map missing the code all fall back deterministically; a present mapping is honored', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { actualKeyLabel } = await loadKeyspec()
    try {
      vi.stubGlobal('navigator', undefined)
      expect(await actualKeyLabel('KeyS'), 'no navigator → KeyS → S').toBe('S')
      expect(await actualKeyLabel('Digit5')).toBe('5')
      expect(await actualKeyLabel('Slash')).toBe('/')
      expect(await actualKeyLabel('Space'), 'named token falls back to itself').toBe(' ')
      expect(await actualKeyLabel('NoSuchToken'), 'unknown token falls back to the raw token').toBe('NoSuchToken')

      let called = 0
      vi.stubGlobal('navigator', {
        keyboard: {
          getLayoutMap: () => {
            called += 1
            return Promise.reject(new Error('PERMISSION_DENIED'))
          },
        },
      })
      expect(await actualKeyLabel('KeyS'), 'REJECTING getLayoutMap → deterministic fallback (feature-detect must catch)').toBe('S')
      expect(called, 'the layout map was actually consulted').toBe(1)

      vi.stubGlobal('navigator', {
        keyboard: {
          getLayoutMap: () => {
            throw new Error('boom')
          },
        },
      })
      expect(await actualKeyLabel('KeyS'), 'SYNCHRONOUSLY throwing getLayoutMap → fallback (catch wraps the call)').toBe('S')

      vi.stubGlobal('navigator', { keyboard: { getLayoutMap: async () => ({ get: () => null }) } })
      expect(await actualKeyLabel('KeyS'), 'map without the code → fallback').toBe('S')

      vi.stubGlobal('navigator', { keyboard: { getLayoutMap: async () => ({ get: (code: string) => (code === 'KeyS' ? 'š' : null) }) } })
      expect(await actualKeyLabel('KeyS'), 'a present mapping is honored (FR-105.2 layout label)').toBe('š')
      expect(await actualKeyLabel('KeyZ'), 'unmapped code falls back').toBe('Z')

      vi.stubGlobal('navigator', { keyboard: {} })
      expect(await actualKeyLabel('KeyS'), 'keyboard present but NO getLayoutMap → fallback (feature-detect)').toBe('S')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('CC-105.3 AUDIT: every frozen-table chord parses on every platform without throwing (registration surface sanity, one platform-independent sweep)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { getCommandCatalog } = await loadRegistry()
    const { parseKeySpec } = await loadKeyspec()
    const catalog = getCommandCatalog()
    expect(catalog.length, 'non-vacuous sweep').toBeGreaterThan(40)
    for (const platform of ['mac', 'windows', 'linux'] as const) {
      for (const entry of catalog) {
        for (const keys of entry.keys) {
          expect(() => parseKeySpec(keys, platform), `${entry.id} "${keys}" parses on ${platform}`).not.toThrow()
        }
      }
    }
  })
})
