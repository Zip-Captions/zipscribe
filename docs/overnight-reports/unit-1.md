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
- **CC-01.8 is PROVISIONAL for eval use** (review round 1 · F2): the format matrix is
  complete and manifest-verified, but every "speech" entry is formant-synthesized, not
  corpus audio — see Deviations item 7. Structural checks (codec/sampleRate/channels/
  expectedPath) are real; anything downstream that measures ASR _quality_ on these
  fixtures (unit-02 WER/MAE, taxonomy-category evidence) is void until the corpus
  vendoring lands.
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
   - `coverage.reportsDirectory` split (review round 1 · F1): `coverage-main` for the
     top-level run, `coverage/child` for scaffold-spawned children
     (`ZIPSCRIBE_CHILD=1`). The frozen `coverage-gate.test.ts` probe runs a nested
     `pnpm test --coverage` and deletes `coverage/` in its `finally`; with vitest's
     shared default `coverage/` that wiped the parent's live `coverage/.tmp` and the
     whole run died on `ENOENT coverage-N.json` (CI run 40646526713; reproduced
     locally). Reviewer prescribed "env var + ci.yml step"; implemented instead as the
     config's `ZIPSCRIBE_CHILD` branch — the marker every scaffold child already
     carries — so parent/child can never collide regardless of how the step is
     invoked. ci.yml artifact upload paths updated (`coverage-main/`, `test-results/`).
   - `testTimeout: 30_000` (review round 1 · F1b): the vitest default 5 s killed the
     type-aware-ESLint probes (6.3–6.5 s) and the scratch `pnpm fixtures` regeneration
     (7.2 s) on the 2-core CI runner — the × marks whose text the crash masked. Pure
     budget raise; no assertion touched.
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
7. **Fixture speech is synthesized, not corpus — the spec's corpus contract is NOT met**
   (review round 1 · F2, honest entry making the `fixtures/LICENSES.md` cross-reference
   true). US-1.0.2 / Technical Specification name openly-licensed vendor sources
   (`fixtures/sources/`: LibriSpeech `test-clean` CC BY 4.0 for `en-clean` + the
   two-speaker mix, Common Voice CC0 for `en-accented`/`fr-clean`, clean-clip ⊕ MUSAN
   at fixed SNR for `en-noisy`, in-house/CC0 for `en-technical`) with word timings from
   a one-time forced-alignment pass. What shipped instead: every `speech-*`/taxonomy
   fixture is generated by `scripts/make-fixtures.ts` as **formant-synthesized sine
   sums** (seeded PRNG, deterministic, ground truth exact by construction — the
   frozen CC-01.2 regeneration test runs `pnpm fixtures` in a scratch tree _without_
   `fixtures/sources/`, so the generator itself had to produce every committed byte).
   Consequences, stated plainly:
   - **Provenance**: no real human speech exists in the corpus; the CC-BY-4.0/CC0
     license rows of the spec's plan are moot — all bytes are ours (CC0, LICENSES.md
     row 1).
   - **Forced-alignment timing**: moot — timings are exact by construction (the
     synthesizer emits the word JSON), so they are _better_ than aligned ground truth
     for timing-metric plumbing but describe synthetic phonation, not real speech.
   - **Taxonomy realism**: the `category` labels (`en-clean`/`en-accented`/
     `en-technical`/`en-noisy`/`fr-clean`) encode no real accent, domain vocabulary
     or noise character — they exercise the manifest/plumbing only. `en-noisy` "noise"
     is a PRNG hiss added at fixed SNR; `fr-clean` is French-_labelled_ formant
     sequences, not French speech.
   - **Structurally void for quality measurement**: a real Whisper ASR run **cannot
     transcribe sine-formant speech** into the scripted words — unit-02's WER/MAE on
     these files and any hotword/taxonomy-accuracy evidence would be meaningless.
     Structural gates stay valid: format matrix + manifest (CC-01.8), byte
     determinism (CC-01.2), license completeness (CC-01.7).
   - **Why not vendored tonight**: the run-config external-deps allowlist permits only
     the npm registry + `huggingface.co`/`*.hf.co`/`*.huggingface.co`; LibriSpeech /
     Common Voice / MUSAN hosts are blocked (orchestrator ruling). Interim path per
     reviewer: this entry + `TODO(unit-02)` in `make-fixtures.ts` (vendoring under an
     approved network exception) + CC-01.8 flagged provisional above. **Vendoring is
     carried to the morning summary as awaiting-owner**, not attempted.
