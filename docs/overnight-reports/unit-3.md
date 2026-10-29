# Unit report: unit-03-model-manager

Branch `ai-dlc/local-transcribe-engine/unit-03-model-manager`, base `f79ddc3` (develop).
Status: **complete** — all 8 untagged Completion Criteria pass with every PR-pipeline gate
green. This is slice 3D on top of the 3A/3B/3C builders (registry/capability 502b855, cache
6865c65, manager bc3940e); 3D relocates the builder provider suites so the frozen CC-03.8 gate
sees them (root-cause per ledger 15:10Z), makes the three frozen CC-03.3 e2e specs green, and
runs the full sweep.

## Completion criteria

From `reports/criteria/unit-03-model-manager.md` (`corepack pnpm verify:unit --from-branch`, exit 0):

| ID      | level    | passing tests | result |
| ------- | -------- | ------------- | ------ |
| CC-03.1 | untagged | 14            | pass   |
| CC-03.2 | untagged | 45            | pass   |
| CC-03.3 | untagged | 3             | pass   |
| CC-03.4 | untagged | 10            | pass   |
| CC-03.5 | untagged | 11            | pass   |
| CC-03.6 | untagged | 19            | pass   |
| CC-03.7 | untagged | 22            | pass   |
| CC-03.8 | untagged | 2             | pass   |

Provenance per ID (frozen suites → relocated provider suites): CC-03.1
`tests/unit/model/registry.test.ts` (frozen) + `registry-internals.test.ts` (relocated);
CC-03.2 `capability.test.ts` + `manager-lifecycle.test.ts` + `capability-internals.test.ts` +
`manager-internals.test.ts`; CC-03.3 `e2e/model/model-cache.spec.ts` (Playwright chromium,
3 specs, green untouched — no spec edit); CC-03.4 `cache.test.ts` + `cache-internals.test.ts`;
CC-03.5 `manager-download.test.ts` + `manager-internals.test.ts`; CC-03.6
`manager-lifecycle.test.ts` + `manager-internals.test.ts`; CC-03.7 `manager-download.test.ts` +
`manager-internals.test.ts`; CC-03.8 `model-coverage.test.ts` (nested scoped run, see Gates).
No `[RQ]`/`[DEPLOY]`/`[MANUAL]`-tagged criteria in this unit.

**CC-03.8 mechanism (the honest lever):** the frozen gate spawns
`vitest run tests/unit/model --exclude=**/model-coverage.test.ts --coverage… --perFile` (lines
85 / branches 75). Only test files under `tests/unit/model/` collect providers there, so the
four builder-owned suites at `src/engine/model/*.test.ts` never ran under the gate (manager.ts
branches ≈63.5% under the five frozen suites alone). They are now `git mv`-relocated to
`tests/unit/model/{registry,capability,cache,manager}-internals.test.ts` — pure moves +
import-path fixes (`./registry` → `@engine/model/registry` etc.), **every assertion intact, no
padding** (65 tests: registry 5, capability 9, cache 26, manager 25). Not added to the
`ZIPSCRIBE_CHILD` exclude list in `vitest.config.ts` (the gates-scaffold coverage-all child
needs them as providers); the five frozen suites' child exclusions stay as the test-author set
them. No new behavioral tests were needed: the nested run cleared perFile thresholds on first
relocation (per-file table in Measurements).

## Gates

Verbatim tails at this HEAD:

- lint ✓ exit 0 (`eslint .`, 0 problems)
- typecheck ✓ exit 0 (`tsc --noEmit` × tsconfig.json / tsconfig.node.json / tsconfig.eval.json)
- test ✓ exit 0 — **Test Files 44 passed (44) · Tests 271 passed | 1 skipped | 1 todo (273)**,
  ~90 s wall (file-sequential; includes the frozen CC-03.8 gate, the gates scaffold's
  `pnpm test --coverage` child running the relocated provider suites, and the frozen
  CC-02.5 in-test `pnpm qualify` re-run). Post-review count (271) supersedes the 234 measured
  when this report was first written: the adversary round (26 probes) and the audit fix cycle
  (junit-trust distrust suite, hardened boundary scanner) added tests afterwards.
- build ✓ + check-bundle ✓ — initial JS **68.3 KB gzip / 350 KB budget** (1 chunk;
  engine/model is lazy, excluded)
- test:e2e ✓ exit 0 — **4 passed, 3 skipped** (skipped = the 3 `[DEPLOY]` specs, Adaptation 3);
  the 3 frozen `e2e/model/model-cache.spec.ts` CC-03.3 specs pass **unmodified**: cache-hit
  reload 0 model-host requests (route spy) 149 ms, offline cached load 98 ms, offline uncached
  `OFFLINE_MODEL_MISSING` 62 ms (≪ 1 s); harness vite on 127.0.0.1:4311 spawned by the spec
  and closed in `afterAll` (verified no listener on 4311/4310 after the run — unit-02 orphan
  rule)
