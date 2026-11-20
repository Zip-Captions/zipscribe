# Unit report: unit-202-export

Status: complete (CI + squash-merge per orchestrator flow)

## Completion criteria

From `reports/criteria/unit-202-export.md` (clean `pnpm verify:unit --from-branch` run — chromium + vitest, Node 24 host; rerun on final tree tracked in PR #30 CI):

| ID       | level    | passing tests | result |
| -------- | -------- | ------------- | ------ |
| CC-202.1 | untagged | 49            | pass   |
| CC-202.2 | untagged | 3             | pass   |
| CC-202.3 | untagged | 4             | pass   |
| CC-202.4 | untagged | 1             | pass   |
| CC-202.5 | untagged | 1             | pass   |
| CC-202.6 | untagged | 5             | pass   |
| CC-202.7 | untagged | 2             | pass   |
| CC-202.8 | untagged | 5             | pass   |

`[RQ]` items: none in this unit (perf/encode matrices are release-qualify territory).
`[MANUAL]` items: none declared. Owner checklist CC-301.4 (real-Chrome) remains
open from unit-301 — unchanged by this unit.

Notes on crediting:

- CC-202.3: chromium gating-matrix spec (T1/T2 full, absent-reason stubs for
  AudioEncoder / both encoders, pending-probe T4 view) + webkit half
  `e2e/export/webkit-export.spec.ts` (1/1 pass locally, WebKit 27.2 under
  `E2E_WEBKIT=1`; webkit = reference-hardware doctrine, skipped by default).
- CC-202.4/.5: once the committed specs cite those IDs leading, verify refuses
  vitest credit and demands the playwright leg — the per-ID describes in
  `e2e/export/sidecars.spec.ts` provide it (golden downloads vs committed
  fixtures); the 32-case vitest golden/matrix suite still runs in `pnpm test`
  as the correctness layer.
- CC-202.7: playwright offline leg (network down, chunks warm) + the
  FR-202.6 toast case; check-bundle asserts the three lazy chunks
  (`ExportDialog-*`, `export-sidecar-*`, `export.worker-*`) exist and are not
  in the initial graph.

## Gates

- lint ✓ · typecheck ✓ (tsc ×3 configs) · test ✓ (2098, coverage thresholds
  green; engine cov enforced)
- build + check-bundle ✓ — initial JS **153.8 KB gzip / 350 KB budget**
  (dialog + sidecar + worker lazy)
- e2e ✓ — full chromium suite green locally twice (3.4 min), incl. burn-in
  SSIM 10/10 ≥ 0.99 vs pinned-geometry preview composite, byte-exact sidecar
  downloads, offline leg, gating matrix; webkit export spec ✓ (E2E_WEBKIT=1,
  reference-hardware tier); `test:e2e` scaffold child (CC-01.5) green inside
  the authoritative `pnpm test` run
- qualification ✓ — `pnpm qualify` 8/8 RQ pass, contentHash refreshed on the
  final committed tree; checker ACCEPT (13 qualification tests green)
- verify:unit ✓ — "all untagged criteria of unit-202-export.md covered (8
  total)"

## Deviations from spec

1. **Encoder ladder owned by mediabunny** — the settings.yml encoder ladder
   is realized as `Conversion.init({video:{fit:'fill',…}})` + typed error
   taxonomy (`ENCODER_UNSUPPORTED` vs `ENGINE_INTERNAL` vs
   `UNSUPPORTED_MEDIA`); `fit` is mandatory when width+height are both given
   (mediabunny 1.62.1 throws a pageerror without it).
2. **Offline substitute (CC-202.7)** — no service worker ships yet (no
   VitePWA until the PWA unit), so "works offline after SW install" is tested
   as "export chunks warm, then `setOffline(true)`": the offline requirement
   (zero network for the sidecar path) holds; SW-install coverage lands with
   the PWA unit.
3. **≥ 1 Hz progress (CC-202.6)** — mediabunny encodes at 35–90× realtime on
   the fixtures, so the ≥ 1 Hz rate is proven in L1
   (`tests/unit/export/burn-in-pacing.test.ts`, 4 cases: first tick, ≥ 900 ms
   cadence, forced final) and the e2e rate check is conditional on runs
   > 2.5 s; the cancel leg now runs on speech-10min (≥ 12 s encode floor) so
   the mid-flight click is deterministic.
4. **T4 dialog leg (CC-202.3)** — the boot gate blocks a resolved-T4 device
   ("can't run on this device" screen), so the requirements-copy state is
   exercised the only way it is reachable in a booted app: the conservative
   pending-probe view (`dialogCapabilities()` fallback).
