// CC-304.6 (L1, node): the unit-304 integrity doctrine (closes #63's
// popover-label half alongside #51). The unit RULING is that the frozen
// engine contract is not edited and the pre-existing translation e2e surface
// is not touched — this anchor makes that ruling FALSIFIABLE at the only
// points that matter: the bytes the tests execute and the bytes as committed.
//
// Tiered attestation (unit-205/303 doctrine, tests/unit/intent/
// caption-translation-anchor.test.ts):
//   • ALWAYS: the work tree files match the authoring-pinned SHA-256 digests
//     AND the committed blobs at HEAD match those same digests — the tests
//     execute the work tree while the model reads HEAD, so both must be
//     byte-identical to the frozen originals (work-tree tamper ⇒ red).
//   • Whenever the FROZEN diff base resolves: an additions-only `git diff
//     --name-status` over the frozen surface — ANY M/D/R/C entry on these
//     paths reddens (this unit's diff must be pure additions; the ruling
//     "no edits to the frozen surface" is enforced mechanically). The base is
//     a FROZEN permanent repo fact — the commit unit-304's branch was cut
//     from (pre-unit-304 develop tip b687f24…, the parent of the unit-304
//     spec commit 2e6745e) — NOT an ambient `develop`/`origin/develop`
//     merge-base: ambient resolution is RED post-unit-304 on develop itself
//     and on every branch cut from it (merge-base == HEAD was refused, then
//     the CI predicate fell false locally — red forever). Hermetic-probe
//     doctrine per the 2026-10-28 PR #4 precedent (48d6227,
//     verify-criteria adversarial-control hotfix: make the probe hermetic
//     instead of ambient-reading).
//   • When the frozen base does NOT resolve (shallow CI): the diff leg is
//     only honest in a genuine CI checkout — attested via the shared Tier-B
//     predicate (tests/unit/intent/anchor-attestation.ts; no branch-grammar
//     gate, round-4 doctrine). With neither base objects nor CI context the
//     test is RED, never vacuous. If HEAD is at/behind the frozen base
//     (a pre-unit-304 checkout — cannot happen post-merge), the positive
//     anchor assertion itself reddens: acceptable, never vacuous.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { isCiCheckoutContext } from './anchor-attestation'

const repoRoot = new URL('../../../', import.meta.url)

/** The frozen surface, digests pinned at unit-304 authoring time (branch
 *  clean at the spec commit — these are the bytes the ruling freezes). */
const FROZEN: Readonly<Record<string, string>> = {
  'src/engine/protocol.ts': 'c18cbe32400326b541f9eecb00030486b73aa5170e46da91577694bfd1b24912',
  'src/engine/model.ts': 'd9b463a3c7e0d206a41832b2fb8185bfd8e1cd0ff2b564ddd45dad683b3fc5bf',
  'e2e/intent/caption-translation.spec.ts': '09246fbe3308ba5032640213534c7806d876d0048253c932af97fca11e774416',
  'e2e/translate/burnin-rtl-golden.spec.ts': '948d26006adbc1fd043b159ad93db61b3a756fc992a0aab0b8f0825596536f53',
  'e2e/translate/longtask.spec.ts': '79188b8a6734b83c81ae148ddc6346aee6c6a4a1f34b183de3c12dc031d02088',
  'e2e/translate/webkit-gating.spec.ts': 'c76a5c2ac0f3cfb219a981f72af76dccb48223cf28dc9ac69519a4b96b5663f1',
  'e2e/translate/workspace.spec.ts': 'ee7c1702b33baf456221807a51b67b3fade5c0f2bde15c72f4373c0949aa49db',
  'e2e/translate/fixtures/harness.html': 'a529a16ef34e3b9f0045b007e62e3af6c983e59bb7d410a54df58da3eb6db46d',
  'e2e/translate/fixtures/harness.ts': 'd040d790062027e4f71da90ded84f76c7404904024cb15e3ca8e500d7de4f0e0',
  'e2e/translate/fixtures/vite.harness.config.ts': '38548d2f470586dd082f7c1c8a3b68de97be253f01144bdb298afded8a49efe2',
}

