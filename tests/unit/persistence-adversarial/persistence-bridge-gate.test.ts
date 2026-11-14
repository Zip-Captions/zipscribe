// ADVERSARY (unit-106): the persistence bridge must be invisible outside the
// STRICT `?ziptest=1` path (FR-2.0.6 doctrine, editor-bridge-gate precedent)
// and its dep-setters must be unreachable from production code. Pins, as AUDIT
// tests: (1) no self-install on import, (2) install before a booted app
// context throws with no stray global, (3) App.tsx calls installPersistenceBridge
// exactly once, only inside the strict `get('ziptest') === '1'` gate, (4) the
// probe/estimate/persist dep reassignments and the setProbeResult/setPersisted/
// seedMediaHandle surface exist ONLY in the bridge module, (5) the bridge's
// handleLike seeding keeps the pinned DataCloneError honesty at the service
// boundary: a function-bearing (non-cloneable) handle persists FINGERPRINT-ONLY
// while staying session-visible — no throw.
// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../helpers/repo'
import { createPersistenceService } from '@state/services/persistence'
import { cannedFingerprint, createFakePersistenceDeps, rawRow } from '../editor/helpers/fake-persistence'

function w(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>
}

// Non-literal specifier (editor-bridge-gate precedent): keeps the tsc `node`
// program from type-resolving context.ts → worker-registry's `?worker`
// imports; vitest's alias resolves it at runtime.
const BRIDGE_MODULE = ['@ui', 'testing', 'persistence-bridge'].join('/')

async function loadBridge(): Promise<{ installPersistenceBridge(): void }> {
  return (await import(BRIDGE_MODULE)) as { installPersistenceBridge(): void }
}

function src(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8')
}

describe('AUDIT-106 bridge gate (FR-2.0.6 / SECURITY-03): the persistence bridge never exposes itself', () => {
  test('AUDIT-106.30: importing the module installs NOTHING on window', async () => {
    await loadBridge()
    expect(w().__zipPersistenceBridge, 'module import must not touch window').toBeUndefined()
  })

  test('AUDIT-106.31: install before the app booted throws — no stray global survives', async () => {
    const { installPersistenceBridge } = await loadBridge()
    expect(() => installPersistenceBridge()).toThrow(/app context not created/u)
    expect(w().__zipPersistenceBridge).toBeUndefined()
  })

  test('AUDIT-106.32: App.tsx installs it ONLY behind the strict ziptest === "1" gate (one call site, after the gate)', () => {
    const app = src('src/App.tsx')
    const strictGate = app.indexOf(`get('ziptest') === '1'`)
    expect(strictGate, 'the STRICT equality gate exists (no includes/truthiness)').toBeGreaterThan(-1)
    expect(app.match(/installPersistenceBridge\(\)/gu)?.length, 'exactly one install call').toBe(1)
    expect(app.indexOf('installPersistenceBridge()'), 'the install lives inside the gated block').toBeGreaterThan(strictGate)
    expect(app.match(/persistence-bridge/gu)?.length, 'the lazy import appears once').toBe(1)
    expect(app.indexOf('persistence-bridge'), 'the import is gated too').toBeGreaterThan(strictGate)
  })

  test('AUDIT-106.33: the dep-swap setters exist ONLY inside the bridge module — production paths cannot reach setProbeResult/setEstimate/setPersisted', () => {
    const bridge = src('src/ui/testing/persistence-bridge.ts')
    for (const surface of ['setProbeResult', 'setEstimate', 'setPersisted', 'seedMediaHandle']) {
      expect(bridge, `the bridge exposes ${surface}`).toContain(surface)
      expect(bridge.match(/__zipPersistenceBridge\s*=/gu)?.length, 'the global is assigned exactly once, inside install').toBe(1)
    }
    const productionFiles = ['src/app/context.ts', 'src/state/services/persistence.ts', 'src/ui/shell/ProjectList.tsx', 'src/ui/shell/Workbench.tsx', 'src/App.tsx'] as const
    for (const file of productionFiles) {
      const source = src(file)
      expect(source, `${file} must not reassign the LIVE persistence deps`).not.toMatch(/deps\.(probeFingerprint|estimateStorage|requestPersist)\s*=/u)
      expect(source, `${file} must not reference the bridge-only setProbeResult surface`).not.toContain('setProbeResult')
      expect(source, `${file} must not reference the bridge-only setPersisted surface`).not.toContain('setPersisted')
      expect(source, `${file} must not seed handles`).not.toContain('seedMediaHandle')
    }
  })

  test('AUDIT-106.34: a bridge-style non-cloneable handleLike persists FINGERPRINT-ONLY (DataCloneError honest) and stays session-visible', async () => {
    const bundle = createFakePersistenceDeps()
    const service = createPersistenceService(bundle.deps)
    await service.open()
    const handleLike = {
      queryPermission: async (): Promise<string> => 'granted',
      getFile: async (): Promise<File> => new File([new Uint8Array(8)], 'media.mp4', { type: 'video/mp4' }),
    }
    const fingerprint = cannedFingerprint()
    await expect(service.storeMediaHandle('proj_bridge', handleLike as unknown as FileSystemFileHandle, fingerprint)).resolves.toBeUndefined()
    const row = await rawRow<{ projectId: string; fingerprint: unknown; handle?: unknown }>(bundle.instrument.raw, 'mediaHandles', 'proj_bridge')
    expect(row, 'the row landed').toBeDefined()
    expect(row?.handle, 'a function-bearing handle is NOT structured-cloneable — the pinned fallback persists the fingerprint row only').toBeUndefined()
    expect(row?.fingerprint, 'the fingerprint survives for the re-link contract',).toEqual(fingerprint)
    const fetched = await service.getMediaHandle('proj_bridge')
    expect(fetched?.handle, 'the session keeps the handle usable for relink').toBeDefined()
    await service.storeMediaHandle('proj_bridge', null, fingerprint)
    const cleared = await service.getMediaHandle('proj_bridge')
    expect(cleared?.handle, 'null clears the session-visible handle').toBeUndefined()
  })
})
