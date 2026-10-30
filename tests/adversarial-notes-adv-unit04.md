# Adversary round — unit-04 (`unit-04-media-ingest`), branch tip 52cb571

Agent: `adv-unit04` (unattended post-build round). Isolated checkout:
`.night/adv-unit04` (git worktree, detached at the branch tip — the branch is
checked out in the main working copy, so `--detach` was required; commits are
pushed back to `ai-dlc/local-transcribe-engine/unit-04-media-ingest`).
Environment: the committed qualification record validates only the builder's
`public/harness/` build state, so the harness dir was seeded from the main
checkout before any `pnpm test` (see F-1 — this is itself a finding, not a
crutch I invented).

## Baseline

- `corepack pnpm test` (clean tree + seeded `public/harness`): **exit 0 — 523 passed | 1 skipped | 1 todo (525), 65 files**.
- On a *clean* checkout (no `public/harness`) the same command fails 3 tests in
  `tests/unit/model-eval/qualification-check-adversarial.test.ts` (REJECT,
  recomputed `4269abe12f9b…` vs record `4390b6733602…`). See F-1.
- `pnpm lint` exit 0, `tsc` (all three configs) exit 0, targeted playwright specs and my new suites green (tails in the round report).

## Committed artifacts

- `tests/unit/audio/adversarial/worker-bridge-adversarial.test.ts` — executes
  `src/workers/media.worker.ts` (real module, fake DedicatedWorkerScope, real
  `MessageChannel` ports, stubbed SDK seams). **Kills the drop-`openFfmpeg`
  mutant** that no existing gate could see (A-04 below). Also documents the
  PortRecorder `stop()` silent-pass mask.
- `e2e/media/adversarial-fabrication.spec.ts` — anti-fabrication oracles across
  the harness/overlay boundary: streaming-summary vs one-shot chunk agreement
  (kills the harness chunk-counter forgery A-12) and overlay ffmpeg rows vs
  browser-native decode cross-correlation (kills the overlay synthesis forgery
  A-13; red under it — corr `0.0001`, green honest).
- This notes file.

## Attack log

Legend: KILLED = at least one honest suite goes red; SURVIVED = every gate
stayed green (finding); each row was executed, not reasoned (except * = argued
from executed primitives, marked so).

