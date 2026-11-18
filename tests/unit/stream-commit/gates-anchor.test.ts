// CC-108.8 (L1, static): "All gates green" — the durable wiring this unit's
// exit gate depends on (gates-anchor.test.ts precedent, 107/106/105/104 line):
// every gate command exists in package.json, the bundle budget consumed by
// scripts/check-bundle.mjs is the frozen 350 KB initial-JS ceiling, the unit
// still declares exactly CC-108.1–CC-108.8, the stream-commit service is the
// ONE commit surface wired by the composition root (never Transcript — the
// frozen FR-104.6 split), and the unit-108 branch exists — merge-status-aware
// per [106-ADJ 8/9]. The GREEN STATE of the gates at commit time is reported
// by the unit report (gate command tails); this test pins the WIRING so a
// gate cannot silently disappear.
// @anchor
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const repoRoot = new URL('../../../', import.meta.url)
const UNIT_FILE = '.ai-dlc/caption-studio-ui/unit-108-stream-commit.md'
const UNIT_BRANCH = 'ai-dlc/caption-studio-ui/unit-108-stream-commit'

describe('CC-108.8: the quality-gate wiring is in place', () => {
  test('CC-108.8: package.json declares every gate script', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const pkg = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as { scripts: Record<string, string> }
    for (const gate of ['lint', 'typecheck', 'test', 'check-bundle', 'verify:unit', 'test:e2e']) {
      expect(pkg.scripts[gate], `gate script '${gate}' exists`).toBeTruthy()
    }
  })

  test('CC-108.8: check-bundle consumes the frozen 350 KB initial-JS ceiling', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const checker = readFileSync(new URL('scripts/check-bundle.mjs', repoRoot), 'utf8')
    expect(checker, 'check-bundle.mjs reads its limit from bundle-budget.json').toContain('bundle-budget.json')
    const pkg = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['check-bundle'], 'the check-bundle gate runs scripts/check-bundle.mjs').toContain('scripts/check-bundle.mjs')
    const budget = JSON.parse(readFileSync(new URL('bundle-budget.json', repoRoot), 'utf8')) as { initialJsGzipBytes: number }
    expect(budget.initialJsGzipBytes, '≤ 350 KB gzip (settings.yml / AGENTS.md gate)').toBe(350 * 1024)
  })

  test('CC-108.8: the unit declares CC-108.1–CC-108.8 and the criteria verifier ships', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    expect(existsSync(new URL('scripts/verify-criteria.ts', repoRoot)), 'criteria verifier ships').toBe(true)
    const unit = readFileSync(new URL(UNIT_FILE, repoRoot), 'utf8')
    for (let n = 1; n <= 8; n++) {
      expect(unit, `unit file declares CC-108.${n}`).toContain(`CC-108.${n}`)
    }
  })

  test('CC-108.8: the commit bridge is the ONE wiring — composition root, never Transcript (frozen FR-104.6)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const context = readFileSync(new URL('src/app/context.ts', repoRoot), 'utf8')
    expect(context, 'the composition root wires the stream-commit service').toContain('createTranscribeCommitService')
    const transcript = readFileSync(new URL('src/ui/transcript/Transcript.tsx', repoRoot), 'utf8')
    expect(transcript, 'Transcript never imports the commit service (component never commits — frozen unit-104)').not.toContain('transcribe-commit')
    expect(transcript, 'the frozen skeleton-row testid still ships').toContain('transcript-skeleton-row')
  })

  test('CC-108.8: the unit-108 branch exists', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    // Merge-status-aware attestation per [106-ADJ 8/9] + CI-honest
    // three-source check (unit-105/106/107 sibling doctrine): a PR checkout
    // has no local refs/heads/<branch> (refs/pull/N/merge + GITHUB_HEAD_REF);
    // after the squash-merge the retired branch can exist in no context — the
    // unit file's `status: done` line is then the attestation.
    const unitText = readFileSync(new URL(UNIT_FILE, repoRoot), 'utf8')
    if (/^status:\s*done\b/m.test(unitText)) {
      expect(unitText, 'the merged unit carries its done-status attestation in its own file').toMatch(/^status:\s*done\b/m)
      return
    }
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
