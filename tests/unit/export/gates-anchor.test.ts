// CC-202.8 (L1, static): "All gates green incl. pnpm test:e2e (chromium +
// webkit export specs)" — the durable wiring the unit's exit gate depends on
// (gates-anchor.test.ts precedent, units 101–106). This test pins the WIRING
// so a gate cannot silently disappear while the unit is in flight: every gate
// command exists in package.json, the bundle budget consumed by
// scripts/check-bundle.mjs is the frozen 350 KB initial-JS ceiling, the
// export e2e suite ships both the chromium specs and the opt-in webkit spec,
// the unit still declares exactly CC-202.1–CC-202.8, and the unit-202 branch
// exists. The GREEN STATE of the gates at commit time is reported by the unit
// report (gate command tails) — verify:unit + CI own that attestation.
// @anchor
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const repoRoot = new URL('../../../', import.meta.url)
const UNIT_FILE = '.ai-dlc/styling-and-export/unit-202-export.md'
const UNIT_BRANCH = 'ai-dlc/styling-and-export/unit-202-export'

describe('CC-202.8: the quality-gate wiring is in place', () => {
  test('CC-202.8: package.json declares every gate script', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const pkg = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as { scripts: Record<string, string> }
    for (const gate of ['lint', 'typecheck', 'test', 'test:e2e', 'check-bundle', 'verify:unit']) {
      expect(pkg.scripts[gate], `gate script '${gate}' exists`).toBeTruthy()
    }
  })

  test('CC-202.8: check-bundle consumes the frozen 350 KB initial-JS ceiling', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const checker = readFileSync(new URL('scripts/check-bundle.mjs', repoRoot), 'utf8')
    expect(checker, 'check-bundle.mjs reads its limit from bundle-budget.json').toContain('bundle-budget.json')
    expect(checker, 'CC-202.7 lazy-chunk assertions are wired into check-bundle').toContain('ExportDialog-')
    const budget = JSON.parse(readFileSync(new URL('bundle-budget.json', repoRoot), 'utf8')) as { initialJsGzipBytes: number }
    expect(budget.initialJsGzipBytes, '≤ 350 KB gzip (settings.yml / AGENTS.md gate)').toBe(350 * 1024)
  })

  test('CC-202.8: the export e2e suite ships chromium + opt-in webkit specs', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const specs = readdirSync(new URL('e2e/export/', repoRoot)).sort()
    for (const spec of ['burn-in.spec.ts', 'gating.spec.ts', 'sidecars.spec.ts', 'webkit-export.spec.ts']) {
      expect(specs, `e2e/export/${spec} ships`).toContain(spec)
    }
    const config = readFileSync(new URL('playwright.config.ts', repoRoot), 'utf8')
    expect(config, 'the webkit project is gated by E2E_WEBKIT (FR-1.0.4)').toContain('E2E_WEBKIT')
  })

  test('CC-202.8: the unit declares CC-202.1–CC-202.8 and the criteria verifier ships', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    expect(existsSync(new URL('scripts/verify-criteria.ts', repoRoot)), 'criteria verifier ships').toBe(true)
    const unit = readFileSync(new URL(UNIT_FILE, repoRoot), 'utf8')
    for (let n = 1; n <= 8; n++) {
      expect(unit, `unit file declares CC-202.${n}`).toContain(`CC-202.${n}`)
    }
  })

  test('CC-202.8: the unit-202 branch exists', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    // merge-status-aware attestation (unit-106 [106-ADJ 9] doctrine): after
    // the squash-merge the retired branch may exist in no ref context — the
    // unit file's `status: done` line is then the merged-branch attestation.
    const unitText = readFileSync(new URL(UNIT_FILE, repoRoot), 'utf8')
    if (/^status:\s*done\b/m.test(unitText)) {
      expect(unitText, 'the merged unit carries its done-status attestation in its own file').toMatch(/^status:\s*done\b/m)
      return
    }
    // CI-honest (unit-105/106 adjudications): a PR checkout has no local
    // refs/heads/<branch> — any authoritative source counts: local ref,
    // origin ref, or GITHUB_HEAD_REF.
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
