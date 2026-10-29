// ADVERSARIAL (unit-03 review round 1, finding F5): the ESLint purity rule's
// dynamic-import guard must be killed by its own tests, in BOTH its branches.
//
// Round 1's survivor: mutating `staticSpecifier` to always return null left
// every committed test green, because outside `**/adapters/**` the `nonStatic`
// catch-all masks it, and the framework-reconstitution case was only ever
// exercised through the *mirrored* scanner (tests/unit/model/boundary-scan.ts)
// — never through the real plugin. Inside adapters/ dirs a split-literal
// framework import (`import('re' + 'act')`) would therefore pass `pnpm lint`.
//
// This suite spawns the REAL ESLint (`eslint --no-ignore`) on a temporary
// fixture whose path contains `/adapters/`, so the plugin's real code path —
// not a mirror — decides.
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isChildRun, REPO_ROOT } from '../../../helpers/repo'

// Lives under a directory named `adapters` so allowSdkUnder matches.
const FIXTURE_DIR = join(REPO_ROOT, 'src', 'engine', '__adv_fixture_adapters__', 'adapters')

function lintFixture(contents: string): { status: number; output: string } {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  const file = join(FIXTURE_DIR, 'probe.ts')
  writeFileSync(file, contents)
  try {
    const run = spawnSync('corepack', ['pnpm', 'exec', 'eslint', '--no-ignore', '--format=json', file], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    })
    return { status: run.status ?? 1, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}` }
  } finally {
    rmSync(FIXTURE_DIR, { recursive: true, force: true })
  }
}

function messages(output: string): { ruleId?: string; messageId?: string }[] {
  try {
    const parsed = JSON.parse(output.slice(output.indexOf('['))) as { messages?: { ruleId?: string; messageId?: string }[] }[]
    return parsed.flatMap((entry) => entry.messages ?? [])
  } catch {
    return []
  }
}

describe('ADVERSARIAL F5: real ESLint dynamic-import guard, inside adapters/', () => {
  test('ADVERSARIAL F5: a split-literal framework import in an adapters dir is rejected by the real plugin', () => {
    if (isChildRun()) return // spawns a node toolchain; not for the gates-scaffold child
    const result = lintFixture("export const load = () => import('re' + 'act')\n")
    const ids = messages(result.output).map((entry) => entry.messageId).filter(Boolean)
    expect(ids, `split-literal 'react' must be reconstituted and rejected\n${result.output.slice(-2000)}`).toContain('framework')
    expect(result.status, 'eslint must exit non-zero on the poisoned fixture').not.toBe(0)
  }, 180_000)

  test('ADVERSARIAL F5: a static template that reconstitutes an SDK name is rejected outside adapters', () => {
    if (isChildRun()) return
    const dir = join(REPO_ROOT, 'src', 'engine', '__adv_fixture_engine__')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'probe.ts')
    writeFileSync(file, "export const load = () => import(`@huggingface/${'transformers'}`)\n")
    try {
      const run = spawnSync('corepack', ['pnpm', 'exec', 'eslint', '--no-ignore', '--format=json', file], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 120_000,
      })
      const ids = messages(`${run.stdout ?? ''}\n${run.stderr ?? ''}`)
        .map((entry) => entry.messageId)
        .filter(Boolean)
      expect(ids, 'template reconstitution of @huggingface/transformers must be rejected').toContain('sdk')
      expect(run.status, 'eslint must exit non-zero').not.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  test('ADVERSARIAL F5: an ordinary relative dynamic import still passes (no over-blocking)', () => {
    if (isChildRun()) return
    const result = lintFixture("export const load = () => import('../model/registry')\n")
    expect(result.status, `a literal relative dynamic import must stay legal\n${result.output.slice(-2000)}`).toBe(0)
  }, 180_000)
})