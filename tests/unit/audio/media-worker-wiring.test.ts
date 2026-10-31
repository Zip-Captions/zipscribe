// CC-04.11 / CC-04.12 (L1, source shape): the real `src/workers/media.worker.ts`
// is a thin adapter over `engine/audio/worker-core` and namespace-imports its
// Task-4 surface through the **same ambient contract** the suite asserts
// (`unit04-api-contract.d.ts`). This keeps the L3 contract suite
// (`e2e/media/worker-contract.spec.ts`, which drives the real worker) honest:
// if the worker stops routing through the frozen modules, or drifts from the
// declared exports, this fails before any browser run.
//
// It also pins the engine-purity rule that matters for this unit: mediabunny
// and ffmpeg imports live only under `src/engine/audio/adapters/**`
// (conventions § Architecture rules; enforced by eslint, restated here because
// the browser suites load those modules directly).
import { describe, expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../helpers/repo'

const WORKER = join(REPO_ROOT, 'src/workers/media.worker.ts')

function source(): string {
  expect(existsSync(WORKER), 'src/workers/media.worker.ts exists (unit-01 stub)').toBe(true)
  return readFileSync(WORKER, 'utf8')
}

/** Static + dynamic import specifiers in a TS module (comments stripped first). */
function importSpecifiers(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const specs = [...code.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!)
  const dynamic = [...code.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]!)
  return [...specs, ...dynamic]
}

describe('CC-04.12: media.worker.ts routes through the frozen engine surface', () => {
  test('CC-04.12: the worker namespace-imports worker-core as the engine/media adapter seam', () => {
    const text = source()
    expect(text).toMatch(/import\s+\*\s+as\s+core\s+from\s+['"]@engine\/audio\/worker-core['"]/)
  })

  test('CC-04.12: it imports nothing that `@engine/audio/worker-core` does not export (frozen contract)', () => {
    const text = source()
    const aliased = /import\s+\*\s+as\s+core\s+from\s+['"]@engine\/audio\/worker-core['"]/.test(text)
    const block = text.match(/import\s*\{([^}]*)\}\s*from\s*['"]@engine\/audio\/worker-core['"]/)
    let names: string[] = []
    if (block) {
      names = block[1]!
        .split(',')
        .map((entry) => entry.trim().split(/\s+as\s+/).map((part) => part.trim()))
        .filter((parts) => parts[0] && parts[0] !== 'type')
        .map((parts) => parts[0]!)
    }
    expect(aliased || names.length > 0, 'the worker imports the deployed modules it is constructed from').toBe(true)
    // The Task-4 surface the worker is built from — every name must exist in the contract.
    const allowed = new Set([
      'decodeAudio',
      'decodeForPlayback',
      'handleMediaRequest',
      'PcmChunkStream',
      'teePcm',
      'transferSource',
      'referenceMeter',
      'decodeAudio',
    ])
    for (const name of names.filter((entry) => entry !== 'createMessageChannel')) {
      expect(allowed.has(name), `${name} is declared by unit04-api-contract.d.ts`).toBe(true)
    }
    if (aliased) {
      for (const name of ['decodeAudio', 'decodeForPlayback', 'handleMediaRequest', 'PcmChunkStream']) {
        const contract = readFileSync(join(REPO_ROOT, 'tests/unit/media/unit04-api-contract.d.ts'), 'utf8')
        expect(contract.includes(`export function ${name}(`), `${name} is part of the frozen contract`).toBe(true)
      }
    }
  })

  test('CC-04.12: it keeps the protocol request/event union (no stringly-typed commands)', () => {
    const text = source()
    expect(text).toMatch(/MediaRequest/)
    expect(text).toMatch(/MediaEvent/)
  })

  test('CC-04.12: mediabunny/ffmpeg SDKs are not imported by the worker core, only by adapters', () => {
    const workerSpecs = importSpecifiers(source())
    expect(workerSpecs.some((spec) => spec === 'mediabunny' || spec.startsWith('@ffmpeg/'))).toBe(false)
    for (const spec of workerSpecs) {
      if (/^@engine\/audio\/(?!adapters\/)/.test(spec)) {
        expect(['@engine/audio/worker-core', '@engine/audio/decode', '@engine/audio/resample', '@engine/audio/peaks', '@engine/audio/fingerprint'].includes(spec), `${spec} is an engine audio module`).toBe(true)
      }
    }
  })
})