// FR-1.0.12 / conventions § Criterion traceability — `pnpm verify:unit` and
// `pnpm verify:intent`.
//
// Parses the criteria of a unit (or intent) markdown file, runs the vitest and
// Playwright suites with JUnit reporters, and maps test titles that cite
// CC-IDs back onto the criteria. Fails when an untagged criterion has no
// passing test, or when a test cites an ID the file does not declare. Writes
// reports/criteria/<name>.md.
//
// Modes:
//   verify:unit <path-to-unit.md> [--root <dir>] [--from-branch] [--no-run]
//   verify:unit --from-branch        → unit derived from the git branch
//   verify:intent <intent-slug>
// `--no-run` is the control/probe mode (parse criteria, no test run, exit
// non-zero on uncovered IDs) and never writes the canonical report.
// `--root` scopes test *discovery* to another tree (used by the scaffold
// negative tests); the unit file always resolves against the repository root.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectPlaywrightEvidence, parseJunit } from './lib/junit-trust.ts'
import type { TestCase } from './lib/junit-trust.ts'
import { committedE2eSpecSources, countCitations, playwrightBackedIds } from './lib/criteria-credit.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface Criterion {
  id: string
  tag?: string
  /**
   * The unit spec names Playwright as this criterion's evidence ("**CC-…**
   * Playwright: …"). Derived from the COMMITTED spec text, never from a live
   * scan of `e2e/` — otherwise deleting the spec file silently downgrades the
   * criterion back to vitest crediting (unit-03 review round 2, F2: the
   * self-fulfilling downgrade).
   */
  e2e?: boolean
}

function listSpecMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSpecMarkdown(full))
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

const PLAYWRIGHT_SPEC = /^\**\s*(?:\[?[A-Z]+\]?\s*)?Playwright\b/i

/** Does the spec line that declares this criterion name Playwright as its evidence? */
function declaresPlaywright(text: string, id: string): boolean {
  for (const line of text.split('\n')) {
    if (!line.includes(`**${id}**`)) continue
    const afterId = line.slice(line.indexOf(`**${id}**`) + id.length + 4).trim()
    if (PLAYWRIGHT_SPEC.test(afterId)) return true
  }
  return false
}

