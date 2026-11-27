# Overnight run plan — MVP remediation ladder (2026-11-27)

Input for the `overnight` agent. You are the unattended orchestrator: git/gh mechanics,
gate re-verification, ledger, subagent spawns — **you never write feature code yourself**
(builder/test-author/reviewer/fixer subagents per `.agent/AGENTS.md`). You cannot ask the
owner questions; anything you cannot decide from this plan is a **blocked condition**:
append a ledger entry (`docs/overnight-ledger.md`), push the branch, mark the item blocked,
move to the next item. Never tick `[MANUAL]` boxes, never flip intent status, never edit
`.ai-dlc/**` (propose in your report instead).

## Read first

1. `.agent/AGENTS.md` (rules, commands, unit report format, git flow)
2. `.ai-dlc/knowledge/product.md` § Roadmap **Addendum — MVP remediation ladder** (authority)
3. `docs/ux-review-evidence/2026-11-26/report.md` (findings + evidence paths per issue)
4. This plan (sequencing, rulings, acceptance per workstream)

## Hard boundaries (all runs)

- Nothing outside the repo. No Cloudflare/deploy/CDN/CI-deploy work — frozen by owner
  ruling until the owner accepts a functional localhost MVP. Do not touch ports
  **4173/4174** (owner's session) or Chrome debug port 9222.
- `git push --force`, `git reset --hard`, `rm -rf`, `sudo`: denied tools — don't route
  around them. Branch per unit `ai-dlc/<intent-slug>/<unit-stem>` from `develop`, PR back
  to `develop`, conventional commits.
- SECURITY-03: no transcript/owner content in logs, issues, commits, test artifacts.
  Fixture media only (`corepack pnpm fixtures`).
- Unit exit gate per conventions: CC-ids proven by traced tests + all gates green
  (`pnpm lint typecheck test build check-bundle`, plus `pnpm test:e2e -- <spec>` scoped
  legs you add). A PR that isn't truly shippable doesn't merge.

## Playwright MCP (browser verification)

Project config registers remote MCP server **`playwright`** at `http://192.168.1.13:8931/mcp`
(your browser surface for repro/verification; Playwright harness drivers in `.night/`
remain the verdict surface for e2e specs).

- Use it to reproduce issues, inspect live DOM (roles/names/rects), and capture
  before/after evidence for issue comments.
- Serve the app yourself: `corepack pnpm build && corepack pnpm preview --port <4181+>`,
  fresh profile expectations as in `docs/ops/ux-review-plan.md` (no test-bridge state).
- **MANDATORY CLOSE-OUT:** when you are done with the browser — end of every workstream
  AND before ending your session — call the server's `browser_close` tool, and kill any
  preview server you started (`lsof -ti :<port> | xargs kill`). Never leave a Playwright
  browser instance or preview server running unused. If a run crashes mid-way, close the
  browser as the first recovery action.

## Workstreams (execute in order; each = one or more units via subagent pipeline)

Pre-authorized orchestrator rulings are marked **[RULING]** — follow them; deviating is a
blocker-to-ledger, not a judgment call.

### M1 · Language plumbing — unblocks translation (Closes #51; part of #63)

- Unit: `caption-translation/unit-304-language-plumbing` (full pipeline: spec →
  test-author → builder → reviewer).
- Persist spoken language: the Transcribe popover's Language select sets
  `project.language` on Start and on explicit change (Auto-detect → store detected language
  once ASR reports it). Languages section reachable from real UI only.
- **[RULING]** No engine contract change: this is state + UI wiring; `protocol.ts` /
  `model.ts` edits are forbidden (contract change → ledger, blocked).
- Acceptance: **bridge-banned** L5 e2e (`e2e/intent/caption-translation.spec.ts` leg or
  new spec) — intake → transcribe → Languages shows Add language → pick target → track
  appears — without any `src/ui/testing/*` import; assert via DOM. Existing translation
  suites stay green (they may keep using the bridge).
- While in the popover: label polish from #63 (friendly model names, language names not
  ISO codes, Auto-detect default) may ride this unit if small; else file as its own.

### M2 · Edit & layout (Closes #55; part of #48, #52)

- Units: `caption-studio-ui/unit-110-row-layout` (#48 expand-on-active rows per owner
  design in issue #48 body) and `caption-studio-ui/unit-111-merge-commands` (#55).
- **[RULING]** #55 is **additive**: bind the already-documented `⌘⇧M`/`Ctrl+⇧M` merge
  command + add menu/pointer paths for split & merge. Frozen CC-104 suites must pass
  **unchanged**; if any frozen assertion makes the addition impossible → blocked-to-ledger.
- **[RULING]** #52 QC posture: UI-defaults only (Issues panel collapsed with count badge;
  raw-ASR lint items visually de-emphasized vs post-edit items; speaker chip hidden when
  project has a single speaker). `checkCaptions` engine behavior untouched (frozen).
