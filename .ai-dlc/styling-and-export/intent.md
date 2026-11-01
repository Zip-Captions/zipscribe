---
status: pending
workflow: default
created: 2026-10-27
passes: [design, dev]
active_pass: "design"
announcements: [changelog, release-notes, social-posts]
---

# Intent: Styling, Export & Offline App

## Description

Make captions yours and get them out — anywhere, even offline: Style tab with preset library (karaoke word-highlight, broadcast box, clean bold-lowercase, minimal) and full style controls driven by `CaptionStyle`; a **single source-of-truth overlay renderer** (`engine/export/overlay.ts`) shared by live preview and burn-in export; export surface — SRT/VTT/JSON/TSV sidecars for the source or any translation track, burned-in MP4 (H.264) on capable browsers via mediabunny + WebCodecs in a worker — behind an honest capability-gated dialog; production deployment to Cloudflare Pages with CI, performance budgets, and model license attribution; and an **installable, offline-capable PWA** (manifest, service worker, offline models management, OS file handling).

Maps to Epic 3 (US 3.1–3.2) of the original brief; corrects its mp4-muxer choice to mediabunny (mp4-muxer deprecated) per `local-transcribe-engine/discovery.md`. PWA/offline added at spec review 2026-10-27.

## Business Context

- Styling presets are CapCut's retention driver for shorts creators; we implement the verified subset (keyword/active-word highlight, box background, batch style) without its marketing-cloud dependency.
- Export breadth is our documented competitive edge (Clipchamp: SRT-only).
- The shared preview/export renderer is the quality guarantee: what you see is what burns in.
- A local-only tool that also works offline and installs like an app is a differentiator no cloud captioner can match (product rules 6–7).

## Passes

| Pass | Discipline | Output |
|---|---|---|
| design | design | unit-200: preset library visual spec, overlay render tokens, export dialog + offline/install flows → acceptance refs for 201/202/204 |
| dev | dev | code units 201–204 |

## Completion Criteria

- [ ] **CC-I3.1** Preset set (karaoke, box, bold-lower, minimal) + custom controls; preview uses `engine/export/overlay.ts` (single renderer, import-graph test: `ui/` never imports a second caption renderer)
- [ ] **CC-I3.2** SRT/VTT/JSON/TSV goldens byte-exact on fixtures incl. escape/RTL/newline edge cases, for the source track and a translation track; re-import via `local-transcribe-engine/unit-07` parsers round-trips blocks (± 1 ms)
- [ ] **CC-I3.3** Burn-in (T1 chromium): MP4 where sample frames at 10 word-boundary timestamps show correct active-word highlight (overlay-layer SSIM ≥ 0.99 vs preview) + audio track duration matches source ± 1 s
- [ ] **CC-I3.4** Capability gating: T3 (webkit project, no AudioEncoder) offers SRT/VTT/JSON/TSV and never offers MP4 burn-in
- [ ] **CC-I3.5** Audio projects: burn-in is absent from the export dialog DOM on every tier; sidecars export byte-exact; the Style tab hides the aspect selector
- [ ] **CC-I3.6** Installable: Chrome reports zero installability errors (CDP `Page.getInstallabilityErrors`) on the production build; manifest fields asserted by test
- [ ] **CC-I3.7** Offline: after one online visit, `context.setOffline(true)` → reload opens the app, an existing project opens from IndexedDB, edits autosave, sidecar export works, and transcription works with an offline-ready model (and fails fast with `OFFLINE_MODEL_MISSING` otherwise)
- [ ] **CC-I3.8** `pnpm test:e2e` green incl. webkit export specs
- [ ] **CC-I3.9** `[DEPLOY]` Delivery: Cloudflare Pages preview per PR, staging from `develop`, production from `main` (git flow, automatic, with rollback); Lighthouse desktop a11y ≥ 95, performance ≥ 85
- [ ] **CC-I3.10** About/licensing panel lists every model with license + attribution (CC-BY where applicable)

## Units

| Unit | Pass | Discipline | Depends on |
|---|---|---|---|
| unit-200-style-export-offline-design | design | design | caption-studio-ui/unit-101 |
| unit-201-styling-engine | dev | frontend | unit-200, caption-studio-ui/unit-102, caption-studio-ui/unit-104 |
| unit-202-export | dev | frontend | unit-201, local-transcribe-engine/unit-03, local-transcribe-engine/unit-07 |
| unit-203-production-deploy | dev | devops | unit-202, caption-studio-ui/unit-106 |
| unit-204-pwa-offline | dev | frontend | unit-200, unit-202, local-transcribe-engine/unit-03, caption-studio-ui/unit-106 |

**Phasing (owner decision 2026-10-31):** units 200–202 + 204 are `phase: mvp` — all provable locally (`vite preview`, Playwright, CDP), no external accounts. unit-203 is `phase: production`: it and this intent's `[DEPLOY]` criteria (CC-I3.9) plus unit-01's deferred CC-01.14/15/16 are gated on Cloudflare credentials and run only after every MVP unit is complete (`.agent/SPEC-GUIDE.md` § Build order). The intent `status` may only flip to `complete` once the phase-2 criteria pass on real deploys.

## Risks

- Burn-in frame/word sync drift (decode pts vs playhead model) → export derives from block data + pts directly, never from the live playhead; golden frame tests catch drift.
- Color space/range canvas→encoder gotchas → encode with explicit `colorSpace` params; visual goldens on chromium, webkit where AudioEncoder allows.
- Google Fonts privacy vs offline → bundled OFL subsets default; remote fonts explicitly opt-in per product privacy rules (and unavailable offline unless already cached).
- Service-worker staleness (users stuck on an old build, or an update reloading mid-edit) → `registerType:'prompt'`, update toast after autosave, `sw.js` served `no-cache`; e2e covers update flow.

## Boundaries

- Per-block style overrides (whole-project style v1; seed), WebM burn-in for T3 (seed), bilingual burn-in and MP4 soft-subtitle tracks (seeds), share-links (seed), Web Share Target (seed).
- Translation workspace UI: `caption-translation/unit-302` (this intent's serializers/renderer take a `track` parameter it uses).
