// Criterion credit policy (unit-04 adversary F-6 — A-11 title forgery,
// unit-03 F2 recurrence).
//
// verify-criteria credits a CC-ID from any passing test whose TITLE leads with
// it. For IDs that have NO committed Playwright spec carrying the leading
// citation, a vitest title is legitimate evidence. For IDs an e2e spec DOES
// lead-cite (e.g. CC-04.9's memory gate, CC-04.10's forced-fallback rows),
// credit must come from playwright-sourced junit cases under the junit-trust
// provenance policy — never from a planted vitest file with two
// `expect(1).toBe(1)` tests (A-11). The e2e-backed set is derived from the
// COMMITTED spec text at git HEAD (the unit-03 review R2 lesson: never from
// what the live run saw or the working tree — deleting the spec file from
// disk must not silently downgrade a criterion back to vitest crediting).
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { citationsOf } from './junit-trust.ts'
import type { TestCase } from './junit-trust.ts'

export interface Citations {
  /** id → count of CREDITED passing cases. */
  citations: Map<string, number>
  /** ids with ≥ 1 credited passing case. */
  passing: Set<string>
  /** every id cited by any case (credited or not) — the UNKNOWN-ID check. */
  cited: Set<string>
}

/**
 * The credit loop (unit-04 F-6): a passing case credits `id` only when the id
 * is not e2e-backed, or the case is playwright-sourced. Kept pure so the
 * scaffold regression suite drives the REAL policy with injected cases.
 */
export function countCitations(cases: readonly TestCase[], e2eBacked: ReadonlySet<string>): Citations {
  const citations = new Map<string, number>()
  const passing = new Set<string>()
  const cited = new Set<string>()
  for (const testCase of cases) {
    for (const id of citationsOf(testCase.title)) {
      cited.add(id)
      const counts = testCase.status === 'passed' && (!e2eBacked.has(id) || testCase.source === 'playwright')
      if (counts) {
        citations.set(id, (citations.get(id) ?? 0) + 1)
        passing.add(id)
      }
    }
  }
  return { citations, passing, cited }
}

const SITE = /(^|[^\w$.])(test|it|describe)((?:\.[A-Za-z]+)*)\s*\(\s*(['"`])((?:\\.|(?!\4)[^\\])*)\4/g

/** Strip JS strings (all three quote flavours) and comments so brace counting
 *  for describe-body nesting is not skewed by braces inside titles
 *  (e.g. `(${browser})`), and string/comment prose cannot fake a call site.
 *  Returns the blanked code plus a mask of positions that were blanked FROM a
 *  non-space character (an original space must not look "stripped"). */
function stripStringsAndComments(text: string): { code: string; stripped: boolean[] } {
  const out = [...text]
  const stripped: boolean[] = new Array<boolean>(text.length).fill(false)
  const blank = (index: number): void => {
    if (text[index] !== ' ' && text[index] !== '\n') {
      out[index] = ' '
      stripped[index] = true
    }
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        blank(i)
        i++
      }
    } else if (c === '/' && text[i + 1] === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        blank(i)
        i++
      }
      i += 1
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c
      stripped[i] = true
      out[i] = ' '
      i += 1
      while (i < text.length) {
        if (text[i] === '\\') {
          stripped[i] = true
          out[i] = ' '
          if (i + 1 < text.length) {
            stripped[i + 1] = true
            out[i + 1] = ' '
          }
          i += 2
          continue
        }
        if (text[i] === quote) {
          stripped[i] = true
          out[i] = ' '
          break
        }
        blank(i)
        i++
      }
    }
  }
  return { code: out.join(''), stripped }
}

interface CallSite {
  at: number
  depth: number
  end: number
  title: string
  isDescribe: boolean
}

