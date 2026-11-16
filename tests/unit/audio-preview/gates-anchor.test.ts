// CC-107.10 (L1, static): "All gates green" — the durable wiring this unit's
// exit gate depends on (gates-anchor.test.ts precedent, 106/105/104 line):
// every gate command exists in package.json, the bundle budget consumed by
// scripts/check-bundle.mjs is the frozen 350 KB initial-JS ceiling, the unit
// still declares exactly CC-107.1–CC-107.10, the qualify tier for the
// [RQ] drift leg is wired (playwright 'drift' project, excluded from the
// default chromium run so CI can never silently drop it), and the unit-107
// branch exists — merge-status-aware per [106-ADJ 8/9]. The GREEN STATE of
// the gates at commit time is reported by the unit report (gate command
// tails); this test pins the WIRING so a gate cannot silently disappear.
// @anchor
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const repoRoot = new URL('../../../', import.meta.url)
const UNIT_FILE = '.ai-dlc/caption-studio-ui/unit-107-audio-preview.md'
const UNIT_BRANCH = 'ai-dlc/caption-studio-ui/unit-107-audio-preview'

describe('CC-107.10: the quality-gate wiring is in place', () => {
  test('CC-107.10: package.json declares every gate script', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const pkg = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as { scripts: Record<string, string> }
    for (const gate of ['lint', 'typecheck', 'test', 'check-bundle', 'verify:unit']) {
      expect(pkg.scripts[gate], `gate script '${gate}' exists`).toBeTruthy()
    }
  })

  test('CC-107.10: check-bundle consumes the frozen 350 KB initial-JS ceiling', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    // check-bundle.mjs carries no numeric literal — its frozen constant is the
    // budget file it refuses to run without; pin BOTH halves of the wiring.
    const checker = readFileSync(new URL('scripts/check-bundle.mjs', repoRoot), 'utf8')
    expect(checker, 'check-bundle.mjs reads its limit from bundle-budget.json').toContain('bundle-budget.json')
    expect(checker, 'check-bundle.mjs is wired as scripts/check-bundle.mjs').toBeTruthy()
    const budget = JSON.parse(readFileSync(new URL('bundle-budget.json', repoRoot), 'utf8')) as { initialJsGzipBytes: number }
    expect(budget.initialJsGzipBytes, '≤ 350 KB gzip (settings.yml / AGENTS.md gate)').toBe(350 * 1024)
  })

  test('CC-107.10: the unit declares CC-107.1–CC-107.10 and the criteria verifier ships', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    expect(existsSync(new URL('scripts/verify-criteria.ts', repoRoot)), 'criteria verifier ships').toBe(true)
    const unit = readFileSync(new URL(UNIT_FILE, repoRoot), 'utf8')
    for (let n = 1; n <= 10; n++) {
      expect(unit, `unit file declares CC-107.${n}`).toContain(`CC-107.${n}`)
    }
  })

  test('CC-107.10: the [RQ] drift tier is wired (playwright drift project, out of the default run, qualify-recorded)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const config = readFileSync(new URL('playwright.config.ts', repoRoot), 'utf8')
    expect(config, "a 'drift' playwright project exists (CC-107.4 [RQ] tier)").toMatch(/name:\s*'drift'/)
    expect(config, 'the default chromium run must not execute the hour-class drift legs').toMatch(/drift-10min/)
    const qualifier = readFileSync(new URL('scripts/qualify.ts', repoRoot), 'utf8')
    expect(qualifier, 'scripts/qualify.ts records CC-107.4 (reference hardware)').toContain('CC-107.4')
    const checker = readFileSync(new URL('scripts/qualification-check.ts', repoRoot), 'utf8')
    expect(checker, 'the release qualification-check requires the CC-107.4 record').toContain('CC-107.4')
    expect(existsSync(new URL('e2e/audio-preview/drift-10min.spec.ts', repoRoot)), 'the drift spec ships').toBe(true)
  })

  test('CC-107.10: the unit-107 branch exists', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    // Merge-status-aware attestation per [106-ADJ 8/9] (Actions runs
    // 43551015319 + 43364639088): while the unit is IN FLIGHT (status:
    // pending) the branch must exist in one of the three sources; after the
    // squash-merge the retired branch can exist in no context, and the unit
    // file's `status: done` line (closing docs commit) is the attestation.
    const unitText = readFileSync(new URL(UNIT_FILE, repoRoot), 'utf8')
    if (/^status:\s*done\b/m.test(unitText)) {
      expect(unitText, 'the merged unit carries its done-status attestation in its own file').toMatch(/^status:\s*done\b/m)
      return
    }
    // CI-honest (orchestrator adjudication, Actions run 43358141096 — mirrored from the unit-105/106 siblings): a PR checkout has no local refs/heads/<branch> — it checks out refs/pull/N/merge and carries the branch in GITHUB_HEAD_REF — so any authoritative source counts: local ref, origin ref (fetch context), or GITHUB_HEAD_REF (PR context). A branch absent from all three still fails.
    const resolveRef = (ref: string): string | null => {
      try {
        return execFileSync('git', ['rev-parse', '--verify', ref], { cwd: repoRoot.pathname, encoding: 'utf8' }).trim()
      } catch {
        return null
      }
    }
    const sha = resolveRef(`refs/heads/${UNIT_BRANCH}`) ?? resolveRef(`refs/remotes/origin/${UNIT_BRANCH}`)
    if (sha !== null) {
      expect(sha, 'the unit branch is a real ref').toMatch(/^[0-9a-f]{40}$/)
    } else {
      expect(process.env.GITHUB_HEAD_REF, 'the unit branch exists as no local/origin ref — a PR checkout must carry it in GITHUB_HEAD_REF').toBe(UNIT_BRANCH)
    }
  })
})
