// CC-01.15 [DEPLOY]: the first release `0.1.0` is cut via "Start release",
// merged to `main`, deployed to production, tagged, and back-merged into
// `develop` (qualification file = unit-01 scope only: gates + smoke).
//
// Deferred for the overnight run: no Cloudflare Pages project, no GitHub
// Environments and no `CLOUDFLARE_*` secrets exist yet
// (`.agent/overnight-pipeline.md` Adaptation 3).
import { test } from '@playwright/test'

const REASON = 'awaiting Cloudflare credentials (see .agent/overnight-pipeline.md Adaptation 3)'

test.skip(`CC-01.15: 0.1.0 release → production deploy → tag → back-merge — ${REASON}`, async ({ page }) => {
  // Implemented once `start-release.yml` and `deploy-production.yml` exist and
  // the owner has added the repo-level secrets.
  await page.goto(process.env.PRODUCTION_URL ?? 'https://example.invalid')
})