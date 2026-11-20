# Bundled font faces (FR-201.4)

Committed OFL subsets materialized by `scripts/copy-fonts.ts` from
`@fontsource/*` devDependencies (regenerate: `corepack pnpm fonts`).
`default/` is registered at app boot (≤ 200 KB budget, asserted in
`tests/unit/style/fonts.test.ts`); `display/` is lazy-loaded on demand.
License texts (SIL Open Font License 1.1) are in `licenses/` — the OFL
requires them to accompany these redistributed subsets.
