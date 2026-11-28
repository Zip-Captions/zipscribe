// CC-112.7 (L1, node): the unit-112 frozen-surface attestation. The unit
// RULING (spec § RULING) freezes `src/engine/captions/**` (the merged unit-07
// parser + the golden import tests) and the `src/state/services/intake.ts`
// contract — this unit is composition wiring only. Tiered doctrine copied from
// the unit-304 anchor (tests/unit/intent/language-plumbing-anchor.test.ts,
// itself the 48d6227 hermetic-probe precedent):
//
//   • ALWAYS: work-tree bytes AND the committed HEAD blobs match the
//     authoring-pinned SHA-256 (work-tree tamper ⇒ red; committed drift ⇒ red).
//     The frozen e2e/unit legs the ruling also pins (unit-101 DnD drop-zone
//     spec, unit-104 report-before-confirm dialog flows) ride the same list.
//   • Whenever the FROZEN diff base resolves: an additions-only `git diff
//     --name-status` over the frozen paths — any M/D/R/C entry reddens. The
//     base is a FROZEN permanent repo fact: d1c28a1871d8fb8e892076261ccfe4166e24cb0a,
//     the origin/develop ancestor unit-112's branch was cut from (verified at
//     authoring: `git merge-base --is-ancestor` green). It is NEVER ambient
//     (an ambient develop/origin/develop merge-base goes red on every branch
//     cut from develop — the ambient-branch defect the unit-304 fix closed).
//   • When the base objects are absent (shallow CI): the diff leg is honest
//     only in a genuine CI checkout — attested via the shared Tier-B predicate
//     (tests/unit/intent/anchor-attestation.ts). Neither ⇒ RED, never vacuous.
//
// The static bundle leg reuses `scripts/check-bundle.mjs`'s initial-graph
// doctrine (index.html scripts + the exact emitted static-import pattern,
// dynamic `import(…)` excluded): the caption PARSE pipeline (TTML root
// message + zipscribe-json parse message — literals only the engine parsers
// contain, minification-proof) must exist somewhere in dist (lazy chunk
// present) and in NO chunk statically reachable from the entry — the
// FR-112.1 sniff/import wiring must never pull `engine/captions/import` and
// its six parsers into the initial JS graph (check-bundle parity).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { isCiCheckoutContext } from '../intent/anchor-attestation'
import { isChildRun, runPnpm } from '../../helpers/repo'

const repoRoot = new URL('../../../', import.meta.url)

/** The frozen base — a permanent repo fact: the origin/develop ancestor this
 *  branch was cut from (HEAD d1c28a1… + the unit-112 spec commits). Verified
 *  at authoring with `git merge-base --is-ancestor <base> HEAD` → true. */
const FROZEN_BASE = 'd1c28a1871d8fb8e892076261ccfe4166e24cb0a'

/** Digests pinned at unit-112 authoring time (branch clean at the spec
 *  commit — these are the bytes the RULING freezes). */