8. **README status paragraph** updated (review round 1 · F9) — "specification only" was
   stale after the scaffold landed.

## Contract changes

No edits to `architecture.md` types were needed.

Orchestrator-owned `settings.yml` patches this unit's data implies (FR-1.0.11:
"recorded in the unit report (and `version_pins` patched for mediabunny)") —
proposed, **not applied**:

1. `stack.build` note (line 30) "DECISION PENDING: … confirm vitest/vite-plugin-pwa
   compat at unit-01 and record here" → resolve to:
   `build: vite@7 (7.3.7 resolved; decision recorded in unit-01 report § Resolved
versions — all direct peers allow vite ^8, hold on 7 until unit-204 exercises
vite-plugin-pwa@2 against it)`.
2. `version_pins.mediabunny` (line 62) still reads "exact version recorded by
   unit-01 (1.62.1 latest on 2026-10-27)" — unit-01 never installs mediabunny (first
   consumer is unit-04); patch to pin `1.62.1` explicitly (or defer the pin to
   unit-04 with a note), so the "pins are contract" wording has a concrete value.

## Dependencies

None outside `settings.yml approved_dependencies` **except dev-only ambient types**,
declared here per `.agent/AGENTS.md` § Dependencies:

- `@types/node` 24.10.1 — required by `typecheck` (scripts/tests use `node:*` APIs)
- `@types/react` 19.3.0 — required by `typecheck` (react@19 JSX; not in the approved list)
- `@types/react-dom` 19.3.0 — same (react-dom@19 `createRoot` typing; not in the approved list)

All versions match the pins (license-check gate passes). Note: fixture generation uses
the already-installed `ffmpeg-static` 5.3.0 binary (dev-side tooling only, never
shipped). **Follow-up (out of review scope):** `wrangler` is listed in
`approved_dependencies.dev` but is not yet a devDependency — every `pnpm exec wrangler`
step in the CD workflows sits behind the `CLOUDFLARE_API_TOKEN != ''` gate (inert per
Adaptation 3), so this cannot bite until the owner adds secrets; add `wrangler` to
devDependencies in the same change that un-gates deploys (unit-203).

## Resolved versions (FR-1.0.11)

From `corepack pnpm list --depth=0` (pnpm 10.15.0, Node 22 line, lockfile as committed):

| Package                                       | Resolved                  | Pin/source                                                                                                  |
| --------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| react                                         | 19.3.1                    | `^19.0.0` (settings.yml pin)                                                                                |
| react-dom                                     | 19.3.1                    | `^19.0.0`                                                                                                   |
| @huggingface/transformers                     | 3.8.1                     | `~3.8.1` (contract pin; transitive onnxruntime-web 1.22.0-dev.20250409-89f8206ba4, onnxruntime-node 1.21.0) |
| vite                                          | 7.3.7                     | decision below                                                                                              |
| vitest                                        | 4.1.12                    | dev                                                                                                         |
| @vitest/coverage-v8                           | 4.1.12                    | dev                                                                                                         |
| @vitejs/plugin-react                          | 5.2.0                     | dev                                                                                                         |
| typescript                                    | 5.9.3                     | TS 5 strict (settings.yml stack)                                                                            |
| eslint                                        | 9.39.5                    | ESLint 9 flat                                                                                               |
| typescript-eslint                             | 8.72.1                    | dev                                                                                                         |
| prettier                                      | 3.9.10                    | dev                                                                                                         |
| @playwright/test                              | 1.64.1                    | dev                                                                                                         |
| jsdom                                         | 30.1.3                    | dev (UI-boundary opt-in)                                                                                    |
| ffmpeg-static                                 | 5.3.0                     | dev (fixture tooling)                                                                                       |
| @types/node / @types/react / @types/react-dom | 24.10.1 / 19.3.0 / 19.3.0 | declared in Dependencies above                                                                              |

