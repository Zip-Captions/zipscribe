// Trust policy for Playwright JUnit evidence (unit-03 adversarial finding 1).
//
// verify-criteria.ts credits e2e-sourced criteria (e.g. CC-03.3) from the
// Playwright JUnit report. A junit file only counts when ALL of:
//   (a) it was wiped before the spawn — a pre-existing file can never count,
//   (b) the spawned playwright run exited 0, and
//   (c) the file exists and was modified during the spawn window
//       (recorded mtime vs. spawn start).
// spawnSync kill/null status, timeout, or a nonzero child exit therefore
// yield ZERO e2e-sourced credit — no partial trust. This mirrors the
// unit-02 spawn-null doctrine (`scripts/qualify.ts` readQualifyResults,
// commit eb61046): results on disk after a run that did not complete belong
// to whoever wrote them, not to this verification.
//
// The policy is injected with a `spawn` function so the distrust rules are
// unit-testable without booting Playwright (tests/unit/scaffold/
// verify-criteria-junit-distrust.test.ts).

import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'

export interface TestCase {
  title: string
  status: 'passed' | 'failed' | 'skipped'
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Lenient JUnit <testcase> reader (vitest + Playwright reporters). */
export function parseJunit(file: string): TestCase[] {
  if (!existsSync(file)) return []
  const xml = readFileSync(file, 'utf8')
  const cases: TestCase[] = []
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = match[1] ?? ''
    const body = match[2] ?? ''
    const nameMatch = attrs.match(/(?:^|\s)name="([^"]*)"/)
    const statusMatch = attrs.match(/(?:^|\s)status="([^"]*)"/)
    const title = decodeEntities(nameMatch?.[1] ?? '')
    let status: TestCase['status'] = 'passed'
    if (/<(failure|error)\b/.test(body) || statusMatch?.[1] === 'unexpected') status = 'failed'
    else if (/<skipped\b/.test(body) || statusMatch?.[1] === 'skipped') status = 'skipped'
    cases.push({ title, status })
  }
  return cases
}

export interface PlaywrightOutcome {
  /** spawnSync status: number exit code, or null when the process was killed, timed out, or failed to spawn. */
  status: number | null
  output: string
}

export type PlaywrightSpawner = (junitFile: string) => PlaywrightOutcome

/** Filesystem mtime granularity/clock-skew allowance for the freshness window. */
export const JUNIT_FRESHNESS_TOLERANCE_MS = 2_000

export interface PlaywrightEvidence {
  cases: TestCase[]
  /** Null when `cases` is trustworthy; a human-readable rejection reason otherwise. */
  failure: string | null
}

export interface PlaywrightEvidenceOptions {
  /** JUnit path handed to the spawn (inside a fresh temp dir). */
  tmpJunitFile: string
  /** Persistent fallback path (repo `test-results/junit.xml`) — the planted-result attack surface. */
  persistentJunitFile: string
  spawn: PlaywrightSpawner
  parse: (file: string) => TestCase[]
  now?: () => number
}

export function collectPlaywrightEvidence(opts: PlaywrightEvidenceOptions): PlaywrightEvidence {
  // (a) Freshness wipe BEFORE the spawn: a file that existed when
  // verification started was not produced by this run, whoever wrote it.
  rmSync(opts.tmpJunitFile, { force: true })
  rmSync(opts.persistentJunitFile, { force: true })

  const startedMs = (opts.now ?? Date.now)()
  const outcome = opts.spawn(opts.tmpJunitFile)

  // (c) spawn-null / timeout / nonzero exit → zero e2e-sourced credit. A
  // killed or failed spawn leaves whatever the disk already held (or a
  // partially written report); a failing child's junit describes a failing
  // suite, not a green gate. Neither is partially trusted.
  if (outcome.status === null) {
    return { cases: [], failure: 'playwright did not complete (spawn failed, killed, or timed out) — junit results distrusted, zero e2e credit' }
  }
  if (outcome.status !== 0) {
    return { cases: [], failure: `playwright exited ${outcome.status} — zero e2e credit (a failing run's junit is not gate evidence)` }
  }

  // (b) Accept junit only if it exists AND was modified during the spawn
  // window. The wipe above removed pre-existing candidates; mtime-vs-spawn-
  // start additionally rejects a file re-created with a back-dated mtime.
  const fresh = (file: string): boolean => {
    try {
      return statSync(file).mtimeMs >= startedMs - JUNIT_FRESHNESS_TOLERANCE_MS
    } catch {
      return false
    }
  }
  const cases: TestCase[] = []
  for (const file of [opts.tmpJunitFile, opts.persistentJunitFile]) {
    if (fresh(file)) cases.push(...opts.parse(file))
  }
  if (cases.length === 0) {
    return { cases: [], failure: 'playwright exited 0 but wrote no fresh JUnit results in the spawn window — zero e2e credit' }
  }
  return { cases, failure: null }
}