const FROZEN: Readonly<Record<string, string>> = {
  'src/engine/captions/align.test.ts': '0241232238408ae1dbe7f341608fcb293cffeed17065df4a07a36f95d074e7e4',
  'src/engine/captions/align.ts': '4e9550f6b0d046703430cf374ef2f5d3eddfb0dcee095bb54bde8e474724317a',
  'src/engine/captions/decode-text.test.ts': '904d535f237a6b7ceb10dab6d9ab8babf8122d6d1acaa675cc634caafdcd72a7',
  'src/engine/captions/decode-text.ts': '3259368eb8b2f70da8e4e55d1fc3cdaaeed71c4dfca955a5d983e2a9ce2135e7',
  'src/engine/captions/estimate-timing.test.ts': '32f1dccb40f14ba6cd7cb7511b912c4aed08ce25f69130c97c358312a62ca635',
  'src/engine/captions/estimate-timing.ts': 'b6a38d778440400ae7dc9e7aee212f10cadbf5e0a218e7a297f51f5edaaa22f2',
  'src/engine/captions/failure.ts': '94f14dca15a1e7c9fa1911daad87912d52b91064c58f2d2bf8fcd4c7624836fb',
  'src/engine/captions/import.test.ts': '04bd67094e55849f94017c2dd81b778cde0aa1dbd6218661d551d48593927d3b',
  'src/engine/captions/import.ts': 'b30bd911434b300e702d1356733a3966031e12492e0fbf3d549e6f286748c39a',
  'src/engine/captions/parse/ass.test.ts': '192cadee6bafde7ac16d723986eaeccaf43e3f5ff97bdd502b5cca4435fa208b',
  'src/engine/captions/parse/ass.ts': '83cc169a7781928a03b768403bdc0ea77ede60ca40a83a10b5ca48492fc8cf6c',
  'src/engine/captions/parse/json.test.ts': '392febff81b302a6af24734d33249a5a338521a0790f4b27eaae4144e0c9582b',
  'src/engine/captions/parse/json.ts': 'e490079e5afcfd2c3c0d1f395a23f72ee70d48984a73fc2ce81ae9733e928158',
  'src/engine/captions/parse/sbv.test.ts': 'b0c45a9fa0a29d3e67ac4945f11652059d6550a93ffebb5abae6401acbba1b9f',
  'src/engine/captions/parse/sbv.ts': 'a9a11c85a7cc409b4a9bdf0412eab96c5a007448c47045b7fed17e02c612c5f5',
  'src/engine/captions/parse/shared.ts': '627c39d19ed4e90df1054885eb275b4fa395b964ab553afb860d45fa883955c8',
  'src/engine/captions/parse/srt.test.ts': 'a631e893e4712de9f2ca02194df5607f210ae5115dfdd6369610e03e86d1bff0',
  'src/engine/captions/parse/srt.ts': 'd951f6825c52f2fc3a23d8a828eed710be6afffc32a36ac3315d5cd963123a7e',
  'src/engine/captions/parse/ttml.test.ts': '06cd9082992750738fbd1c25aaa353e867afd2dde2ff72fded1dd938b40eab77',
  'src/engine/captions/parse/ttml.ts': '404c23fdabd4fc69303922c557d949e62fa116c783b45b822658e6043e340f9c',
  'src/engine/captions/parse/vtt.test.ts': '2e2ead26ff961449b02726ef578b2ea7feae0b02942b7e8a1485cf52ab0518d2',
  'src/engine/captions/parse/vtt.ts': 'e2d3e367293e17a3badd4c8232336dab968438d09abb91a17e055a3f2aaf9155',
  'src/engine/captions/qc.test.ts': '9a6c73d6cf204f3b46826f10aff176484b08e706ce31278584ff95769545f6ff',
  'src/engine/captions/qc.ts': '5a911f65d77ef68dd69aa4e1a6aece7c35d79b9d6f7195fddf37d9c650b47bb9',
  'src/engine/captions/retime.test.ts': '21247fe8b7437cc5b60faf01848394d97e177311d4d5255460c8b7a91a65fbe4',
  'src/engine/captions/retime.ts': 'f66fc7241caa504192657e15182367472085369753ca05d616f71aa498947bf7',
  'src/engine/captions/types.ts': 'd611828be79c379e77b90297edffe4e429e3edfa04bc3e3cc7394563727be482',
  'src/state/services/intake.ts': '6ae40465e21dfd3466c845c724f0c3f4aec897c4211938a898503ffe14c7342c',
  'e2e/transcript/import-qc-flow.spec.ts': '3955e7adca4680411c117bf1041523b7e17f883d23a40d8b12b8165e58d3d660',
  'e2e/workbench/import.spec.ts': '3deb4e38b389c45566ff517a0d3ffd8885ac95df31e13e8d410d3c8774fbced1',
  'tests/unit/transcript/import-translation.test.tsx': 'ad37b1bc6a28cbd93dcfe44a74f52ca58b7544a4d3f066cf3a32bc374778092c',
  'e2e/intent/caption-studio-ui.spec.ts': 'a5334b5ed913f63608c6af3536c2fb04f9c9a94d519f8aced294c31e5ec8636b',
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

describe('CC-112.7: the engine captions surface and the intake contract are byte-identical to the authored digests', () => {
  test('CC-112.7: every frozen surface file matches its pinned SHA-256 in the work tree AND as committed at HEAD (the RULING is mechanically enforced)', () => {
    const lsTree = new Map(
      git(['ls-tree', 'HEAD', '--', ...FROZEN_PATHS])
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => {
          const meta = line.slice(0, line.lastIndexOf('\t'))
          const path = line.slice(line.lastIndexOf('\t') + 1)
          const sha = meta.split(/\s+/u)[2] ?? ''
          return [path ?? '', sha] as const
        }),
    )
    for (const [rel, pinned] of Object.entries(FROZEN)) {
      expect(sha256Of(readWorkTree(rel)), `${rel} in the WORK TREE is byte-identical to the authored digest (the tests execute the work tree)`).toBe(pinned)
      const committed = lsTree.get(rel)
      expect(committed, `${rel} is committed at HEAD`).toBeTruthy()
      expect(git(['hash-object', '--', rel]), `${rel} in the work tree matches its committed blob`).toBe(committed)
      expect(sha256Of(gitBlob(rel)), `${rel} as COMMITTED at HEAD is byte-identical to the authored digest (the model reads HEAD)`).toBe(pinned)
    }
  })

  test('CC-112.7: the frozen surface is additions-only against the frozen base whenever its objects resolve; otherwise a genuine CI checkout is attested (never vacuous)', () => {
    // The base is the branch's own ancestor — assert it (a base that is not
    // an ancestor cannot certify "additions-only since this branch started").
    let baseIsAncestor = true
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', FROZEN_BASE, 'HEAD'], { cwd: fileURLToPath(repoRoot), stdio: 'pipe' })
    } catch {
      baseIsAncestor = false
    }
    expect(baseIsAncestor, `${FROZEN_BASE} must be an ancestor of HEAD (the frozen base is this branch's develop ancestor — d1c28a1…)`).toBe(true)

    let baseResolves = true
    try {
      git(['cat-file', '-e', `${FROZEN_BASE}^{commit}`])
    } catch {
      baseResolves = false
    }
    if (!baseResolves) {
      expect(isCiCheckoutContext(), 'frozen base objects missing: the additions-only leg is only honest in a genuine CI checkout (shared Tier-B predicate)').toBe(true)
      return
    }
    const nameStatus = git(['diff', '--name-status', FROZEN_BASE, 'HEAD', '--', ...FROZEN_PATHS])
    const offenders = nameStatus
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .filter((line) => !line.startsWith('A\t'))
    expect(offenders, `unit-112 must not modify/delete/rename any frozen file (RULING: engine parser + intake contract + the pinned dialog/DnD/golden legs stay byte-identical):\n${offenders.join('\n')}`).toEqual([])
    // Positive anchor: the diff machinery is live on this checkout — the same
    // query WITHOUT the frozen pathspec sees this unit's own additions.
    expect(git(['diff', '--name-only', FROZEN_BASE, 'HEAD']), 'the branch adds unit-112 files (the diff leg is live, not vacuous)').toMatch(/unit-112|unit112|caption-import-click|composition-importer|frozen-anchor|caption-import-language|media-caption-add|languages-section-truth/u)
  })
})

