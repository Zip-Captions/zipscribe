# Unit report: unit-04-media-ingest

Branch `ai-dlc/local-transcribe-engine/unit-04-media-ingest`, base `e18f328` (slice-4D tip).
Status: **complete for the 4E scope** — both coverage gates green, `corepack pnpm test` exits 0
end-to-end (the slice's acceptance), full sweep + qualification + perf fixture + memory figure
measured. Three criteria rows (CC-04.1/2/3) remain FAIL in `verify:unit` for **frozen-artifact
reasons outside builder scope**, root-caused and routed below (Deviations §1–2); the specs those
rows should credit pass in Chromium. This is slice 4E on top of the 4A–4D builders (probe 4A/4B,
mediabunny adapter + worker-core 4C, fixture re-authors + adjudications 4D).

## Completion criteria

From `reports/criteria/unit-04-media-ingest.md` (`corepack pnpm verify:unit --from-branch`,
**exit 1** — 11/14 rows pass, three frozen-citation defects in Deviations):

| ID       | level    | passing tests | result                              |
| -------- | -------- | ------------- | ----------------------------------- |
| CC-04.1  | untagged | 0             | FAIL (frozen defect, Deviations §1) |
| CC-04.2  | untagged | 0             | FAIL (frozen defect, Deviations §2) |
| CC-04.3  | untagged | 0             | FAIL (frozen defect, Deviations §2) |
| CC-04.4  | untagged | 27            | pass                                |
| CC-04.5  | untagged | 26            | pass                                |
| CC-04.6  | untagged | 4             | pass                                |
| CC-04.7  | untagged | 18            | pass                                |
| CC-04.8  | untagged | 12            | pass                                |
| CC-04.9  | untagged | 1             | pass                                |
| CC-04.10 | untagged | 1             | pass                                |
| CC-04.11 | untagged | 10            | pass                                |
| CC-04.12 | untagged | 14            | pass                                |
| CC-04.13 | untagged | 9             | pass                                |
| CC-04.14 | untagged | 1             | pass                                |

Provenance: rows CC-04.4–.8 and CC-04.11–.13 cite the frozen `tests/unit/audio/**` vitest suites
(this slice added no citations to them — counts unchanged from 4D). CC-04.9/CC-04.10 are the
frozen `e2e/media/memory/decode-memory.spec.ts` / longform spec, each 1 passing test — they were
**not runnable before this slice** because the 120-min perf fixture was never built; with
`node scripts/make-fixtures.ts --perf` producing `fixtures/audio-120min.mp4` (22 MB, gitignored)
they now execute and pass under Chromium (memory growth 51.5 MB < 150 MB gate, Measurements).
CC-04.14 is the frozen `tests/unit/audio/media-coverage.test.ts` gate wrapper (1 test) — green
because the new nested providers below clear it. No `[RQ]`/`[DEPLOY]`/`[MANUAL]`-tagged criteria
in this unit (all 14 untagged; unit-03's 8 `[RQ]` items stay covered by the in-test `pnpm qualify`
re-run, which passed 8/8 here too).

**CC-04.14 + CC-01.1 mechanism (the honest lever, unit-03 relocated-internals pattern):** the
frozen nested gate spawns `vitest run tests/unit/audio --exclude=**/media-coverage.test.ts
--coverage --include=src/engine/audio/** --exclude=**/*.test.ts --exclude=**/adapters/** --perFile
lines 85 / branches 75` with `ZIPSCRIBE_CHILD` cleared, so **only** `tests/unit/audio/**` collect
providers there; and the gates-scaffold child run (`ZIPSCRIBE_CHILD=1`, global engine+state
85/75 perFile) excludes `tests/unit/audio/**` (frozen `vitest.config.ts`), so **only** source-
adjacent `src/**/*.test.ts` collect there. Four ADD-only suites close both:
`src/engine/audio/decode-internals.test.ts` (child provider — error-mapping legs, buildAsset/
newAssetId, planar/interleaved feed, priming drop/clip, pump byte-exact splits, iterator
throw/cancel-before-open, ffmpeg-notice legs, PcmChunkStream, referenceMeter, handleMediaRequest,
playback legs) and `tests/unit/audio/{decode,fingerprint,worker-ref}-internals.test.ts` (nested
providers — decode.ts including the coop PORT_STALL 8 s test with explicit 60 s timeout, which
must not enter the 30 s child budget, fingerprint `name:''` bare-Blob leg, worker-core@ref
closed-post/buffered-arms/classifier legs). **Zero edits to frozen files** — the acceptance
`git diff e18f328..HEAD --diff-filter=M -- tests e2e fixtures scripts/make-fixtures.ts` is empty
(4 new files, all adds; `qualification/0.0.0-spike.json` regenerated, see Gates). No threshold
loosened, no assertion deleted, no test skipped. Contract-type imports in the Node suites use
`@engine/protocol@04` per the frozen doctrine (bare `@engine/protocol` is an ambient partial
without `MediaRequest`).

## Gates

Verbatim tails at this HEAD:

- lint ✓ exit 0 (`eslint .`, 0 problems — after fixing `prefer-promise-reject-errors`,
  `no-unsafe-member-access` (typed `AsyncIterator<PcmChunk, void, void>` cast), `require-await`
  (empty async generators → `Symbol.asyncIterator` single-shot), `prefer-const`)
- typecheck ✓ exit 0 (tsconfig.json / tsconfig.node.json / tsconfig.eval.json)
- test ✓ **exit 0** — `corepack pnpm test` · **Test Files 65 passed (65) · Tests 523 passed |
  1 skipped | 1 todo (525)**, ~228 s wall. The two sanctioned REDs (CC-01.1 child coverage,
  CC-04.14 nested gate) are closed; no ERROR lines from the child run.
- nested CC-04.14 gate ✓ exit 0 — 126 tests, 19.47 s; totals **lines 98.79 / branches 88.13**;
  per-file table in Measurements. `media-coverage.test.ts` wrapper passes inside `pnpm test`.
- child CC-01.1 run ✓ exit 0 — `ZIPSCRIBE_CHILD=1 vitest run --coverage`: 40 files, 328 passed |
  1 skipped | 1 todo (330), ~16 s (fits gates.test's 30 s spawn budget); global totals
  **lines 99.67 / branches 92.99**; `decode.ts` **75.2 → 100.00** lines, **58.82 → 91.97**
  branches (per-file table in Measurements).
- test:e2e ✓ (slice scope) — `--project=chromium --project=memory` CI=1: **69 passed /
  21 skipped / 0 failed**, exit 0 (4D baseline 68/22; the delta is the memory spec, previously
  skipped for the missing perf fixture). Skips = 3 `[DEPLOY]` specs (awaiting Cloudflare
  credentials, Adaptation 3) + 18 webkit rows (this slice, opt-in, webkit-matrix below).
  Playwright junit captured at `.night/pw2/junit.xml` (junit reporter enabled; `--reporter=line`
  alone silently writes nothing).
- build ✓ + check-bundle ✓ — initial JS **68.3 KB gzip / 350 KB budget**.
- qualify ✓ — `pnpm qualify` 8/8 RQ pass, record regenerated for this tree: contentHash
  `4390b6733602…` (supersedes unit-03's `9021ffe2…`); `qualification-check` ACCEPT; `startedAt`
  is hash-derived (`contentDerivedInstant`) so re-runs are byte-stable/idempotent.
- verify:unit ✗ **exit 1** — 11/14 rows pass; CC-04.1/2/3 unattributable (frozen defects,
  Deviations §1–2). This is the unit exit gate's uncovered set; the two sanctioned REDs this
  slice was chartered to fix are gone.
- Housekeeping: `fixtures/harness/manifest.json` restored after perf-fixture regeneration
  (regeneration rewrites key order — restored to keep the frozen diff empty);
  `fixtures/audio-120min.mp4` gitignored, not committed; ports 4310–4312 free at end of run.

## Deviations from spec

1. **CC-04.1 has no generated tests — frozen manifest/helper mismatch (routed to test-author).**
   The frozen `e2e/media/video-decode.spec.ts` generates one test per `videoSet()`, but frozen
   `e2e/media/helpers/media.ts:86-91` filters `key.startsWith('../') && kind !== 'tone'`, while
   frozen `scripts/make-fixtures.ts` registers the video corpus with plain, root-relative keys
   (`speech-2min.mp4` etc., `kind: 'speech'`; manifest `root: 'fixtures/audio'`) and the only
   `'../'` key is `'../tone-30s.wav'` (kind `tone`, excluded). → `videoSet()` returns `[]` and the
   spec emits **zero** cases (confirmed: absent from junit, not even skipped). One-line fixes
   either side: key the videos `'../<name>.mp4'` in make-fixtures (matches physical
   `fixtures/*.mp4` vs root `fixtures/audio`) **or** relax the helper filter to match
   `kind === 'speech' | 'speech-2spk'`. Both files are in the frozen set.
2. **CC-04.2/CC-04.3 specs pass but cannot be credited — frozen describe title vs junit-trust
   (routed to test-author).** `e2e/media/format-matrix.spec.ts:57` uses describe
   `'unit-04 audio format matrix (real decode in Chromium)'`; Playwright junit names are
   `"describe › test"`, and frozen `scripts/lib/junit-trust.ts` (via `citationsOf`) accepts
   citations only from the title's **leading** run — the per-test `CC-04.2:`/`CC-04.3:` prefixes
   sit after the describe prefix and are never read. Fix: prefix the describe with the IDs (or
   split per-path describes) — frozen file. (CC-03-era precedent: the two self-citing adversary
   titles renamed in unit-03 F2 established the leading-run rule; unit-04's specs predate it.)
3. **Perf-fixture CLI trap (tooling, not spec):** `pnpm fixtures --perf` swallows the flag (single
   dash → pnpm arg) and deletes the 120-min fixture; correct invocations are
   `node scripts/make-fixtures.ts --perf` or `pnpm fixtures -- --perf`. Regeneration also churns
   `fixtures/harness/manifest.json` key order — `git checkout` it afterwards (done; frozen diff
   verified empty).
4. **Memory figure provenance:** the frozen memory spec prints MB only on failure; the 51.5 MB
   figure comes from a scratch driver (`.night/memory-measure.mts`) replaying the spec verbatim
   (isolated preview 4312, `routeFixtures` policy, same `page.evaluate` measurement) — the gate
   itself is the Playwright spec, which passed in both the chromium+memory run and the
   verify-spawned run (CC-04.9 = 1 passing).

## Contract changes

none.

## Dependencies

none — no package added or removed.

## Measurements

- **Nested scoped coverage (CC-04.14 gate run, `src/engine/audio/**`, perFile 85/75), per-file
  `coverage-summary.json`:**
  | file                                                                                       | lines | branches |
  | ------------------------------------------------------------------------------------------ | ----- | -------- |
  | decode.ts                                                                                  | 100   | 90.90    |
  | fingerprint.ts                                                                             | 100   | 100      |
  | peaks.ts                                                                                   | 100   | 100      |
  | resample.ts                                                                                | 94.73 | 76.82    |
  | resample/film.ts                                                                           | 100   | 77.27    |
  | worker-core.ts                                                                             | 100   | 100      |
  | worker-core@ref.ts                                                                         | 100   | 97.50    |
  | **total**                                                                                  | 98.79 | 88.13    |
  | Every file clears perFile lines ≥ 85 / branches ≥ 75 (lowest: resample.ts branches 76.82). |
  | Run: 126 tests, 19.47 s, exit 0.                                                           |
- **Child run (CC-01.1, `ZIPSCRIBE_CHILD=1`, global engine+state 85/75 perFile), exit 0:**
  decode.ts 100/91.97 (was 75.2/58.82 — the gate's named gap), fingerprint 100/100,
  peaks 98.03/95.23, resample 100/98.78, film 100/90.90, worker-core 100/100,
  worker-core@ref 100/82.50; **total 99.67/92.99**. No 8 s+ tests in the child (coop PORT_STALL
  test lives only in the nested provider; child wall ~16 s < 30 s budget).
- **Decode memory (CC-04.9 gate, `performance.measureUserAgentSpecificMemory()` on
  `preview:isolated`:4312, Chromium full-binary channel — headless-shell throws SecurityError):**
  baseline **2.2 MB**, peak **53.7 MB**, growth **51.5 MB < 150 MB** limit, over a full streaming
  decode of `audio-120min.mp4` (22 MB H.264+AAC container, **7200 chunks / 7200 s** of audio,
  `crossOriginIsolated: true`, 2 s sampling). Flat-window streaming confirmed (no growth after
  the ramp).
- e2e: chromium+memory 69 pass / 21 skip / 0 fail (~4 min wall); full parent `pnpm test` 525
  tests ~228 s. Bundle 68.3 KB gzip / 350 KB. Qualification contentHash `4390b6733602…` (8/8 RQ).

### WebKit-matrix status (for discovery.md transcription)

The 18 `CC-04.7` webkit rows in `e2e/media/support-matrix.spec.ts` are **skipped by design in
this run** — `row belongs to the webkit project` (chromium project run) + webkit is opt-in
(`E2E_WEBKIT=1`, `playwright.config.ts` FR-1.0.4: webkit is the view/export tier, not a CI PR
gate). Expected observed paths on reference hardware (frozen `WEBKIT_EXPECTED`, 12 webcodecs /
6 ffmpeg): **webcodecs** — fmt-30s.{aac,flac,m4a,m4b,mka,mp3,oga,ogg,opus,vbr.mp3,wav,weba};
**ffmpeg** — fmt-30s.{3gp,aiff,alac.m4a,amr,caf,wma}. No webkit binary on the PR path; rows
assert at `pnpm qualify`/release runs.

## Follow-ups

- **Frozen-citation fixes for CC-04.1/2/3** (Deviations §1–2) — test-author: key video manifest
  entries `'../<name>.mp4'` (or relax `videoSet()`), and prefix the `format-matrix.spec.ts`
  describe titles with the CC IDs. Until then `verify:unit` cannot exit 0 on unit-04 regardless
  of builder work.
- **Frozen-diff gate extension (re-raised from 4D):** the acceptance diff covers `tests e2e
fixtures scripts/make-fixtures.ts` for modifications only — builders can still ADD files under
  them (this slice did, sanctioned precedent unit-03) and 4D saw committed `fixtures/**` changes
  slip pre-gate. Consider extending the M-filter provenance check to assert new files under
  those paths are builder-sanctioned (orchestrator-owned scripts).
- **OWNER-FLAG (carried, 4D):** real-speech AMR-NB payload for `fmt-30s.amr`/`.3gp` still the
  decoder-parity golden (hand-built MR122 payload) — corpus vendoring decision open.
- **Perf-fixture ergonomics:** make `--perf` survive the `pnpm fixtures` wrapper (arg `--` pass
  through in the package script) and make manifest writes key-stable so regeneration doesn't
  churn the committed `fixtures/harness/manifest.json`.
- **`sherpa-onnx@2.0.1` devDependency removal** still open from unit-02 review L1 (nothing
  references it).
- **qualification-check on `release/*`:** record is current for this tree; any later `src/**`
  change re-invalidates the contentHash — re-run `pnpm qualify` on the release branch as the
  release gate requires.
