// CC-110.6 (L1, node): the `checkCaptions` engine surface is byte-unchanged.
// The unit-110 RULING (issue #52 [RULING], spec § Description) is that the QC
// ENGINE keeps its behaviour and signature untouched — the posture change is
// UI-defaults only. This anchor makes that ruling FALSIFIABLE with the
// unit-304 doctrine (tests/unit/intent/language-plumbing-anchor.test.ts —
// which pinned protocol.ts the same way):
//   • ALWAYS: the work-tree bytes AND the committed blobs at HEAD match the
//     authoring-pinned SHA-256 digests (work-tree tamper ⇒ red).
//   • Whenever the `develop` merge-base resolves locally: an additions-only
//     `git diff --name-status` over the frozen surface — ANY M/D/R/C entry on
//     these paths reddens.
//   • When develop objects do NOT resolve: the diff leg is only honest in a
//     genuine CI checkout (shared Tier-B predicate, tests/unit/intent/
//     anchor-attestation.ts). With neither, the test is RED, never vacuous.
//
// GREEN at authoring (the frozen surface is currently intact — this is a
// guard that reddens the moment builder/engine drift touches checkCaptions).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { isCiCheckoutContext } from '../intent/anchor-attestation'

const repoRoot = new URL('../../../', import.meta.url)

/** The frozen QC surface, digests pinned at unit-110 authoring time (branch
 *  clean at the spec commit — these are the bytes the ruling freezes). */
const FROZEN: Readonly<Record<string, string>> = {
  'src/engine/captions/qc.ts': '5a911f65d77ef68dd69aa4e1a6aece7c35d79b9d6f7195fddf37d9c650b47bb9',
  'src/engine/captions/types.ts': 'd611828be79c379e77b90297edffe4e429e3edfa04bc3e3cc7394563727be482',
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

describe('CC-110.6: the checkCaptions engine surface is byte-identical to the authored digests (UI-defaults-only ruling)', () => {
  test('CC-110.6: every frozen QC file matches its pinned SHA-256 in the work tree AND as committed at HEAD', () => {
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

  test('CC-110.6: the frozen QC surface is additions-only against the develop merge-base whenever develop objects resolve; otherwise a genuine CI checkout is attested (never vacuous)', () => {
    const head = git(['rev-parse', 'HEAD'])
    let base: string | null = null
    for (const candidate of ['develop', 'origin/develop']) {
      try {
        const out = git(['merge-base', candidate, 'HEAD'])
        if (/^[0-9a-f]{40}$/u.test(out) && out !== head) {
          base = out
          break
        }
      } catch {
        // A missing ref is exactly the shallow-CI condition — fall through.
      }
    }
    if (base === null) {
      expect(isCiCheckoutContext(), 'no develop objects locally: the additions-only leg is only honest in a genuine CI checkout (shared Tier-B predicate — no branch-grammar gate)').toBe(true)
      return
    }
    const nameStatus = git(['diff', '--name-status', base, 'HEAD', '--', ...FROZEN_PATHS])
    const offenders = nameStatus
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .filter((line) => !(line.startsWith('A\t') || line === ''))
    expect(offenders, `unit-110 must not modify/delete/rename any frozen QC engine file (ruling: UI defaults only, checkCaptions untouched):\n${offenders.join('\n')}`).toEqual([])
    // Positive anchor: the diff machinery is live on this checkout — the same
    // query WITHOUT the frozen pathspec sees this suite's own additions.
    expect(git(['diff', '--name-only', base, 'HEAD']), 'the branch adds unit-110 files (the diff leg is live, not vacuous)').toMatch(/row-layout|issues-posture|single-surface|longtask-expand|perf-1k-expand|qc-engine-frozen-anchor/u)
  })
})
