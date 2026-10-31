// Unit-04 adversary F-6 (A-11, unit-03 F2 class) — regression suite for the
// vitest-title forgery the adversary survived: the unit-04 criterion rows
// carry no `Playwright` token, so `e2eBackedIds` was ∅ and two trivial
// `expect(1).toBe(1)` vitest tests titled `CC-04.9:` / `CC-04.10:` got both
// the memory gate and the forced-fallback gate credited as "pass".
//
// The hardened policy (scripts/lib/criteria-credit.ts, wired into
// scripts/verify-criteria.ts): a criterion is vitest-title-creditable only
// when NO committed e2e spec (read at git HEAD — the unit-03 R2 lesson, not
// the working tree, not the junit the run saw) carries its leading CC-ID;
// e2e-backed criteria earn credit exclusively from playwright-sourced junit
// cases with provenance (scripts/lib/junit-trust.ts).
//
// Real-flow counterpart of every assertion below: `corepack pnpm
// verify:unit --from-branch` still exits 0 with all 14 CC-04 rows pass —
// CC-04.9 credited from the `memory` project junit, CC-04.10 from the
// forced-fallback playwright case (genuine provenance).
import { afterAll, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT } from '../../helpers/repo'
import { committedE2eSpecSources, countCitations, modelledCaseTitles, playwrightBackedIds, specLeadingCitations } from '../../../scripts/lib/criteria-credit.ts'
import { parseJunit } from '../../../scripts/lib/junit-trust.ts'
import type { TestCase } from '../../../scripts/lib/junit-trust.ts'

const COMMITTED = committedE2eSpecSources(REPO_ROOT)
const BACKED = playwrightBackedIds(COMMITTED)

afterAll(() => {
  // Crash-residual safety for the scratch worktree below (AGENTS.md:
  // <repo>/.night/ only — prune stale registrations whose dir is gone).
  spawnSync('git', ['worktree', 'prune'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 })
})

function git(args: string[], cwd: string = REPO_ROOT): { status: number | null; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })
  return { status: result.status, stderr: result.stderr ?? '' }
}

describe('verify:unit e2e backing — committed-spec-derived (unit-04 adversary F-6)', () => {
  test('committed e2e specs back exactly the Playwright-owned unit-04 CC-IDs (and keep vitest-owned ones vitest-creditable)', () => {
    // Every ID whose real evidence is a Playwright spec (memory gate,
    // forced-fallback, format matrix, probe, playback, tee, video decode)
    // must be playwright-only from the committed spec text alone.
    for (const id of ['CC-04.1', 'CC-04.2', 'CC-04.3', 'CC-04.4', 'CC-04.6', 'CC-04.7', 'CC-04.9', 'CC-04.10', 'CC-04.12']) {
      expect(BACKED.has(id), `committed e2e specs lead-cite ${id} → credit requires playwright provenance`).toBe(true)
    }
    // The vitest-owned rows must NOT be blocked by e2e prose (in-engine.spec
    // cites them only after the describe prefix — never leading in the junit
    // name), or legitimate verify:unit would fail with no runnable evidence.
    for (const id of ['CC-04.5', 'CC-04.8', 'CC-04.11', 'CC-04.13', 'CC-04.14']) {
      expect(BACKED.has(id), `${id} has no leading e2e citation — vitest-title credit stays legitimate`).toBe(false)
    }
  })

  test('A-11 forgery: two trivial vitest titles credit nothing; provenance still credits', () => {
    const cases: TestCase[] = [
      { title: 'CC-04.9: trivial forgery', status: 'passed', source: 'vitest' },
      { title: 'CC-04.10: trivial forgery', status: 'passed', source: 'vitest' },
      { title: 'ADVERSARIAL CC-04.12: trivial forgery (caps-stripped leading cite)', status: 'passed', source: 'vitest' },
      { title: 'CC-04.13: legitimate vitest coverage stays credited', status: 'passed', source: 'vitest' },
      { title: 'CC-04.9: 120-minute decode memory gate › CC-04.9: decoding audio-120min.mp4 stays < 150 MB above baseline', status: 'passed', source: 'playwright' },
      { title: 'CC-04.10: forced ffmpeg fallback (stubbed capability probe) › CC-04.10: a dual-supported file decoded with a stubbed probe emits the ffmpeg path', status: 'passed', source: 'playwright' },
    ]
    const { citations, passing, cited } = countCitations(cases, BACKED)
    expect(citations.get('CC-04.9'), 'the vitest forgery adds nothing — only the playwright case credits').toBe(1)
    expect(citations.get('CC-04.10'), 'likewise for the forced-fallback gate').toBe(1)
    expect(citations.has('CC-04.12'), 'the caps-prefixed forgery on an e2e-backed ID is refused entirely').toBe(false)
    expect(citations.get('CC-04.13'), 'vitest-owned criteria keep vitest crediting').toBe(1)
    expect(passing.has('CC-04.12'), 'CC-04.12 is not passed by a vitest title alone').toBe(false)
    expect(cited.has('CC-04.12'), '…but the citation still surfaces for the UNKNOWN-ID check').toBe(true)

    // Pure forgery (no genuine playwright evidence at all) leaves both gates
    // UNCOVERED — the adversary's reported "pass" is no longer producible.
    const forgedOnly = countCitations(cases.filter((testCase) => testCase.source !== 'playwright'), BACKED)
    expect(forgedOnly.passing.has('CC-04.9'), 'a vitest-only tree must NOT credit the memory gate').toBe(false)
    expect(forgedOnly.passing.has('CC-04.10'), '…nor the forced-fallback gate').toBe(false)
  })

  test('forged junit files are still parsed honestly (the refusal is the policy, not a parser accident)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zs-f6-'))
    const file = join(dir, 'planted.xml')
    writeFileSync(file, '<testsuites><testcase name="CC-04.9: trivial forgery"/><testcase name="CC-04.10: trivial forgery"/></testsuites>')
    const parsed = parseJunit(file, 'vitest')
    expect(parsed).toHaveLength(2)
    const { passing } = countCitations(parsed, BACKED)
    expect([...passing], 'neither forged ID earns credit through the real parser path either').toEqual([])
  })

  test('working-tree spec deletion cannot downgrade: the backing set is read at git HEAD', () => {
    // Scratch worktree (AGENTS.md: <repo>/.night/ only). Delete the memory
    // and forced-fallback specs FROM DISK — if the backing set were a disk
    // scan, the trivial vitest titles would start crediting again (the
    // unit-03 R2 self-fulfilling downgrade).
    const name = `.night/f6-credit-${process.pid}-${Date.now().toString(36)}`
    const dir = join(REPO_ROOT, name)
    const add = git(['worktree', 'add', '--detach', name, 'HEAD'])
    expect(add.status, `git worktree add ${name}\n${add.stderr}`).toBe(0)
    try {
      for (const spec of ['e2e/media/memory/decode-memory.spec.ts', 'e2e/media/forced-fallback.spec.ts']) {
        rmSync(join(dir, spec), { force: true })
      }
      const sources = committedE2eSpecSources(dir)
      expect(sources.has('e2e/media/memory/decode-memory.spec.ts'), 'HEAD still carries the deleted spec').toBe(true)
      const backed = playwrightBackedIds(sources)
      expect(backed.has('CC-04.9'), 'deletion does not downgrade the memory gate to vitest crediting').toBe(true)
      expect(backed.has('CC-04.10'), '…nor the forced-fallback gate').toBe(true)
      const forged = countCitations(
        [
          { title: 'CC-04.9: trivial forgery', status: 'passed', source: 'vitest' as const },
          { title: 'CC-04.10: trivial forgery', status: 'passed', source: 'vitest' as const },
        ],
        backed,
      )
      expect(forged.passing.size, 'the A-11 forgery stays uncredited with the specs deleted on disk').toBe(0)
    } finally {
      git(['worktree', 'remove', '--force', name])
      git(['worktree', 'prune'])
    }
  })
})

