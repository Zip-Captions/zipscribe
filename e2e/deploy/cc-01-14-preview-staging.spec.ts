// CC-01.14 [DEPLOY]: this unit's PR gets a preview URL comment; merging it
// deploys staging; smoke passes on both.
//
// Deferred for the overnight run: no Cloudflare Pages project and no
// `CLOUDFLARE_*` secrets exist yet (`.agent/overnight-pipeline.md` Adaptation 3).
// Authored as an explicit skip so traceability still resolves and the work is
// never silently dropped.
import { test } from '@playwright/test'

const REASON = 'awaiting Cloudflare credentials (see .agent/overnight-pipeline.md Adaptation 3)'

test.skip(`CC-01.14: PR preview URL comment + staging deploy + smoke pass on both — ${REASON}`, async ({ page }) => {
  // Implemented once `ci.yml`'s preview deploy job and `deploy-staging.yml`
  // exist and the owner has added the repo-level secrets.
  await page.goto(process.env.DEPLOY_URL ?? 'https://example.invalid')
})