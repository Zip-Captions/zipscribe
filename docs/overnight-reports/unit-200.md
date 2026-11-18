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

none outside approved list (generator is scratch-only tooling).

## Measurements

53 SVG artifacts (24 preset renders, 4 contrast sheets, 15 export wireframes, 8 offline
wireframes, 3 icons). Contrast: min 10.10 (text), min 4.51 (non-text). All xmllint-clean;
geometry audit passes (no text outside canvas).

## Follow-ups

- Owner: answer the 5 open questions (karaoke highlight hue; broadcast-box box outline;
  karaoke optical-center margin; update-toast re-surface rule; T4 "Why?" expansion).
- unit-201: pwaAssets config consumes `icons/app-icon-512.svg`.
- unit-204: manifest `monochrome` entry points at the committed monochrome glyph.
- Consider committing the generator to `scripts/` if the owner wants mockups regenerated
  in CI (out of scope for a design pass; kept in `.night/` for now).
