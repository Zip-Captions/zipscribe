---
status: building
phase: mvp
discipline: frontend
depends_on: [unit-104-transcript-editor, unit-101-workbench-shell, local-transcribe-engine/unit-04-media-ingest]
workflow: tdd
mode: AHOTL   # well-bounded: one commit service + one jobs-slice extension, strong L2/L5 proof via the frozen intent suite
---

# Unit 108: Streaming Transcribe → Committed Blocks (stream-commit)

## Description

Close the [107-ADJ 24] blocker: a transcribe job's streamed `job:segments` become **committed project blocks while the job runs** (progress-frontier rule), the real decoded PCM stream finally feeds the ASR/diarize workers (replacing the jobs-slice `placeholderPcm` "Follow-up: real stream plumbing"), and a mid-job `job:error` leaves the committed blocks editable with a one-line coded notice in the StatusBar (no modal). This unblocks the intent suite legs CC-I2.1, CC-I2.3 and CC-I2.11 in `e2e/intent/caption-studio-ui.spec.ts`.

The frozen unit-104 contract is preserved verbatim: `Transcript` itself never commits (streaming rows beyond the committed frontier stay aria-hidden textless skeletons); the commit lives in a **state-layer service** wired by the composition root, so the frozen jsdom suites — which mount `Transcript` alone — observe byte-identical behavior.

## User Stories

**US-108.1** As a transcriber, my captions appear as I wait.
- *Given* an open project and a running transcribe (replace) job, *when* the worker streams `job:progress` (processedSec P) and `job:segments`, *then* every segment with `end <= P` is committed as an editable block (one `captions-import` command per batch = one undo step per batch), words carry `timing: 'asr'`, and the first commit of a replace job replaces the source track and registers `SPK_1`.
- *Given* no `job:progress` has arrived, *then* nothing commits (the frontier is 0) — streamed rows stay skeleton-only in the Transcript (frozen FR-104.6).
- *Given* `job:done`, *then* every remaining accumulated segment is committed (flush) — after a mocked full job the block list equals the accumulated segments.

**US-108.2** As a transcriber, a crash mid-way costs me nothing already transcribed.
- *Given* a mid-job `job:error`, *when* the notice lands, *then* the committed blocks persist and stay editable through the real editor UI, no `job:done` flush happens, the StatusBar renders exactly one `[data-testid=job-error]` line containing the EngineError **code only** (SECURITY-03 — never `detail`, never content), and no modal appears.
- *Given* cancel, *then* the same hold-what-you-have rule applies.

**US-108.3** As a user, the ASR worker really receives my audio.
- *Given* a production context (not the ziptest harness), *when* a transcribe/align job starts, *then* the app fetches the project's media blob, posts `media:decode` with the job's MessagePort tee and posts `transcribe` with `{kind:'stream', port}` (16 kHz), and cancel posts `media:cancel` for the decode job too.
- *Given* the ziptest/e2e harness, *then* injection-driven flows stay deterministic (real decode skipped — the mocked-engine doctrine of the intent suite header; the real worker pipeline is proven at qualify).

## Functional Requirements

- **FR-108.1** `src/state/services/transcribe-commit.ts`: `createTranscribeCommitService({ engine, jobs, editorApp })` — subscribes the jobs store (running transition captures `{jobId, kind}`) and `engine.onAsrEvent`; commits only for `kind === 'transcribe'`; frontier advances on `job:progress`; flush on `job:done`; hold (no flush) on `job:error`/cancel; dedupe by `start|end|text`; dispatches `captions-import` (first batch `replace:true` + `speakers:[SPK_1]`, later batches append); a validator rejection stops the batch (codes only, nothing logged). Align jobs never commit (the frozen panel `captions-align-apply` path is untouched).
- **FR-108.2** `src/state/jobs.ts`: `createJobsStore` gains an optional `mediaSource?: () => Promise<File>` dep. With it: `startTranscribe` creates a `MessageChannel` per consumer, posts `transcribe` with `{kind:'stream', port}` synchronously (the worker buffers until chunks arrive), then async-fetches the file and posts `decode` (own decode jobId, `ports` tee to ASR + diarize); the decode jobId is tracked and `cancel`/displacement also post `media:cancel` for it. Without the dep the frozen placeholder sequence is posted byte-identically (all frozen suites keep passing).
- **FR-108.3** `src/ui/shell/Workbench.tsx` StatusBar: renders `{error !== null && <span data-testid="job-error">{error.code}</span>}` inside the frozen footer (codes/numbers only). The frozen save-state/live-region structure is untouched.
- **FR-108.4** `src/app/context.ts`: wires the commit service; supplies `mediaSource` (fetch stage media URL → `File` with the asset name/mime — the unit-107 `blobForCurrentSource` precedent) **except** under the strict `ziptest=1` flag.

