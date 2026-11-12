// CC-105.6 (L1, static): "All gates green" — the durable wiring the unit's
// exit gate depends on (gates-anchor.test.ts precedent, unit-104/103/102/101
// line): every gate command exists in package.json, the bundle budget is the
// frozen 350 KB (358_400 bytes) initial-JS ceiling, the unit still declares
// exactly CC-105.1–CC-105.6, and the unit-105 branch exists. The GREEN STATE
// of the gates at commit time is reported by the unit report (gate command
// tails) — this test pins the WIRING so a gate cannot silently disappear
// while the unit is in flight.
// @anchor
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const repoRoot = new URL('../../../', import.meta.url)
const UNIT_FILE = '.ai-dlc/caption-studio-ui/unit-105-command-system.md'
const UNIT_BRANCH = 'ai-dlc/caption-studio-ui/unit-105-command-system'

describe('CC-105.6: the quality-gate wiring is in place', () => {
  test('CC-105.6: package.json declares every gate script', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const pkg = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as { scripts: Record<string, string> }
    for (const gate of ['lint', 'typecheck', 'format:check', 'test', 'build', 'check-bundle', 'test:e2e', 'verify:unit']) {
      expect(pkg.scripts[gate], `gate script '${gate}' exists`).toBeTruthy()
    }
  })

  test('CC-105.6: the initial-JS budget is the frozen 350 KB ceiling', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const budget = JSON.parse(readFileSync(new URL('bundle-budget.json', repoRoot), 'utf8')) as { initialJsGzipBytes: number }
    expect(budget.initialJsGzipBytes, '≤ 350 KB gzip (settings.yml / AGENTS.md gate)').toBe(350 * 1024)
  })

  test('CC-105.6: the unit declares CC-105.1–CC-105.6 and the criteria verifier ships', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    expect(existsSync(new URL('scripts/verify-criteria.ts', repoRoot)), 'criteria verifier ships').toBe(true)
    const unit = readFileSync(new URL(UNIT_FILE, repoRoot), 'utf8')
    for (let n = 1; n <= 6; n++) {
      expect(unit, `unit file declares CC-105.${n}`).toContain(`CC-105.${n}`)
    }
  })

  test('CC-105.6: the unit-105 branch exists', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const sha = execFileSync('git', ['rev-parse', '--verify', `refs/heads/${UNIT_BRANCH}`], { cwd: repoRoot.pathname, encoding: 'utf8' }).trim()
    expect(sha, 'the unit branch is a real ref').toMatch(/^[0-9a-f]{40}$/)
  })
})
