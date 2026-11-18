# Unit report: unit-108-stream-commit

Status: complete — orchestrator-implemented (flow doctrine [107-ADJ 17]: no builder subagent; same gates, all tails re-run by the orchestrator) → gates battery green locally → PR #21 CI round 1 RED (spec-lint: frontmatter `status: building` not in allowed set) → `8a7c03b` (`in-progress`) → round 2 RED (prettier on the two new service files) → `f9d5fd4` + record re-sign `2851b8e` (force-push blocked by operator policy; record follows as its own commit — PR-head tree is what CI verifies) → round 3 RED (branch-attestation anchor cannot see `refs/heads/<branch>` in a PR checkout) → `03b294c` (CI-honest tri-source rule + done-status bypass, unit-105/106/107 sibling doctrine) → round 4 **GREEN** (`gh run watch` exit 0; run 44256219985, 39m50s) → squash-merged as `058b4c8`. Closes the [107-ADJ 24] root cause: **intent caption-studio-ui verify:intent 12/12**. Full process evidence: `docs/overnight-ledger.md` (entries `108-ADJ 1`–`9`).

## What shipped

- `src/state/services/transcribe-commit.ts` — progress-frontier commit service (state layer, wired at the composition root; `Transcript` untouched): commit segments with `end <= job:progress.processedSec` (no progress ⇒ nothing commits — the frozen FR-104.6 skeleton contract stays byte-green), flush all on `job:done`, **hold** on `job:error`/cancel, `kind === 'align'` never commits (frozen `captions-align-apply` path). One `captions-import` dispatch per batch = one undo step; first batch `replace:true` + `SPK_1`, later append; dedupe `${start}|${end}|${text}`; words `timing:'asr'`; per-segment fallback on validator rejection.
- `src/state/jobs.ts` — `mediaSource` dep: `transcribe` posted immediately with a `{kind:'stream', port}` `PcmSource`; `media:decode` tee posted async under its **own** jobId (cancel/displace posts `media:cancel` for it too). Without the dep the frozen byte-identical `placeholderPcm` sequence is unchanged (frozen L1 pins green).
- `JobsStore.onEngineEvent` — additive EXTENDS raw-event tap firing **before** the slice folds (live-job correlation reads pre-event state; SM.1/SM.2 adversarial rules respected — it is a read-only observer, no slice mutation).
- `src/state/services/engine-port.ts` — `createWorkerEnginePort({nullAsrDiarizeWorkers})`: ziptest harness nulls the ASR/diarize lanes (injection-driven e2e doctrine; kills real-worker `MODEL_UNLOADED` `job:error` racing scripted events); the media worker stays **real** (CC-106.8 probes). Production passes neither flag.
- `Workbench.tsx` StatusBar — exactly one `[data-testid=job-error]`, **code only** (SECURITY-03; redaction-spy clean), clear on next start; no modal (committed blocks stay editable).
- Intent suite — the four `[107-ADJ 24]` skip guards removed, `job:progress` injections mirror the real worker order, leading `CC-108.7` citations at the JUnit head per [107-ADJ 25].

## Completion criteria (`pnpm verify:unit --from-branch`; `reports/criteria/unit-108-stream-commit.md`)

| ID       | level · evidence                                                                                                                                                                                                                        | tests | result |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| CC-108.1 | untagged · L2: `mediaSource` dep → `transcribe` posted `{kind:'stream',port}` + `decode` under own jobId (ports tee incl. diarize when enabled); `cancel` posts `media:cancel` for the decode jobId; no-dep frozen sequence unchanged   | 2     | pass   |
| CC-108.2 | untagged · L2: no `job:progress` ⇒ zero history steps, block list unchanged; with progress only `end <= processedSec` commits, words `timing:'asr'`, first batch `replace:true` + `SPK_1`                                               | 3     | pass   |
| CC-108.3 | untagged · L2: `job:done` flushes all remaining segments; committed blocks == streamed segments                                                                                                                                         | 1     | pass   |
| CC-108.4 | untagged · L2: `job:error`/cancel never flush; committed blocks persist, zero extra history steps after the error                                                                                                                       | 2     | pass   |
| CC-108.5 | untagged · L2: `kind:'align'` jobs never commit through the service (align-apply path frozen)                                                                                                                                           | 1     | pass   |
| CC-108.6 | untagged · L2: one `[data-testid=job-error]`, code only, running/late-job error; clear on next start; redaction spy clean                                                                                                               | 1     | pass   |
| CC-108.7 | untagged · L5: intent legs CC-I2.1, CC-I2.3 (both legs incl. aiff decoded round-trip), CC-I2.11 un-skipped and green (`e2e/intent/caption-studio-ui.spec.ts`); `verify:intent caption-studio-ui` → **12/12**, exit 0                    | 4     | pass   |
| CC-108.8 | untagged · anchor: gate scripts present, frozen 350 KB budget, unit declares CC-108.1–.8, branch attestation merge-status-aware + CI-honest tri-source; frozen unit-104 streaming + adversarial suites untouched (byte-identical files) | 5     | pass   |

`verify — all untagged criteria of unit-108-stream-commit.md covered (8 total)`, exit 0. No `[RQ]`/`[DEPLOY]`/`[MANUAL]` criteria declared in the unit file.

## Gates — battery re-run by the orchestrator at the final heads