- `verify:unit --from-branch` ✓ exit 0 — "all untagged criteria of unit-03-model-manager.md
  covered (8 total)"
- `vitest run --config vitest.config.qualify.ts` ✓ exit 0 — 10 files / 20 tests passed
- frozen contract ✓ — `git diff f79ddc3..HEAD --diff-filter=M -- tests e2e` is **empty**
  (relocations are pure renames; zero bytes changed on any f79ddc3-present test/e2e file,
  incl. `fakes.ts`, `unit03-api-contract.d.ts`, the e2e harness fixtures and specs)
- `node scripts/qualification-check.ts` ✓ exit 0 — `ACCEPT — qualification/0.0.0-spike.json
valid for contentHash 9021ffe2b6c0…` (see Deviations 8: the record was regenerated and
  committed with this unit)

## Deviations from spec

1. **`ensureOffline` delegation (carried from 3C, ledger 04:56Z):** the manager's download
   sequence delegates to `cache.ensureOffline` (single owner of URL planning incl. same-origin
   `runtimeWasm`, SHA verify, all-or-nothing put); `ModelManagerDeps.fetchImpl` is kept for DI
   symmetry and is unused by the manager itself. Accepted by the orchestrator.
2. **runtime-wasm size-vs-SHA gap (ledger 14:35Z):** US-03.1/CC-03.4 say runtime wasm is
   "SHA-256-verified", but the frozen `ModelSpec.runtimeWasm` is `string[]` — a per-file
   checksum is unrepresentable in the frozen contract. `cache.ts` verifies presence +
   same-origin fetch for wasm and full SHA-256 for every registry file; `matchCached(url, "")`
   is the documented presence-only read for wasm entries. Test-contract gap, flagged for
   registry v2 (Follow-ups).
3. **Registry enrichment choices (3A):** `cactus-whistle@b358ddad` carries `tierHint: 'T3'`
   per the spike recommendation (CC-02.11) although its measured row ran on the T2 profile;
   `approxBytes` values are sums/roundings of the per-file `bytes` (catalog convention), not
   exact wire sizes; `languages: ['*']` for whistle (report says "7 langs", list not
   enumerated) with `languageDetect: true`.
4. **`playwright.config.ts` `fullyParallel: true → false` (builder extension):** the frozen
   CC-03.3 spec spawns its own vite server on fixed port 4311 in `beforeAll` and closes it in
   `afterAll` (unit-02 orphan doctrine). With `fullyParallel: true` the three tests land on
   three workers; only the first successfully binds `--strictPort`, and whichever worker
   finishes first kills the one live server, leaving siblings `ERR_CONNECTION_REFUSED`
   (measured: 1 failed / 2 passed nondeterministically). Per-file single-worker execution is
   Playwright's documented default; cross-file parallelism is unchanged. No threshold or
   assertion touched; the spec file itself runs green byte-identical.
