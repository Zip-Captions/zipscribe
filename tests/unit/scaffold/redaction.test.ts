// CC-01.10: redaction harness negative test.
//
// Contract: FR-1.0.12 — `src/test-support/` includes a "canary-transcript
// redaction spy"; `knowledge/conventions.md` § Principles 4 — "Every suite loads
// a *canary transcript* containing a unique marker string; a global spy on
// `console.*`, thrown errors, `EngineError.detail`, notices and written
// artifacts fails the run if the marker ever appears (SECURITY-03)". The
// negative test is a deliberate `console.log` of the canary marker: the harness
// must turn it into a failing test.
import { afterAll, describe, expect, test } from 'vitest'
import { exists, linkScratchToolchain, readText, removeScratch, runIn, scratchDir, writeFixtureFile } from '../../helpers/repo'

const CANARY_TEST = `// @vitest-environment node
import { test, expect } from 'vitest'
import { createRedactionSpy, CANARY_MARKER } from '../src/test-support/redaction'

test('a deliberate console.log of the canary marker is caught', () => {
  const spy = createRedactionSpy()
  console.log(CANARY_MARKER)
  const verdict = spy.settle()
  spy.restore()
  expect(verdict.leaks).toEqual([])
})
`

const CLEAN_TEST = `// @vitest-environment node
import { test, expect } from 'vitest'
import { createRedactionSpy, CANARY_MARKER } from '../src/test-support/redaction'

test('logging around the marker without the marker is clean', () => {
  const spy = createRedactionSpy()
  console.log('job:progress', 42, CANARY_MARKER.length)
  const verdict = spy.settle()
  spy.restore()
  expect(verdict.leaks).toEqual([])
})
`

const trees: string[] = []
afterAll(() => trees.splice(0).forEach(removeScratch))

function treeWith(body: string): string {
  const root = scratchDir('redaction')
  writeFixtureFile(`${root}/tests/redaction-probe.test.ts`, body)
  const support = ['src/test-support/redaction.ts', 'src/test-support/redaction/index.ts'].find((file) => exists(file))
  if (support) writeFixtureFile(`${root}/${support}`, readText(support))
  linkScratchToolchain(root)
  trees.push(root)
  return root
}

describe('CC-01.10: canary-redaction harness', () => {
  test('CC-01.10: src/test-support/redaction.ts exists and exports the canary spy', () => {
    const support = ['src/test-support/redaction.ts', 'src/test-support/redaction/index.ts'].find((file) => exists(file))
    expect(support, 'src/test-support/redaction.ts').toBeDefined()
    const source = support ? readText(support) : ''
    expect(source, 'the canary marker constant').toMatch(/CANARY_MARKER/)
    expect(source, 'the spy factory').toMatch(/createRedactionSpy|redactionSpy/)
  })

  test('CC-01.10: a deliberate console.log of the canary marker fails the suite', () => {
    // Without the harness the probe cannot even be imported, so a non-zero exit
    // would prove nothing. Guard on the harness existing first.
    expect(exists('src/test-support/redaction.ts') || exists('src/test-support/redaction/index.ts'), 'src/test-support/redaction.ts exists').toBe(true)
    const root = treeWith(CANARY_TEST)
    const run = runIn(root, 'corepack', ['pnpm', 'exec', 'vitest', 'run', 'tests/redaction-probe.test.ts'], 30_000)
    expect(run.status, `leaking the canary must fail the run\n${run.output.slice(-4000)}`).not.toBe(0)
    expect(run.output, 'the failure reports a leak').toMatch(/leak|canary|redact/i)
  })

  test('CC-01.10: code that does not leak the canary passes the same harness', () => {
    expect(exists('src/test-support/redaction.ts') || exists('src/test-support/redaction/index.ts'), 'src/test-support/redaction.ts exists').toBe(true)
    const root = treeWith(CLEAN_TEST)
    const run = runIn(root, 'corepack', ['pnpm', 'exec', 'vitest', 'run', 'tests/redaction-probe.test.ts'], 30_000)
    expect(run.status, `a clean run must pass\n${run.output.slice(-4000)}`).toBe(0)
  })
})