function parseCriteria(file: string): Criterion[] {
  const text = readFileSync(file, 'utf8')
  const found: Criterion[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(/\*\*(CC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.\d+)\*\*\s*(?:`|\s)*\[(RQ|DEPLOY|MANUAL)\]?/g)) {
    const id = match[1]!
    if (!seen.has(id)) {
      found.push({ id, tag: match[2], e2e: declaresPlaywright(text, id) })
      seen.add(id)
    }
  }
  for (const match of text.matchAll(/\*\*(CC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.\d+)\*\*(?!\s*(?:`|\s)*\[)/g)) {
    const id = match[1]!
    if (!seen.has(id)) {
      found.push({ id, e2e: declaresPlaywright(text, id) })
      seen.add(id)
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

// spawnSync status is preserved as `number | null` (NOT collapsed to 1): a
// null status means the process was killed, timed out, or failed to spawn —
// results on disk after such a run are never trusted (unit-02 doctrine,
// scripts/qualify.ts readQualifyResults @ eb61046, extended to the e2e junit
// by scripts/lib/junit-trust.ts after the unit-03 adversary).
function run(command: string, args: string[], timeoutMs: number, extraEnv?: Record<string, string>): { status: number | null; output: string } {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    // No ZIPSCRIBE_CHILD here: a criteria verification is the authoritative
    // full run and must see every test file, including the gates scaffold.
    env: { ...process.env, CI: process.env.CI ?? '1', NO_COLOR: '1', ZIPSCRIBE_CHILD: undefined, ...extraEnv },
    maxBuffer: 64 * 1024 * 1024,
  })
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` }
}

function collectTests(testRoot: string): TestCase[] {
  const outDir = mkTmp('zipscribe-verify')
  const cases: TestCase[] = []
  const vitestArgs = ['pnpm', 'exec', 'vitest', 'run', '--root', testRoot, '--reporter=junit', `--outputFile.junit=${join(outDir, 'vitest.xml')}`]
  if (testRoot === repoRoot) vitestArgs.splice(4, 0, '--reporter=default')
  const vitest = run('corepack', vitestArgs, 30 * 60_000)
  if (vitest.status === null) {
    // Killed / timed out / failed to spawn: whatever the reporter wrote (if
    // anything) is not this run's complete evidence — never partially
    // trusted (unit-02 spawn-null doctrine, scripts/qualify.ts @ eb61046).
    throw new Error('vitest run did not complete (spawn failed, killed, or timed out) — JUnit results distrusted')
  }
  cases.push(...parseJunit(join(outDir, 'vitest.xml'), 'vitest'))
  if (vitest.status !== 0 && cases.length === 0) {
    console.error(vitest.output.slice(-4000))
    throw new Error('vitest run produced no JUnit results')
  }
  // Playwright (e2e) only for whole-repo verification.
  // Builder fix (unit-03): Playwright's junit reporter writes to STDOUT when
  // only `--output=<dir>` is given — it never creates `<dir>/junit.xml`, so
  // e2e criteria silently collected 0 cases (first exposed by CC-03.3, the
  // first e2e-sourced untagged criterion). `PLAYWRIGHT_JUNIT_OUTPUT_FILE` is
  // the reporter's documented file-output env var (verified against the
  // pinned @playwright/test 1.64.1).
  //
  // Adversary fix (unit-03 finding 1): the junit is only credited through
  // collectPlaywrightEvidence — pre-existing candidates (including the
  // persistent repo `test-results/junit.xml` fallback) are wiped before the
  // spawn, a null/nonzero child yields ZERO e2e-sourced credit, and accepted
  // files must be freshly written inside the spawn window. A deleted spec +
  // planted junit can therefore never fabricate e2e coverage.
  if (testRoot === repoRoot) {
    const playwrightOutDir = join(outDir, 'pw')
    const playwrightJunitFile = join(playwrightOutDir, 'junit.xml')
    const evidence = collectPlaywrightEvidence({
      tmpJunitFile: playwrightJunitFile,
      persistentJunitFile: join(repoRoot, 'test-results', 'junit.xml'),
      spawn: (junitFile) =>
        // unit-04 CC-04.9: the `memory` project (e2e/media/memory/**) is
        // testIgnore-excluded from chromium to keep its spec-spawned isolated
        // preview (4312) single-owner; it must still be exercised for the
        // e2e-sourced criteria to be collectible. GREEN-phase note: the real
        // 120-min decode is a reference-hardware gate — if it outgrows this
        // window at release time the memory project belongs in `qualify`,
        // not a longer spawn here (unit report follow-up).
        run('corepack', ['pnpm', 'exec', 'playwright', 'test', '--project=chromium', '--project=memory', '--reporter=junit', `--output=${playwrightOutDir}`], 20 * 60_000, {
          PLAYWRIGHT_JUNIT_OUTPUT_FILE: junitFile,
        }),
      parse: (file) => parseJunit(file, 'playwright'),
    })
    cases.push(...evidence.cases)
    if (evidence.failure) console.error(`verify:unit: e2e evidence rejected — ${evidence.failure}`)
  }
  return cases
}

import { mkdtempSync } from 'node:fs'
function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function git(args: string[]): string {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).stdout?.trim() ?? ''
}

// The unit branch under CI: `actions/checkout@v4` leaves PR jobs in DETACHED
// HEAD, where `git branch --show-current` prints nothing — resolving only
// through it would silently no-op the criteria gate exactly where
// settings.yml/AGENTS.md require it ("enforced in CI on every PR"). Try, in
// order: the named branch, then GitHub's PR/ref env, then any (remote-)branch
// whose history contains HEAD.
function unitFileFromBranch(): string | null {
  const candidates: string[] = []
  const current = git(['branch', '--show-current'])
  if (current) candidates.push(current)
  else {
    const headRef = (process.env.GITHUB_HEAD_REF ?? '').trim()
    const ref = (process.env.GITHUB_REF ?? '').trim().replace(/^refs\/heads\//, '')
    if (headRef) candidates.push(headRef)
    if (ref) candidates.push(ref)
    if (candidates.length === 0) {
      const containing = [
        ...git(['branch', '--format=%(refname:short)', '--contains', 'HEAD']).split('\n'),
        ...git(['branch', '-r', '--format=%(refname:short)', '--contains', 'HEAD'])
          .split('\n')
          .map((line) => line.replace(/^(origin|upstream)\//, '')),
      ]
      candidates.push(
        ...containing
          .map((line) => line.trim())
          .filter(Boolean)
          .sort(),
      )
    }
  }
  for (const branch of [...new Set(candidates)]) {
    const match = branch.match(/^ai-dlc\/([^/]+)\/(.+)$/)
    if (!match) continue
    const candidate = join(repoRoot, '.ai-dlc', match[1]!, `${match[2]}.md`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

// "Tests name the criterion" (conventions § Criterion traceability,
// REVIEW.md #13) — the citation grammar moved to scripts/lib/junit-trust.ts
// (unit-04 F-6) so committed e2e spec titles are modelled with the same
// leading-run rule; credit decisions run through scripts/lib/criteria-credit.ts
// countCitations (single auditable policy, exercised by the scaffold
// regression suite).

/**
 * L4 criteria whose evidence must come from Playwright (unit-03 review F2).
 * The set is derived from the criterion's own spec text ("**CC-…** Playwright:
 * …"), which is committed and immutable during verification — deleting the
 * e2e spec file must never make a Playwright criterion start accepting vitest
 * citations. Unit-04 adversary F-6 extends "must come from Playwright" beyond
 * the unit-file declaration: any ID that a COMMITTED e2e spec lead-cites
 * (e.g. CC-04.9/CC-04.10 — the spec text names them but the unit line carries
 * no `Playwright` token) is credited only from playwright-sourced junit cases,
 * so two planted `expect(1).toBe(1)` vitest titles can no longer forge a pass.
 */
function e2eBackedIds(criteria: Criterion[], specSources: ReadonlyMap<string, string>): Set<string> {
  const ids = playwrightBackedIds(specSources)
  for (const criterion of criteria) if (criterion.e2e) ids.add(criterion.id)
  return ids
}

function main(): void {
  const argv = process.argv.slice(2)
  const mode = argv[0] === 'unit' || argv[0] === 'intent' ? (argv.shift() as string) : 'unit'
  const fromBranch = argv.includes('--from-branch')
  const noRun = argv.includes('--no-run')
  const rootIndex = argv.indexOf('--root')
  const testRoot = rootIndex >= 0 ? resolve(argv[rootIndex + 1] ?? repoRoot) : process.env.ZIPSCRIBE_VERIFY_ROOT ? resolve(process.env.ZIPSCRIBE_VERIFY_ROOT) : repoRoot
  const positional = argv.filter((arg, index) => !arg.startsWith('--') && !(rootIndex >= 0 && index === rootIndex + 1))

  let unitFile: string | null = null
  let reportName = ''
  if (mode === 'unit') {
    if (positional.length > 0) unitFile = resolve(repoRoot, positional[0]!)
    else if (fromBranch) unitFile = unitFileFromBranch()
    if (unitFile === null) {
      console.log('verify:unit — not a unit branch (no ai-dlc/<intent>/<unit-stem>); no-op.')
      process.exit(0)
    }
    if (!existsSync(unitFile)) {
      console.error(`verify:unit — unit file not found: ${unitFile}`)
      process.exit(1)
    }
    reportName = basename(unitFile, '.md')
  } else {
    const slug = positional[0]
    if (!slug) {
      console.error('verify:intent — usage: pnpm verify:intent <intent-slug>')
      process.exit(1)
    }
    unitFile = join(repoRoot, '.ai-dlc', slug, 'intent.md')
    reportName = slug
  }

  const criteria = parseCriteria(unitFile)
  if (criteria.length === 0) {
    console.error(`verify — no CC-* criteria found in ${unitFile}`)
    process.exit(1)
  }

  const cases = noRun ? [] : collectTests(testRoot)
  // Multi-unit repos: a whole-repo test scan cites the criteria of sibling
  // units of the same intent (not "unknown" — declared by other units' files).
  // Coverage still checks ONLY this unit's criteria; the unknown-ID check
  // additionally accepts IDs declared anywhere under .ai-dlc/** (the
  // orchestrator-owned spec tree), so cross-unit citations pass.
  const declared = new Set(criteria.map((criterion) => criterion.id))
  for (const file of listSpecMarkdown(join(repoRoot, '.ai-dlc'))) {
    if (file === unitFile) continue
    for (const criterion of parseCriteria(file)) declared.add(criterion.id)
  }
  // Unit-04 adversary F-6 (A-11): the playwright-backed set comes from the
  // COMMITTED spec text at git HEAD — immutable during verification, so
  // neither a planted vitest file nor a working-tree spec deletion can
  // downgrade a Playwright-backed criterion to vitest-title crediting.
  const specSources = committedE2eSpecSources(repoRoot)
  const e2eOnly = e2eBackedIds(criteria, specSources)
  const { citations, passing: passingIds, cited: citedIds } = countCitations(cases, e2eOnly)

  const problems: string[] = []
  for (const criterion of criteria) {
    if (criterion.tag) continue // [RQ] / [DEPLOY] / [MANUAL] — outside the PR pipeline
    if (!passingIds.has(criterion.id)) problems.push(`UNCOVERED: ${criterion.id} has no passing test citing it`)
  }
  for (const id of [...citedIds].sort()) {
    if (!declared.has(id)) problems.push(`UNKNOWN ID: a test cites ${id}, which ${unitFile} does not declare`)
  }

  const rows = criteria.map((criterion) => {
    const count = passingIds.has(criterion.id) ? (citations.get(criterion.id) ?? 0) : 0
    const result = criterion.tag ? `${criterion.tag} (outside PR pipeline)` : passingIds.has(criterion.id) ? 'pass' : 'FAIL'
    return `| ${criterion.id} | ${criterion.tag ?? 'untagged'} | ${count} | ${result} |`
  })
  const report = `# Criteria — ${reportName}\n\n| ID | level | passing tests | result |\n|---|---|---|---|\n${rows.join('\n')}\n`
  console.log(report)
  if (noRun) {
    // REVIEW round-2 R2-5: a `--no-run` invocation has no test results, so its
    // table is all-FAIL by construction. Writing it would clobber the
    // canonical reports/criteria/<name>.md of the real run with a false
    // verdict (correctness would hang on step ordering alone). Control
    // invocations print only.
    console.log('verify — --no-run control invocation: canonical report NOT written (reports/criteria left untouched)')
  } else {
    const reportDir = join(repoRoot, 'reports', 'criteria')
    mkdirSync(reportDir, { recursive: true })
    const reportPath = join(reportDir, `${reportName}.md`)
    writeFileSync(reportPath, report)
    console.log(`criteria report written: ${reportPath}`)
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`verify:unit: ${problem}`)
    process.exit(1)
  }
  console.log(`verify — all untagged criteria of ${basename(unitFile)} covered (${criteria.length} total).`)
}

main()
