# Unit report: unit-01-scaffold-quality-gates

Status: complete

## Completion criteria

From `reports/criteria/unit-01-scaffold-quality-gates.md` (`pnpm verify:unit --from-branch`, 2026-10-28):

| ID       | level    | passing tests | result                       |
| -------- | -------- | ------------- | ---------------------------- |
| CC-01.1  | untagged | 13            | pass                         |
| CC-01.2  | untagged | 8             | pass                         |
| CC-01.3  | untagged | 8             | pass                         |
| CC-01.4  | untagged | 10            | pass                         |
| CC-01.5  | untagged | 1             | pass                         |
| CC-01.6  | untagged | 8             | pass                         |
| CC-01.7  | untagged | 8             | pass                         |
| CC-01.8  | untagged | 16            | pass                         |
| CC-01.9  | untagged | 8             | pass                         |
| CC-01.10 | untagged | 6             | pass                         |
| CC-01.11 | untagged | 4             | pass                         |
| CC-01.12 | untagged | 4             | pass                         |
| CC-01.13 | untagged | 6             | pass                         |
| CC-01.14 | DEPLOY   | 0             | DEPLOY (outside PR pipeline) |
| CC-01.15 | DEPLOY   | 0             | DEPLOY (outside PR pipeline) |
| CC-01.16 | DEPLOY   | 0             | DEPLOY (outside PR pipeline) |

- `[DEPLOY]` CC-01.14/15/16: deferred per run-config `unit exceptions` — no Cloudflare
  credentials/environments exist on this Free-plan repo; recorded as awaiting-credentials,
  not done. `scripts/deploy-smoke.mjs` exists and runs against a `DEPLOY_URL` at release time.
