# unit-200 design pass — Style, Export & Offline mockups

Design-pass output for units **201** (styling), **202** (export), **204** (PWA/offline).
Every file here is an acceptance reference: builders implement *to these*, and owners
review *these* (CC-200.5). Visual language follows `knowledge/design.md`
(Dense/Utilitarian dark workbench; tokens below are the only colors used).

Layout convention: preset renders and preview-stage renders are canvas-only (app chrome
is already specified in `knowledge/design.md` and proven by intent-2 suites); dialog
wireframes show the dialog on a dimmed workbench.

## 1. Preset library (`presets/`, `contrast/`) — CC-200.1

Four presets, every `CaptionStyle` field explicit (interface in
`knowledge/architecture.md`). Missing keys are not allowed — a preset row with no value
is a spec bug.

| field | karaoke | broadcast-box | bold-lower | minimal |
|---|---|---|---|---|
| `fontFamily` | Inter | Inter | Inter | Inter |
| `fontWeight` | 700 | 700 | 700 | 400 |
| `fontSizePct` | 7.0 | 4.2 | 5.2 | 4.0 |
| `textTransform` | uppercase | none | lowercase | none |
| `color` | `#ffffff` | `#ffffff` | `#ffffff` | `#e8eaed` |
| `highlightColor` | `#4c8dff` | `#ffd166` | `#ffffff` | `#e8eaed` |
| `outlineColor` | `#0d0f12` | `#0d0f12` | `#0d0f12` | `#0d0f12` |
| `outlineWidth` | 3 | 0 | 2 | 1.5 |
| `backgroundColor` | — | `#15181d` | — | — |
| `backgroundOpacity` | 0 | 0.82 | 0 | 0 |
| `boxEdge` | — | 1 px `border-subtle` @ 90 % | — | — |
| `position` | center | bottom | bottom | bottom |
| `marginVPct` | 45 | 6 | 8 | 5 |
| `alignment` | center | center | center | center |
| `maxLinesPerBlock` | 2 | 3 | 2 | 3 |
| `highlightMode` | karaoke | none | bold-active | none |
| `showSpeakerBar` | false | true | false | false |
| `animationPreset` | — (none in v1) | — | — | — |

`outlineWidth` unit: px at 1080p canvas height (scales with canvas height, not font size).
`marginVPct` is the block edge inset from the frame edge in % of canvas height; for
`position: 'center'` it places the block's **vertical center** on that % of canvas
height (karaoke hero at 45 % = optically centered, owner decision 2026-11-19).
Caption colors are **palette tokens only** (owner decision 2026-11-19, dark/light-theme
proof): `outlineColor` = `--bg-app`, `backgroundColor` = `--bg-panel`, `boxEdge` =
`--border-subtle`, `highlightColor` = `--accent` (karaoke) / `--gold` (broadcast box),
text = `--text-primary` / solid-on-accent `#ffffff`. No ad-hoc CSS overrides.

Renders — each preset × `{16x9, 9x16}` × `{short, long, wrapped}` samples, on a
mid-grey `#808080` frame (worst case for both dark and light text):
`presets/<preset>/<aspect>-<sample>.svg`. The highlighted word visible in karaoke /
bold-lower renders is the **active-word snapshot** at a word boundary (word index 2 of
the block) — not an animation frame.

### Layout / fit rules (binding for the overlay renderer, unit-201)

1. Text wraps inside `maxLinesPerBlock`, respecting explicit `\n` line breaks first.
2. If wrapped text still overflows the 90% safe width, font size shrinks proportionally
   down to **40 % of `fontSizePct`**.
3. Below that floor the block **grows line count** up to a hard cap of 5 lines.
4. The renderer never clips caption text and never truncates with ellipsis — if even
   the cap overflows (pathological input), it renders at the floor size with the cap
   line count and QC raises a `TOO_MUCH_TEXT` issue (unit-104 code family).
5. `highlightMode: 'bold-active'` changes weight (700 → 900), not color — hence
   `highlightColor` equals `color` in bold-lower/minimal.
6. Karaoke highlight is a solid color swap (`highlightColor`), no gradient, no motion
   (reduced-motion safe by construction).
7. Speaker bar (`showSpeakerBar`) is an 8 px (at 1080p) rounded bar at the block-box
   left edge in the block's speaker color from `--speaker-palette`.

