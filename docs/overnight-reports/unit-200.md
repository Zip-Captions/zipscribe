# Unit report: unit-200-style-export-offline-design

Status: complete (all criteria `[MANUAL]`; owner review is the remaining human gate — CC-200.5)

## Completion criteria

| ID       | tag        | artifact                                                                                                                                                                                                                                                                                          | result                                                                                                          |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| CC-200.1 | `[MANUAL]` | `mockups/presets/` 24 renders (4 presets × {16:9, 9:16} × {short, long, wrapped}) + complete `CaptionStyle` tables in `mockups/README.md` §1 (every interface field, no gaps)                                                                                                                     | built — awaiting owner                                                                                          |
| CC-200.2 | `[MANUAL]` | `mockups/export/` 15 wireframes: T1/T2 defaults, T3/T4 sidecars-only (burn-in **absent from DOM**), audio-project dialog, tracks/stale chips, burn-in progress+cancel, sidecar run, success download, success FS-saved, coded failure, edits-after-start, stage spectrum/waveform-paused/pre-play | built — awaiting owner                                                                                          |
| CC-200.3 | `[MANUAL]` | `mockups/offline/` 8 wireframes (chip+tooltip, models panel w/ honest persist result, install ×3, update toast, `OFFLINE_MODEL_MISSING`, OS file-open) + `mockups/icons/` base/maskable/monochrome SVG sources for `@vite-pwa/assets-generator`                                                   | built — awaiting owner                                                                                          |
| CC-200.4 | `[MANUAL]` | WCAG math in `mockups/README.md` §2 + `mockups/contrast/*.svg` sheets: min text ratio 10.10 (broadcast-box/white), highlight 6.00 (karaoke), all non-text pairs ≥ 4.5                                                                                                                             | math passes — visual sign-off awaiting owner                                                                    |
| CC-200.5 | `[MANUAL]` | owner review record                                                                                                                                                                                                                                                                               | **PENDING** — 5 open questions listed in `mockups/README.md` § Open questions; gate for units 201/202/204 start |

## Gates

spec-lint ✓ | format:check ✓ (also fixed missed prettier on intent-1-closure-suite.md) |
lint/typecheck/test ✓ (CI quality, 38m9s — no src touched) | fixtures-verify ✓ |
preview-deploy ✓ | qualification: untouched (no `src/**`, `public/**`, `models/**` bytes).
PR #23 → squash `f242b4a`, CI run 44380539185.

## Deviations from spec

- Renders are SVG (committed, deterministic) not PNG screenshots: no production code was
  allowed, so there is no app to screenshot; the scratch generator (`.night/gen200/`,
  gitignored) renders from the README tables byte-for-byte.
- `marginVPct` semantics for `position: 'center'` pinned by this pass as block-top inset
  (open question 3 for owner).
- Added caption **fit rules** (shrink-to-fit 40 % floor → line growth to cap 5 → never
  clip; `TOO_MUCH_TEXT` QC link) — needed to make the long/wrapped renders well-defined.
  Recorded in `knowledge/design.md` § Intent 3 surfaces.

## Contract changes

none (CaptionStyle used verbatim; fit rules are renderer behavior, not contract types).

## Dependencies

@fontsource/inter (devDependency; design tooling — Inter subset embedding in mockup SVGs via gitignored .night generators; added to settings.yml approved_dependencies.dev by the orchestrator 2026-11-19; fontTools used via system python, not a package dep).

## Measurements

55 SVG artifacts (24 preset renders, 4 contrast sheets, 16 export wireframes, 8 offline
wireframes, 3 icons). Contrast: min 10.10 (text), min 4.51 (non-text). All xmllint-clean;
geometry audit passes (no text outside canvas).

## Follow-ups

- Owner: answer the 5 open questions (karaoke highlight hue; broadcast-box box outline;
  karaoke optical-center margin; update-toast re-surface rule; T4 "Why?" expansion).