| ID | Attack | Mutated artifact | Result | Caught by / notes |
|----|--------|------------------|--------|-------------------|
| A-01 | @ref `queue.pop()` (LIFO delivery) | `worker-core@ref.ts` | KILLED | `worker-ref-internals` + frozen `pcm-chunk` burst-order pin (3 fail) |
| A-02 | @ref never sends receipts | `worker-core@ref.ts` | KILLED | frozen `decode.test` stalled-consumer test times out |
| A-03 | @ref drains synchronously (`post` → inline `drain`) | `worker-core@ref.ts` | KILLED | `worker-ref-internals` post-close-inert + buffered() pins |
| A-04 | Worker bridge drops `openFfmpeg` seam (ffmpeg fallback unreachable in production) | `src/workers/media.worker.ts` | **SURVIVED all shipped gates** (wiring test is regex-on-source) → now KILLED by committed suite | F-4: worker had zero executing coverage; `e2e/media/worker-contract.spec.ts` referenced by `decode-contract.ts` does not exist |
| A-05 | ffmpeg adapter halves gain of decoded PCM | `adapters/ffmpeg.ts` | KILLED | `adapters/ffmpeg.test` value assertions (3 fail) |
| A-06 | mediabunny returns `path: 'ffmpeg'` for native decodes | `adapters/mediabunny.ts` | **SURVIVED** (no unit assertion; e2e uses the frozen harness's inlined mirror, never this module) | F-3 |
| A-07 | probe.ts: ffmpeg-only formats reported `webcodecs` | `adapters/probe.ts` | **SURVIVED** (no unit test executes `probe.ts`; support-matrix verifies the harness mirror) | F-3 |
| A-08 | `toEngineError` leaks raw decoder message into `detail` (SECURITY-03) | `decode.ts` | KILLED | `decode-internals` redaction assertions, both copies |
| A-09 | Backpressure `gate()` call removed (unbounded queue) | `decode.ts` | KILLED | frozen CC-04.12 stalled-queue test times out; two internals tests |
| A-10 | check-bundle bypass: 400 KB JS served via `publicDir`, injected at boot by `main.tsx` | `main.tsx` + fixture payload | **SURVIVED** — `check-bundle` 68.3 KB/350 KB green, payload served `200` (400,036 B); `verify-fixtures` ignores files absent from the manifest | F-5 |
| A-11 | Title forgery: two trivial `expect(1).toBe(1)` tests titled `CC-04.9:`/`CC-04.10:` | added vitest file | **SURVIVED** — `verify-criteria unit --from-branch` reports `CC-04.9 | 2 | pass`, `CC-04.10 | 2 | pass` | F-6 (unit-03 F2 class, unfixed for unit-04) |
| A-12 | Frozen harness fakes the streaming summary (reports half the chunks) | `e2e/media/fixtures/harness.ts` `decodeStreaming` | KILLED by memory gate chunk-count + my new spec; **tee-scaling alone SURVIVED** (fan-out equality is insensitive to global loss) | guard sketch in F-7 |
| A-13 | Overlay forges the whole ffmpeg fallback answer (440 Hz sine + honest-shaped events) | `scripts/harness/ffmpeg-overlay.mjs` | KILLED — all 6 format-matrix fallback rows + forced-fallback red (ref correlation / static parity); my new spec red (corr 0.0001) | overlay is builder-owned & un-frozen (F-7) |
| A-14 | amr fixture bytes XORed (content destroyed) + manifest sha re-signed | `fixtures/audio/fmt-30s.amr`, manifest | verify-fixtures **GREEN** (sha-only, self-consistent); format-matrix amr row KILLED (source correlation vs `fmt-30s.ref.wav`) | F-8 (manifest is self-signed; CI regenerates fixtures) |
| A-15 | Hand-edit `qualification/0.0.0-spike.json` `contentHash` | qualification record | KILLED | `qualification-check` REJECT (unit-02 anti-tamper suite works — but see F-2) |
| A-16 | *Qualification re-signing laundering: mutate `src/` then run `pnpm test` | concurrent src mutants during a suite run | **OBSERVED** — `qualification/0.0.0-spike.json` was rewritten in-place to the mutant tree's hash (`973ae98f…`) by the suite itself | F-2 |

## Findings

- **F-1 (HIGH) — qualification contentHash binds machine-local build output.**
  `scripts/lib/qualification-hash.ts` `GENERATED_PUBLIC_DIRS` excludes
  `wasm/sherpa/eval4x/fixtures/hf-cache` but **not `harness/`**, which
  `pnpm build` regenerates (gitignored). Consequences: a clean checkout fails
  3 model-eval tests and `node scripts/qualification-check.ts` REJECTs
  (`4269abe…` vs record `4390b…`) ⇒ the release `qualification-check` CI job
  and the "main suite green" claim are only true on a tree carrying the
  builder's private `public/harness` bytes. Guard: add `'harness'` to
  `GENERATED_PUBLIC_DIRS` (the frozen test's own `GENERATED_PUBLIC` list
  doesn't need to change — the hash lib excludes it before hashing).
- **F-2 (HIGH) — CC-02.5 anti-tamper is order-dependent tautology.**
  `tests/unit/model-eval/qualify-runner.test.ts:39` runs `pnpm qualify` at the
  repo root on every `pnpm test`, re-signing `qualification/0.0.0-spike.json`
  against the current working tree (observed rewriting to a mutant tree's
  hash mid-run). "Untouched copy is accepted" (same file, later test; and
  `qualification-check-adversarial`'s accept case) is satisfied by the
  record the suite just re-minted. `docs/spikes/**` and `qualify/**` are not
  in any frozen set, so a builder can re-sign arbitrary trees. Guard: qualify
  runner should write to a scratch dir (like the fabrication suite already
  does), never the repo; or `pnpm test` must `git checkout` the record after.
- **F-3 (HIGH) — production adapter modules are executed by nothing.**
  `src/engine/audio/adapters/mediabunny.ts` (open/path labels) and
  `adapters/probe.ts` (support table) are imported only by
  `src/workers/media.worker.ts`, which no shipped suite executed (A-04/A-06/A-07
  all survived; e2e drives the frozen harness's *inlined mirror* of the same
  logic, which passes regardless). The mirror can drift from production and
  every media gate stays green. Guard: the committed worker suite + extending
  it (or the phantom `e2e/media/worker-contract.spec.ts`) to drive the real
  worker in a real Worker, and a test that imports `probe.ts` directly against
  the support expectations the matrix asserts.
- **F-4 (HIGH, now closed by artifact) — zero worker-bridge coverage.**
  Fixed by `worker-bridge-adversarial.test.ts` (open/decode/cancel/probe,
  tee to two real ports, ffmpeg seam, CANCELLED, receipts/ack path).
- **F-5 (MEDIUM) — FR-1.0.6 budget bypassable via runtime injection.**
  `check-bundle` counts `dist/index.html` scripts + statically analyzable
  imports only. A boot-injected `document.createElement('script')` pointing at
  a `publicDir` payload (400 KB, `200 OK` under preview) passed
  `check-bundle` (68.3/350 KB), `verify-fixtures` (manifest-omission is legal),
  lint, tsc, and the unit suite. Guard: assert the set of `publicDir` files
  (minus manifest-listed assets) referenced by `index.html`/static imports is
  exhaustive; or budget `dist/**` minus an allowlist.
- **F-6 (HIGH) — criterion credit by test *title* (unit-03 F2 recurrence).**
  Unit-04 spec criterion lines carry no `Playwright` token ⇒ `e2eBackedIds` =
  ∅ ⇒ `verify-criteria unit` credits CC-04.9/CC-04.10 (the [RQ] memory +
  fallback gates) from any vitest titles. Two `expect(1).toBe(1)` tests made
  both rows `pass`. Guard: require the unit file itself (or its `e2e/`
  counterpart) to actually contain a Playwright-backed test for `[RQ]`/`[L4]`
  rows, and refuse `--from-branch` credit when no junit for `e2e/**` exists.
- **F-7 (MEDIUM) — no integrity boundary around `scripts/harness/**`,
  `e2e/media/fixtures/harness.ts`, `qualify/**`, `docs/spikes/**`.**
  A-12/A-13 show these mediate L4/RQ evidence; CI has no frozen-diff (the
  manual orchestrator M-diff covers `tests/e2e` only per unit-03 report). The
  two new committed specs kill the *content* forgeries; the *file-level* guard
  (CI step: `git diff --exit-code develop...HEAD -- scripts/harness
  e2e/media/fixtures qualify/`) would close the rest.
- **F-8 (MEDIUM) — fixture trust is self-asserted.** Manifest shas are
  re-signable (`fmt-30s.amr` content destroyed + sha re-signed ⇒
  `verify-fixtures` green); CI's `fixtures-verify` job *regenerates* fixtures
  with the builder-owned `make-fixtures.ts` without diffing, so tampered
  generator + manifest passes. The one real content oracle is source
  correlation vs `fmt-30s.ref.wav` (which killed A-14) — its own bytes trace
  back to `make-fixtures.ts`. Guard: pin a committed sha of `ref.wav` + a CI
  `git diff --exit-code` after regeneration.
- **F-9 (LOW, documented in suite) — `PortRecorder.stop()` resolves unmet
  waiters.** Suites that `stop()` before asserting events can silently pass
  (no shipped suite calls `stop()` today; the mask is pinned by a passing
  documentation test in the committed worker suite).
- **F-10 (LOW) — stale exclusion.** `vitest.config.ts` child-run still
  excludes `tests/unit/audio/**` citing "retire once unit-04 goes green";
  unit-04 is green — retire the exclusion so child runs execute audio suites.

## Reproduction recipes (surviving attacks)

F-1 (clean-checkout red): `git worktree add .night/x <tip> && cd .night/x &&
corepack pnpm install --frozen-lockfile && corepack pnpm test` → 3 fails in
`qualification-check-adversarial.test.ts`; `node
scripts/qualification-check.ts` → `REJECT … recomputed 4269abe12f9b…`.

F-2 (record laundering): from green tree, add `src/adversary-probe.ts` (any
bytes), `corepack pnpm test` → `git diff qualification/0.0.0-spike.json` shows
`contentHash` rewritten to the mutated tree.

F-5: payload = 400 KB string file in `publicDir`, injected in `main.tsx` boot;
`corepack pnpm build && corepack pnpm check-bundle` → green; `vite preview` +
`curl -I /big-runtime.js` → `200`.

F-6: file with `test('CC-04.9: …', () => expect(1).toBe(1))` (+ 04.10),
`GITHUB_HEAD_REF=ai-dlc/local-transcribe-engine/unit-04-media-ingest node
scripts/verify-criteria.ts unit --from-branch` → rows `pass`.

A-06/A-07: flip `path: 'webcodecs'`→`'ffmpeg'` in `mediabunny.ts:155`;
`if (false && ffmpegOnly)` in `probe.ts:136` → `pnpm test`, `pnpm test:e2e`
stay green (production modules are dead-tested; e2e exercises the harness
mirror instead).