const FROZEN_PATHS = Object.keys(FROZEN)

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: fileURLToPath(repoRoot), encoding: 'utf8' }).trim()
}

/** Untrimmed `git show` — the committed blob must be hashed byte-exact. */
function gitBlob(rel: string): string {
  return execFileSync('git', ['show', `HEAD:${rel}`], { cwd: fileURLToPath(repoRoot), encoding: 'utf8' })
}

function sha256Of(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function readWorkTree(rel: string): Buffer {
  return readFileSync(new URL(rel, repoRoot))
}

describe('CC-304.6: the frozen engine contract and translation e2e surface are byte-identical to the authored digests', () => {
  test('CC-304.6: every frozen surface file matches its pinned SHA-256 in the work tree AND as committed at HEAD (the ruling is mechanically enforced)', () => {
    const lsTree = new Map(git(['ls-tree', 'HEAD', '--', ...FROZEN_PATHS]).split('\n').filter((line) => line !== '').map((line) => {
      const [meta, path] = [line.slice(0, line.lastIndexOf('\t')), line.slice(line.lastIndexOf('\t') + 1)] as const
      const sha = meta.split(/\s+/u)[2] ?? ''
      return [path ?? '', sha] as const
    }))
    for (const [rel, pinned] of Object.entries(FROZEN)) {
      expect(sha256Of(readWorkTree(rel)), `${rel} in the WORK TREE is byte-identical to the authored digest (the tests execute the work tree)`).toBe(pinned)
      const committed = lsTree.get(rel)
      expect(committed, `${rel} is committed at HEAD`).toBeTruthy()
      expect(git(['hash-object', '--', rel]), `${rel} in the work tree matches its committed blob`).toBe(committed)
      expect(sha256Of(gitBlob(rel)), `${rel} as COMMITTED at HEAD is byte-identical to the authored digest (the model reads HEAD)`).toBe(pinned)
    }
  })

  test('CC-304.6: the frozen surface is additions-only against the develop merge-base whenever develop objects resolve; otherwise a genuine CI checkout is attested (never vacuous)', () => {
    // FROZEN diff base — a permanent repo fact, never an ambient ref.
    // Derivation (verified at fix time): `git rev-parse 2e6745e^` ==
    // b687f24343b8c3dc16ce78e11b593a021081fbf0 and `git cat-file -t` on both
    // yields `commit` — the pre-unit-304 develop tip that unit-304's branch
    // was cut from, i.e. the parent of the unit-304 spec commit 2e6745e.
    // Ambient develop/origin/develop merge-base is NOT consulted: post-
    // unit-304 it equals HEAD on develop and on every branch cut from it,
    // which the old `!== head` guard refused, dropping every local checkout
    // to the CI predicate — false-red forever (PR #4 hermetic-probe
    // doctrine, 48d6227).
    const base = 'b687f24343b8c3dc16ce78e11b593a021081fbf0'
    let baseResolves = true
    try {
      git(['cat-file', '-e', `${base}^{commit}`])
    } catch {
      // Objects absent (shallow CI clone) — exactly the Tier-B condition.
      baseResolves = false
    }
    if (!baseResolves) {
      expect(isCiCheckoutContext(), 'frozen base objects missing: the additions-only leg is only honest in a genuine CI checkout (shared Tier-B predicate — no branch-grammar gate)').toBe(true)
      return
    }
    const nameStatus = git(['diff', '--name-status', base, 'HEAD', '--', ...FROZEN_PATHS])
    const offenders = nameStatus
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .filter((line) => !(line.startsWith('A\t') || line === ''))
    expect(offenders, `unit-304 must not modify/delete/rename any frozen file (ruling: no edits to protocol.ts/model.ts, the existing e2e suite is untouched):\n${offenders.join('\n')}`).toEqual([])
    // Positive anchor: the diff machinery is live on this checkout — the same
    // query WITHOUT the frozen pathspec sees this suite's own additions.
    expect(git(['diff', '--name-only', base, 'HEAD']), 'the branch adds unit-304 files (the diff leg is live, not vacuous)').toMatch(/jobs-language-plumbing|language-plumbing/u)
  })
})
