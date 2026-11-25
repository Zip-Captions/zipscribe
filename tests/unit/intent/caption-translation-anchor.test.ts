// unit-303 static anchor legs (gates-anchor.test.ts doctrine, units 101–106
// + 202): the durable wiring behind the two closure-suite criteria no single
// executable journey can pin — CC-303.3 (the criteria-verifier wiring: the
// `pnpm verify:intent caption-translation` credit path is scripts + intent-md
// + spec consumption, attested statically; the GREEN-state half stays with the
// authoritative run) and CC-303.4 (`pnpm test` + `pnpm test:e2e` fully green,
// pure addition over the develop merge-base — the tiered CI-robust blob
// attestation copied from the unit-205 CC-205.4 doctrine, incl. the
// degenerate self-base guard; Tier-B attests CI CONTEXT, not PR identity —
// the GitHub ref must match the git-flow unit-branch grammar (shared
// predicate in ./anchor-attestation), the blob attestation is identity-free
// so any legitimate unit-branch PR is a legal Tier-B checkout while forged
// non-ai-dlc refs (main, release/x) redden; the "all existing suites still
// green" half is
// carried by the verify:unit spawn itself, junit-trust: nonzero ⇒ zero
// credit). The FR-303.1-authorized test-surface modifications (identical-id
// split L1 cases + the corrected translations-stub pin) are the ONLY tolerated
// non-A entries; the authorized src fix itself is shape-attested below.
// @anchor
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { citationsOf } from '../../../scripts/lib/junit-trust'
import { ciBranchFromEnv, CLOSURE_ANCHOR_AUTHORIZED_MODS, isUnitBranchCiContext } from './anchor-attestation'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const repoRoot = new URL('../../../', import.meta.url)
const SPEC = 'e2e/intent/caption-translation.spec.ts'
const ANCHOR = 'tests/unit/intent/caption-translation-anchor.test.ts'
const UNIT_FILE = '.ai-dlc/caption-translation/unit-303-intent-closure-suite.md'
const INTENT_FILE = '.ai-dlc/caption-translation/intent.md'
const CITED_ROWS = ['CC-I4.1', 'CC-I4.3', 'CC-I4.4', 'CC-I4.5', 'CC-I4.7']

// The dual-lead contract (CC-303.1/.2 credit mechanics): every journey
// describe lead-leads BOTH its unit criterion and its intent criterion,
// verified through the repo's own citation grammar.
const DUAL_LEADS: Array<readonly [string, readonly string[]]> = [
  ['CC-303.1 CC-I4.1: 200-block en → mocked fr+es run', ['CC-303.1', 'CC-I4.1']],
  ['CC-303.1 CC-I4.3: edited translation + source split → stale', ['CC-303.1', 'CC-I4.3']],
  ['CC-303.1 CC-I4.4: per-language export + translation burn-in', ['CC-303.1', 'CC-I4.4']],
  ['CC-303.1 CC-I4.7: console redaction across a translate journey', ['CC-303.1', 'CC-I4.7']],
  ['CC-I4.5 CC-303.2: unsupported-browser gating journey (webkit)', ['CC-I4.5', 'CC-303.2']],
  ['CC-I4.5 CC-303.2: T5b chromium Translator-less gating mirror — translation actions absent with the explanatory note, import + manual still work (chromium)', ['CC-I4.5', 'CC-303.2']],
]

function read(rel: string): string {
  return readFileSync(new URL(rel, repoRoot), 'utf8')
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot.pathname, encoding: 'utf8' }).trim()
}

