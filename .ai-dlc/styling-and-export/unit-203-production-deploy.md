---
status: pending
discipline: devops
depends_on: [unit-202-export, caption-studio-ui/unit-106-persistence]
workflow: default
mode: AHOTL   # infra config, strong CI verification available
operations:
  - production-deploy
---

# Unit 203: Production Deploy & Ops (Cloudflare Pages)

## Description

Ship it: the git-flow CD pipeline from `knowledge/conventions.md` § CI/CD — static deployment to Cloudflare Pages via `wrangler` in GitHub Actions (preview per PR, **staging on every merge to `develop`**, **production on every release/hotfix merge to `main`**, automated release cutting, automatic rollback), `_headers`/`_redirects` caching + CSP for hashed assets, wasm, service worker and manifest, Lighthouse budgets in CI, versioned About + model-license attribution panel, error-reporting policy (content-free), release checklist. (Service worker, manifest and offline behaviour are built in unit-204; this unit serves them with the right headers.)

## User Stories

**US-3.3.1** As a team, code flows from our working branch to production automatically, with a qualified release in between.
- *Given* a PR, *when* CI completes, *then* a preview deploy URL + build hash + criteria table are posted as a PR comment and L7 smoke has run against the preview.
- *Given* a merge into `develop`, *when* CI is green, *then* staging (`develop.<project>.pages.dev`) is redeployed from that commit's tested artifact and L7 smoke (incl. a real model download through the allowlisted hosts) passes.
- *Given* "Start release" with version `X.Y.Z`, *when* run, *then* `release/X.Y.Z` is cut from `develop`, `package.json` bumped, `CHANGELOG.md` generated from conventional commits, and a PR into `main` opened; the PR auto-merges only when CI, RC-preview smoke and `qualification-check` are green.
- *Given* the release PR has auto-merged, *when* `deploy-production.yml` runs, *then* production is deployed, L7 smoke passes against production, tag `vX.Y.Z` + GitHub Release are created, and a back-merge PR `main → develop` is opened and auto-merged; *given* production smoke fails, *then* the previous release's artifact is redeployed automatically and an incident issue is opened.
- *Given* a `hotfix/X.Y.Z` PR into `main`, *when* merged, *then* the same production path runs (qualification limited to criteria the hotfix touches, recorded in the PR).

**US-3.3.2** (moved) Offline behaviour is specified in unit-204; this unit's deployed-header checks cover `sw.js` and the manifest.

**US-3.3.3** As a journalist, I can audit exactly what runs.
- *Given* About panel, *when* opened, *then* app version, engine tiers active, every model (repo, revision/SHA, license, attribution for CC-BY), library licenses list (generated), and the translation engine in use ("Browser built-in (Chrome)" or "Unavailable").
- *Given* a boot with no user action, *when* the request audit runs, *then* zero requests leave `self`; during model download only `settings.yml operations.model_hosts` origins appear (Playwright request audit test; opt-in fonts are the only other allowed origin, and only when enabled).

## Functional Requirements

