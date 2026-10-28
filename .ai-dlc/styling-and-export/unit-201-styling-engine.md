---
status: pending
discipline: frontend
depends_on: [unit-200-style-export-offline-design, caption-studio-ui/unit-102-editor-core-playback, caption-studio-ui/unit-104-transcript-editor]
workflow: default
mode: HITL   # visual judgement + shared-renderer contract with export
---

# Unit 201: Styling Engine & Presets

## Description

Style tab + `CaptionStyle` pipeline: control panel (font family/weight/size %, colors incl. outline/background box, position + safe margins, alignment, max lines, highlight mode), preset library (karaoke active-word, broadcast box, bold-lowercase, minimal), font strategy (bundled OFL subsets default, Google Fonts opt-in), and the **shared overlay renderer** `engine/export/overlay.ts` — `(ctx, project, time, style) → draws` — plugged into unit-102's canvas layer and reused verbatim by unit-202.

## User Stories

**US-3.1.1** (orig. FR-3.1.1) As a creator, I have safe fonts that load fast and still work offline.
- *Given* an offline session after one online visit, *when* style renders, *then* bundled subsets (Inter, Archivo, JetBrains Mono + 4 display OFL faces) render from the service-worker cache (no network); *given* "Load Google Fonts" enabled (explicit opt-in, product privacy rule), *when* used, *then* remote loaded with fallback-then-swap, no layout jump in canvas (measure-after-load re-render on `document.fonts.ready`).

**US-3.1.2** (orig. FR-3.1.2, verified subset) As a shorts creator, presets get me 90% there.
- *Given* preset picker with preview thumbnails, *when* "Karaoke" chosen, *then* active word gets `--accent` fill + raised weight synced to playhead via `activeWord` selector (≤ 1 frame), other words base style; box/bold-lower/minimal verified per CapCut-documented styles (design § Sources); preset = style patch — one undo step, custom controls remain live after preset (batch re-style per CapCut Ctrl+A convention: preset applies project-wide).

**US-3.1.4** As an editor, preview and burn-in look the same.
- *Given* the same `(project, time, style, track)`, *when* the overlay layer alone is rendered on the main-thread canvas and on an `OffscreenCanvas` in a worker, *then* the two layers match at SSIM ≥ 0.99 (exact pixel equality is not required — font rasterization can differ by context); import-graph test: only `engine/export/overlay.ts` draws captions (UI may not fork a second renderer).

## Functional Requirements

- **FR-201.1** `engine/export/overlay.ts`: pure on `(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, frame: OverlayFrame)` where `OverlayFrame = { blocks visible at t, time, style, track: 'source' | lang, width, height }` — translation tracks render block-level (no per-word highlight), `ctx.direction` set from the track language (RTL for ar/he) — word-wrap (per `maxLinesPerBlock`, break at spaces then hard-break), line-fill budgets, speaker-color left bar (when speakers shown), outline (stroke order), background box (radius, opacity), active-word highlight state machine, `safeMargin` presets (9:16/16:9/1:1/4:5 from design).
- **FR-201.2** Style slice in `project` store via commands (`style-patch`, `style-preset`); live-update from controls (no history spam: control commits on release/blur — coalesced rule from unit-102).
- **FR-201.3** Preset registry `ui/style/presets.ts`: `{ id, name, patch, thumbnail() }`; thumbnails rendered by same overlay renderer with sample project (no static images to drift).
- **FR-201.4** Font manager: `bundled` (subsetted woff2, latin + latin-ext; ≤ 200 KB for the default set, display faces lazy-loaded and precached by the service worker) / `remote` (opt-in toggle, per-font), `font-display: swap` semantics, measurement integration with transcript virtualization re-measure bus (unit-104 risk hook). Fonts are also registered in the export worker (`new FontFace(...)` + `self.fonts.add`) so `OffscreenCanvas` uses identical faces. Scripts outside the bundled subsets (Arabic, CJK, Devanagari — reachable via translation tracks) fall back to system fonts; preview shows a "system font used" hint.
- **FR-201.5** Contrast guard: text/background contrast < 4.5:1 → warning icon in panel (WCAG AA helper, product rule).
- **FR-201.6** Aspect-ratio selector (`Project.outputAspect`: source/16:9/9:16/1:1/4:5) drives letterbox + safe margins (102) and export (202) from single source. Hidden for audio projects (stage fixed at 16:9; style controls stay — they shape the preview captions over the visualizer).
- **FR-201.7** Preset values come from unit-200's spec verbatim; any deviation is recorded in the unit report.

## Completion Criteria

- [ ] **CC-201.1** Overlay goldens: 4 presets × 3 captions (short/long/wrapped) × safe-margin matrix, SSIM ≥ 0.98; plus one RTL translation-track golden
- [ ] **CC-201.2** Preview==export identity test wired (export stub consumes renderer; full in 202)
- [ ] **CC-201.3** Preset apply = 1 undo step; controls live post-preset; batch re-style affects all blocks
- [ ] **CC-201.4** Offline font test (blocked network, bundled render) + remote opt-in test
- [ ] **CC-201.5** Contrast guard test; import-graph "one renderer" lint test passes
- [ ] **CC-201.6** All gates green

## Docs to consult

- knowledge/design.md tokens · docs-mcp `@tanstack/react-virtual` (re-measure bus) · CapCut caption styles (design § Sources)