## 2. Contrast check — CC-200.4

WCAG relative-luminance ratios, computed from the exact hex values above. Method:
outlined text (no box) is measured as `text vs outlineColor` plus the non-text pair
`outlineColor vs frame ≥ 3:1` (the outline is what separates text from frame content);
boxed text is measured as `text vs box composited over frame`. Sheets per preset in
`contrast/<preset>.svg` (mid-grey + white frames).

| preset | frame | text pair | ratio | AA 4.5 |
|---|---|---|---|---|
| karaoke | mid-grey | white vs `#0d0f12` | 19.19 | ✓ |
| karaoke | mid-grey | highlight `#4c8dff` vs `#0d0f12` | 6.00 | ✓ |
| karaoke | white | outline vs frame | 19.19 | ✓ (non-text) |
| broadcast-box | mid-grey | white vs box-over-frame `#2c2f35` | 14.22 | ✓ |
| broadcast-box | white | white vs box-over-frame `#2b2e33` | 10.10 | ✓ |
| bold-lower | mid-grey | white vs `#0d0f12` | 19.19 | ✓ |
| bold-lower | white | outline vs frame | 19.19 | ✓ (non-text) |
| minimal | mid-grey | `#e8eaed` vs `#0d0f12` | 15.92 | ✓ |
| minimal | white | outline vs frame | 19.19 | ✓ (non-text) |

No pair falls below 4.5:1; all non-text separation pairs ≥ 3:1. Owner review confirms
visual judgement (WCAG math is necessary, not sufficient — CC-200.4 is `[MANUAL]`).

## 3. Export dialog (`export/`) — CC-200.2

Capability tiers are the ones in `knowledge/architecture.md` / unit-03 (T1 WebGPU+full
WebCodecs, T2 no-WebGPU Chromium with WebCodecs, T3 webkit without AudioEncoder, T4 no
WebCodecs).

| file | state | acceptance |
|---|---|---|
| `t1-default.svg` | T1 full dialog: burn-in enabled + sidecars + tracks | unit-202 primary path |
| `t2-default.svg` | T2: burn-in offered, honest "CPU-bound" hint | gating keys off WebCodecs encoders, not GPU |
| `t3-sidecars-only.svg` | T3: MP4 section **absent from DOM** (CC-I3.4) | e2e asserts the row does not exist |
| `t4-sidecars-only.svg` | T4: same absence + plain-language reason row | no transcript text in reason (SECURITY-03) |
| `t4-why-expanded.svg` | T4 reason row expanded via “Why?” (active link + detail panel) | static local text; capability not setting; sidecars unaffected; no transcript text (SECURITY-03) |
| `t1-audio-project.svg` | audio project on any tier: no burn-in anywhere (CC-I3.5) | aspect selector hidden here and in Style tab |
| `tracks-selection.svg` | source + translation radios, `edited`/`stale` chips | one track per run; stale = sourceHash mismatch |
| `burnin-progress-cancel.svg` | progress strip Demux→Decode→Composite→Encode→Mux, frame ticker, cancel confirm | progress from encoded pts, never playhead; partial file never written |
| `sidecar-progress.svg` | sidecar run: per-file checklist, no fake progress bar | completes sub-second; no bar theatre |
| `success-download.svg` | download card (no FSA handle) | duration line mirrors ± 1 s criterion |
| `success-saved-fsa.svg` | "Saved to …" card + remembered folder | File System Access path; handle in IDB |
| `failure.svg` | coded error `EXPORT_ENCODE_FAILED`, Retry + sidecar fallback | code + numbers only, no transcript |
| `edits-after-start.svg` | in-progress note: snapshot semantics, "cancel & re-run" guidance | project snapshot at Export press |
| `stage-spectrum-playing.svg` | audio preview stage: spectrum, playing, speaker tint | matches unit-107 stage spec, same overlay |
| `stage-waveform-paused.svg` | waveform mode, paused frame at 40 % opacity | reduced-motion: 4 Hz |
| `stage-preplay.svg` | pre-play flat baseline + "Press Space to play" | decorative, `aria-hidden` |

Dialog invariants: formats are checkboxes (multi-select), track is a radio
(single-select); the footer button label adapts (`Export` / `Export sidecars` / `Done`
/ `Close`); no export ever leaves the device (stated in the footer note).