- unit-201: pwaAssets config consumes `icons/app-icon-512.svg`.
- unit-204: manifest `monochrome` entry points at the committed monochrome glyph.
- Consider committing the generator to `scripts/` if the owner wants mockups regenerated
  in CI (out of scope for a design pass; kept in `.night/` for now).

## Design revision 1 — broadcast-box caption container (PR #25 → ffa8f9c, 2026-11-18)

Owner flagged `contrast/broadcast-box.svg`: glyphs overflowed the rounded box
(padding ignored the corner arcs). Regenerated all affected artifacts:

- **Boxes size from a worst-case bold width model** (0.72 em/char — covers
  Inter/SF Bold in any viewer) and pad each side `max(0.55em, rx + 0.35em)`,
  so glyphs always clear the corner arcs — the box may look roomier than the
  preview font; it is sized for YOUR font.
- Contrast-sheet box corner radius was a fixed 6 on a ~13 px pill (corners
  bit into the glyph band) → `min(6, 0.30 × boxH)`; box height 1.8 → 2.05 em
  (descender clearance).
- Caption fit for boxed presets now wraps at a box-aware budget, keeping the
  whole box inside the frame at full font size (16x9-long stays at fs 15.1).
- Incidental render accuracy: weight-aware word metrics (bold 0.62 em, caps
  +0.08) — bold-active word no longer collides with its successor.
- Verification: chromium pixel audit (glyph ink vs rounded-corner geometry +
  box-vs-frame containment) 8/8 pairs, 0 violations; xmllint clean.

Re-review focus for CC-200.5: `mockups/presets/broadcast-box/*` (6 renders)
and `mockups/contrast/broadcast-box.svg`. Nothing else moved except
bold-word spacing in karaoke/bold-lower renders (accuracy fix). The 5 open
questions in `mockups/README.md` § Open questions still await answers.

## Review page (2026-11-19)

`mockups/review.html` — self-contained on-screen review wrapper (all 55 SVGs inlined,
spec chips, zoom/theme/font controls, WCAG table, open-question answer boxes +
CC-200.5 sign-off block persisted in the browser). Chromium-verified: 57→58 inlined SVGs (58 after t4-why-expanded)
(icons shown dark+light), 54 artifact figures, no console errors, deterministic
regeneration. Recommended way to do the CC-200.5 pass.

## Design revision 2 — owner round-2 + CC-200.5 decisions (2026-11-19)

Owner round-2 feedback (all three reports were real defects, now fixed): karaoke
9x16-long clipped (worst-case width model for wrap/shrink; never-clip outranks the
40 % floor in mockups — app spec per README §1 unchanged); broadcast-box uneven
word spacing (lines are now single <text> + <tspan> with natural font spacing);
wireframe element overlaps (T1/T2 SRT-vs-Track rows, T3/T4/audio stale-chip vs
notes, offline tooltip re-anchored under the Offline chip w/ pointer, plus
success-saved-fsa note, Safari instructions, 'not cached' chip — found by the new
overlap probe). Every text-bearing artifact now embeds the production Inter latin
subset (@fontsource/inter 400/700 via fontTools) as data: @font-face — mockups render in the production UI font (mono timecode labels aside).

CC-200.5 decisions (owner, same day): karaoke highlight keeps accent blue with ALL
colors as theme palette tokens (dark/light-switcher-proof); broadcast box gains a
1 px border-subtle edge; karaoke marginVPct 45 (optical center); update toast
re-surfaces once per session; T4 “Why?” expanded state shown
(export/t4-why-expanded.svg). Contract proposal for knowledge/design.md palette:
add tokens gold #ffd166 and text-on-solid #ffffff; caption colors map to existing
tokens (bg-app outline, bg-panel box, border-subtle edge, accent highlight).

Gates this round: geometry audit 0 violations; overlap probe 0 across 51+ wires;
verify-review incl. README-vs-page decisions parity; xmllint clean.
