// unit-205 static anchor legs (gates-anchor.test.ts doctrine, units 101–106
// + 202): the durable wiring behind the three closure-suite criteria no
// single executable journey can pin — CC-205.2 (the webkit tier: the
// on-engine J4 half runs only under E2E_WEBKIT=1 and stays skipped in the
// chromium verify:unit spawn; the executable T3 proof is the J4b chromium
// mirror and its credit flows from the chromium playwright spawn, while
// these legs pin the WIRING), CC-205.3 (the criteria verifier ships and is
// consumed by the closure spec), and CC-205.4 (the closure suite is pure
// addition over the develop merge-base — a falsifiable git check, no test
// re-runs; the "all existing suites still green" half is carried by the
// verify:unit spawn itself, junit-trust: nonzero ⇒ zero credit). GREEN-state
// attestation stays with the unit report + the authoritative run, exactly as
// in gates-anchor.
// @anchor
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const repoRoot = new URL('../../../', import.meta.url)
const SPEC = 'e2e/intent/styling-and-export.spec.ts'
const ANCHOR = 'tests/unit/intent/styling-and-export-anchor.test.ts'
const UNIT_FILE = '.ai-dlc/styling-and-export/unit-205-intent-closure-suite.md'
const INTENT_FILE = '.ai-dlc/styling-and-export/intent.md'
const UNIT_BRANCH = 'ai-dlc/styling-and-export/unit-205-intent-closure-suite'
const CITED_ROWS = ['CC-I3.1', 'CC-I3.2', 'CC-I3.3', 'CC-I3.4', 'CC-I3.5', 'CC-I3.6', 'CC-I3.7', 'CC-I3.8', 'CC-I3.10']

function read(rel: string): string {
  return readFileSync(new URL(rel, repoRoot), 'utf8')
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot.pathname, encoding: 'utf8' }).trim()
}

describe('CC-205.2: the webkit export-tier journey and its chromium mirror leg are wired', () => {
  test('CC-205.2: the closure spec ships the lead-cited J4 webkit journey (formats offered, MP4 never) and the J4b chromium AudioEncoder-less mirror', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spec = read(SPEC)
    expect(spec, 'J4 lead-cites CC-I3.4 + CC-205.2 in its describe').toMatch(/test\.describe\(\s*'CC-I3\.4 CC-205\.2:[^\n]*\(webkit\)'/u)
    expect(spec, 'J4 is project-tagged, not skip-free (FR-205.3)').toContain("browserName !== 'webkit'")
    expect(spec, 'the tier keeps the four sidecar formats offered').toContain('sidecar-format-')
    expect(spec, 'the encoder-less branch never offers MP4 burn-in').toContain('burnin-start')
    expect(spec, 'the absent offer is replaced by the honest gating copy').toContain('burnin-absent-reason')
    expect(spec, 'the gating copy names the missing encoder (unit-202 contract)').toContain("toContainText('AudioEncoder')")
    expect(spec, 'J4b (chromium mirror) lead-cites CC-I3.4 + CC-205.2').toMatch(/test\.describe\(\s*'CC-I3\.4 CC-205\.2:[^\n]*\(chromium\)'/u)
    expect(spec, 'J4b deletes AudioEncoder via addInitScript (unit-202 gating.spec.ts doctrine)').toContain("Object.defineProperty(window, 'AudioEncoder'")
  })

  test('CC-205.2: the webkit project ships in the playwright config, gated behind E2E_WEBKIT', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const config = read('playwright.config.ts')
    expect(config, "a 'webkit' project exists").toContain("name: 'webkit'")
    expect(config, 'the webkit tier is gated by E2E_WEBKIT (FR-1.0.4)').toContain('E2E_WEBKIT')
    expect(config, 'the webkit project runs Desktop Safari').toContain('Desktop Safari')
  })
})