5. **`scripts/verify-criteria.ts` (frozen-adjacent, same treatment the orchestrator gave
   unit-02's sibling-ID fix):** the Playwright JUnit reporter writes to **stdout** when only
   `--output=<dir>` is passed — `<dir>/junit.xml` was never created, so e2e-sourced criteria
   silently collected 0 passing tests (CC-03.3 was the first e2e-sourced untagged criterion
   and exposed it: 3 real green specs reported as "no passing test"). Fixed by exporting the
   reporter's documented `PLAYWRIGHT_JUNIT_OUTPUT_FILE` env var to `<outDir>/pw/junit.xml`
   (verified against pinned @playwright/test 1.64.1; the fallback `test-results/junit.xml`
   candidate is untouched). This makes attribution honest — it can only turn a falsely-failing
   criterion green, never a failing test.
6. **Relocation import adaptations (type-only, assertions byte-identical):**
   `manager-internals.test.ts` imports `ModelManagerEvent` from `@engine/protocol` (where the
   frozen `unit03-api-contract.d.ts` declares it) instead of `@engine/model/manager`;
   `cache-internals.test.ts` replaces the DOM-lib `RequestInfo` with
   `Parameters<typeof globalThis.fetch>[0]` (the node test tsconfig carries no DOM lib —
   same trick the frozen `fakes.ts` documents for `Response`). Both were required solely
   because the files now typecheck under `tsconfig.node.json`.
7. **SECURITY-03 note:** no transcript/model text in logs or failures anywhere in the slice;
   e2e model bytes are seeded PRNG noise from the frozen spec; manager/cache rejections carry
   codes only.
8. **Qualification record regenerated (was: REJECT on stale committed spike file — review round
   1 finding F1).** The committed `qualification/0.0.0-spike.json` was unit-02's record
   (`fba967fe7b74…`); unit-03 necessarily changes the hash inputs by adding
   `src/engine/model/**`, so the committed record no longer described the tree it shipped in
   and the frozen CC-02.5 accept-legs (`qualification-check-adversarial.test.ts`, CI `quality`)
   failed on a clean checkout. Fixed by running the real `corepack pnpm qualify` against this
   tree (exit 0, 8/8 RQ criteria pass) and committing the regenerated file — contentHash
   `9021ffe2b6c0…`, `node scripts/qualification-check.ts` now ACCEPTs it (exit 0). Nothing is
   fabricated: every number came from that run. `pnpm test` no longer dirties the tree.

## Contract changes

none (no `architecture.md` type edits needed; `ModelManagerEvent`/`ModelFailure` shapes match
the frozen contract). Orchestrator attention on the two tool files in Deviations 4–5.

## Dependencies

none — no package added or removed (unit-02's `sherpa-onnx@2.0.1` removal remains open, see
Follow-ups).

## Measurements

- Nested scoped coverage (the CC-03.8 gate run, `--coverage.include=src/engine/model/**`,
  perFile 85/75), per-file `coverage-summary.json`:
  | file                                                                                       | lines | branches |
  | ------------------------------------------------------------------------------------------ | ----- | -------- |
  | cache.ts                                                                                   | 100   | 100      |
  | capability.ts                                                                              | 100   | 95.91    |
  | manager.ts                                                                                 | 95.08 | 84.21    |
  | registry.ts                                                                                | 100   | 100      |
  | **total**                                                                                  | 97.57 | 91.62    |
  | All files clear perFile lines ≥ 85 / branches ≥ 75 — no file needed extra tests beyond the |
  | relocated suites. Nested run: 16 files / 154 tests passed, 10.4 s.                         |
- e2e timings (chromium, local): cache-hit spec 149 ms, offline-cached 98 ms, offline-uncached
  notice 62 ms (threshold < 1000 ms), workbench smoke 108 ms; full `pnpm test:e2e` 5.2 s
  (build+preview webServer excluded: reused).
- Bundle: 68.3 KB gzip initial / 350 KB budget. `pnpm test` wall 82–113 s sequential.
- Qualification regenerate contentHash `9021ffe2b6c0df0e746c62062e74ab599c780a5b55c3616559cb2ffc3891639e`
  (committed record, regenerated and re-verified by this unit; supersedes unit-02's
  `fba967fe7b741795fc1cb8ef698e89d9a51c3e9af3674b9206b0551dd09fbe9d`).

## Follow-ups

- **FR-03.7 `@network` registry-reachability integration test — no such test exists yet**
  (spec: manual, CI skips). Needs an owner/orchestrator manual run against the real HF CDN
  (allowlisted hosts only) before registry rows are trusted at release.
- **runtimeWasm per-file SHA (registry v2):** extend `ModelSpec.runtimeWasm` to
  `{ path, sha256 }[]` (contract change) so the same-origin runtime assets are
  SHA-verified like model files — closes the 14:35Z gap; frozen `ModelSpec` blocks it here.
- **`TIER_DOWNGRADE` retry notice** (US-1.1.1 adapter-request-fail → automatic T2 retry with
  user-facing notice): manager fails closed on T4 and delegates device choice; the actual
  webgpu→wasm retry notice flow belongs to the unit-05 worker pipeline.
- **`sherpa-onnx@2.0.1` devDependency removal** still open from unit-02 review L1 (nothing
  references it).
- **qualification-check on `release/*`:** the record is now current for this tree; any later
  `src/**` change (unit-04 onward) invalidates it again — re-run `pnpm qualify` on the release
  branch as the release gate requires.
- **architecture.md T4 wording vs `capability.ts` (review round 1 F6):** the tier table's T4 row
  reads "no WASM SIMD, or deviceMemory < 4 GB" (disjunctive), while US-1.1.1 and the frozen
  contract require `!webgpuAdapter && !wasmSimd` (conjunctive) so a WebGPU machine without SIMD
  still gets T1. Implementation follows the frozen contract; the orchestrator owns the
  architecture.md rewording (no code change).
- ~~`vitest.config.ts` child-safety block for the five frozen unit-03 suites~~ — **retired**
  (review round 1 F7): they spawn nothing and run in 0.5 s, so the CC-01.1 command-wiring
  child now executes them (297 tests green in the child).
- **Review round 1 fix cycle (all closed):** F1 qualification record regenerated and committed
  (8/8 RQ). F2 e2e criteria now need Playwright provenance and citations come only from a
  title's leading run (`e2e-provenance-adversarial.test.ts` proves the deleted-spec bypass is
  dead; two self-citing adversary titles renamed). F3 `copyNeedleRuntime` vendors the
  cactus-needle runtime into `public/wasm` SHA-verified against its vendor manifest, with an
  additive test asserting every `runtimeWasm` path has a producer. F4 comment no longer claims
  a provenance the spike report never states. F5 real-plugin ESLint adversary added (the
  `staticSpecifier` mutation is now killed).
