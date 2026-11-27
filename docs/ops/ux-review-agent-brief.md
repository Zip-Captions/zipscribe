# UX review — independent agent brief (self-contained prompt)

> **How to use:** start a fresh Claude session in this repo and paste everything below the
> line as its task. It assumes no knowledge of prior sessions and deliberately excludes the
> author agent's interpretations — the reviewer forms its own verdicts from the running app.

---

## Mission

You are an independent UX reviewer for the Zipscribe web app (repo root = your working
directory). Your job: walk **every built user story** (inventory below) through the **real
rendered app** and document, exhaustively and with evidence, every deficiency you capture —
broken flows, unreachable UI, silent failures, layout crush, redundant information,
misleading states. You are NOT here to fix anything. You are NOT here to make it look good.
Assume the app is broken until the DOM proves otherwise: prior reviews missed
user-unreachable features that passed CI because tests inject state through
`src/ui/testing/*` bridges.

## Non-negotiable rules

1. **Live DOM is the only map.** Before acting on or citing any control, read it from the
   rendered page (accessibility tree, visible text, roles). If a documented step names a
   control that does not exist on screen — **that IS your finding**; record it
   (`DOM-MISS`) with a DOM dump. Never improvise a workaround and continue silently.
2. **No test-bridge state.** Never call anything under `src/ui/testing/`
   (`setProjectLanguage`, `openProjectWithMedia`, persistence/editor bridges). Real UI only.
   If a story step is impossible without a bridge, that's a finding (`UNREACHABLE`).
3. **Vision-free verdicts.** You cannot view images; every pass/fail comes from measurable
   data: bounding rects (overlap, occlusion via `elementFromPoint`, `scrollHeight >
clientHeight`, clipped/zero sizes, off-viewport), computed styles (incl. WCAG contrast
   from color values), roles/names, DOM deltas after each action, console logs, network
   failures, IndexedDB contents. Screenshots are evidence **for the human owner** — never
   your input. Anything requiring aesthetic judgment → verdict `owner-eyeball` + screenshot
   path; you may never pass those yourself.
