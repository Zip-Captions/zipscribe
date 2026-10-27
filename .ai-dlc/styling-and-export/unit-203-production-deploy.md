---
status: pending
discipline: operations
depends_on: [unit-202-export, caption-studio-ui/unit-106-persistence]
workflow: default
mode: AHOTL   # infra config, strong CI verification available
operations:
  - production-deploy
---

# Unit 203: Production Deploy & Ops (Cloudflare Pages)

## Description

Ship it: static deployment to Cloudflare Pages via `wrangler` in GitHub Actions (preview per PR, production on `main`), `_headers`/`_redirects` caching strategy for hashed assets + wasm, Lighthouse budgets in CI, offline app shell, versioned About + model-license attribution panel, error-reporting policy (content-free), release checklist.

## User Stories

**US-3.3.1** As a team, every merge is verifiable in prod-like conditions.
- *Given* a PR, *when* CI completes, *then* preview deploy URL posted as PR comment with build hash; *given* push to `main`, *when* CI green, *then* production deploy with version tag; rollback = revert-redeploy documented + rehearsed once (record in unit report).

**US-3.3.2** As a user on a train, the app still works if I have my models.
- *Given* visited once + models cached, *when* reload offline, *then* shell + editor + cached-model transcription available (service-worker precache of app shell; **no** background model prefetch — privacy + bandwidth), status chip shows offline honestly.

**US-3.3.3** As a journalist, I can audit exactly what runs.
- *Given* About panel, *when* opened, *then* app version, engine tiers active, every model (repo, revision/SHA, license, attribution for CC-BY), library licenses list (generated), zero third-party requests at boot except opt-in fonts (Playwright request audit test — allowlist `huggingface.co` only during model download).

## Functional Requirements

- **FR-203.1** `public/_headers`: immutable cache for `/assets/*` (hashed), `no-cache` for `index.html`, `public, max-age=31536000, immutable` for `/wasm/*` + font subsets; CSP: `default-src 'self'; worker-src 'self' blob:; connect-src 'self' https://huggingface.co https://cdn.jsdelivr.net; img-src 'self' data: blob:; media-src 'self' blob:;` (opt-in fonts widen `style-src`/`font-src` only then).
- **FR-203.2** CI deploy jobs: `wrangler pages deploy` with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` secrets; preview comment via Pages; branch protection requires gates (settings.yml) before merge.
- **FR-203.3** Lighthouse CI on preview (desktop): a11y ≥ 95, best-practices ≥ 95, performance ≥ 85 (perf on stable fixture run, self-hosted runner; budget failures block `main` merge).
- **FR-203.4** Version + update UX: build hash in About; SW update-available toast with reload action; no forced reload mid-project.
- **FR-203.5** Error policy (SECURITY-03): unhandled rejections → error-code queue surfaced in About "diagnostics" (local only); any future remote reporting = separate opt-in unit (product rule 2). Sentry deferred seed.
- **FR-203.6** Attribution build step: generate `licenses.json` (deps + model registry entries incl. CC-BY/`Verify`-status from spike report) → About panel data; license-check CI job fails on new dependency without license field.
- **FR-203.7** Release checklist doc (`docs/RELEASE.md`): gate runbook, rollback, fixture regeneration cadence, model-registry refresh trigger (new spike).

## Completion Criteria

- [ ] Preview deploy + PR comment verified on unit PR; production deploy from `main` with version tag
- [ ] Offline reload with cached models works (playwright `context.setOffline`)
- [ ] Boot request audit: only allowlist hosts (test fails on any new third-party origin)
- [ ] Lighthouse budgets green on preview (CI job, thresholds per FR-203.3)
- [ ] `_headers` verified via deployed-header assertions (curl checks in CI against preview)
- [ ] About panel: model list matches registry with license + attribution; dependency license audit job green
- [ ] Rollback rehearsed once, recorded in unit report

## Risks

- Cloudflare Pages asset size limits (25 MB/file) → wasm/model chunks checked in build (models are remote-cached anyway); verify during first deploy.
- CSP regressions block worker/blob behavior → request-audit + CSP violation report hook in About diagnostics during unit-203 verification period.

## Docs to consult

- Cloudflare Pages headers/deploy: https://developers.cloudflare.com/pages/ · wrangler GitHub Action · Lighthouse CI: https://github.com/GoogleChrome/lighthouse-ci
