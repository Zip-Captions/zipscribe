import type { ReactNode } from 'react'

// FR-1.0.8: empty workbench shell — header bar + empty panels. Later units
// populate transcript / timeline / preview; the panels here are the labelled
// empty states only (no business logic in ui/**, per conventions).

export function WorkbenchShell(): ReactNode {
  return (
    <div data-testid="workbench-shell" className="zipscribe-shell">
      <header role="banner" className="zipscribe-header">
        <span className="zipscribe-brand">Zipscribe</span>
        <span data-testid="build-info" className="zipscribe-build">
          {__ZIP_VERSION__}
        </span>
        <span role="status" aria-live="polite" data-testid="job-status" className="zipscribe-status">
          No active jobs
        </span>
      </header>
      <main className="zipscribe-main">
        <section role="region" aria-label="Transcript (empty)" data-testid="panel-transcript">
          <p>Nothing transcribed yet. Import media to begin.</p>
        </section>
        <section role="region" aria-label="Preview (empty)" data-testid="panel-preview">
          <p>No media loaded.</p>
        </section>
        <section role="region" aria-label="Timeline (empty)" data-testid="panel-timeline">
          <p>No caption blocks yet.</p>
        </section>
      </main>
    </div>
  )
}
