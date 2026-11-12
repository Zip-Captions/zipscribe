// CC-104.9 (L1, static): "All gates green" — the durable wiring the unit's
// exit gate depends on: every gate command exists in package.json, the
// bundle budget is the frozen 350 KB (358_400 bytes) initial-JS ceiling, the
// criteria verifier exists, and the unit still declares exactly CC-104.1–9.
// The GREEN STATE of the gates at commit time is reported by the unit report
// (gate command tails) — this test pins the WIRING so a gate cannot silently
// disappear while the unit is in flight.
// <!-- gate-derived criterion per CC-101.6/CC-102.7/CC-103.6 precedent;
//      evidence: orchestrator BUILD_VERIFIED 2026-11-12 at bcab122 —
//      lint/typecheck/format:check exit 0 · pnpm test 188 files 1505
//      passed/1 skipped/1 todo exit 0 · pnpm test --coverage exit 0
//      (Statements 95.54% Branches 90.34% Functions 96.99% Lines 98.42%) ·
//      build+check-bundle 124.9 KB ≤ 350 KB · pnpm test:e2e 110 passed/22
//      skipped/0 failed (9.9 min, retry-pass reporter clean) · verify:unit
//      9/9 untagged CC-104 rows pass
//      (reports/criteria/unit-104-transcript-editor.md) -->
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const repoRoot = new URL('../../../', import.meta.url)

describe('CC-104.9: the quality-gate wiring is in place', () => {
  test('CC-104.9: package.json declares every gate script', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const pkg = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as { scripts: Record<string, string> }
    for (const gate of ['lint', 'typecheck', 'test', 'build', 'check-bundle', 'test:e2e', 'verify:unit', 'format:check', 'qualify']) {
      expect(pkg.scripts[gate], `gate script '${gate}' exists`).toBeTruthy()
    }
  })

  test('CC-104.9: the initial-JS budget is the frozen 350 KB ceiling', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const budget = JSON.parse(readFileSync(new URL('bundle-budget.json', repoRoot), 'utf8')) as { initialJsGzipBytes: number }
    expect(budget.initialJsGzipBytes, '≤ 350 KB gzip (settings.yml / AGENTS.md gate)').toBe(350 * 1024)
  })

  test('CC-104.9: verify-criteria + CI workflow + settings.yml gates exist; unit declares CC-104.1–9', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    expect(existsSync(new URL('scripts/verify-criteria.ts', repoRoot)), 'criteria verifier ships').toBe(true)
    expect(existsSync(new URL('.github/workflows/ci.yml', repoRoot)), 'CI enforces the gates on PRs').toBe(true)
    const settings = readFileSync(new URL('.ai-dlc/settings.yml', repoRoot), 'utf8')
    expect(settings).toContain('quality_gates')
    const unit = readFileSync(new URL('.ai-dlc/caption-studio-ui/unit-104-transcript-editor.md', repoRoot), 'utf8')
    for (let n = 1; n <= 9; n++) {
      expect(unit, `unit file declares CC-104.${n}`).toContain(`CC-104.${n}`)
    }
  })
})
