// ADVERSARIAL (unit-03 red-team): the FR-03.5 boundary scanner against
// obfuscated SDK imports. Unlike a pattern copy (decorative self-test), this
// probe mutates a PRODUCTION engine file inside a scratch git worktree and
// runs the REAL frozen `boundary-guard.test.ts` + the real ESLint purity rule
// against it — the scanners themselves are under test. A mutation the real
// scanners wave through is an enforcement gap (the unit-03 Risks item
// "boundary lint test" is defense-in-depth for FR-03.5).
import { afterAll, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isChildRun, REPO_ROOT } from '../../../helpers/repo'

// Unique per test PROCESS: this file also executes inside the CC-03.8 nested
// coverage run (a second vitest process while the parent suite is alive) — a
// shared fixed path would let the two processes steal each other's worktree.
const SCRATCH_PREFIX = 'zs-adv-boundary-'
const SCRATCH = join('/tmp', `${SCRATCH_PREFIX}${process.pid}-${Date.now().toString(36)}`)

function git(args: string[], cwd: string = REPO_ROOT): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })
}

function destroyScratch(): void {
  git(['worktree', 'remove', '--force', SCRATCH])
  git(['worktree', 'prune'])
  rmSync(SCRATCH, { recursive: true, force: true })
  // Crash-residual hygiene for OUR prefix only (never anything else in /tmp),
  // and only for STALE entries (> 30 min) — a sibling vitest process (the
  // CC-03.8 nested run) may hold a live worktree with the same prefix.
  try {
    for (const entry of readdirSync('/tmp')) {
      if (!entry.startsWith(SCRATCH_PREFIX)) continue
      const path = join('/tmp', entry)
      try {
        if (Date.now() - (statSync(path).mtimeMs ?? 0) < 30 * 60_000) continue
      } catch {
        continue
      }
      git(['worktree', 'remove', '--force', path])
      rmSync(path, { recursive: true, force: true })
    }
  } catch {
    /* /tmp unreadable — nothing of ours to clean */
  }
  git(['worktree', 'prune'])
}

// Worktree setup is skipped entirely for child runs (CC-01.1 budget) —
// module-level code pays this cost even when the test body stands down.
const ACTIVE = !isChildRun()
if (ACTIVE) {
  destroyScratch()
  spawnSync('git', ['worktree', 'add', '--detach', SCRATCH, 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 })
  spawnSync('ln', ['-s', join(REPO_ROOT, 'node_modules'), join(SCRATCH, 'node_modules')], { timeout: 10_000 })
}

afterAll(() => {
  if (ACTIVE) destroyScratch()
})

function runBoundaryGuard(): number {
  const run = spawnSync('corepack', ['pnpm', 'exec', 'vitest', 'run', 'tests/unit/model/boundary-guard.test.ts'], {
    cwd: SCRATCH,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, CI: '1', NO_COLOR: '1', ZIPSCRIBE_CHILD: undefined },
  })
  return run.status ?? 1
}

function runEslintOnRegistry(): string {
  const run = spawnSync('corepack', ['pnpm', 'exec', 'eslint', 'src/engine/model/registry.ts'], {
    cwd: SCRATCH,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  })
  return `${run.stdout ?? ''}\n${run.stderr ?? ''}`
}

function poisonRegistry(marker: string, code: string): void {
  const path = join(SCRATCH, 'src', 'engine', 'model', 'registry.ts')
  const text = readFileSync(path, 'utf8')
  const anchor = "import type { Device, Tier } from '@engine/protocol'"
  writeFileSync(path, text.replace(anchor, `${anchor}\n// ${marker}\n${code}`))
}

function unpoison(): void {
  git(['checkout', '--', 'src/engine/model/registry.ts'], SCRATCH)
}

describe('ADVERSARIAL FR-03.5: the boundary scanner is under test', () => {
  test('ADVERSARIAL FR-03.5: runtime+type-only SDK imports are rejected; obfuscated dynamic imports are a KNOWN gap (characterized)', () => {
    // Child-safety (same doctrine as model-coverage.test.ts): this file also
    // executes inside the CC-01.1 gates-scaffold child run (`pnpm test` with a
    // frozen 30 s budget) — the worktree + four nested tool spawns belong to
    // the authoritative parent and the CC-03.8 nested coverage run only.
    if (!ACTIVE) return

    const gaps: string[] = []
    const required: string[] = []

    unpoison()
    poisonRegistry('MUTANT-adv runtime', "import { env } from '@huggingface/transformers'\nvoid env")
    if (runBoundaryGuard() === 0) required.push('runtime `import { env } from "@huggingface/transformers"` → scanner GREEN (it must be RED)')
    unpoison()

    poisonRegistry('MUTANT-adv type-only', "import type { env } from '@huggingface/transformers'\nexport type AdvEnv = typeof env")
    if (runBoundaryGuard() === 0) required.push('type-only import → scanner GREEN (it must be RED)')
    if (!/error/.test(runEslintOnRegistry())) required.push('type-only import → eslint GREEN (it must be RED)')
    unpoison()

    // String-concatenated dynamic import: a REAL runtime import (node/vitest
    // resolves it), invisible to a regex that expects a quoted literal right
    // after `import(`, and skipped by the ESLint rule which only matches
    // literal specifiers (scripts/eslint-engine-purity.mjs ImportExpression).
    // KNOWN GAP (unit-03 adversary report, MEDIUM): enforcement gap without
    // criterion exposure. This assertion fails when the gap is FIXED (update
    // the report and tighten to `required`) or WIDENS (new evasion) — it can
    // still fail, so it is a test, not a comment.
    poisonRegistry('MUTANT-adv concat', "export async function advLoad(): Promise<unknown> {\n  return await import('@huggingface/' + 'transformers')\n}")
    if (runBoundaryGuard() === 0) gaps.push('obfuscated `import("@huggingface/" + "transformers")` → scanner GREEN')
    if (!/error/.test(runEslintOnRegistry())) gaps.push('obfuscated dynamic import → eslint GREEN')
    unpoison()

    expect(required.join('\n'), 'FR-03.5 must reject these (regression if non-empty)').toBe('')
    expect(gaps.join('\n'), 'KNOWN GAP drift — expected exactly the two characterized evasions').toBe(['obfuscated `import("@huggingface/" + "transformers")` → scanner GREEN', 'obfuscated dynamic import → eslint GREEN'].join('\n'))
  }, 240_000)
})