describe('CC-112.7: the caption parse pipeline stays out of the initial JS graph (static/digest leg)', () => {
  // Gate-spawning doctrine (child safety): the lazy-chunk probe may spawn a
  // `pnpm build`; the gate-child's frozen 30 s budget cannot host that. The
  // authoritative parent `pnpm test` and `verify:unit` (which clears
  // ZIPSCRIBE_CHILD) execute the leg — same doctrine as bundle-budget.test's
  // exclusion, expressed as a per-file guard so no shared config is touched.
  const MARKERS = ['TTML root element <tt> missing', 'zipscribe-json is not valid JSON'] as const

  function distDir(): string {
    return resolve(fileURLToPath(repoRoot), 'dist')
  }

  function buildOnce(): void {
    if (existsSync(join(distDir(), 'index.html'))) return
    const result = runPnpm('build', [], 600_000)
    expect(result.status, `pnpm build prerequisite failed\n${result.output.slice(-4000)}`).toBe(0)
  }

  /** The scripts/check-bundle.mjs initial-graph doctrine, verbatim: the
   *  scripts referenced by dist/index.html plus their STATIC sibling imports
   *  (the exact minified emit pattern; dynamic `import(…)` stays out). */
  function initialChunkSet(): Set<string> {
    const dist = distDir()
    const html = readFileSync(join(dist, 'index.html'), 'utf8')
    const staticImport = /(?:^|[\s;(),{}])(?:import|export)\s*(?:[^'"]*?from\s*)?['"]([^'"]+\.js)['"]/g
    const initial = new Set<string>()
    const queue: string[] = [...html.matchAll(/<script[^>]*src="([^"]+\.js)"/g)].map((match) => (match[1] ?? '').replace(/^\//, ''))
    while (queue.length > 0) {
      const entry = queue.shift() ?? ''
      if (initial.has(entry) || entry === '') continue
      const absolute = resolve(dist, entry)
      expect(absolute.startsWith(dist) && existsSync(absolute) && statSync(absolute).isFile(), `initial script present in dist/: ${entry}`).toBe(true)
      initial.add(entry)
      const source = readFileSync(absolute, 'utf8')
      for (const match of source.matchAll(staticImport)) {
        const spec = match[1] ?? ''
        if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/')) continue
        const candidate = resolve(dist, dirname(entry), spec)
        if (candidate.startsWith(dist) && existsSync(candidate) && statSync(candidate).isFile()) {
          queue.push(candidate.slice(dist.length + 1).split('\\').join('/'))
        }
      }
    }
    return initial
  }

  function allDistJs(): string[] {
    const dist = join(distDir(), 'assets')
    const found: string[] = []
    for (const entry of readdirSync(dist, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) found.push(`assets/${entry.name}`)
    }
    return found
  }

  test.skipIf(isChildRun())('CC-112.7: the parser literals exist in dist (lazy chunk present) and in NO chunk of the initial graph — the sniff/import wiring never pulls the parse pipeline into the entry', () => {
    buildOnce()
    const initial = initialChunkSet()
    expect(initial.size, 'the initial graph is non-empty (the entry resolves — never vacuous)').toBeGreaterThan(0)
    const chunks = allDistJs()
    expect(chunks.length, 'dist/assets carries emitted chunks').toBeGreaterThan(0)

    for (const marker of MARKERS) {
      const carriers = chunks.filter((chunk) => readFileSync(join(distDir(), chunk), 'utf8').includes(marker))
      expect(carriers.length, `the parse pipeline (literal "${marker}") is present in dist — the lazy chunk exists (non-vacuity)`).toBeGreaterThan(0)
      const eager = carriers.filter((chunk) => initial.has(chunk))
      expect(eager, `the parse pipeline (literal "${marker}") is NOT statically reachable from the entry — engine/captions/import + parsers must stay in a lazy chunk (FR-112.1 / check-bundle parity)`).toEqual([])
    }
  })
})
