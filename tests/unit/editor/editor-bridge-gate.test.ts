// SECURITY gate (slice C self-attack, FR-2.0.6 bridge doctrine): the editor
// bridge must be invisible outside the STRICT `?ziptest=1` path — (1) no
// self-install on import, (2) install without a booted app context throws
// (no stray global), (3) App.tsx wires BOTH bridges only behind the strict
// `get('ziptest') === '1'` check (exact string equality — `?ziptest=0`,
// `?ziptest=true` never install; the runtime half of that pin is the L5
// e2e/editor/bridge-gate.spec.ts).
// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../helpers/repo'

function w(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>
}

// Non-literal specifier: keeps the tsc `node` program (types: node, no
// vite/client) from type-resolving context.ts → worker-registry's `?worker`
// imports. vitest's alias resolves it at runtime (the module itself is
// runtime-safe under jsdom — nothing is constructed at import time).
const BRIDGE_MODULE = ['@ui', 'testing', 'editor-bridge'].join('/')

async function loadBridge(): Promise<{ installEditorBridge(): void }> {
  return (await import(BRIDGE_MODULE)) as { installEditorBridge(): void }
}

describe('SECURITY-03/FR-2.0.6: the editor bridge never exposes itself', () => {
  test('bridge gate: importing the module installs NOTHING (no self-install on import)', async () => {
    await loadBridge()
    expect(w().__zipEditorBridge, 'module import must not touch window').toBeUndefined()
  })

  test('bridge gate: install before the app booted throws — no stray global survives', async () => {
    const { installEditorBridge } = await loadBridge()
    expect(() => installEditorBridge()).toThrow(/app context not created/u)
    expect(w().__zipEditorBridge).toBeUndefined()
  })

  test('bridge gate: the module assigns the global exactly once, inside the install function', () => {
    const source = readFileSync(join(REPO_ROOT, 'src', 'ui', 'testing', 'editor-bridge.ts'), 'utf8')
    expect(source.match(/__zipEditorBridge\s*=/gu)?.length, 'one assignment site').toBe(1)
    const installAt = source.indexOf('export function installEditorBridge')
    const assignAt = source.indexOf('__zipEditorBridge =')
    expect(assignAt, 'the assignment lives inside installEditorBridge').toBeGreaterThan(installAt)
  })

  test('bridge gate: App.tsx installs both bridges ONLY behind the strict ziptest === \'1\' check', () => {
    const source = readFileSync(join(REPO_ROOT, 'src', 'App.tsx'), 'utf8')
    const strictGate = source.indexOf(`get('ziptest') === '1'`)
    expect(strictGate, 'the STRICT equality gate exists (no includes/truthiness)').toBeGreaterThan(-1)
    expect(source.match(/installWorkbenchBridge\(\)/gu)?.length).toBe(1)
    expect(source.match(/installEditorBridge\(\)/gu)?.length).toBe(1)
    expect(source.indexOf('installWorkbenchBridge()'), 'workbench install is inside the gated block').toBeGreaterThan(strictGate)
    expect(source.indexOf('installEditorBridge()'), 'editor install is inside the gated block').toBeGreaterThan(strictGate)
  })
})
