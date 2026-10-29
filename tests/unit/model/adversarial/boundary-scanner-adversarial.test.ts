// ADVERSARIAL (unit-03 red-team, flipped by the finding-2 fix): the FR-03.5
// boundary scanners against obfuscated SDK imports. Unlike a pattern copy
// (decorative self-test), this probe mutates a PRODUCTION engine file inside a
// scratch git worktree and runs the REAL scanners against it — the scanners
// themselves are under test. A mutation the scanners wave through is an
// enforcement gap (the unit-03 Risks item "boundary lint test" is
// defense-in-depth for FR-03.5).
//
// History: this file was written as a characterization tripwire — the
// string-concatenated dynamic import was a KNOWN, pinned gap ("fails if the
// gap is fixed"). The fix (fix(lint)) hardened the ESLint ImportExpression
// rule (scripts/eslint-engine-purity.mjs: non-static specifiers rejected
// outside adapters dirs, split literals/templates reconstituted and matched)
// and added the sibling hardened scanner (tests/unit/model/boundary-scan.ts +
// boundary-guard-hardened.test.ts) — the frozen author-set file
// tests/unit/model/boundary-guard.test.ts stays untouched per the frozen-test
// rule and keeps covering static literal imports. This tripwire is now
// flipped: every characterized evasion must be REJECTED.
import { afterAll, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isChildRun, REPO_ROOT } from '../../../helpers/repo'
import { scanEngineSource } from '../boundary-scan'

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
let setupError: string | null = null
if (ACTIVE) {
  destroyScratch()
  const add = spawnSync('git', ['worktree', 'add', '--detach', SCRATCH, 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 })
  if (add.status !== 0) setupError = `git worktree add --detach ${SCRATCH} HEAD failed: ${add.stderr ?? ''}`
  const link = spawnSync('ln', ['-s', join(REPO_ROOT, 'node_modules'), join(SCRATCH, 'node_modules')], { timeout: 10_000 })
  if (link.status !== 0) setupError = `symlinking node_modules into ${SCRATCH} failed: ${link.stderr ?? ''}`
}

afterAll(() => {
  if (ACTIVE) destroyScratch()
})

// spawn-null doctrine (unit-02, scripts/qualify.ts @ eb61046): a killed or
// un-spawned tool must never masquerade as an exit code. Both the "scanner
// must be RED" and the "scanner must be GREEN" assertions depend on the tool
// having actually run, so a null status throws instead of being read as 1.
function requireStatus(run: ReturnType<typeof spawnSync>, label: string): number {
  if (run.error) throw new Error(`${label} failed to spawn: ${run.error.message}`)
  if (run.status === null) throw new Error(`${label} did not complete (killed or timed out${run.signal ? `, signal ${run.signal}` : ''})`)
  return run.status
}

function runBoundaryGuard(): number {
  const run = spawnSync('corepack', ['pnpm', 'exec', 'vitest', 'run', 'tests/unit/model/boundary-guard.test.ts'], {
    cwd: SCRATCH,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, CI: '1', NO_COLOR: '1', ZIPSCRIBE_CHILD: undefined },
  })
  return requireStatus(run, 'boundary-guard run')
}

