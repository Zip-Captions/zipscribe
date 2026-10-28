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
// `--root` scopes test *discovery* to another tree (used by the scaffold
// negative tests); the unit file always resolves against the repository root.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface Criterion {
  id: string
  tag?: string
}

function parseCriteria(file: string): Criterion[] {
  const text = readFileSync(file, 'utf8')
  const found: Criterion[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(/\*\*(CC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.\d+)\*\*\s*(?:`|\s)*\[(RQ|DEPLOY|MANUAL)\]?/g)) {
    const id = match[1]!
    if (!seen.has(id)) {
      found.push({ id, tag: match[2] })
      seen.add(id)
    }
  }
  for (const match of text.matchAll(/\*\*(CC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.\d+)\*\*(?!\s*(?:`|\s)*\[)/g)) {
    const id = match[1]!
    if (!seen.has(id)) {
      found.push({ id })
      seen.add(id)
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

interface TestCase {
  title: string
  status: 'passed' | 'failed' | 'skipped'
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function parseJunit(file: string): TestCase[] {
  if (!existsSync(file)) return []
  const xml = readFileSync(file, 'utf8')
  const cases: TestCase[] = []
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = match[1] ?? ''
    const body = match[2] ?? ''
    const nameMatch = attrs.match(/(?:^|\s)name="([^"]*)"/)
    const statusMatch = attrs.match(/(?:^|\s)status="([^"]*)"/)
    const title = decodeEntities(nameMatch?.[1] ?? '')
    let status: TestCase['status'] = 'passed'
    if (/<(failure|error)\b/.test(body) || statusMatch?.[1] === 'unexpected') status = 'failed'
    else if (/<skipped\b/.test(body) || statusMatch?.[1] === 'skipped') status = 'skipped'
    cases.push({ title, status })
  }
  return cases
}

function run(command: string, args: string[], timeoutMs: number): { status: number; output: string } {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    // No ZIPSCRIBE_CHILD here: a criteria verification is the authoritative
    // full run and must see every test file, including the gates scaffold.
    env: { ...process.env, CI: process.env.CI ?? '1', NO_COLOR: '1', ZIPSCRIBE_CHILD: undefined },
    maxBuffer: 64 * 1024 * 1024,
  })
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` }
}

function collectTests(testRoot: string): TestCase[] {
  const outDir = mkTmp('zipscribe-verify')
  const cases: TestCase[] = []
  const vitestArgs = ['pnpm', 'exec', 'vitest', 'run', '--root', testRoot, '--reporter=junit', `--outputFile.junit=${join(outDir, 'vitest.xml')}`]
  if (testRoot === repoRoot) vitestArgs.splice(4, 0, '--reporter=default')
  const vitest = run('corepack', vitestArgs, 30 * 60_000)
  cases.push(...parseJunit(join(outDir, 'vitest.xml')))
  if (vitest.status !== 0 && cases.length === 0) {
    console.error(vitest.output.slice(-4000))
    throw new Error('vitest run produced no JUnit results')
  }
  // Playwright (e2e) only for whole-repo verification.
  if (testRoot === repoRoot) {
    const playwright = run('corepack', ['pnpm', 'exec', 'playwright', 'test', '--project=chromium', '--reporter=junit', `--output=${join(outDir, 'pw')}`], 20 * 60_000)
    const junitCandidates = [join(outDir, 'pw', 'junit.xml'), join(repoRoot, 'test-results', 'junit.xml')]
    for (const candidate of junitCandidates) cases.push(...parseJunit(candidate))
    if (playwright.status !== 0 && playwright.output.length === 0) throw new Error('playwright run failed silently')
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
// REVIEW.md #13): a citation counts only when the ID leads the title —
// optionally after a run of ALL-CAPS tag words (e.g. `ADVERSARIAL CC-01.3:
// …`). An ID merely embedded in prose (`… NOTA-CITATION CC-999.2 …`) or glued
// to other tokens (`FR-1.0.12 / CC-I1.11`) discusses the ID, it does not
// declare the test as covering it, and must not produce coverage or UNKNOWN-ID
// verdicts.
function citationsOf(title: string): string[] {
  const stripped = title.replace(/^(?:[A-Z]+[ \t]+)+/, '')
  if (!/^(?:CC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.\d+)(?![A-Za-z0-9.-])/.test(stripped)) return []
  return [...stripped.matchAll(/CC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.\d+/g)].map((match) => match[0])
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
  const declared = new Set(criteria.map((criterion) => criterion.id))
  const passingIds = new Set<string>()
  const citedIds = new Set<string>()
  const citations = new Map<string, number>()
  for (const testCase of cases) {
    for (const id of citationsOf(testCase.title)) {
      citedIds.add(id)
      citations.set(id, (citations.get(id) ?? 0) + (testCase.status === 'passed' ? 1 : 0))
      if (testCase.status === 'passed') passingIds.add(id)
    }
  }

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
  const reportDir = join(repoRoot, 'reports', 'criteria')
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `${reportName}.md`)
  writeFileSync(reportPath, report)

  console.log(report)
  console.log(`criteria report written: ${reportPath}`)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`verify:unit: ${problem}`)
    process.exit(1)
  }
  console.log(`verify — all untagged criteria of ${basename(unitFile)} covered (${criteria.length} total).`)
}

main()
