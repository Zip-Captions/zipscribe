---
status: pending
phase: mvp
discipline: frontend
depends_on: [unit-101-workbench-shell, unit-104-transcript-editor, unit-106-persistence]
workflow: default
mode: AHOTL
---

# unit-109-media-intake-picker — Local file picker for media intake

## Description

Owner-reported MVP usability gap, confirmed during the 2026-11-23 sign-off run (`docs/signoff-evidence/2026-11-23/obs-01*`, `obs-02*`): media can only enter the app by drag-and-drop or the sample clip — there is no affordance to choose a file from the device. Add a real file-picker entry that feeds the **existing** intake path unchanged: `IntakeService.handleFiles(files)` (`src/state/services/intake.ts`, already used by the drop handler at `src/ui/shell/Workbench.tsx:637`; sibling affordance today is `sample-clip-button` at :470). Follows the `persistence.ts:170` picker doctrine (hidden `<input type=file>` — the intake picker uses the plain input directly, not `showOpenFilePicker`, so behaviour is identical across Chromium/WebKit).

Entries: (E1) the Media-tab DropZone gains a visible "Choose file…" button beside the drop copy; (E2) `ProjectList.tsx` empty-state (the drop-only area at ~:225-234) gains the same button creating a project from the chosen media. Both call one shared `MediaIntakeButton` component; zero changes to `IntakeService`, validation, sniffing, or size limits — the picker is an input surface, not a new pipeline. Reopens `caption-studio-ui` per the MVP gate (`knowledge/product.md` § Roadmap item 5, owner ruling 2026-11-24: fix in MVP).

## User Stories

**US-109.1** As a user on any browser, I can add my recording from disk with a click, without knowing drag-and-drop exists.
- *Given* the Media tab with no asset, *when* I press "Choose file…" and pick a supported video/audio file, *then* the intake flow runs exactly as with a drop: asset card appears, waveform/preview ready, project autosaves (Playwright `setInputFiles`).
- *Given* the Projects empty state, *when* I press the button and pick a media file, *then* a project is created and opened through the same path the drop uses.

**US-109.2** As a user, cancel and bad choices are safe.
- *Given* the picker open, *when* I cancel, *then* no project/asset is created and no error toast appears (no-op).
- *Given* I select an unsupported file (e.g. `.txt`) or one over the intake size cap, *then* the outcome surfaces with the same coded notice the drop path shows — no new error surface.

## Functional Requirements

- **FR-109.1** New shared component (e.g. `src/ui/shell/MediaIntakeButton.tsx`): hidden `<input type=file>` with `accept` mirroring the intake media+caption extension/sniff matrix (`isMediaFileName`/`isCaptionFileName` stay the authority — input is a hint, validation stays server-of-truth in intake); `multiple` where intake supports it.
- **FR-109.2** E1 Media-tab DropZone and E2 ProjectList empty-state both mount the button; drop handlers untouched; keyboard reachable + focus-visible (tab order, `aria`-labelled as a button, Enter/Space open the picker).
- **FR-109.3** Intake results reuse the existing outcome plumbing (`Workbench.tsx:631-645` doctrine): same toasts, same failure codes, same sample-clip error treatment; unhandled rejections never escape.
- **FR-109.4** SECURITY-03: file *names* are treated as user content — never logged; console stays codes/counts.

## Technical Specification

Component takes `onFiles(files: File[])` and a label; Workbench wires it to `intake.handleFiles`, ProjectList to its existing project-from-drop creation function. Test ids: `media-intake-button` (Media tab), `project-intake-button` (Projects). Styling per `design.md` button vocabulary; no new deps.

## Completion Criteria

- [ ] **CC-109.1** L5 chromium: `setInputFiles` via `media-intake-button` creates asset + preview + autosaved project (assert via persistence bridge, mirrors unit-106 patterns); `project-intake-button` creates and opens a project
- [ ] **CC-109.2** Cancel = no-op (no state change, no toast); unsupported/oversized file → same coded outcome as the equivalent drop (parity test comparing both paths' outcomes)
- [ ] **CC-109.3** Keyboard-only: focus → Enter opens the file chooser (Playwright filechooser event); component is a real focusable button with accessible name
- [ ] **CC-109.4** SECURITY-03: console capture during journeys shows no file names / no transcript-derived strings
- [ ] **CC-109.5** Unit test: `MediaIntakeButton` passes selected files through `onFiles` verbatim and resets `input.value` (re-choosing the same file fires again); lint/typecheck/test/build+bundle green

## Risks

- Divergent behaviour vs drop path (the classic two-pipeline bug) → CC-109.2 parity test forces identical outcomes; reviewer checks that no validation logic was copied.
- `accept` drift from the intake matrix → hint only; intake remains the single validator (stated in code comment).

## Boundaries

Owns: `src/ui/shell/MediaIntakeButton.tsx` (+ test), mount points in `Workbench.tsx` / `ProjectList.tsx`, their css, `e2e/media/intake-picker.spec.ts`. Doesn't own: `IntakeService`, persistence, caption-import dialog (FR-104.9), PWA units.

## Docs to consult

`src/state/services/intake.ts` header; `persistence.ts` picker doctrine (:170); `knowledge/design.md` buttons; docs-mcp `playwright` (filechooser / setInputFiles); `e2e/media/format-matrix.spec.ts` (fixture conventions).