function runEslintOn(repoRelative: string): { status: number; output: string } {
  const run = spawnSync('corepack', ['pnpm', 'exec', 'eslint', repoRelative], {
    cwd: SCRATCH,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  })
  const status = requireStatus(run, `eslint ${repoRelative}`)
  return { status, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}` }
}

function runEslintOnRegistry(): { status: number; output: string } {
  return runEslintOn('src/engine/model/registry.ts')
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
  test('ADVERSARIAL FR-03.5: runtime+type-only SDK imports and obfuscated dynamic imports are REJECTED (finding-2 gap FIXED — tripwire flipped)', () => {
    // Child-safety (same doctrine as model-coverage.test.ts): this file also
    // executes inside the CC-01.1 gates-scaffold child run (`pnpm test` with a
    // frozen 30 s budget) — the worktree + four nested tool spawns belong to
    // the authoritative parent and the CC-03.8 nested coverage run only.
    if (!ACTIVE) return
    if (setupError) throw new Error(setupError)

    const required: string[] = []
    const gaps: string[] = [] // no characterized evasion may survive the hardened scanners

    unpoison()
    poisonRegistry('MUTANT-adv runtime', "import { env } from '@huggingface/transformers'\nvoid env")
    if (runBoundaryGuard() === 0) required.push('runtime `import { env } from "@huggingface/transformers"` → scanner GREEN (it must be RED)')
    unpoison()

    poisonRegistry('MUTANT-adv type-only', "import type { env } from '@huggingface/transformers'\nexport type AdvEnv = typeof env")
    if (runBoundaryGuard() === 0) required.push('type-only import → scanner GREEN (it must be RED)')
    if (runEslintOnRegistry().status === 0) required.push('type-only import → eslint GREEN (it must be RED)')
    unpoison()

    // String-concatenated dynamic import (the finding-2 MEDIUM gap, and its
    // template/variable siblings): once invisible to the literal-only scanner
    // and skipped by the ESLint rule. Now the ESLint ImportExpression rule
    // reconstitutes static concatenations/templates and rejects unverifiable
    // (non-literal) specifiers outright outside **/adapters/**, and the
    // hardened scanner mirrors both rules. Any GREEN here is a regression.
    const dynamicMutants: Array<[string, string]> = [
      ['concat', "export async function advLoad(): Promise<unknown> {\n  return await import('@huggingface/' + 'transformers')\n}"],
      ['static-template', "export async function advLoad(): Promise<unknown> {\n  return await import(`@huggingface/${'transformers'}`)\n}"],
      ['variable-specifier', "const advPkg: string = 'not-an-sdk'\nexport async function advLoad(): Promise<unknown> {\n  return await import(advPkg)\n}"],
    ]
    for (const [label, code] of dynamicMutants) {
      poisonRegistry(`MUTANT-adv ${label}`, code)
      if (runEslintOnRegistry().status === 0) required.push(`obfuscated dynamic import (${label}) → eslint GREEN (it must be RED)`)
      if (scanEngineSource(`${code}\n`).length === 0) required.push(`obfuscated dynamic import (${label}) → hardened scanner GREEN (it must be RED)`)
      unpoison()
    }

    // Positive probes — the hardening must not punish legitimate code.
    // (1) literal relative dynamic import outside adapters dirs: both real
    // scanners stay GREEN (frozen guard included — the hardening required no
    // false positives against the real tree).
    const relativeProbe = "export async function advProbe(): Promise<unknown> {\n  return await import('./registry')\n}"
    poisonRegistry('PROBE-adv relative-dynamic', relativeProbe)
    try {
      const relativeLint = runEslintOnRegistry()
      if (relativeLint.status !== 0) required.push(`legit literal dynamic import ('./registry') → eslint RED (must be GREEN):\n${relativeLint.output.slice(-2000)}`)
      if (runBoundaryGuard() !== 0) required.push("legit literal dynamic import ('./registry') → frozen boundary guard RED (must stay GREEN)")
    } finally {
      unpoison()
    }
    if (scanEngineSource(`${relativeProbe}\n`).length !== 0) required.push("legit literal dynamic import ('./registry') → hardened scanner RED (must be GREEN)")

    // (2) the adapters/ dir keeps its allowance: static SDK import, literal
    // dynamic SDK import and a split-literal dynamic SDK import all lint
    // GREEN inside **/adapters/**.
    const adapterProbe = "export async function advProbeSdk(): Promise<unknown> {\n  const mod = await import('@huggingface/transformers')\n  return mod\n}\nexport async function advProbeSplit(): Promise<unknown> {\n  return await import('@huggingface/' + 'transformers')\n}\n"
    const adapterPath = join(SCRATCH, 'src', 'engine', 'boot', 'adapters', 'adv-probe.ts')
    writeFileSync(adapterPath, adapterProbe)
    try {
      const adapterLint = runEslintOn('src/engine/boot/adapters/adv-probe.ts')
      if (adapterLint.status !== 0) required.push(`adapters-dir SDK dynamic imports → eslint RED (must be GREEN):\n${adapterLint.output.slice(-2000)}`)
    } finally {
      rmSync(adapterPath, { force: true })
    }
    if (scanEngineSource(adapterProbe, { sdkAllowed: true }).length !== 0) required.push('adapters-dir SDK dynamic imports → hardened scanner RED (must be GREEN)')

    expect(required.join('\n'), 'FR-03.5 must reject these (regression if non-empty)').toBe('')
    expect(gaps.join('\n'), 'KNOWN GAP drift — no characterized evasion may survive the hardened scanners').toBe('')
  }, 420_000)
})