Stack entries intentionally **not installed yet** (first consumer is a later unit):
zustand/immer/zundo + `@tanstack/react-virtual` (intent 2), mediabunny (unit-04, pin
proposed under Contract changes), tailwindcss (unit-201), vite-plugin-pwa +
`@vite-pwa/assets-generator` + workbox-window (unit-204), `@ffmpeg/*` (fallback tier),
idb (persistence), `@axe-core/playwright`, `@lhci/cli`, wrangler (see Dependencies
follow-up), Stryker (intent-exit mutation baseline).

**vite@7 vs vite@8 decision (settings.yml line-30 note — resolved):** stay on
**vite@7.3.7**. Evidence (pinned versions, `peerDependencies` as shipped): vitest
4.1.12 allows `vite ^6.0.0 || ^7.0.0 || ^8.0.0`; `@vitejs/plugin-react` 5.2.0 allows
`^4.2.0 || ^5 || ^6 || ^7 || ^8`. So nothing _installed_ blocks vite 8. The hold is
`vite-plugin-pwa@2` (Workbox 7) — required by unit-204, peer range "vite 3–8"
(settings.yml line 64) but with no demonstrated 8.x usage in this stack yet, and
vite 8 is a fresh major. Adopting it is a unit-204 decision (an upgrade unit, per
"Version pins are contract"); until then the scaffold keeps the conservative major.

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
- `fixtures/sources/` vendoring (LibriSpeech/Common Voice/MUSAN) awaits an approved
  network exception — see Deviations item 7 / Review round 1 · F2; carried as
  awaiting-owner to the morning summary.

## Review round 1

Findings F1–F4, F6–F10 (F5 absent from the round-1 list). No test file was modified:
`git diff 7f9d48f..HEAD --diff-filter=M -- tests e2e` remains empty (and this round
added none). F4 was resolved without touching `models-fetch.test.ts` (the reviewer's
preferred branch: ci.yml reorder).

- **F1 (blocker, CI red) — FIXED.**
  (a) Deterministic crash: reproduced locally at `e5ef3c5` —
  `corepack pnpm test --coverage` → `EXIT=1`, unhandled rejection
  `Error: Something removed the coverage directory "<repo>/coverage/.tmp" … Make sure
you are not running multiple Vitests with the same "coverage.reportsDirectory" at the
same time.` / `Caused by: ENOENT … coverage/.tmp/coverage-0.json` (CI run 40646526713
  shows the identical `coverage-11.json` failure). Cause exactly as reviewed: the
  frozen `coverage-gate.test.ts` nested probe shared `coverage/` with the parent and
  deleted it in its `finally`. Fix in `vitest.config.ts` (builder-owned config, frozen
  tests untouched): `coverage.reportsDirectory` = `coverage-main` (parent) vs
  `coverage/child` (any `ZIPSCRIBE_CHILD=1` child) — the two runs can no longer share
  a temp dir; `coverage*/` gitignored; ci.yml upload paths follow.
  (b) The five further reds, from the CI log: `CC-01.6` ×2 were the Playwright tests
  spawning chromium before `playwright install` (ci.yml step order) — fixed by moving
  `install playwright browsers` **and** the `models:fetch` cache step **above** the
  vitest step. The remaining × marks (`CC-01.3` ×3 at 6.32–6.47 s, `CC-01.2` regen at
  7.19 s) match vitest's default 5 s per-test budget exceeded on the 2-core runner —
  fixed with `testTimeout: 30_000` in `vitest.config.ts` (budget only; no assertion
  altered). The crash had masked the detail output (vitest aborted before printing it);
  these tests are green locally with `--coverage` both before and after, and the CI
  re-run adjudicates (checked with `gh pr checks 3`, non-blocking).
  OBSERVED (unit Verify block, behaviour change): same command, post-fix:
  `Test Files 20 passed (20) · Tests 78 passed | 1 skipped | 1 todo (80) · EXIT=0`.
- **F2 (major, evidence integrity) — FIXED via the orchestrator-ruled interim path.**
  Honest deviation entry added as Deviations item 7 (provenance / forced-alignment /
  taxonomy / WER-void consequences stated; CC-01.8 flagged provisional under the
  criteria table); `fixtures/LICENSES.md`'s "see the unit report for the documented
  deviation" cross-reference is now TRUE (it was a dangling pointer);
  `TODO(unit-02)` added to `scripts/make-fixtures.ts` pointing at `fixtures/sources/`
  vendoring under an approved network exception. The download itself was **not**
  attempted (external-deps allowlist forbids the corpora hosts this run) — carried to
  the morning summary as awaiting-owner.
