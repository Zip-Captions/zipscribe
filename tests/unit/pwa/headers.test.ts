// CC-204.4 (FR-204.6 verification, L1/static): the Cloudflare Pages header
// file the deploy uses pins the SW + manifest to revalidation so a stale
// sw.js can never strand an update (FR-204.6; public/_headers is
// self-provided by this unit). Parsing the REAL shipped file — no copies —
// via tests/helpers/repo (same convention as the scaffold contract tests).
//
// The runtime half of FR-204.6 (the preview/deploy actually SENDING these
// headers) is asserted in e2e/pwa/update.spec.ts against the built output.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../helpers/repo'

interface HeaderEntry {
  path: string
  headers: Record<string, string>
}

function parseHeaders(fileContent: string): HeaderEntry[] {
  const entries: HeaderEntry[] = []
  let current: HeaderEntry | null = null
  for (const rawLine of fileContent.split('\n')) {
    const line = rawLine.trimEnd()
    if (line === '' || line.trimStart().startsWith('#')) continue
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      current = { path: line.trim(), headers: {} }
      entries.push(current)
    } else if (current !== null) {
      const match = /^\s*([^:]+):\s*(.*)$/.exec(line)
      if (match?.[1] !== undefined && match[2] !== undefined) current.headers[match[1].trim().toLowerCase()] = match[2].trim()
    }
  }
  return entries
}

const entries = parseHeaders(readFileSync(join(REPO_ROOT, 'public', '_headers'), 'utf8'))

function headerFor(path: string, header: string): string | undefined {
  return entries.find((entry) => entry.path === path)?.headers[header]
}

describe('CC-204.4: FR-204.6 — _headers pins sw.js/manifest to revalidation', () => {
  it('CC-204.4: /sw.js is served no-cache (max-age=0, must-revalidate) so updates are never stranded', () => {
    const cacheControl = headerFor('/sw.js', 'cache-control')
    expect(cacheControl, 'public/_headers must carry a /sw.js Cache-Control entry').toBeDefined()
    expect(cacheControl).toContain('max-age=0')
    expect(cacheControl).toContain('must-revalidate')
  })

  it('CC-204.4: /manifest.webmanifest is served no-cache so install criteria stay current', () => {
    const cacheControl = headerFor('/manifest.webmanifest', 'cache-control')
    expect(cacheControl, 'public/_headers must carry a /manifest.webmanifest Cache-Control entry').toBeDefined()
    expect(cacheControl).toContain('max-age=0')
    expect(cacheControl).toContain('must-revalidate')
  })

  it('CC-204.4: hashed immutable assets keep long-cache entries (sw updates ride the no-cache SW, not asset churn)', () => {
    const cacheControl = headerFor('/assets/*', 'cache-control')
    expect(cacheControl, 'public/_headers must keep the immutable long-cache rule for hashed assets').toBeDefined()
    expect(cacheControl).toContain('max-age=31536000')
    expect(cacheControl).toContain('immutable')
  })
})
