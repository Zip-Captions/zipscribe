// Shared Tier-B legality predicate for the closure-suite anchors
// (tests/unit/intent/styling-and-export-anchor.test.ts CC-205.4 and
// tests/unit/intent/caption-translation-anchor.test.ts CC-303.4 — the
// tiered CI-robust attestation, unit-205 doctrine).
//
// The committed-blob attestation is IDENTITY-FREE: it proves the closure
// surface exists as committed blobs at HEAD and that the work tree the tests
// execute matches them byte-for-byte — regardless of which branch CI happens
// to have checked out. The Tier-B guard therefore attests CI CONTEXT, not PR
// identity: a genuine CI checkout whose GitHub ref carries a git-flow unit
// branch (the ai-dlc/<intent>/<unit-stem> grammar scripts/verify-criteria.ts
// unitFileFromBranch uses). Forged non-ai-dlc refs (main, release/x) redden;
// a foreign but well-formed ai-dlc/…/… ref passes Tier-B BY DESIGN — the
// same pipeline runs the same committed suite for every unit-branch PR, the
// blob attestation describes it honestly either way, and "all existing
// suites still green" stays verifier-owned via junit-trust (nonzero spawn ⇒
// zero credit). PR-identity enforcement belongs to branch protection, not to
// a test that must run on any legitimate PR.
//
// Tier A (the additions-only diff vs the develop merge-base) is unchanged and
// branch-agnostic too: it runs ONLY where develop objects resolve (every
// local/authoritative run) and its guarantee is content-based, not ref-based.

/** The GitHub CI branch context: GITHUB_HEAD_REF (PR jobs) wins, else the
 *  GITHUB_REF head name (branch-push jobs); '' when neither is set. */
export function ciBranchFromEnv(env: Record<string, string | undefined> = process.env): string {
  const headRef = (env.GITHUB_HEAD_REF ?? '').trim()
  if (headRef !== '') return headRef
  return (env.GITHUB_REF ?? '').trim().replace(/^refs\/heads\//u, '')
}

/** True only when the CI context carries a git-flow unit branch:
 *  `ai-dlc/<intent>/<unit-stem>` in GITHUB_HEAD_REF (or GITHUB_REF). */
export function isUnitBranchCiContext(env: Record<string, string | undefined> = process.env): boolean {
  return /^ai-dlc\/[^/]+\/.+$/u.test(ciBranchFromEnv(env))
}

/** The committed TEST-SURFACE files the two closure anchors are allowed to
 *  see as `M` (modify) entries in the Tier-A additions-only diff. Every
 *  entry is a documented, orchestrator-authorized exception riding the
 *  merged branch (PR #43); any other M/D/R/C entry still reddens, so
 *  tampering with any other committed test file stays falsifiable. */
export const CLOSURE_ANCHOR_AUTHORIZED_MODS: readonly string[] = [
  // unit-303 FR-303.1 (orchestrator authorization 2026-11-24, reviewer F-1):
  // the identical-id split L1 cases + the corrected stub pin that had
  // encoded the onBlockSplit bug (strictly-strengthening, domain.md inv. 10).
  'tests/unit/translate/track-rules.test.ts',
  'tests/unit/editor/translations-stub.test.ts',
  // unit-303 CI round 3 (orchestrator instruction): Tier-B must attest CI
  // context, not PR identity — both units' anchors + this shared helper are
  // legitimately touched on either unit's branch.
  'tests/unit/intent/styling-and-export-anchor.test.ts',
  'tests/unit/intent/caption-translation-anchor.test.ts',
  'tests/unit/intent/anchor-attestation.ts',
]
