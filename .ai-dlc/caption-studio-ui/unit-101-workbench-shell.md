---
status: pending
discipline: frontend
depends_on: [local-transcribe-engine/unit-01-scaffold-quality-gates]
workflow: default
mode: AHOTL
---

# Unit 101: Workbench Shell

## Description

Panel architecture per `knowledge/design.md` layout: resizable sidebar (Subtitles/Media/Style tabs — Style reserved), preview stage with reserved canvas layer, timeline region (empty until unit-103), header with tier chip + Transcribe/Export actions (dispatch to store), status bar, theme tokens, import drop zone / empty state.

## User Stories

**US-2.0.1** As a user, the workbench never reflows under me.
- *Given* any viewport ≥ 1280×720, *when* panels resize/collapse (`Ctrl+Alt+2/3` Clipchamp-style) or streams arrive, *then* only panel sizes change; no layout thrash (no CLS > 0.02 in Playwright perf trace), minimum panel sizes enforced, sizes persisted to settings (IDB via unit-106 seam).

**US-2.0.2** As a user, first run guides me to import.
- *Given* no project, *when* app opens, *then* centered drop zone accepts MP4/MOV/MKV/WebM/MP3/WAV (extension+MIME probe), shows model/tier status from `jobs` store (mocked), and a "Try a sample clip" action loading `fixtures/speech-2min.mp4`.

**US-2.0.3** As a user on a weak GPU, I always know my tier.
- *Given* capability probe result, *when* rendered, *then* tier chip shows `GPU`/`CPU`/`Limited` with tooltip explaining what's degraded (from `jobs.tierNotice`); T4 renders the blocked screen (no panels) with requirements list.

## Functional Requirements

- **FR-2.0.1** Layout primitives: CSS grid + drag-resize handles (`panels-resizable` pattern; no new dep if CSS-native feasible), keyboard `Alt+1/2/3` focus regions.
- **FR-2.0.2** Header: project name inline-edit, tier chip, Transcribe primary button (disabled states: no media / model not ready / job running), Export button (disabled until ≥ 1 block; dispatches `export:open` action to service seam).
- **FR-2.0.3** Sidebar tabs; Subtitles tab hosts unit-104 mount point; Media tab = asset card (name, duration, res/fps, codec, re-link button) + import again; Style tab shows "Styling arrives in Intent 3" placeholder wired to feature flag.
- **FR-2.0.4** Status bar: model+tier, cache state, job progress (polite live-region), autosave indicator (seam).
- **FR-2.0.5** Theme: dark default via tokens (light switchable); no styled-components; respects `prefers-color-scheme` only when no explicit choice.
- **FR-2.0.6** Store wiring: `jobs` slice receives mocked worker events (fake engine injectable — contract tests with unit-102's fixtures).

## Completion Criteria

- [ ] Layout spec: resize persistence, collapse, min-sizes, CLS assertion on streaming updates
- [ ] Import drop zone accepts fixture set, rejects wrong types with toast (no silent drops)
- [ ] Tier chip + blocked screen (T4 via fake capability) tested
- [ ] Tab keyboard `Alt+1/2/3` + focus-visible rings (axe clean on shell)
- [ ] All gates green (chromium)

## Docs to consult

- knowledge/design.md (layout ASCII + tokens) · Clipchamp Alt+1..4/zoom collapse: official shortcuts doc
