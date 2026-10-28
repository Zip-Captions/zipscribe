// CC-01.9: `verify:unit` negative tests.
//
// Contract: FR-1.0.12 (`scripts/verify-criteria.ts`: `verify:unit`,
// `verify:intent`, `--from-branch`) and `knowledge/conventions.md`
// § Criterion traceability — "They **fail** when an untagged criterion has no
// passing test, when a test cites an unknown ID, or when a `[RQ]`/`[MANUAL]`
// criterion is missing…". Every case runs against a committed fixture unit
// (`tests/fixtures/criteria/`), never the live unit.
import { afterAll, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, exists, isPlaceholderScript, packageScripts, removeScratch, runCommand, scratchDir, writeFixtureFile } from '../../helpers/repo'

const FIXTURE_UNIT = 'tests/fixtures/criteria/unit-999-fixture.md'

function harnessTree(body: string): string {
  const dir = scratchDir('verify-criteria')
  writeFixtureFile(join(dir, 'src/__fixture__/criteria.test.ts'), body)
  return dir
}

function bodyOf(uncovered: boolean, unknown: boolean): string {
  const lines = [`import { test, expect } from 'vitest'`, '']
  lines.push(`test('CC-999.1: the covered criterion', () => {`, `  expect(1 + 1).toBe(2)`, `})`)
  if (!uncovered) lines.push('', `test('CC-999.2: the second criterion', () => {`, `  expect(2 + 2).toBe(4)`, `})`)
  if (unknown) lines.push('', `test('CC-999.7: cites an ID the unit does not declare', () => {`, `  expect(3 + 3).toBe(6)`, `})`)
  return lines.join('\n')
}

const trees: string[] = []
afterAll(() => trees.splice(0).forEach(removeScratch))

function verify(root: string, args: string[]): ReturnType<typeof runCommand> {
  // `--root` keeps the harness inside the scratch tree; the verify script
  // resolves the unit file and the JUnit it just wrote from there.
  return runInRoot(root, ['pnpm', 'run', '--silent', 'verify:unit', FIXTURE_UNIT, '--root', root, ...args])
}

function runInRoot(root: string, args: string[]): ReturnType<typeof runCommand> {
  const result = spawnSync('corepack', args, { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, CI: '1', NO_COLOR: '1', ZIPSCRIBE_VERIFY_ROOT: root }, timeout: 300_000 })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  return { status: result.status, stdout, stderr, output: `${stdout}\n${stderr}`, slug: args.join(' ') }
}

describe('CC-01.9: verify:unit traces criteria to tests', () => {
  test('CC-01.9: verify:unit / verify:intent scripts exist and are not placeholders', () => {
    const scripts = packageScripts()
    for (const name of ['verify:unit', 'verify:intent']) {
      expect(isPlaceholderScript(scripts[name]), `${name} = ${scripts[name] ?? '<missing>'}`).toBe(false)
    }
    expect(exists('scripts/verify-criteria.ts') || exists('scripts/verify-criteria.mjs'), 'scripts/verify-criteria.ts').toBe(true)
    expect(readFileSync(join(REPO_ROOT, FIXTURE_UNIT), 'utf8'), `${FIXTURE_UNIT} declares both fixture CC-IDs`).toContain('CC-999.2')
  })

  test('CC-01.9: fails for an untagged criterion with no test', () => {
    const root = harnessTree(bodyOf(true, false))
    trees.push(root)
    const run = verify(root, [])
    expect(run.status, `verify:unit must fail on an uncovered criterion\n${run.output.slice(-4000)}`).not.toBe(0)
    expect(run.output, 'the uncovered ID is named').toContain('CC-999.2')
  })

  test('CC-01.9: fails for a test citing an unknown CC-ID', () => {
    const root = harnessTree(bodyOf(false, true))
    trees.push(root)
    const run = verify(root, [])
    expect(run.status, `verify:unit must fail on an unknown ID\n${run.output.slice(-4000)}`).not.toBe(0)
    expect(run.output, 'the unknown ID is named').toContain('CC-999.7')
  })

  test('CC-01.9: passes when every criterion is covered by a passing test', () => {
    const root = harnessTree(bodyOf(false, false))
    trees.push(root)
    const run = verify(root, [])
    expect(run.status, `verify:unit on a fully covered fixture unit\n${run.output.slice(-6000)}`).toBe(0)
    expect(run.output).toMatch(/report/i)
  })
})