describe('CC-205.3: the criteria-verifier wiring ships and is consumed by the closure suite', () => {
  test('CC-205.3: verify-criteria, junit-trust and criteria-credit ship; the spec consumes citationsOf; both verify scripts are declared gates', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    expect(existsSync(new URL('scripts/verify-criteria.ts', repoRoot)), 'the criteria verifier ships').toBe(true)
    expect(existsSync(new URL('scripts/lib/junit-trust.ts', repoRoot)), 'the junit-trust provenance policy ships').toBe(true)
    expect(existsSync(new URL('scripts/lib/criteria-credit.ts', repoRoot)), 'the e2e-credit policy ships').toBe(true)
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['verify:unit'], 'verify:unit is a declared gate').toContain('verify-criteria')
    expect(pkg.scripts['verify:intent'], 'verify:intent is a declared gate').toContain('verify-criteria')
    const spec = read(SPEC)
    expect(spec, 'the closure spec consumes the verifier citation parser').toContain('../../scripts/lib/junit-trust')
    expect(spec, 'and applies it to its own title space').toContain('citationsOf(')
  })

  test('CC-205.3: every credited CC-I3 row lead-cites both its journey describe and its test; the [DEPLOY] row never leads', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spec = read(SPEC)
    for (const row of CITED_ROWS) {
      expect(spec, `${row} leads a test title`).toContain(`test('${row}`)
      expect(spec, `${row} leads a describe title`).toContain(`test.describe('${row}`)
    }
    expect(/test(?:\.describe)?\(\s*'CC-I3\.9(?![.\d])/u.test(spec), 'CC-I3.9 ([DEPLOY]) is never lead-cited (conventions § Criterion traceability)').toBe(false)
    const unit = read(UNIT_FILE)
    for (let n = 1; n <= 5; n++) expect(unit, `unit-205 declares CC-205.${n}`).toContain(`CC-205.${n}`)
    const intent = read(INTENT_FILE)
    for (const row of CITED_ROWS) expect(intent, `the intent declares ${row}`).toContain(row)
  })
})

describe('CC-205.4: the closure suite is additive over the develop merge-base', () => {
  // The test surface whose committed files the closure suite must never edit
  // (FR-205.1). src/** + qualification/** are deliberately OUT of this list:
  // the About/licensing composition leg (5bc27cb, the review-round J9 blocker
  // resolution) is a shipped feature commit — and the "all existing suites
  // still green" half of CC-205.4 is attested by the verify:unit spawn
  // (junit-trust: a nonzero exit anywhere ⇒ zero credit), not by this leg.
  const TEST_SURFACE = ['e2e', 'tests', 'scripts', 'fixtures', 'package.json', 'pnpm-lock.yaml', 'playwright.config.ts', 'vitest.config.ts', 'vitest.config.qualify.ts', 'vite.config.ts', 'tsconfig.json', 'bundle-budget.json']

  test('CC-205.4: git diff develop-merge-base..HEAD shows additions only — no committed e2e/tests/scripts/config file is modified, renamed or deleted', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    // CI-honest (unit-105/106 adjudications): a PR-merge-ref checkout is a
    // shallow single-commit fetch with no develop objects — merge-base then
    // cannot resolve and the diff leg is replaced by the merge-tree
    // attestation below (the merged ref itself is the additive evidence).
    let base = ''
    for (const candidate of ['develop', 'origin/develop', 'FETCH_HEAD']) {
      try {
        const out = git(['merge-base', candidate, 'HEAD'])
        if (/^[0-9a-f]{40}$/u.test(out)) {
          base = out
          break
        }
      } catch {
        // candidate ref absent — try the next
      }
    }
    if (base === '') {
      const ciBranch = (process.env.GITHUB_HEAD_REF ?? '').trim() || (process.env.GITHUB_REF ?? '').trim().replace(/^refs\/heads\//, '')
      expect(ciBranch, 'the develop merge-base is unresolvable — legal only inside a PR/branch CI checkout (shallow fetch); it must carry the unit branch in GITHUB_HEAD_REF/GITHUB_REF').toBe(UNIT_BRANCH)
      const tree = git(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'e2e/intent', 'tests/unit/intent']).split('\n').filter((line) => line !== '')
      expect(tree, 'the merged tree carries the closure spec').toContain(SPEC)
      expect(tree, 'the merged tree carries this anchor file').toContain(ANCHOR)
      return
    }
    const nameStatus = git(['diff', '--name-status', base, 'HEAD', '--', ...TEST_SURFACE])
    const violations: string[] = []
    const added: string[] = []
    for (const line of nameStatus.split('\n').filter((entry) => entry !== '')) {
      const tab = line.indexOf('\t')
      const status = tab < 0 ? line : line.slice(0, tab)
      const path = tab < 0 ? '' : line.slice(tab + 1).split('\t')[0] ?? ''
      if (status.startsWith('A')) added.push(path)
      else violations.push(`${status} ${path}`)
    }
    expect(violations, 'the closure suite edits no committed test surface relative to the develop merge-base (FR-205.1 / CC-205.4)').toEqual([])
    expect(added, 'the closure spec ships as an addition').toContain(SPEC)
    expect(added, 'this anchor file ships as an addition').toContain(ANCHOR)
  })
})