describe('spec-title model fidelity (scripts/lib/criteria-credit.ts)', () => {
  test('a test under a non-citing describe is never leading (junit "describe › test" name)', () => {
    const source = `
import { test } from '@playwright/test'
test.describe('unit-04 engine math on real decoded audio (Chromium)', () => {
  test('CC-04.8: 44.1 kHz fixtures resampled to 16 kHz', async () => {})
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'CC-04.99: reason string is not a title')
})
`
    expect(modelledCaseTitles(source)).toEqual(['unit-04 engine math on real decoded audio (Chromium) › CC-04.8: 44.1 kHz fixtures resampled to 16 kHz'])
    expect(specLeadingCitations(source), 'no leading citation survives the describe prefix').toEqual([])
  })

  test('citing describes make their rows leading; nested chains join outermost-first', () => {
    const source = `
test.describe('CC-04.2: matrix, native set', () => {
  test(\`CC-04.2: \${key} decodes via the \${pathFor(browser, key)} path\`, async () => {})
})
test.describe('outer prose', () => {
  test.describe('CC-04.12: tee and backpressure', () => {
    test('two ports receive byte-identical chunk sequences', async () => {})
  })
})
`
    const ids = specLeadingCitations(source)
    expect(ids).toContain('CC-04.2')
    // The 'outer prose' wrapper prefix means the junit name does NOT lead
    // with CC-04.12 — exactly why prefixing describes with the ID (the
    // unit-04 test-author round) is the credited shape.
    expect(ids).not.toContain('CC-04.12')
    expect(modelledCaseTitles(source)).toContain('outer prose › CC-04.12: tee and backpressure › two ports receive byte-identical chunk sequences')
    // Without the wrapper the cited describe leads the junit name.
    expect(specLeadingCitations(`test.describe('CC-04.12: tee and backpressure', () => {
  test('two ports receive byte-identical chunk sequences', async () => {})
})`)).toEqual(['CC-04.12'])
  })

  test('comments and strings cannot fake a leading citation', () => {
    const source = `
// test('CC-04.77: forged in a comment', async () => {})
const note = "test('CC-04.88: forged in a string')"
test.describe('CC-04.1: video corpus decodes to spec', () => {
  test(\`CC-04.1: \${key.replace('.mp4', '')} decodes to spec\`, async () => {})
})
`
    expect(specLeadingCitations(source)).toEqual(['CC-04.1'])
  })

  test('ALL-CAPS tag words before a citation still lead (matches citationsOf)', () => {
    // Top-level test (no describe): the junit name IS the test title, so
    // caps tag words ahead of the citation still lead.
    expect(specLeadingCitations(`test('ADVERSARIAL CC-04.12: tee rows', async () => {})`)).toEqual(['CC-04.12'])
  })
})