- `[MANUAL]` CC-01.13 platform branch protection: `tests/unit/scaffold/branch-policy.test.ts`
  skips with reason "awaiting GitHub Pro/org plan" (run-config adaptation 2 — the
  `.github/workflows/branch-policy.yml` check is the enforcement, and it passes;
  verified locally too: the workflow's git-flow rules reject direct/force patterns).
  Manual verification for the human: when the plan allows, enable protection on
  `main`/`develop` (no direct pushes, no force pushes, PRs required).

## Gates

lint ✓ · typecheck ✓ · test ✓ (14 files, 59 passed / 1 skipped / 1 todo, two consecutive
full runs) · build+check-bundle ✓ (68.3 KB gzip initial / 350 KB budget) ·
test:e2e --project=chromium ✓ (run inside gates.test and by verify-criteria's Playwright
pass; webkit/firefox gated behind `E2E_WEBKIT`/CI) · criteria ✓ (verify-criteria: all
untagged CC-IDs covered) · format ✓ (prettier) · spec-lint ✓ (21 unit files) ·
license-check ✓ (54 transitive production packages) · frozen contract ✓
(`git diff 7f9d48f..HEAD -- tests e2e` is empty)

## Deviations from spec

Builder extensions to orchestrator/test-author-owned config (no frozen test touched):

1. **`vitest.config.ts`**
   - `sequence.concurrent: false` (and `fileParallelism: false`): several scaffold
     tests spawn vite previews on fixed ports (4178/4173); in-file concurrency made
     them preempt each other's live servers.
   - `exclude: ['**/gates.test.ts']` when `ZIPSCRIBE_CHILD=1`: the same recursion
     guard `gates.test.ts` applies to its own `pnpm test --coverage` child via
     `isChildRun()`, extended to the whole orchestration file so the child suite
     (30 s budget from `tests/helpers/repo.ts runPnpm`) finishes in ~21 s instead of
     re-running lint/typecheck/build/e2e children pointlessly.
   - `ZIPSCRIBE_REPO_ROOT` export so the scratch-tree fixture regeneration test finds
     the pinned ffmpeg-static binary.
2. **`package.json` preview scripts + `scripts/preview.mjs`** (new): the frozen
   network-audit/retry-detection tests spawn `pnpm run preview -- --port PORT
--strictPort`; `vite`'s CLI stops option parsing at `--`, so the args were
   dropped. The wrapper strips `--`, spawns the vite bin directly, forwards
   signals, preempts a stale vite-preview left on the port by an earlier
   imperfectly-killed test (only processes whose argv is our own vite preview —
   `--strictPort` still surfaces foreign conflicts), and watches its launcher
   chain so an orphaned corepack/pnpm tree dies with its parent. This makes the
   frozen 300 ms `stopPreview` window reliable.
3. **`vite.config.ts`**: `closeBundle` creates the gitignored root symlink
   `assets → dist/assets` (the frozen check-bundle inject test resolves
   `join(REPO_ROOT, entry)`); `preview.host: '127.0.0.1'`; `preview.headers` adds
   `Cache-Control: no-store` plus, under `ZIPSCRIBE_ISOLATED`, COOP/COEP +
   `Origin-Agent-Cluster: ?1` (forces the agent-cluster swap on the same-tab
   navigation the frozen test performs).
4. **`scripts/retry-pass-reporter.mjs`**: flaky-detection reads `result.retry`
   (Playwright's per-attempt field), not `test.retry`.
5. **`scripts/verify-criteria.ts`**: its test runner clears `ZIPSCRIBE_CHILD` — a
   criteria verification is the authoritative full run and must see every test
   file (CI's `pnpm verify:unit --from-branch` therefore covers gates.test too).
6. **Typings/format**: `make-fixtures.ts` indexed-assignment under
   `noUncheckedIndexedAccess`, `models-fetch.ts` async signature.

## Contract changes

None. No edits to `architecture.md` types were needed.

## Dependencies

None outside `settings.yml approved_dependencies`; all versions match the pins
(license-check gate passes). Note: fixture generation uses the already-installed
`ffmpeg-static` binary (dev-side tooling only, never shipped).

## Measurements

- Initial JS: **68.3 KB gzip** (1 chunk) vs 350 KB budget.
- `vite build`: 1.7 s. Full vitest suite: 52.7 s wall (outer), child suite 21.6 s
  (30 s budget — 8 s margin).
- Fixtures: 36 files + 9 ground truths, ~22 MB, generated in 2.9 s; byte-determinism
  verified across repeated runs (manifest sha256s stable; perf file
  `cafbea59…d8c8b9`, 120 min).
- Model cache: whisper-tiny (12 files) + silero-vad, all SHA-256-verified against
  `models/ci-registry.json`, 45 MB.
- Engine coverage gate (CC-01.11): thresholds engine 85/75, state 80 enforced via
  `pnpm test --coverage`; `enabled:false` while no engine logic exists (per
  vitest.config comment) — goes live with unit-02.

## Adversarial round

Post-build red-team commit `2a7d861` added 6 new test files (12 tests + 7 survived-edge
tests) exposing 8 spec-contradicting violations. All fixed in `ca9ddff` (+ final polish
commit); `git diff 7f9d48f..HEAD --diff-filter=M -- tests e2e` remains empty
(additions-only). One harness bug in an adversary file was corrected (noted in 2).

1. **check-bundle name-based exclusion → budget bypass** — FIXED `ca9ddff`.
   `scripts/check-bundle.mjs` no longer lets `excludePatterns` skip a chunk that is in
   the initial import graph: exclusion is bound to laziness (settings.yml bundle_budget
   "lazy-loaded and excluded"), so a statically-reachable chunk matching an exclude
   pattern now FAILS as a lazy-contract violation and unpatterned chunks always count.
   Counterexample (`…-worker-mediabunny.js` 1 MB statically imported) exits non-zero;
   clean build green again.
2. **check-bundle blind to vite's minified static-import form** — FIXED `ca9ddff`.
   `staticImport` regex now accepts the emitted `import{a}from'./x.js'` /
   `export*from'…'` forms (`[^'"]*?from\s*` without the required pre-`from`
   whitespace; boundary extended to `[\s;()]`), while dynamic `import('./x.js')`
   stays out of the initial graph (correctly lazy). Tamper-detection at the
   unresolvable-import fail path now fires for the minified form too. Note: the
   adversary's `incompressible()` was itself broken — `(i*2654435761)%251` has
   period 251 and gzips 1 MB to ~4 KB, so even a correct walker stayed under budget;
   per instructions ("adversary harness assumptions wrong") it was replaced with a
   deterministic 64-bit LCG producing genuinely incompressible bytes. The assertion
   itself is unchanged.
3. **verify:unit `--from-branch` no-op under detached CI HEAD** — FIXED `ca9ddff`.
   `unitFileFromBranch()` now resolves through: named branch → `GITHUB_HEAD_REF` /
   `GITHUB_REF` (the `actions/checkout@v4` PR state) → local and remote branches whose
   history contains HEAD. The detached-worktree counterexample (same commit as the
   named-branch control) now exits non-zero under `--no-run` instead of no-op exit 0,
   so the CI criteria gate really adjudicates on PRs.
4. **Boundaryless CC-ID citation regex** — FIXED `ca9ddff`.
   New `citationsOf()`: an ID counts only when it LEADS the title, optionally after
   ALL-CAPS tag words (`ADVERSARIAL CC-01.3: …`) — per conventions § Criterion
   traceability "Tests name the criterion". `prose mentions NOTA-CITATION CC-999.2 …`
   no longer covers CC-999.2 (counterexample exits non-zero). Side effect: the
   mid-title `CC-I1.11` mention in a models-fetch title (not declared in the unit
   file) no longer triggers UNKNOWN-ID, restoring verify:unit exit 0.
5. **Redaction spy missed `console.table`** — FIXED `ca9ddff`.
   `CHANNELS` extended to the full content-emitting console surface: log, info, warn,
   error, debug, trace, table, dir, dirxml, assert, count, countReset, group,
   groupCollapsed, timeLog (conventions § Principles 4 "a global spy on `console.*`").
6. **Spy missed transcript inside a logged Error** — FIXED `ca9ddff`.
   `flatten()` special-cases `Error`: name, message, stack, own properties
   (EngineError-style `detail`, incl. non-enumerable) and the `cause` chain —
   JSON.stringify alone reduces an Error to `{}`. Errors nested inside plain objects
   are flattened via the JSON replacer.
7. **`containsCanary` blind to `Error.message`** — FIXED `ca9ddff`. Same primitive fix
   as 6: spy AND every artifact scan built on `containsCanary`/`scanError` see the
   message. Counterexample `containsCanary(new Error(…CANARY…))` now true.
8. **Engine-purity bypassed by dynamic import + globalThis** — FIXED `ca9ddff`.
   `scripts/eslint-engine-purity.mjs` adds an `ImportExpression` listener (core
   no-restricted-imports is "static imports only" — official docs) so
   `await import('react')` / `import('mediabunny')` in `src/engine/**` outside
   `**/adapters/**` are errors; and `restrictedGlobals` now reports value-position
   member access on the (unshadowed) global object — `globalThis.window`,
   `self.document`, `globalThis['window']` — while `obj.window` on real objects and
   DOM _types_ stay allowed.

Verification of the round: the 6 adversarial/survived files pass 19/19; full suite
`corepack pnpm test` = 78 passed / 1 skipped / 1 todo; lint, typecheck,
build+check-bundle (68.3 KB gzip / 350 KB), `pnpm test:e2e` (1 passed, 3 DEPLOY
skipped) and `pnpm verify:unit --from-branch` (all untagged covered) all exit 0.

## Follow-ups

- **Frozen-helper fragility (for orchestrator):** `runPnpm` kills the corepack
  child on timeout but orphaned grandchildren survive (observed: a 30 s-killed
  inner suite kept writing lint probes and poisoned outer lint). `scripts/preview.mjs`
  defends against this at the port; a `detached`+`killpg` in `tests/helpers/repo.ts`
  would remove the whole class (touches frozen files — propose for the
  test-author's backlog, not done here).
- **Child-suite time budget:** outer suite ~53 s; inner (child) 21.6 s against the
  frozen 30 s `runPnpm` timeout. From unit-02 on, new heavy suites must keep the
  child run under ~25 s or gates.test's child call needs its timeout widened
  (frozen — raise with orchestrator before unit-02's suite lands).
- `[DEPLOY]` CC-01.14/15/16 remain open: Cloudflare Pages project + production/staging
  environments + `DEPLOY_URL`/`CF_*` secrets at repo level, then run
  `deploy-smoke.mjs` in the CD workflow.
- webkit/firefox e2e projects are gated behind `E2E_WEBKIT`; decide in CI whether to
  enable them nightly.
- `docs/spikes/` does not exist yet; the unit file does not require spike reports for
  unit-01 — candidates for later units (ORT wasm threading, WebCodecs decode budget).
