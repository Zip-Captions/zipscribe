---
status: pending
workflow: default
created: 2026-10-27
passes: [design, dev]
active_pass: "design"
announcements: [changelog, release-notes, social-posts]
---

# Intent: Styling & Export

## Description

Make captions yours and get them out: Style tab with preset library (karaoke word-highlight, broadcast box, clean bold-lowercase, minimal) and full style controls driven by `CaptionStyle` tokens; a **single source-of-truth overlay renderer** (`engine/export/overlay.ts`) shared by live preview and burn-in export; export surface — SRT/VTT/JSON sidecars always, burned-in MP4 (H.264) on capable browsers via mediabunny + WebCodecs in a worker, WebM fallback — behind an honest capability-gated dialog; production deployment to Cloudflare Pages with CI, performance budgets, and model license attribution.

Maps to Epic 3 (US 3.1–3.2) of the original brief; corrects its mp4-muxer choice to mediabunny (mp4-muxer deprecated) per `local-transcribe-engine/discovery.md`.

## Business Context

- Styling presets are CapCut's retention driver for shorts creators; we implement the verified subset (keyword/active-word highlight, box background, batch style) without its marketing-cloud dependency.
- Export breadth is our documented competitive edge (Clipchamp: SRT-only).
- The shared preview/export renderer is the quality guarantee: what you see is what burns in.

## Passes

| Pass | Discipline | Output |
|---|---|---|
| design | design | preset library visual spec, overlay render tokens, export dialog flows → feeds dev pass as unit-201 acceptance refs |
| dev | dev | code units 201–203 |

## Completion Criteria

- [ ] Preset set (karaoke, box, bold-lower, minimal) + custom controls; preview uses `engine/export/overlay.ts` (single renderer, import-graph test: `ui/` never imports a second caption renderer)
- [ ] SRT/VTT/JSON goldens byte-exact on fixtures incl. escape/RTL/newline edge cases; re-import of our own SRT/VTT round-trips blocks (± 5 ms)
- [ ] Burn-in (T1 chromium): MP4 where sample frames at 10 word-boundary timestamps show correct active-word highlight (pixel assert) + audio track duration matches source ± 1 s + overlay renderer identity test (preview frame == export frame)
- [ ] Capability gating: T3 (webkit project) offers SRT/VTT/JSON + WebM; never offers MP4 burn-in
- [ ] `pnpm test:e2e` green incl. webkit export specs
- [ ] Production: Cloudflare Pages deploy from `main` + preview from PR; Lighthouse desktop a11y ≥ 95, performance ≥ 85; offline reload works with cached shell + model
- [ ] About/licensing panel lists every model with license + attribution (CC-BY where applicable)

## Units

| Unit | Discipline | Depends on |
|---|---|---|
| unit-201-styling-engine | frontend(design→dev) | caption-studio-ui/unit-102, unit-104 |
| unit-202-export | frontend | unit-201 |
| unit-203-production-deploy | operations | unit-202, caption-studio-ui/unit-106 |

## Risks

- Burn-in frame/word sync drift (decode pts vs playhead model) → export derives from block data + pts directly, never from the live playhead; golden frame tests catch drift.
- Color space/range canvas→encoder gotchas (discovery) → encode with explicit color space params; visual goldens on chromium, webkit where AudioEncoder allows.
- Google Fonts privacy vs offline → bundled OFL subsets default; remote fonts explicitly opt-in per product privacy rules.

## Boundaries

- Per-block style overrides (whole-project style v1; seed exists), translation (seed: Chrome Translator API), share-links (seed).
