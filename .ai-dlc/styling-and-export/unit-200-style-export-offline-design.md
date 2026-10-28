---
status: pending
discipline: design
depends_on: [caption-studio-ui/unit-101-workbench-shell]
workflow: default
mode: HITL   # visual judgement; owner reviews each artifact
---

# Unit 200: Style, Export & Offline — Design Pass

## Description

Design-pass output that the dev units build against: the four caption presets, overlay render tokens, the export dialog (formats × tracks × capability tiers), and the offline/install surfaces (offline chip, Offline models panel, install entry, update toast, OS file-open). Uses the project's Dense/Utilitarian dark-workbench direction (`knowledge/design.md`). Outputs are wireframes/mockups committed under `.ai-dlc/styling-and-export/mockups/` and referenced by units 201, 202, 204 as acceptance references.

## User Stories

**US-200.1** As a builder of unit-201, I have an unambiguous visual target for each preset.
- *Given* the preset spec, *when* read, *then* each preset defines every `CaptionStyle` field value (font, weight, size %, transform, colors incl. `highlightColor`, outline, box, position, margins, max lines, highlight mode, speaker bar) and shows 16:9 and 9:16 renders of a short, long and wrapped caption.

**US-200.2** As a builder of unit-202, I know every state of the export dialog.
- *Given* the dialog spec, *when* read, *then* it covers T1/T2/T3/T4 option sets, the audio-project dialog (sidecars only, no burn-in anywhere), the audio visualizer stage (spectrum + waveform modes, paused/pre-play states, speaker tint), track/language selection, progress, cancel, success (download / saved), failure, and "edits after export started don't affect it" messaging.

**US-200.3** As a builder of unit-204, I know how offline and install look.
- *Given* the offline spec, *when* read, *then* it covers: offline chip + tooltip, Offline models panel (list, sizes, storage estimate, make-available / remove, persist-storage result), Install entry (Chromium prompt vs Safari instructions vs already-installed), update-available toast, `OFFLINE_MODEL_MISSING` state in the transcribe popover, and app icon set (any + maskable + monochrome-friendly).

## Completion Criteria

- [ ] **CC-200.1** `[MANUAL]` Preset spec with complete `CaptionStyle` values for 4 presets + mockups (16:9, 9:16)
- [ ] **CC-200.2** `[MANUAL]` Export dialog wireframes for every tier and state above
- [ ] **CC-200.3** `[MANUAL]` Offline/install wireframes for every state above + icon set source (SVG) for `@vite-pwa/assets-generator`
- [ ] **CC-200.4** `[MANUAL]` Contrast check: every preset's text vs box/outline meets WCAG AA 4.5:1 on a mid-grey and a white frame
- [ ] **CC-200.5** `[MANUAL]` Owner review recorded before the intent advances to the dev pass

## Boundaries

- No production code. Token additions go into `knowledge/design.md` via the orchestrator.
