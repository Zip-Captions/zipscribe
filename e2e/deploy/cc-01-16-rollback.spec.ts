// CC-01.16 [DEPLOY]: a forced smoke failure on a throwaway production deploy
// (test hook) triggers an automatic rollback.
//
// Deferred for the overnight run: rollback needs a live production deployment
// and a redeployable previous release artifact; neither exists yet
// (`.agent/overnight-pipeline.md` Adaptation 3).
import { test } from '@playwright/test'

const REASON = 'awaiting Cloudflare credentials (see .agent/overnight-pipeline.md Adaptation 3)'

test.skip(`CC-01.16: forced smoke failure rolls production back automatically — ${REASON}`, async ({ page }) => {
  // Implemented once `deploy-production.yml` has the smoke hook and the
  // previous-release redeploy step.
  await page.goto(process.env.PRODUCTION_URL ?? 'https://example.invalid')
})