## 4. Offline & install surfaces (`offline/`, `icons/`) — CC-200.3

| file | surface | acceptance |
|---|---|---|
| `offline-chip-tooltip.svg` | `Offline` chip + honest can/cannot tooltip | shown on `!navigator.onLine` **or** model-host request failure |
| `models-panel.svg` | Offline models: list, sizes, total estimate, Make available / Remove, persist result | ⋯ menu → panel; persist result displayed as returned, never aspirational |
| `install-chromium.svg` | ⋯ menu "Install app…" when `beforeinstallprompt` fired | launches native prompt |
| `install-safari.svg` | ⋯ menu → step-by-step instructions | no fake install button on WebKit |
| `install-installed.svg` | already-installed state | item disabled as "Installed ✓" in standalone |
| `update-toast.svg` | "New version ready — Reload" | only after autosave flushed; never auto-reloads (`registerType:'prompt'`); “Later” dismisses per session, toast **re-surfaces once on next launch** until reloaded (owner decision 2026-11-19) |
| `transcribe-offline-missing.svg` | popover fails fast `OFFLINE_MODEL_MISSING` | Start disabled, code + modelId only, no network attempt |
| `os-file-open.svg` | installed PWA OS file-open lands in import drop zone | manifest `file_handlers` covers media + `.zipscribe.json` |
| `icons/app-icon-512.svg` | base icon "any" (1024/512 source) | input for `@vite-pwa/assets-generator` |
| `icons/app-icon-maskable-512.svg` | maskable (glyph in 80 % safe zone, solid tile) | `purpose: maskable` entry |
| `icons/app-icon-monochrome-512.svg` | monochrome single-color glyph | `purpose: monochrome` entry (Chromium) |

Icon concept: three caption bars (bottom one short, like a truncated line) + the zip
chevron, accent `#4c8dff` on `--bg-app`. The generator spec (`pwaAssets` config) consumes
`app-icon-512.svg` as the single source; maskable/monochrome are committed as the
hand-tuned variants because auto-padding cannot keep the caption bars inside the safe
zone.

## Owner decisions (CC-200.5, 2026-11-19)

1. Karaoke `highlightColor` = accent blue `#4c8dff` — **Decision: keep the app
   accent**, and every mockup/app color comes from the theme palette tokens only
   (no custom CSS overrides) so a dark/light theme switcher can drive them later.
2. Broadcast box edge over white-frame content — **Decision: 1 px outline on the
   box rect** (`--border-subtle` @ 90 %), not on the text. Applied to mockups.
3. Karaoke `marginVPct` — **Decision: 45**, block vertically centered on the 45 %
   line (optically centered for shorts). Applied to mockups.
4. Update toast “Later” — **Decision: re-surface once per session**; next launch
   shows it again until the update is reloaded. Never auto-reloads.
5. T4 reason row “Why?” — **Decision: expanded state is shown** —
   `export/t4-why-expanded.svg` (static local text: missing WebCodecs AudioEncoder,
   browser capability not a setting, sidecars unaffected, check is local).

## Review page

`review.html` — self-contained on-screen review wrapper: all 55 SVGs inlined with
preset spec chips, zoom / page-theme / font controls, WCAG table, the open questions
with answer boxes and a CC-200.5 sign-off block (state saved per browser via
localStorage). Open it directly in a browser; it is generated from this README + the
SVG files by the same scratch generator (`gen-review.mjs`) and is not the source of
truth. Artifacts embed a subsetting of the production Inter (latin subset of
`@fontsource/inter`, 400/700) as a `data:` `@font-face`, so they render in the
production font in any browser; the page's font toggle switches to system fallback.

## Provenance

Generated deterministically by a scratch generator (`.night/gen200/`, gitignored) from
the tables in this README; re-running it reproduces these files byte-for-byte. Text
sizes in preset renders use the fit rules of §1 (mock text is the same three samples
across all presets). Fonts: every text-bearing artifact embeds the production-Inter
latin subset (400/700, from `@fontsource/inter`, subsetting via fontTools) as a
`data:` `@font-face` — mockups now render exactly as the app will, no local font
install needed (production ships the same subset per `knowledge/design.md`).
Mockup fits guarantee zero clipping (the shrink loop may go below the §1 40 % floor
for pathological samples; the app renderer keeps the floor + `TOO_MUCH_TEXT` QC per §1).
