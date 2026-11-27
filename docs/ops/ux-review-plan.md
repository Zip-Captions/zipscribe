# UI/UX review plan (agent-run, story-driven)

Purpose: systematic, repeatable discovery of the gap between **what the spec says the app
does** and **what a real user can actually do in the rendered UI**. Run by an agent session
(Claude subagent or orchestrator overnight pass) — never by the code's own test bridge,
never from the agent's memory of source.

## Why this exists

2026-11-26 session: multiple user-reachable flows turned out broken or unreachable despite
green CI (#51 translation UI — the e2e bridge injected state the UI never sets; #50 silent
Start hang; #52 layout/QC flood; #48 row overflow). The agent giving usage instructions
invented controls that don't exist (#49). Root causes: tests bypass the UI, nobody walks
journeys as a user, and guidance comes from source fragments.

## Hard rules for the reviewing agent

1. **Live DOM is the only map.** Before naming any control in a step, read it from the
   rendered accessibility tree / DOM (`getByRole`, visible text). If a step in
   `ux-stories.md` names a control that isn't there — **that is the finding**; record it,
   don't improvise a workaround.
2. **No test-bridge state.** `src/ui/testing/*` bridges (`setProjectLanguage`,
   `openProjectWithMedia`, …) are banned for review runs — they mask missing UI.
3. **Real browser path**: Playwright (chromium) with a **fresh persistent profile per run**
   and a **fresh port** (origin rotation, e.g. 4181, 4182…) so no stale service worker or
   cache can contaminate (lesson of #50C). Puppeteer MCP is not a valid verdict surface for
   media/transcription.
4. **Fixture content only** (SECURITY-03): `fixtures/` + `.night/csa-*` probe files; no
   owner media; transcript text never lands in logs/issues — codes and numbers.
5. **Evidence or it didn't happen**: every step yields a screenshot
   (`docs/ux-review-evidence/<date>/<story>/step-<nn>-<slug>.png`) and, on failure, a DOM
   snippet + console/network tail. Verdicts: pass / fail(known #) / fail(new) / blocked.
6. **Dedupe before filing**: check open issues (#48–#52 + list) — reference known IDs, file
   new ones only after dedupe, with repro steps, expected vs actual, severity (rubric in
   `ux-stories.md`), and evidence paths.
7. `[MANUAL]` boxes stay owner-only; the review records findings, never ticks sign-offs.
8. **Verdicts are vision-free**: the agent has no image access, so every pass/fail derives
   from measurable data — bounding-rect geometry (overlap, occlusion via `elementFromPoint`,
   `scrollHeight > clientHeight`, clipped/zero sizes, off-viewport), computed styles
   (incl. contrast ratios), accessibility-tree roles/names, DOM deltas after actions,
   console/network capture. Screenshots are evidence **for the owner**, never input to an
   agent verdict. Anything requiring aesthetic judgment (mood, "looks right", preset feel)
   is recorded as `owner-eyeball` with screenshot paths — the agent may not pass it.

## Runner mechanics

Template: `scripts/ux-walk.template.mjs`. Per story, the agent copies it to
`.night/ux-<story>.mjs`, fills step bodies with DOM-derived locators, runs it, and writes
`docs/ux-review-evidence/<date>/report.md`:

```
| story | step | expected | actual | verdict | evidence |
```

Harness provides per run: fresh profile + fresh port (server started inside the driver on
the chosen port serving `dist/`), model mirror pre-seeded (`.cache/models`), console +
network capture, per-step auto-screenshot, JSON verdict dump. Model downloads allowed once
whisper-base (int8) into the profile mirror; diarize fixture optional.

## Cadence

- Full J-01…J-12 sweep: once per intent completion, and before every owner sign-off ask
  (a sweep report must exist, or the sign-off request is invalid).
- Incremental: on any PR touching `src/ui/**`, the CI green path is not enough — at least
  the affected journeys get re-walked by an overnight pass.
- The sign-off queue (`owner-signoff-queue.md`) may not present an item to the owner whose
  story failed the latest sweep — fix or file first; the owner only answers judgment
  questions, never navigation ones.

## Known-issues snapshot (2026-11-26)

#48 row overflow · #49 undiscoverable/agent-guidance · #50 silent Start hang (stale SW +
phantom models) · #51 translation UI unreachable (bridge paper-over) · #52 Subtitles-tab
layout crush, QC flood on raw ASR, single-speaker chip spam.