- **FR-203.1** `public/_headers`: immutable cache for `/assets/*` (hashed), `no-cache` for `index.html`, `/sw.js` and `/manifest.webmanifest` (content-type `application/manifest+json`), `public, max-age=31536000, immutable` for versioned `/wasm/*` + font subsets. CSP built from `settings.yml operations.model_hosts`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://huggingface.co https://*.hf.co https://*.huggingface.co; img-src 'self' data: blob:; media-src 'self' blob:; manifest-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` — no CDN origins (wasm is self-hosted). Opt-in Google Fonts can't change a static header, so remote fonts are fetched only through `connect-src`-allowed origins **or** the opt-in is documented as unavailable under CSP — decide in this unit and record. Verify `'wasm-unsafe-eval'` and `'unsafe-inline'` (Tailwind/React inline styles) are actually required; remove whatever isn't.
- **FR-203.2** Harden the four workflows unit-01 created (`ci.yml`, `deploy-staging.yml`, `start-release.yml`, `deploy-production.yml` — conventions § CI/CD): swap the minimal smoke for the full L7 suite (FR-203.8) on preview, staging and production; add Lighthouse CI to preview + staging; add the `qualification-check` requirement on `release/*` (runner from unit-02); verify build-once/deploy-same-artifact and per-environment `concurrency`; confirm `wrangler pages deploy dist --project-name <project> --branch <branch>` with Pages production branch = `main`.
- **FR-203.8** L7 deploy smoke suite (`e2e/deploy/**`, runs against a URL from env): app boots, response headers + CSP match `_headers`, zero CSP violations, boot request audit, SW registers, manifest served, sample clip plays, About shows the deployed version/hash.
- **FR-203.3** Lighthouse CI (desktop) on every preview and staging deploy: a11y ≥ 95, best-practices ≥ 95, performance ≥ 85 (median of 3 runs on GitHub-hosted runners — performance is a regression signal there; absolute performance baselines live in release qualification). Budget failures block merge. Lighthouse no longer has a PWA category — installability is asserted by unit-204's CDP check instead.
- **FR-203.4** Version in About (build hash + app version); update UX itself is unit-204.
- **FR-203.5** Error policy (SECURITY-03): unhandled rejections → error-code queue surfaced in About "diagnostics" (local only); any future remote reporting = separate opt-in unit (product rule 2). Sentry deferred seed.
- **FR-203.6** Attribution build step: generate `licenses.json` (deps + model registry entries incl. CC-BY/`Verify`-status from `docs/spikes/model-eval-report.md`) → About panel data; license-check CI job fails on a new dependency without a license field or with an NC/GPL license in the runtime bundle.
- **FR-203.7** Release runbook (`docs/RELEASE.md`): git-flow release and hotfix steps, running `pnpm qualify` on reference hardware and committing `qualification/X.Y.Z.json`, manual-check sign-off, rollback (automatic + on-demand + Pages dashboard), SW kill switch (unit-204 FR-204.7), fixture regeneration cadence, model-registry refresh trigger (new spike).

## Completion Criteria

- [ ] **CC-203.1** `[DEPLOY]` Preview deploy + PR comment (URL, hash, criteria table) verified on this unit's PR
- [ ] **CC-203.2** `[DEPLOY]` Merge to `develop` redeploys staging and its L7 smoke passes
- [ ] **CC-203.3** `[DEPLOY]` Release PR is blocked by `qualification-check` without a qualification file and unblocked by a matching one (exercised on the next real release)
- [ ] **CC-203.4** `[DEPLOY]` Full L7 suite runs on preview, staging and production deploys; a forced production smoke failure (test hook) rolls back and opens an incident issue
- [ ] **CC-203.5** Boot request audit: zero non-self requests at boot; only `model_hosts` during download (test fails on any new third-party origin)
- [ ] **CC-203.6** `[DEPLOY]` Deployed CSP doesn't break: model download (incl. HF CDN redirect), workers, wasm, service worker registration — e2e against the preview URL with CSP-violation listener asserting zero violations
- [ ] **CC-203.7** `[DEPLOY]` Lighthouse budgets green on preview (CI job, thresholds per FR-203.3)
- [ ] **CC-203.8** `[DEPLOY]` `_headers` verified via deployed-header assertions (curl checks in CI against preview)
- [ ] **CC-203.9** About panel: model list matches registry with license + attribution; dependency license audit job green
- [ ] **CC-203.10** `[MANUAL]` Rollback rehearsed once, recorded in unit report

## Risks

- Cloudflare Pages asset size limits (25 MB/file) → wasm/model chunks checked in build (models are remote-cached anyway); verify during first deploy.
- CSP regressions block worker/blob behavior → request-audit + CSP violation report hook in About diagnostics during unit-203 verification period.

## Docs to consult

- Cloudflare Pages headers/deploy: https://developers.cloudflare.com/pages/ · wrangler GitHub Action · Lighthouse CI: https://github.com/GoogleChrome/lighthouse-ci
