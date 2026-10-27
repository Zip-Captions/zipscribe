---
status: pending
discipline: frontend
depends_on: [caption-studio-ui/unit-102-editor-core-playback, caption-studio-ui/unit-104-transcript-editor]
workflow: default
mode: HITL   # visual judgement + shared-renderer contract with export
---

# Unit 201: Styling Engine & Presets

## Description

Style tab + `CaptionStyle` pipeline: control panel (font family/weight/size %, colors incl. outline/background box, position + safe margins, alignment, max lines, highlight mode), preset library (karaoke active-word, broadcast box, bold-lowercase, minimal), font strategy (bundled OFL subsets default, Google Fonts opt-in), and the **shared overlay renderer** `engine/export/overlay.ts` — `(ctx, project, time, style) → draws` — plugged into unit-102's canvas layer and reused verbatim by unit-202.

## User Stories

**US-3.1.1** (orig. FR-3.1.1) As a creator, I have safe fonts that load fast and still work offline.
- *Given* first run offline, *when* style renders, *then* bundled subsets (Inter, Archivo, JetBrains + 4 display OFL faces) render (no network); *given* "Load Google Fonts" enabled (explicit opt-in, product privacy rule), *when* used, *then* remote loaded with fallback-then-swap, no layout jump in canvas (measure-after-load re-render on `document.fonts.ready`).

**US-3.1.2** (orig. FR-3.1.2, verified subset) As a shorts creator, presets get me 90% there.
- *Given* preset picker with preview thumbnails, *when* "Karaoke" chosen, *then* active word gets `--accent` fill + raised weight synced to playhead via `activeWord` selector (≤ 1 frame), other words base style; box/bold-lower/minimal verified per CapCut-documented styles (design § Sources); preset = style patch — one undo step, custom controls remain live after preset (batch re-style per CapCut Ctrl+A convention: preset applies project-wide).

**US-3.1.4** As an editor, preview and burn-in are pixel-identical.
- *Given* the same `(project, time, style)`, *when* preview canvas and export frame (headless) render, *then* pixel-identical (golden diff SSIM ≥ 0.99 on chromium goldens); import-graph test: only `engine/export/overlay.ts` draws captions (UI may not fork a second renderer).

## Functional Requirements

- **FR-201.1** `engine/export/overlay.ts`: pure on `(ctx: CanvasRenderingContext2D, frame: OverlayFrame)` — word-wrap (per `maxLinesPerBlock`, break at spaces then hard-break), line-fill budgets, speaker-color left bar (when speakers shown), outline (stroke order), background box (radius, opacity), active-word highlight state machine, `safeMargin` presets (9:16/16:9/1:1/4:5 from design).
- **FR-201.2** Style slice in `project` store via commands (`style-patch`, `style-preset`); live-update from controls (no history spam: control commits on release/blur — coalesced rule from unit-102).
- **FR-201.3** Preset registry `ui/style/presets.ts`: `{ id, name, patch, thumbnail() }`; thumbnails rendered by same overlay renderer with sample project (no static images to drift).
- **FR-201.4** Font manager: `bundled` (subsetted woff2 in build, ≤ 200 KB total) / `remote` (opt-in toggle, per-font), `font-display: swap` semantics, measurement integration with transcript virtualization re-measure bus (unit-104 risk hook).
- **FR-201.5** Contrast guard: text/background contrast < 4.5:1 → warning icon in panel (WCAG AA helper, product rule).
- **FR-201.6** Aspect-ratio selector (16:9/9:16/1:1/4:5) drives letterbox + safe margins (102) and export (202) from single source.

## Completion Criteria

- [ ] Overlay goldens: 4 presets × 3 scripts (short/long/wrapped) × safe-margin matrix, SSIM ≥ 0.98
- [ ] Preview==export identity test wired (export stub consumes renderer; full in 202)
- [ ] Preset apply = 1 undo step; controls live post-preset; batch re-style affects all blocks
- [ ] Offline font test (blocked network, bundled render) + remote opt-in test
- [ ] Contrast guard test; import-graph "one renderer" lint test passes
- [ ] All gates green

## Docs to consult

- knowledge/design.md tokens · docs-mcp `@tanstack/react-virtual` (re-measure bus) · CapCut caption styles (design § Sources)