- Acceptance: DOM-rect assertions (zero row→row text overlap at 1440×900 on fixture
  project), merge undo/redo exactness, single transcript surface per #52 decision recorded
  in the unit report.

### M3 · Intake & project integrity (Closes #53, #54, #57, #58, #59, #65, #70)

- Units: `caption-studio-ui/unit-112-caption-importer-production` (#53/#54: replace the
  unit-07 placeholder port at `src/app/ports.ts:71` with the real engine importer — engine
  import parsing already exists per unit-07; this is composition wiring + language field),
  `caption-studio-ui/unit-113-project-integrity` (#57/#58/#59/#70: new-project resets
  header/media state; per-project media isolation; reload re-attaches media or offers
  honest relink; mid-job reload resumes or restores rows with interrupted state).
- **#57 spec gap**: if restoring media after reload conflicts with a frozen spec, record
  the conflict in the unit report as a proposed spec edit (orchestrator updates
  `architecture.md` later) — implement the honest empty/relink state meanwhile; never fake.
- Acceptance: e2e per behavior on fixtures only; `#65` bad-file toasts use human copy
  (codes allowed in a secondary detail line only).

### M4 · Offline & truthfulness (Closes #71, #60; part of #50)

- Units: `styling-and-export/unit-206-offline-model-availability` (#71: "Make available
  offline" completes with real progress; cached models actually work offline —
  `ENGINE_INTERNAL` root-cause first (likely wasm/worker offline fetch), status cache
  truth), `caption-studio-ui/unit-114-status-truth` (#60 + #50 surfacing: status bar
  monotonic %, completion announced, worker/boot failures surface within 2 s with codes,
  stale-chunk self-heal unregister+reload prompt).
- **[RULING]** Phantom model rows (cactus/sherpa from #50-A): **remove from the Transcribe
  popover** until adapters exist (registry rows may stay; the popover filters to
  implemented engines).
- Acceptance: `context.setOffline(true)` legs proving cached-model transcription completes;
  failure-path tests assert visible feedback (no silent states), codes-only text.

### M5 · Silent features (Closes #61, #68, #69)

- Unit: `local-transcribe-engine/unit-08-silent-features` (or split at your discretion
  into 08/09/10 if size demands — one branch each).
  - #69 diarization: fetch/serve the two pinned diarization models in the preview model
    mirror path and wire the worker to actually run them; two-speaker fixture must yield
    ≥ 2 speakers or fail visibly.
  - #68 align-to-audio: root-cause `ENGINE_INTERNAL`; on failure show the coded message,
    never append raw codes silently; on success word timings flip `estimated → aligned`.
  - #61 burn-in MP4: root-cause the silent close (picker/encode never starts?); visible
    progress + completion or visible error.
- **[RULING]** For each of the three: work or be honestly unavailable — a selectable
  no-op is a failed acceptance.

### M6 · Polish pack (Closes #62, #64, #66; finish #63, #67)

- One small unit each: popover/menu dismissal (Esc + outside click, no stacking occlusion),
  a11y (⋯ button name, `aria-modal` + focus management for dialogs incl. Export/About),
  keymap (#66: ⌘A select-all rows, Esc closes find, undo scope per **[RULING]**: undo
  operates on transcript edits; import/media removal get their own explicit actions, not
  undo-chain surprises — if frozen tests bind current behavior, ledger it).
- #67 harness tooling: fix `scripts/ux-walk.template.mjs` (import path, downloadsPath,
  UTC date flag, SECURITY-03 text scrub) — docs/scripts-only, builder may edit
  `scripts/**`.

## Cross-cutting rules

- **Order is load-bearing**: M1 before M2/M5 translation-adjacent legs; M4's offline fix
  before any re-sweep counts offline journeys. If a later item is blocked by an earlier
  blocked item, skip it and log why.
- Every merged PR: comment on the closed issue with before/after evidence (harness run
  path or Playwright MCP screenshots dir under `docs/ux-review-evidence/` — scrubbed,
  fixture-only).
- Every unit: ledger entry + unit report per `.agent/AGENTS.md` format; blocked items get
  `BLOCKED:` summaries.
- If all workstreams complete: final act = re-run the harness spot-check per journey
  (`.night/ux-*.mjs` patterns), update journey roll-up in the ledger, and post a run
  summary. Do **not** re-run the full independent sweep (owner schedules a fresh session
  for that) and do **not** declare the gate closed — the owner does.
- Time-boxing: prefer many small shippable PRs over one large branch. Green partial >
  red ambitious.
