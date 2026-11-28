// CC-111.5 (L1, node): the frozen command-registry / shortcut-overlay /
// keyboard-lint surface is byte-unchanged by unit-111. The [RULING] (spec §
// Description, plan docs/ops/overnight-plan-2026-11-27.md) is ADDITIVE ONLY:
// the registry rows `timeline.merge` (Meta+Shift+M) and `timeline.merge-ctrl`
// (Ctrl+Shift+M) — src/ui/commands/registry.ts:81-82 — are NOT re-bound,
// renamed or re-`when:`-ed, the keyboard-allowlist lint (scripts/
// eslint-keyboard.mjs, wired through eslint.config.js) is not widened, and the
// frozen CC-104/CC-105 overlay suites (overlay content = design.md § Keyboard
// shortcuts, driven by the design-table oracle) pass UNCHANGED. There is no
// `e2e/workbench/shortcuts.spec.ts` — the overlay suites that actually freeze
// that content are the three `tests/unit/commands/*` files pinned below
// (registry-snapshot = design-table snapshot, overlay = ⌘/ overlay a11y +
// content, design-table = the parse oracle) plus the shell-binding registry
// seam test tests/unit/workbench/command-registry.test.ts.
//
// Doctrine (unit-303/304, tests/unit/intent/language-plumbing-anchor.test.ts,
// copied structurally from unit-110's tests/unit/transcript/
// qc-engine-frozen-anchor.test.ts which pinned checkCaptions the same way):
//   • ALWAYS: the work-tree bytes AND the committed blobs at HEAD match the
//     authoring-pinned SHA-256 digests (work-tree tamper ⇒ red).
//   • Whenever the FROZEN diff base resolves: an additions-only
//     `git diff --name-status` over the frozen surface — ANY M/D/R/C entry on
//     these paths reddens. The base is a FROZEN permanent repo fact — the
//     origin/develop tip unit-111's branch was cut from at authoring time
//     (574a19ed15cc86cdadf8a273c834e53143acc60f, `git merge-base
//     --is-ancestor`-verified against the authoring HEAD) — NOT an ambient
//     develop ref (hermetic-probe doctrine, PR #74/PR #4 line).
//   • When the base does NOT resolve (shallow CI): the additions-only leg is
//     only honest in a genuine CI checkout (shared Tier-B predicate,
//     tests/unit/intent/anchor-attestation.ts). With neither, RED, never
//     vacuous. The positive anchor (the diff machinery is live — the branch
//     ADDS its unit-111 suites) keeps a base-at/behind-HEAD checkout honest.
//
// GREEN at authoring (the frozen surface is currently intact — this is a
// guard that reddens the moment builder drift touches a registry binding, the
// overlay suites, or the keyboard lint).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { isCiCheckoutContext } from '../intent/anchor-attestation'

const repoRoot = new URL('../../../', import.meta.url)

/** The frozen registry/overlay/lint surface, digests pinned at unit-111
 *  authoring time (branch clean at the spec commit — these are the bytes the
 *  [RULING] freezes; the merge rows at registry.ts:81-82 are inside the pinned
 *  whole-file digest of registry.ts). */
const FROZEN: Readonly<Record<string, string>> = {
  'src/ui/commands/registry.ts': '805d8754985fe65dca9674a5c78d26097341f4162a3705e84d9ddf05ca831ec9',
  'tests/unit/workbench/command-registry.test.ts': 'c824ad88f421a2f3c9fe4aebe13f5d5b6657987cf414e3140f03a2643e63395f',
  'tests/unit/commands/overlay.test.tsx': '810cf15ea10ad4d893604ee091e59777dab19f9e55d3c829eecaa49dd8bf00af',
  'tests/unit/commands/registry-snapshot.test.ts': '4975f38981546ef51f713a3d04eac8704e23acee85e33cfece224f9e6579bc97',
  'tests/unit/commands/helpers/design-table.ts': '4e7ae0f80cd45344a38bee5005da477fd540022dcfb5cd5fb9ae11142069c715',
  'scripts/eslint-keyboard.mjs': '22f198cfed9e61dbe2970491b7790d3f2fb5800a810ce7e6bad02a626a432003',
  'eslint.config.js': 'ab76b7f0fef2ce01be6ce397cd21f84bd89aaf65a6977b122cbde630cdef2919',
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

describe('CC-111.5: the frozen registry bindings, overlay suites and keyboard lint are byte-identical to the authored digests (additive-only ruling)', () => {
  test('CC-111.5: every frozen registry/overlay/lint file matches its pinned SHA-256 in the work tree AND as committed at HEAD (the ruling is mechanically enforced)', () => {
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

  test('CC-111.5: the frozen surface is additions-only against the frozen branch-cut base whenever its objects resolve; otherwise a genuine CI checkout is attested (never vacuous)', () => {
    // FROZEN diff base — a permanent repo fact, never an ambient ref.
    // Derivation (verified at authoring time): `git rev-parse origin/develop`
    // == 574a19ed15cc86cdadf8a273c834e53143acc60f and
    // `git merge-base --is-ancestor origin/develop <authoring HEAD>` exits 0
    // — the develop tip unit-111's branch was cut from. Ambient
    // develop/origin/develop is NOT consulted (post-merge it equals HEAD and
    // the ambient guard would false-red every later checkout — PR #74
    // hermetic-probe doctrine).
    const base = '574a19ed15cc86cdadf8a273c834e53143acc60f'
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
    expect(offenders, `unit-111 must not modify/delete/rename any frozen registry/overlay/lint file ([RULING]: additive only — registry rows, overlay suites and keyboard lint stay UNCHANGED):\n${offenders.join('\n')}`).toEqual([])
    // Positive anchor: the diff machinery is live on this checkout — the same
    // query WITHOUT the frozen pathspec sees this unit's own additions.
    expect(git(['diff', '--name-only', base, 'HEAD']), 'the branch adds unit-111 files (the diff leg is live, not vacuous)').toMatch(/merge-journey|row-merge-affordances|merge-frozen-anchor/u)
  })
})