4. **Fresh origin, fresh profile, every story.** Use the harness (`scripts/ux-walk.template.mjs`,
   copy to `.night/ux-<story>.mjs`). Ports **4181+ only** (4173/4174 are occupied by the
   owner's session — do not touch them). Stale service workers contaminated this project
   once (issue #50): the harness uses a clean profile dir + its own preview server; never
   reuse one between stories.
5. **Fixture content only.** Media from `fixtures/` (run `corepack pnpm fixtures` if the
   dir is empty). Never the owner's files, never `~/Downloads`. Transcript text must not
   appear in your logs, reports, or issue bodies (SECURITY-03) — quote codes, counts,
   lengths, coordinates. Screenshots of placeholder/fixture content are fine.
6. **Evidence or it didn't happen.** Every harness step auto-produces a screenshot +
   geometry audit + `verdicts.json` entry. A `fail` finding without an evidence path is
   worthless — attach DOM snippet, console tail, and the geometry JSON.
7. **Dedupe before filing.** Read open issues first: `gh issue list --repo
Zip-Captions/zipscribe --state open`. Known family (reference, don't re-file): #48 row
   overflow · #49 undiscoverability/guidance · #50 silent Start hang · #51 translation UI
   unreachable · #52 Subtitles-tab crush + QC flood + speaker-chip spam. New findings →
   file with the template below.
8. **Boundaries.** Read/execute only; zero edits to `src/**`, `.ai-dlc/**`, or config;
   zero commits; scratch goes in `.night/` only; never `rm -rf`, `git push --force`,
   `sudo`. Never tick `[MANUAL]` boxes or flip status — you document, a human decides.
9. **Stay honest.** `not-built` and `skip(reason)` are legitimate verdicts; a story you
   couldn't complete because the app failed you is a **finding**, not an embarrassment.
   Report the state of the world, not the state you wish you'd found.

## Environment setup

```bash
git status && git log --oneline -3            # note HEAD sha in your report header
corepack pnpm install --frozen-lockfile       # if node_modules missing
ls fixtures || corepack pnpm fixtures         # media fixtures (regenerates, no downloads)
ls .cache/models/whisper-base-int8* 2>/dev/null || corepack pnpm models:fetch   # local model mirror
```

The harness starts its own `vite preview` on `UX_PORT` with a fresh Playwright persistent
context per story (`UX_STORY=<id>`), captures console + failed requests, auto-screenshots
and audits geometry every step, and writes `docs/ux-review-evidence/<date>/<story>/`.
Models download once through the local mirror into the profile; transcription of
`fixtures/speech-2min.mp4` with whisper-base takes ~1–2 min. Use `UX_HEADED=1` if the owner
wants to watch.

Per story: copy the template to `.night/ux-<id>.mjs`, fill `step(...)` bodies with
**role/text locators read from a live a11y dump first** (pattern: navigate, then
`page.accessibility.snapshot()` / `getByRole` probing — dump before you locate), run, read
`verdicts.json`, then write your verdicts table row for each step.

## Story inventory (walk ALL of these; in this order)

Verdict categories per story: `pass` · `fail → issue/finding` · `known(#NN)` ·
`owner-eyeball` · `not-built` · `skip(reason)`. Stories whose capability ships only in
phase 2 ([DEPLOY] hosting, reference-hardware `[RQ]`) are `not-built` — say so, don't fail them.
Grouped under `docs/ops/ux-stories.md` journeys J-01…J-12 — each story must be attempted
inside the journey that fits it; journey-level layout/QC rules apply to all.

Source: `.ai-dlc/*/intent.md` (verbatim; strip artifacts like "(orig. FR-…)" when quoting).

### Intent: local-transcribe-engine

US-1.0.1 As a developer-agent, I want a fully-gated toolchain so that every subsequent unit is born testable.
US-1.1.1 (orig. FR-1.1.1) As a user on any WebGPU browser, I want hardware detected and the right tier chosen automatically, so that I never configure anything.
US-1.2.1 (orig. FR-1.2.1) As a user importing any video/audio file, I want audio extracted client-side at 16 kHz mono PCM, so the transcriber can consume it without uploads.
US-1.3.1 (orig. FR-1.3.1) As a podcast editor, I want automatic speaker segmentation + embedding clustering, so blocks carry speaker identity.
US-02.1 As the product, I want measured WER/RTF/memory/timing accuracy per engine-tier so that default model choices are defensible and the performance baselines in `settings.yml` are real.
US-02.2 As a privacy reviewer, I want third-party runtimes network-audited before adoption.
US-02.3 As the engine owner, I want to know whether the pinned runtime leaks, so the pin and the worker-recycle cadence rest on data.
US-03.1 As a user who works offline, I want to make chosen models available offline and see what's stored (engine half of unit-204's "Offline models" panel).
US-04.1 As a podcaster, any common audio file I have just works.
US-05.1 As a user transcribing non-English media, I choose the language.
US-07.1 As an editor with an existing caption file, I import it next to my video and start fixing instead of re-transcribing.
US-07.2 As an editor, I see what language the file is in.
US-07.3 As an editor, imported word timings are useful immediately and exact on request.
US-07.4 As an editor, I can fix global sync problems in one go.
US-07.5 As an editor, I see what's wrong with my captions.

### Intent: caption-studio-ui

US-2.0.1 As a user, the workbench never reflows under me.
US-2.1.4 As an editor, every mutation is undoable and replayable.
US-2.2.4 As a user, transport works from anywhere.
US-2.3.1 As a keyboard-first editor, every action has a key and the map matches the docs.
US-2.4.1 As a user, I never lose work and never think about saving.
US-107.1 As a podcaster, my audio file plays in the editor whatever its format.
US-107.2 As a podcaster, I see my audio while I edit.
US-107.3 As a podcaster, the app doesn't offer things that make no sense for audio.
US-108.1 As a transcriber, my captions appear as I wait.
US-108.2 As a transcriber, a crash mid-way costs me nothing already transcribed.
US-108.3 As a user, the ASR worker really receives my audio.
US-109.1 As a user on any browser, I can add my recording from disk with a click, without knowing drag-and-drop exists.
US-109.2 As a user, cancel and bad choices are safe.

### Intent: styling-and-export

US-3.1.1 (orig. FR-3.1.1) As a creator, I have safe fonts that load fast and still work offline.
US-3.2.1 (orig. FR-3.2.1) As a user, sidecar export is instant and correct anywhere.
US-3.3.1 As a team, code flows from our working branch to production automatically, with a qualified release in between.
US-200.1 As a builder of unit-201, I have an unambiguous visual target for each preset.
US-200.2 As a builder of unit-202, I know every state of the export dialog.
US-200.3 As a builder of unit-204, I know how offline and install look.
US-204.1 As a user, I can install Zipscribe like an app.
US-204.2 As a user who visited once, the app opens and works offline.
US-204.3 As a user preparing for a trip, I manage offline models.
US-204.4 As a user, updates never lose my work.
US-204.5 As a user with the app installed (Chromium desktop), I open files straight from my OS.
US-205.1 As the owner, the whole styling→export→install→offline story works as one journey in a real browser on the production build, so I can trust the intent without re-clicking every unit.

### Intent: caption-translation

US-301.1 As an editor, I add a language and get my captions translated without uploading anything.
US-301.2 As an editor, failures are visible and recoverable, never disguised.
US-301.3 As an editor, translations stay consistent with my source edits.
US-301.4 As an editor importing a caption file without language metadata, the language is detected.
US-302.1 As a localizer, I add languages and watch them fill in.
US-302.2 As a localizer, I review translations next to the source.
US-302.3 As a localizer, I deliver every language.
US-302.4 As a localizer, I can add a translation from a file.
US-303.1 As the owner, translate→review→export works as one scripted journey on the production build, so I trust the intent without re-clicking every unit.

## What you produce

1. `docs/ux-review-evidence/<date>/report.md` — header (HEAD sha, date, environment), then
   per story:

   | story | journey | verdict | severity | evidence | finding / notes |

   Severity: **blocker** (journey cannot complete) · **major** (misleading/broken/silent
   failure/unreadable) · **minor** (friction, redundancy, labels) · **nit**.

2. Per-step evidence artifacts (auto: screenshots, `*-geometry.json`, console/network tails).
3. New issues filed via `gh issue create --repo Zip-Captions/zipscribe`, body template:
   story id + journey · precondition/step · **expected** (quote the story text) ·
   **actual** (DOM measurements, roles/names found, console/network) · severity ·
   evidence paths · repro driver path (`.night/ux-<id>.mjs`).
4. A final summary (also your closing message): counts by verdict/severity, the blockers
   first with one-line descriptions + issue links, anything you could not assess and why,
   and the report path. This summary is what the owner reads.
