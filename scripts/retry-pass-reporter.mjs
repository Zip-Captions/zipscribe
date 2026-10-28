// FR-1.0.12 — retry-pass detector (base reporter).
//
// A test that goes green only on its retry is a flake: knowledge/conventions.md
// § Coverage and flakiness says it "blocks merge". The reporter records every
// `onTestEnd` where a test ends *passed* on a retry attempt and fails the run.
export default class RetryPassReporter {
  retryPasses = []

  onTestEnd(test, result) {
    if (result.status === 'passed' && test.retry > 0) {
      this.retryPasses.push(`${test.titlePath().join(' › ')} (passed on retry #${test.retry})`)
    }
  }

  onEnd() {
    if (this.retryPasses.length === 0) return
    console.error('')
    console.error('CC-01.12 retry-pass guard: the following tests passed only on retry —')
    for (const line of this.retryPasses) console.error(`  ✘ ${line}`)
    console.error('flake policy (conventions § Coverage and flakiness): fix or quarantine; a retry-pass fails the run.')
    // Playwright sets the process exit code after reporters finish; the guard
    // must be decisive here.
    process.exit(1)
  }
}
