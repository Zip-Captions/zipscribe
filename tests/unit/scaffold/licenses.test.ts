// CC-01.7: fixtures stay inside the repo budget and every source is licensed.
//
// Contract: US-1.0.2 ("Given any fixture missing its license record, when CI
// `fixtures-verify` runs, then it fails"), § Technical Specification
// ("committed fixtures ≤ 50 MB total … licenses in `fixtures/LICENSES.md`"),
// and `knowledge/conventions.md` § Test data (≤ 50 MB total).
import { execFileSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { exists, readJson, readText, totalBytes, walkFiles } from '../../helpers/repo'

/**
 * Committed files under `dir` (git truth), intersected with the on-disk walk
 * for byte accounting. walkFiles() sees the DISK: generated, gitignored setup
 * artifacts (e.g. `pnpm fixtures --perf`'s audio-120min.mp4) legitimately sit
 * there and must not count against the CC-01.7 COMMITTED budget or trip the
 * "never committed" assertion — the criterion says "committed fixtures ≤ 50 MB".
 */
function committedFiles(dir: string): string[] {
  const tracked = new Set(execFileSync('git', ['ls-files', dir], { encoding: 'utf8' }).split('\n').filter(Boolean))
  return walkFiles(dir).filter((file) => tracked.has(file))
}

const FIXTURE_BUDGET_BYTES = 50 * 1024 * 1024
const URL_PATTERN = /https?:\/\/\S+/

interface ManifestEntry {
  license: string
  generated: boolean
}

describe('CC-01.7: fixture budget and licensing', () => {
  test('CC-01.7: committed files under fixtures/ total at most 50 MB', () => {
    const files = committedFiles('fixtures')
    const bytes = totalBytes(files)
    const mb = bytes / (1024 * 1024)
    expect(files.length, 'fixtures/ is empty — nothing is committed yet').toBeGreaterThan(0)
    expect(mb, `fixtures/ holds ${mb.toFixed(2)} MB`).toBeLessThanOrEqual(50)
  })

  test('CC-01.7: the perf-only 120-minute fixture is generated, never committed', () => {
    const committed = committedFiles('fixtures')
    expect(committed).not.toContain('fixtures/audio-120min.mp4')
    const manifestPath = exists('fixtures/harness/manifest.json') ? 'fixtures/harness/manifest.json' : 'fixtures/manifest.json'
    expect(exists(manifestPath), `manifest at ${manifestPath}`).toBe(true)
    const manifest = readJson<{ files: Record<string, ManifestEntry> }>(manifestPath)
    const perf = manifest.files['audio-120min.mp4']
    expect(perf, 'manifest entry for audio-120min.mp4').toBeDefined()
    expect(perf!.generated, 'audio-120min.mp4.generated').toBe(true)
  })

  test('CC-01.7: fixtures/LICENSES.md exists and lists every source with license + URL', () => {
    expect(exists('fixtures/LICENSES.md'), 'fixtures/LICENSES.md').toBe(true)
    const text = readText('fixtures/LICENSES.md')
    const rows = text
      .split('\n')
      .filter((line) => line.trim().startsWith('|'))
      .filter((line) => !/^\|\s*(source|file|name)\b/i.test(line))
      .filter((line) => !/^\|[-: |]+\|$/.test(line))
    expect(rows.length, 'LICENSES.md needs at least one source row').toBeGreaterThan(0)
    const unlicensed = rows.filter((row) => !/CC0|CC BY|Apache|MIT|BSD|Public Domain|OFL|LGPL|GPL/i.test(row))
    const unlinked = rows.filter((row) => !URL_PATTERN.test(row))
    expect(unlicensed, 'rows without a recognised license').toEqual([])
    expect(unlinked, 'rows without a source URL').toEqual([])
  })

  test('CC-01.7: every manifest entry names a license that LICENSES.md records', () => {
    const manifestPath = exists('fixtures/harness/manifest.json') ? 'fixtures/harness/manifest.json' : 'fixtures/manifest.json'
    expect(exists(manifestPath), `manifest at ${manifestPath}`).toBe(true)
    const manifest = readJson<{ files: Record<string, ManifestEntry> }>(manifestPath)
    const licenses = readText('fixtures/LICENSES.md')
    const undocumented = Object.entries(manifest.files)
      .filter(([, entry]) => !entry.license || !licenses.includes(entry.license))
      .map(([name]) => name)
    expect(undocumented, 'manifest entries whose license is missing from LICENSES.md').toEqual([])
  })
})