- **F3 (major, deploy safety) — FIXED.**
  (a) `preview-deploy` no longer re-runs `pnpm build`: `quality` uploads `dist/` as an
  artifact (`retention-days: 1`) and the deploy job downloads and ships **that**
  artifact (conventions § CI/CD "ships the exact dist/ artifact the same run tested";
  `pnpm install` remains only to provision the job's tooling).
  (b) `deploy-production.yml` gains the spec'd failure path: `rollback production on
failed smoke` (`if: failure() && … && steps.smoke.outcome == 'failure'`, redeploys
  the previous release tag per conventions § CI/CD "redeploy the previous release
  tag's artifact") and `open incident issue on failed smoke` (`gh issue create`,
  gated on token presence).
  (c) All three deploy workflows capture the wrangler URL into a step output
  (`grep -oE 'https://[a-z0-9.-]+pages\.dev' deploy.log | tail -1`) and point
  `deploy-smoke.mjs` at it — literal `https://<project>.pages.dev` placeholders gone.
  (d) PR-comment step added to `preview-deploy` (FR-1.0.7/13): preview URL + criteria
  table from the `reports` artifact, gated on Cloudflare + `GH_TOKEN` presence.
  All additions sit behind the existing token gates (inert until Adaptation 3 lifts);
  workflows re-validated as parseable YAML. Note: `wrangler` itself is not yet a
  devDependency (follow-up recorded under Dependencies).
- **F4 (minor, vacuous models-fetch) — FIXED via ci reorder (reviewer-preferred).**
  `models:fetch` (+ cache) now runs before the vitest step, so
  `tests/unit/scaffold/models-fetch.test.ts` finds a populated `.cache/models` in CI
  and its `if (!bytes) return` guards stop being taken (CI log showed the file's 4
  adversarial cache-integrity tests completing in 6 ms = vacuous). **No test edit**, so
  no REVIEW #9 citation is needed. Locally the cache was already populated and those 4
  tests run for real (suite duration moved 52.7 s → ~61 s).
- **F6 (minor) — FIXED.** `scripts/check-bundle.mjs` static-import separator class
  widened `[\s;()]` → `[\s;(),{}]` (minified emitted forms can be preceded by `}` or
  `,`, e.g. `…}import{a}from'./x.js'`). Dynamic `import('…')` stays out of the graph
  (the adversarial CC-01.4 minified-import and lazy-chunk tests still pass).
- **F7 (minor) — FIXED.** FR-1.0.11 "Resolved versions (FR-1.0.11)" section added with
  the exact resolved versions from `corepack pnpm list --depth=0` and the reasoned
  vite@7-vs-8 decision (peers allow 8; hold on 7 pending unit-204's
  vite-plugin-pwa@2 exercise). The `settings.yml` patches (stack.build note,
  mediabunny pin) are orchestrator-owned → recorded under Contract changes.
- **F8 (minor) — FIXED.** `@types/node` 24.10.1, `@types/react` 19.3.0,
  `@types/react-dom` 19.3.0 declared in the report Dependencies section (absent from
  `approved_dependencies`; justified as typecheck-necessary dev-only ambient types).
- **F9 (minor) — FIXED.** README "specification only" paragraph replaced with an
  accurate scaffold-phase status (gates + fixtures + shell landed; app units pending).
- **F10 (minor) — FIXED.** `test-results/` (Playwright JUnit) added to the ci.yml
  `reports` artifact upload paths (alongside the new `coverage-main/`).

### Gates re-run (this round, local)

lint ✓ (0) · typecheck ✓ (0) · `pnpm test` ✓ (20 files, 78 passed | 1 skipped | 1
todo, 60.7 s) · **`pnpm test --coverage` ✓ EXIT=0 (20 files, 78 passed | 1 skipped |
1 todo, 64.4 s — the F1 CI command)** · build ✓ + check-bundle ✓ (68.3 KB gzip / 350
KB, 1 chunk) · `pnpm test:e2e` ✓ (1 passed chromium, 3 DEPLOY skipped, 3.3 s) ·
`pnpm verify:unit --from-branch` ✓ (all untagged criteria of unit-01 covered, 16
total) · format:check ✓ · spec-lint ✓ (21 files) · license-check ✓ (54 packages).