/**
 * Model the Playwright junit title space from committed spec text: every
 * `test`/`it` call site gets the title `describe › … › test` (the junit
 * reporter's `name`), and the criteria whose citation LEADS one of those
 * modelled titles are the playwright-backed ones. Static title literals only
 * (template placeholders cannot alter the LEADING citation; the
 * `test.skip(condition, 'reason')` shape has no string first argument and is
 * not a case title). Fidelity against the real reporter is pinned by
 * tests/unit/scaffold/verify-criteria-e2e-backing.test.ts.
 */
export function modelledCaseTitles(specSource: string): string[] {
  const { code, stripped } = stripStringsAndComments(specSource)
  const depthBefore: number[] = new Array<number>(specSource.length + 1)
  let depth = 0
  for (let i = 0; i < specSource.length; i++) {
    depthBefore[i] = depth
    if (code[i] === '{') depth++
    else if (code[i] === '}') depth--
  }
  depthBefore[specSource.length] = depth

  const sites: CallSite[] = []
  for (const match of specSource.matchAll(SITE)) {
    const boundary = match[1] ?? ''
    const keyword = match[2] ?? ''
    const chain = (match[3] ?? '').toLowerCase()
    const title = match[5] ?? ''
    const kwAt = (match.index ?? 0) + (boundary === '' ? 0 : 1)
    if (stripped[kwAt]) continue // the keyword lives inside a string/comment — not a real call site
    const isDescribe = keyword === 'describe' || chain.split('.').includes('describe')
    void keyword
    sites.push({ at: kwAt, depth: depthBefore[kwAt] ?? 0, end: specSource.length, title, isDescribe })
  }
  for (const describe of sites) {
    if (!describe.isDescribe) continue
    for (let i = describe.at; i < specSource.length; i++) {
      if (code[i] === '}' && (depthBefore[i] ?? 0) === describe.depth + 1) {
        describe.end = i
        break
      }
    }
  }
  const titles: string[] = []
  for (const site of sites) {
    if (site.isDescribe) continue
    const chain: string[] = []
    for (const describe of sites) {
      if (!describe.isDescribe) continue
      if (describe.at < site.at && site.at < describe.end) chain.push(describe.title)
    }
    titles.push([...chain, site.title].join(' › '))
  }
  return titles
}

/** Leading-run citations over the modelled junit titles of one spec file. */
export function specLeadingCitations(specSource: string): string[] {
  const ids = new Set<string>()
  for (const title of modelledCaseTitles(specSource)) for (const id of citationsOf(title)) ids.add(id)
  return [...ids]
}

function git(args: string[], cwd: string): { status: number | null; stdout: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })
  return { status: result.status, stdout: result.stdout ?? '' }
}

/**
 * Committed e2e spec sources: `git show HEAD:<path>` for every spec under
 * `e2e/` in HEAD (falling back to a disk walk when git is unavailable, e.g.
 * a copyTree scratch with no repository). HEAD, never the working tree: the
 * set drives the vitest-credit refusal, so it must be immutable during
 * verification (unit-03 R2).
 */
export function committedE2eSpecSources(repoRoot: string): Map<string, string> {
  const sources = new Map<string, string>()
  const listing = git(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'e2e'], repoRoot)
  if (listing.status === 0) {
    for (const path of listing.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((path) => path.endsWith('.spec.ts'))) {
      const show = git(['show', `HEAD:${path}`], repoRoot)
      if (show.status === 0) sources.set(path, show.stdout)
    }
    return sources
  }
  const walk = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const relative = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(full, relative)
      else if (entry.name.endsWith('.spec.ts')) sources.set(relative, readFileSync(full, 'utf8'))
    }
  }
  walk(join(repoRoot, 'e2e'), '')
  return sources
}

/** Every id whose credit must come from Playwright evidence, derived from the
 *  committed e2e spec sources (the unit-file `Playwright:` declaration union is
 *  added by the caller — scripts/verify-criteria.ts). */
export function playwrightBackedIds(specSources: ReadonlyMap<string, string>): Set<string> {
  const ids = new Set<string>()
  for (const source of specSources.values()) for (const id of specLeadingCitations(source)) ids.add(id)
  return ids
}
