// unit-205 static anchor legs (gates-anchor.test.ts doctrine, units 101–106
// + 202): the durable wiring behind the three closure-suite criteria no
// single executable journey can pin — CC-205.2 (the webkit tier: the
// on-engine J4 half runs only under E2E_WEBKIT=1 and stays skipped in the
// chromium verify:unit spawn; the executable T3 proof is the J4b chromium
// mirror and its credit flows from the chromium playwright spawn, while
// these legs pin the WIRING), CC-205.3 (the criteria verifier ships and is
// consumed by the closure spec), and CC-205.4 (the closure suite is pure
// addition over the develop merge-base — a falsifiable git check, no test
// re-runs; tiered (PR #44): the additions-only diff runs wherever develop
// objects resolve, the committed-blob attestation (existence, non-emptiness,
// shape, work-tree == HEAD blob) runs everywhere — including the shallow
// PR-merge-ref CI checkout where FETCH_HEAD degenerates the merge-base to
// HEAD itself. Tier-B attests CI CONTEXT, not PR identity: the GitHub ref
// must match the git-flow unit-branch grammar (shared predicate in
// ./anchor-attestation) — the blob attestation is identity-free, so any
// legitimate unit-branch PR is a legal Tier-B checkout and forged
// non-ai-dlc refs (main, release/x) redden. The "all existing suites still
// green" half is carried by the
// verify:unit spawn itself, junit-trust: nonzero ⇒ zero credit). GREEN-state
// attestation stays with the unit report + the authoritative run, exactly as
// in gates-anchor.
// @anchor
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ciBranchFromEnv, CLOSURE_ANCHOR_AUTHORIZED_MODS, isUnitBranchCiContext } from './anchor-attestation'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const repoRoot = new URL('../../../', import.meta.url)
const SPEC = 'e2e/intent/styling-and-export.spec.ts'
const ANCHOR = 'tests/unit/intent/styling-and-export-anchor.test.ts'
const UNIT_FILE = '.ai-dlc/styling-and-export/unit-205-intent-closure-suite.md'
const INTENT_FILE = '.ai-dlc/styling-and-export/intent.md'
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

  /** Parse `git diff --name-status base HEAD -- TEST_SURFACE` and hard-assert
   *  the additive property: additions only (plus the CLOSURE_ANCHOR_
   *  AUTHORIZED_MODS documented exceptions riding the merged branch), both
   *  closure files among them. Any other M/D/R/C entry reddens — on a
   *  develop-object-bearing run a tampered committed test surface can never
   *  pass. */
  function assertAdditionsOnlyVs(base: string): void {
    const nameStatus = git(['diff', '--name-status', base, 'HEAD', '--', ...TEST_SURFACE])
    const violations: string[] = []
    const added: string[] = []
    for (const line of nameStatus.split('\n').filter((entry) => entry !== '')) {
      const tab = line.indexOf('\t')
      const status = tab < 0 ? line : line.slice(0, tab)
      const path = tab < 0 ? '' : line.slice(tab + 1).split('\t')[0] ?? ''
      if (status.startsWith('A')) added.push(path)
      else if (status.startsWith('M') && CLOSURE_ANCHOR_AUTHORIZED_MODS.includes(path)) continue
      else violations.push(`${status} ${path}`)
    }
    expect(violations, `the closure suite edits no committed test surface relative to ${base} beyond the documented authorized mods (FR-205.1 / CC-205.4)`).toEqual([])
    // The closure files ship as ADDITIONS relative to the base — or already
    // exist in it (the unit's own merge landed in develop and moved the base
    // past the addition; a later authoritative run on another unit's branch
    // then legitimately sees no A entry). Either way the blob attestation
    // pins the committed surface at HEAD + work tree.
    const shipped = (path: string): boolean => {
      if (added.includes(path)) return true
      try {
        git(['cat-file', '-e', `${base}:${path}`])
        return true
      } catch {
        return false
      }
    }
    expect(shipped(SPEC), 'the closure spec ships (added vs base, or already merged into it — the blob attestation pins it either way)').toBe(true)
    expect(shipped(ANCHOR), 'this anchor file ships (added vs base, or already merged into it — the blob attestation pins it either way)').toBe(true)
  }

  /** The attestation BOTH tiers run: the committed tree really carries the
   *  closure surface (existence, non-emptiness, shape) and the work tree the
   *  tests execute is byte-identical to the committed blobs. Without develop
   *  objects the diff-vs-develop half cannot run, but deleting or emptying
   *  the committed spec reddens the ls-tree/length assertions and any
   *  work-tree tampering reddens the hash-object assertion — this pair is
   *  the forgery surface that matters (junit credits flow from the work
   *  tree while criteria-credit models HEAD; they must agree). */
  function assertCommittedBlobAttestation(): void {
    const blobSha = new Map<string, string>()
    for (const line of git(['ls-tree', 'HEAD', '--', SPEC, ANCHOR]).split('\n').filter((entry) => entry !== '')) {
      const tab = line.indexOf('\t')
      if (tab < 0) continue
      const meta = line.slice(0, tab).split(/\s+/u)
      if (meta[1] === 'blob' && (meta[2] ?? '').length === 40) blobSha.set(line.slice(tab + 1), meta[2]!)
    }
    for (const required of [SPEC, ANCHOR]) {
      const sha = blobSha.get(required)
      expect(sha, `${required} exists as a committed blob at HEAD (delete / rename ⇒ red even without develop objects)`).toMatch(/^[0-9a-f]{40}$/u)
      expect(git(['hash-object', '--', required]), `${required} in the work tree is byte-identical to the committed blob (work-tree tamper ⇒ red: the tests run the work tree, the model reads HEAD)`).toBe(sha)
    }
    const committed = git(['show', `HEAD:${SPEC}`])
    expect(committed.length, 'the committed closure spec is non-empty (empty-out ⇒ red even without develop objects)').toBeGreaterThan(2_000)
    expect(committed, 'the committed closure spec carries its lead-citation journey describes (shape check only — the full committed-model lint lives in J8 / the CC-205.1 leg)').toContain("test.describe('CC-I3.4 CC-205.2")
  }

  test('CC-205.4: committed blob attestation always, plus an additions-only git diff vs the develop merge-base whenever develop objects resolve', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    // Attestation tiering (gates-anchor wiring-not-green-state doctrine;
    // CI-proven 2026-11-24 on PR #44: a PR-merge-ref checkout is a shallow
    // single-commit fetch — FETCH_HEAD points AT the checkout itself, so an
    // unguarded merge-base(FETCH_HEAD, HEAD) degenerates to HEAD and the
    // diff leg runs vacuously (empty added list); and develop objects are
    // absent there, so the diff-vs-develop half is physically unrunnable):
    //   Tier A — a real (non-degenerate) merge-base against origin/develop,
    //     develop or FETCH_HEAD resolves (every local/authoritative run):
    //     full additions-only diff over the test surface = the CC-205.4
    //     "zero edits to committed specs" proof, hard-red on tampering.
    //   Tier B — no base resolves (shallow PR-merge-ref CI checkout): legal
    //     ONLY inside a genuine CI checkout of a git-flow unit branch —
    //     GITHUB_HEAD_REF/GITHUB_REF present and matching the
    //     ai-dlc/<intent>/<unit-stem> grammar (red otherwise — never
    //     vacuous). CI CONTEXT, not PR identity: the blob attestation is
    //     identity-free, so a FOREIGN well-formed ai-dlc ref legitimately
    //     passes (the same pipeline runs the same committed suite for every
    //     unit PR, and it describes that tree honestly either way), while a
    //     forged main / release/x redden; the merged ref itself is the
    //     additive attestation there (it is develop ∪ branch, and "all
    //     existing suites still green" is verifier-owned via junit-trust).
    //   The blob attestation above runs in BOTH tiers, so work-tree tampering
    //     reddens locally too, not just the committed diff.
    // Tier option (b) — diffing the merge commit's parents — was rejected:
    // on GitHub merge refs HEAD^1 is the develop tip and on branch merge
    // commits it is the pre-merge branch head; either orientation mixes
    // develop-side modifications into the diff (false red) or an
    // any-parent relaxation hides deep tampering (false green).
    assertCommittedBlobAttestation()
    let head = ''
    try {
      head = git(['rev-parse', 'HEAD'])
    } catch {
      head = ''
    }
    expect(head, 'HEAD resolves — git is available where this attestation runs').toMatch(/^[0-9a-f]{40}$/u)
    let base = ''
    for (const candidate of ['origin/develop', 'develop', 'FETCH_HEAD']) {
      try {
        const out = git(['merge-base', candidate, 'HEAD'])
        // A self-base (the PR-merge-ref FETCH_HEAD trap) makes the diff
        // empty by construction — never an attestation.
        if (/^[0-9a-f]{40}$/u.test(out) && out !== head) {
          base = out
          break
        }
      } catch {
        // candidate ref absent — try the next
      }
    }
    if (base !== '') {
      assertAdditionsOnlyVs(base)
      return
    }
    const ciBranch = ciBranchFromEnv()
    expect(isUnitBranchCiContext(), `no develop-object-bearing merge-base resolved — Tier-B is legal only inside a genuine CI checkout of a git-flow unit-branch PR (GITHUB_HEAD_REF/GITHUB_REF matching ai-dlc/<intent>/<unit-stem>; CI context, not PR identity — the blob attestation above is identity-free); observed ciBranch='${ciBranch}'; there the committed-blob attestation above is the CI-tier proof`).toBe(true)
  })
})