5. **Burn-in track selector (US-3.2.2) deferred to unit-302** — named
   deviation per reviewer R1-M3: `unit-202-export.md` Boundaries put
   "Translation track UI: unit-302", the CC-202 list omits a track selector,
   `ExportSettings` is frozen `{format,width,height,fps}`, and the worker
   pins `track:'source'`. The burn-in section offers no hidden/ignored track
   control. unit-302 adds `track` + selector + FR-302.3 overlay wiring.
6. **`vitest.config.ts` coverage exclude `**/*.md`** — the v8 provider's
   uncovered-file sweep hands `src/state/CONTRACT.md` (prose under
   `coverage.include`) to rollup's parser → PARSE_ERROR; Node 22 (CI)
   tolerated it, Node 24 exits 1 (reproduced identically on `develop`,
   pre-existing). Markdown is not measurable code — CONTRACT.md's real gate
   is `tests/unit/editor/contract.test.ts`. Coverage thresholds untouched
   (engine 85/75, state 80, perFile) — reviewer confirmed byte-for-byte.
7. **Cancel-ack contract widening** — `ExportHandle.cancel(): void →
   Promise<void>` (source-compatible) so the run row clears on the worker's
   terminal flush-ack and "cancel ≤ 2 s" is falsifiable (reviewer R1-H1).
   Recorded as a contract change (below).

## Contract changes

- `ExportHandle.cancel(): Promise<void>` (was `void`) — widened in
  `tests/unit/editor/unit102-api-contract.d.ts` (with rationale comment),
  `src/state/CONTRACT.md:251` synced, and asserted by the L1 ack tests.
  architecture.md never froze this member (only the worker `cancel` message),
  so no architecture edit is required; proposed addition if the orchestrator
  wants the seam documented: "handle.cancel() resolves on the worker's
  terminal event after the encoder flush (watchdog 4 s)".
- `ExportSettings` UNCHANGED (frozen). No protocol.ts changes.

## Dependencies

None outside `settings.yml approved_dependencies` (mediabunny pinned 1.62.1;
ffmpeg from `ffmpeg-static` in e2e helpers, dev-side only).

## Measurements

- burn-in encode: taxi (30 s 320×180@10) ≈ 0.9 s; speech-2min ≈ 1.3–3.4 s;
  speech-10min ≈ 12.4 s (swiftshader) → 48–90× realtime
- cancel ack (worker terminal event after `conversion.cancel()`): 540 ms
  measured isolated; e2e asserts ≤ 2 s under full-suite parallel load (8/8
  repeat ×4 workers green)
- burn-in SSIM: 10/10 sampled frames ≥ 0.99 vs preview composite (background
  channel alone: 0.9996)
- initial JS 153.8 KB gzip (budget 350 KB); export dialog/sidecar/worker are
  lazy chunks (check-bundle CC-202.7 assertion)

## Follow-ups

- Ignore Cancel once `export:result` delivered (save-picker race; watchdog
  currently drops the pending blob) — reviewer R2-3 [L].
- Escape `]` in VTT prefix labels or document the `]: ` strip ambiguity in
  unit-302 — reviewer R2-4 [N].
- Add `public/samples` to the qualify generated-exclusion set so
  qualification-check ACCEPTs from clean checkouts (record currently binds
  builder-local ignored files) — reviewer R2-5 [N].
- AAC re-encode branch (non-compatible audio input) untested in-suite —
  release-qualify encoder matrix territory.
- SRT inline `-->` guard (non-anchored) if importers ever demand it.
- Sticky T4 fallback if `probeFullCapability()` rejects — consider retry or
  explicit "probe failed" copy.

## Review

R1 CHANGES_REQUESTED (1H/2M/6 notes) → H1 fixed (worker cancel-ack:
exactly-once `ackCancel` from `conversion.cancel()` + execute-reject
backstop + pre-init path; service ack-promise + watchdog; row mounted until
ack; L1 pre-ack tests; deterministic mid-flight e2e), M2 fixed (VTT prefix
escaping + voice entity decode + both-mode roundtrips + 3 goldens regen +
manifest hashes), M3 accepted as documented deferral (this report).
R2 delta **APPROVE** (gates re-run in isolated worktree: export 87,
export+captions 271, tsc ×3, eslint clean); R2 new findings: CONTRACT.md
sync [M] and cancel()-catch [L] fixed pre-merge; R2-3/4/5 filed as
follow-ups above.
