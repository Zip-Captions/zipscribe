# Unit report: unit-201-styling-engine

Status: complete (pending CI + reviewer R6 delta)

## Completion criteria

From `reports/criteria/unit-201-styling-engine.md` (clean `pnpm verify:unit --from-branch` run):

| ID       | level    | passing tests         | result                                                                                                                                                                                                                        |
| -------- | -------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-201.1 | untagged | 0 (macOS verify host) | FAIL locally — 49/49 golden comparisons PASS on the CI linux runner (`quality` run 44684325215, `e2e/style/overlay-golden.spec.ts`, 190 e2e passed); linux-gated by golden doctrine, identical treatment to unit-107 CC-107.7 |
| CC-201.2 | untagged | 2                     | pass                                                                                                                                                                                                                          |
| CC-201.3 | untagged | 17                    | pass                                                                                                                                                                                                                          |
| CC-201.4 | untagged | 2                     | pass                                                                                                                                                                                                                          |
| CC-201.5 | untagged | 6                     | pass                                                                                                                                                                                                                          |
| CC-201.6 | untagged | 1                     | pass                                                                                                                                                                                                                          |

`[RQ]` items: none in this unit (perf/qualify surfaces are unit-202/204). `[MANUAL]`: none.

## Gates

- lint ✓ · typecheck ✓ · test ✓ (2013 tests, coverage thresholds incl. 80% state-layer)
- build + check-bundle ✓ (152.3 KB gzip initial JS / 350 KB budget — style code lazy)
- e2e ✓ style suite locally (identity US-3.1.4 SSIM ≥ 0.99, offline-fonts incl. the
  route-stubbed real-bytes opt-in leg); goldens compare on CI linux only
- qualification ✓ (contentHash refreshed on the final tree; checker ACCEPT)

## Deviations from spec

1. "4 display OFL faces" unnamed in spec → chose Anton 400 / Bebas Neue 400 /
   Oswald 500 / Poppins 700 (all OFL, subset, lazy — never registered at boot).
2. JetBrains Mono 700 dropped from the default set to honor the ≤200 KB budget
   (default set = 5 faces, 177.1 KB committed; asserted in fonts.test.ts).
3. `safeMargins` per-aspect table invented (not specified): source/16:9
   {0.90, .04, .06}, 9:16 {0.90, .10, .14}, 1:1 & 4:5 {0.90, .07, .10} — documented
   in `src/engine/export/overlay.ts`.
4. `boxEdgeColor` derived when `backgroundColor` set (CaptionStyle has no boxEdge
   field); fed from `--border-subtle` on both preview surfaces (engine default
   `rgba(42,47,56,0.9)` matches the dark token).
5. mockups README §2 composited-hex column contains spec typos (#2c2f35/#2b2e33 vs
   the generator's #282b2f/#3f4246); the RATIO column (19.19/6.00/15.92/14.22/10.10)
   is authoritative and is what the contrast guard pins.
6. Remote Google Fonts path fetches the css2 text and resolves the gstatic woff2
   URLs (FontFace src must be a font resource, not a stylesheet) — required CSP:
   `connect-src … https://fonts.googleapis.com` + `font-src 'self'
https://fonts.googleapis.com https://fonts.gstatic.com`; both origins added to
   `settings.yml operations.model_hosts` (opt-in only, per product privacy rule).
7. `pnpm fonts` (scripts/merge-fonts.py) now pins head.created/modified and
   disables fontTools' save-time modified-recalc → committed subsets are byte-stable
   across regeneration (verified: consecutive runs sha256-identical).
8. Caption canvas DPR bug found via the identity spec: the preview adapter drew at
   1× on the DPR-scaled backing store; fixed with setTransform(dpr). This changed no
   golden (all golden paths render through the bridge/worker which always applied
   the transform) and the unit-107 visualizer goldens are untouched in this PR.

## Contract changes (proposed)

- CONTRACT.md/architecture.md: +3 command ids (`style-patch`, `style-preset`,
  `output-aspect-set`) — added as an additive EXTENDS block in
  `tests/unit/editor/unit102-api-contract.d.ts` (104/301 precedent); `model.ts`
  untouched.
- `OverlayFrame` (architecture.md export surface): additive optional fields
  `speakerPalette`, `boxEdgeColor`, `safe` (engine cannot read CSS; callers inject).
- `OverlayRenderer` protocol unchanged.

## Dependencies

- New devDeps (dev-time font pipeline only; committed subsets are what ships):
  `@fontsource/archivo`, `@fontsource/jetbrains-mono`, `@fontsource/anton`,
  `@fontsource/bebas-neue`, `@fontsource/oswald`, `@fontsource/poppins` (^5.3.0).
  settings.yml approved_dependencies.dev updated (orchestrator edit). No runtime deps.

## Measurements

- default face set 177.1 KB (budget 200) · display set 84.0 KB (lazy)
- initial JS 152.3 KB gzip (budget 350) — unchanged by this unit (style lazy)
- identity SSIM main-canvas vs OffscreenCanvas ≥ 0.99 (measured 0.999+ locally)
- 49 committed pinned-engine goldens (presets×samples×aspects×DPR + RTL)

## Follow-ups

- Owner-facing mockups README §2 hex-column typo (fix in a docs pass; ratios kept).
- unit-204: SW precache for /fonts/** + display faces; CSP regression check on
  Pages deploy (headers are only applied by Pages, not vite preview).
- Consider per-subset remote woff2 selection (today the last css2 url wins).