describe('CC-303.3: the criteria-verifier wiring ships and is consumed by the closure suite', () => {
  test('CC-303.3: verify-criteria, junit-trust and criteria-credit ship; the spec consumes citationsOf; both verify scripts are declared gates', async ({ skip }) => {
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

  test('CC-303.3: every credited CC-I4 row lead-cites its journey describe AND test through the repo citation grammar; unit + intent declare their rows', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spec = read(SPEC)
    for (const [title, ids] of DUAL_LEADS) {
      expect(spec, `the '${title}' describe ships`).toContain(`test.describe('${title}'`)
      expect(citationsOf(title), `'${title}' parses to ${ids.join(' + ')}`).toEqual(ids)
    }
    const CHROMIUM_ROWS = ['CC-I4.1', 'CC-I4.3', 'CC-I4.4', 'CC-I4.7']
    for (const row of CHROMIUM_ROWS) {
      expect(spec, `${row} leads a test title`).toContain(`test('CC-303.1 ${row}:`)
      expect(spec, `${row} leads a describe title`).toContain(`test.describe('CC-303.1 ${row}:`)
    }
    // The gating pair (T5 + T5b mirror) leads the webkit pair instead.
    for (const id of ['CC-I4.5', 'CC-303.2']) {
      expect(spec, `${id} leads a test title`).toContain(`test('CC-I4.5 CC-303.2:`)
      expect(spec, `${id} leads a describe title`).toContain(`test.describe('CC-I4.5 CC-303.2:`)
    }
    const unit = read(UNIT_FILE)
    for (let n = 1; n <= 5; n++) expect(unit, `unit-303 declares CC-303.${n}`).toContain(`CC-303.${n}`)
    const intent = read(INTENT_FILE)
    for (const row of CITED_ROWS) expect(intent, `the intent declares ${row}`).toContain(row)
  })
})

describe('CC-303.4: the closure suite is additive over the develop merge-base', () => {
  // The test surface whose committed files the closure suite must never edit
  // (FR-303.1). src/** is deliberately OUT of this list: the authorized
  // onBlockSplit fix (orchestrator authorization 2026-11-24, reviewer F-1) is
  // a shipped feature commit inside this unit — and it is SHAPE-ATTESTED
  // below; the "all existing suites still green" half of CC-303.4 is attested
  // by the verify:unit spawn (junit-trust: a nonzero exit anywhere ⇒ zero
  // credit), not by this leg.
  const TEST_SURFACE = ['e2e', 'tests', 'scripts', 'fixtures', 'package.json', 'pnpm-lock.yaml', 'playwright.config.ts', 'vitest.config.ts', 'vitest.config.qualify.ts', 'vite.config.ts', 'tsconfig.json', 'bundle-budget.json']

  // FR-303.1 authorized-scope exception + the round-3 Tier-B identity fix:
  // the CLOSURE_ANCHOR_AUTHORIZED_MODS set (unit-303 L1 files + both units'
  // anchors + the shared helper) is the only tolerated non-A entry class;
  // every other M/D/R/C on the test surface still reddens.

  /** Parse `git diff --name-status base HEAD -- TEST_SURFACE` and hard-assert
   *  the additive property: additions only (plus the two FR-303.1-authorized
   *  M entries), both closure files among the additions. Any other M/D/R/C
   *  entry reddens — on a develop-object-bearing run a tampered committed
   *  test surface can never pass. */
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
    expect(violations, `the closure suite edits no committed test surface relative to ${base} beyond the documented authorized mods (CC-303.4)`).toEqual([])
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
    expect(committed, 'the committed closure spec carries its dual-lead journey describes (shape check only — the full committed-model lint lives in the CC-303.3 leg)').toContain("test.describe('CC-303.1 CC-I4.1")
    expect(committed, 'the committed closure spec carries the T5b chromium gating mirror (J4b doctrine)').toContain('T5b chromium Translator-less gating mirror')
    // The FR-303.1 authorized engine fix must still be in the committed tree:
    // the aliased-split delete MUST precede the firstId reassignment (the
    // original bug was the delete-after-assignment destroying the first part).
    const track = git(['show', 'HEAD:src/engine/translate/track.ts'])
    const deleteAt = track.indexOf('delete track.entries[sourceId]')
    const firstAt = track.indexOf('track.entries[firstId] = { ...entry }')
    expect(deleteAt, 'the onBlockSplit source-key delete ships in the committed engine').toBeGreaterThan(-1)
    expect(firstAt, 'the first-part entry reassignment ships in the committed engine').toBeGreaterThan(-1)
    expect(deleteAt < firstAt, 'the delete precedes the reassignment — the T3 leg (CC-303.1 CC-I4.3) depends on this order (unit-303 / invariant 10)').toBe(true)
  }

  test('CC-303.4: committed blob attestation always, plus an additions-only git diff vs the develop merge-base whenever develop objects resolve', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    // Attestation tiering (gates-anchor wiring-not-green-state doctrine;
    // CI-proven 2026-11-24 on PR #44 — verbatim from the unit-205 CC-205.4
    // anchor): a PR-merge-ref checkout is a shallow single-commit fetch —
    // FETCH_HEAD points AT the checkout itself, so an unguarded
    // merge-base(FETCH_HEAD, HEAD) degenerates to HEAD and the diff leg runs
    // vacuously (empty added list); and develop objects are absent there, so
    // the diff-vs-develop half is physically unrunnable.
    //   Tier A — a real (non-degenerate) merge-base against origin/develop,
    //     develop or FETCH_HEAD resolves (every local/authoritative run):
    //     full additions-only diff over the test surface (plus the two
    //     FR-303.1 authorized M entries) = the "zero edits to committed
    //     specs" proof, hard-red on tampering.
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