## Technical Specification

- SECURITY-03: no transcript/caption content in logs, notices or test output; the job-error line is the code string only; redaction-spy covered.
- Main thread: commits are immer patches + command dispatch (≤ ms per batch); no decode/inference work moves on-thread (50 ms long-task gate unaffected).
- Fixtures/fakes: `FakeEnginePort` + `createTestApp` (existing); no network, no model downloads in tests.

## Completion Criteria

- [ ] **CC-108.1** L2: with a `mediaSource` dep, `startTranscribe` posts `transcribe` with `{kind:'stream', port}` and `decode` (own jobId, ports tee incl. diarize when enabled); `cancel` posts `media:cancel` for the decode jobId; without the dep the frozen request sequence is unchanged (L1 pins in `jobs.test.ts` stay green)
- [ ] **CC-108.2** L2: progress-frontier commit — without `job:progress` nothing commits (zero history steps, block list unchanged); with progress only `end <= processedSec` segments commit, words `timing:'asr'`, first batch `replace:true` + `SPK_1`
- [ ] **CC-108.3** L2: `job:done` flushes all remaining accumulated segments; committed blocks == streamed segments
- [ ] **CC-108.4** L2: `job:error` and cancel never flush; committed blocks persist with zero extra history steps after the error
- [ ] **CC-108.5** L2: `kind === 'align'` jobs never commit through the service (align-apply path frozen)
- [ ] **CC-108.6** L2: StatusBar renders exactly one `[data-testid=job-error]` with the code only for a running/late job error; clear on next start; redaction spy clean
- [ ] **CC-108.7** L5: `e2e/intent/caption-studio-ui.spec.ts` CC-I2.1, CC-I2.3 (both legs incl. aiff decoded round trip) and CC-I2.11 run (skip guards removed, `job:progress` injections added to the mocked flows) and pass; `verify:intent caption-studio-ui` reports 12/12
- [ ] **CC-108.8** All gates green incl. `pnpm test` (frozen unit-104 streaming + adversarial suites untouched and passing), lint, typecheck, build+check-bundle ≤ 350 KB

## Risks

- Double-render between committed rows and streaming rows → prevented: Transcript skeletons key on `segment.start >= lastCommittedEnd`, committed segments fall below the frontier the moment they commit.
- Undo-history churn (one step per batch) — acceptable streaming semantics; user edits always land on top as their own steps (frozen).
- Late `job:segments` after `job:done` — store correlation (running filter) keeps them out, unchanged from unit-101.
- Real decode in e2e could destabilize the mocked flows → gated off under `ziptest=1` ([108-ADJ] ledger entry documents the honesty boundary: production path L2-proven, worker end-to-end at qualify).

## Boundaries

- Not this unit: diarize `diar:frames` → speaker assignment (manual assignment flows exist); the export dialog leg (unit-202); real-worker end-to-end runs (`[RQ]` at qualify); resume-from (`resumeFromSec`) semantics.

## Docs to consult

- `knowledge/architecture.md` § Worker protocol (decode tee, PcmSource stream), § jobs; `knowledge/domain.md` invariants 1–3, 9; unit-104 CONTRACT § streaming; `docs-mcp` mediabunny/mediabunny-decode notes already cited in `engine/audio/decode.ts`.