- `corepack pnpm spec-lint` → `OK — 22 unit files, frontmatter + criteria IDs valid`.
- `corepack pnpm lint` / `typecheck` / `format:check` → exit 0 (`All matched files use Prettier code style!`).
- `corepack pnpm test` → exit 0 — `Test Files 231 passed (231)` / `Tests 1873 passed | 1 skipped | 1 todo (1875)` (322.9s).
- CI `pnpm test --coverage` (run 44256219985 L1–L3 step) → pass (coverage thresholds enforced there; local full-coverage battery green at the pre-prettier tree, prettier commit style-only, test-only anchor fix after).
- `corepack pnpm build && corepack pnpm check-bundle` → exit 0 — initial JS **143.4 KB gzip / budget 350 KB**.
- `corepack pnpm test:e2e` → 137 passed, 2 failed — `CC-05.3` longtask (35-min `page.evaluate` timeout) + `CC-05.2 [memory]` recycle-10min (heap grew 1338.4 MB) — both real-worker harness specs on **untouched** code paths; **isolated re-run both PASS** (longtask 34.4m, recycle-11.3m — `.night/e2e-flakecheck.log`) ⇒ parallel-load flake on this machine; CC-05.2 is `[RQ]`/qualify tier (owner ruling 2026-11-09); CI (ubuntu) green is the arbiter (run 44256219985 incl. both harness specs).
- `corepack pnpm verify:unit --from-branch` → exit 0, table above (CC-108.7 credited with 4 playwright cases).
- `corepack pnpm verify:intent caption-studio-ui` → exit 0 — **12/12** `CC-I2.1–12` all pass.
- Qualification: re-signed via clean-tree flow (`pnpm test` → record → amend/own-commit); `qualification-check: ACCEPT — valid for contentHash 70a4be5fac61…` at merged HEAD (`src/**`+`public/**`+`models/**` hash scope — tests-only follow commits don't flip it, re-verified).
- CI (final head `03b294c`, run **44256219985**): `quality success` · `fixtures-verify success` · `preview-deploy success` (39m50s). Rounds 1–3 RED: spec-lint status value, prettier, PR-context branch attestation (108-ADJ 8).
- Test integrity: additive new suites only (`src/state/services/transcribe-commit.test.ts` ×9, `tests/unit/workbench/job-error.test.tsx` ×1, `tests/unit/stream-commit/gates-anchor.test.ts` ×5) + intent-spec adaptations (108-ADJ 6); zero `.only`, zero new `eslint-disable`, no first-party `vi.mock`; frozen `streaming-skeleton` + `unit104-adversarial` files byte-identical (`git diff` empty against develop pre-merge).

## Deviations from spec

- **No builder subagent** — orchestrator implemented (flow doctrine [107-ADJ 17], 108-ADJ 1); same TDD-to-criteria + gate battery.
- **Zip-test inert ASR/diarize lanes** (`nullAsrDiarizeWorkers`): scripted-event e2e races real-worker `MODEL_UNLOADED` `job:error`; media worker stays real for CC-106.8 probes; production context passes neither flag (108-ADJ 4).
- **Decode tee gated on `mediaSource`** (composition-root fetch→File, unit-107 `blobForCurrentSource` precedent); dedicated decode jobId + `media:cancel` propagation added beyond the literal criterion wording to keep cancellation leak-free (108-ADJ 5).
- **`mockTranscribe`/CC-I2.11 inject `job:progress`** (maxEnd+0.5 / `processedSec: 3.0`, totalSec 120) mirroring the real worker's event order — required by the frontier rule; without injection nothing may commit (that IS CC-108.2's negative proof) (108-ADJ 6).
- **`captionOrigin:'imported'` on ASR commits** — `captions-import` is the only block-creating command; no command sets `'transcribed'`. Contract-follow-up candidate (108-ADJ 7); no frozen test asserts `captionOrigin` for ASR path.
- **CI round history** (108-ADJ 8): `status: building` not in the allowed frontmatter set → `in-progress`; prettier reformat of the two service files → re-sign as separate commit (operator policy blocks force-push; PR-head tree — what CI gates — matches); branch-attestation anchor made CI-honest tri-source (local ref · origin ref · `GITHUB_HEAD_REF`) + done-status bypass, exactly the merged unit-105/106/107 sibling implementations.
- **Local e2e parallel-load flakes** (108-ADJ 9): CC-05.3/CC-05.2 red only in the full parallel local battery (spec-owned dev servers + wasm inference contention); green isolated; CI green.

## Contract changes

- Proposed (non-blocking) follow-up: add `'transcribed'` as a `CaptionOrigin` value with a command-level distinction from `'imported'` (108-ADJ 7). No contract type was edited; `JobsStore.onEngineEvent` is additive (`architecture.md` `JobsStore` EXTENDS, no field removed/retyped).

## Dependencies

- None outside `settings.yml` (no new packages; `package.json`/`pnpm-lock.yaml` untouched).

## Measurements

- Bundle: 143.4 KB gzip initial JS (budget 350 KB).
- Isolated harness re-runs: CC-05.3 longtask pass (34.4m window), CC-05.2 recycle pass ≤ gate (11.3m) — heap-growth flake only under 8-worker local contention.
- verify:unit wall ~55m (runs its own vitest + playwright legs); CI quality 39m50s.

## Follow-ups

- `captionOrigin:'transcribed'` contract seed (above).
- Real-worker ziptest parity: an opt-in lane that exercises the REAL ASR worker against the stream-commit service (today's e2e proves service+slice+UI with scripted injection + real media decode; worker↔frontier interplay is covered L2 only).
- CI guard rejecting `.ai-dlc/**` edits in unit PRs (unit-106 seed, still open — would be the only way to forge a premature `done`).
- CC-05.2/CC-05.3 flake hardening: stagger the [memory]/[drift]/longtask projects against the chromium project in the local runner config (CI already serializes them per-project).
