// scripts/spec-lint.ts — FR-1.0.12: unit-file spec lint (criteria IDs,
// depends_on, frontmatter). Run by `pnpm spec-lint` and by CI L0.
// Errors: malformed frontmatter (missing/unknown enum values, depends_on not a
// bracketed array or referencing a nonexistent unit), malformed CC-IDs
// (shape, duplicates, out-of-order numbering), tags outside RQ|DEPLOY|MANUAL.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../..')
const dlcRoot = join(repoRoot, '.ai-dlc')

const STATUS = new Set(['pending', 'in-progress', 'in_progress', 'blocked', 'done', 'done-with-followups'])
const DISCIPLINE = new Set(['dev', 'frontend', 'design', 'devops', 'qa'])
const WORKFLOW = new Set(['tdd', 'default'])
const MODE = new Set(['HITL', 'AHOTL'])
const TAGS = new Set(['RQ', 'DEPLOY', 'MANUAL'])

const CC_ID_RE = /CC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.\d+/
const CC_LINE_RE = /\*\*(CC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.\d+)\*\*(?:\s*(?:`|\s)*\[(RQ|DEPLOY|MANUAL)\])?/g

interface UnitFile {
  intent: string
  stem: string
  path: string
  text: string
}

const problems: string[] = []

function fail(path: string, message: string): void {
  problems.push(`${path}: ${message}`)
}

function listUnitFiles(): UnitFile[] {
  const files: UnitFile[] = []
  for (const intent of readdirSync(dlcRoot, { withFileTypes: true })) {
    if (!intent.isDirectory() || intent.name === 'knowledge') continue
    const dir = join(dlcRoot, intent.name)
    for (const name of readdirSync(dir)) {
      if (!/^unit-.+\.md$/.test(name)) continue
      const path = join(dir, name)
      files.push({ intent: intent.name, stem: name.replace(/\.md$/, ''), path, text: readFileSync(path, 'utf8') })
    }
  }
  return files
}

function frontmatter(text: string): Record<string, string> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match?.[1]) return null
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line)
    const key = kv?.[1]
    const value = kv?.[2]
    if (key && value !== undefined) fields[key] = value.replace(/\s+#.*$/, '').trim()
  }
  return fields
}

function checkFrontmatter(file: UnitFile): void {
  const rel = `.ai-dlc/${file.intent}/${file.stem}.md`
  const fm = frontmatter(file.text)
  if (!fm) {
    fail(rel, 'missing frontmatter block (--- ... ---)')
    return
  }
  if (!fm.status || !STATUS.has(fm.status)) fail(rel, `frontmatter status "${fm.status ?? ''}" not in {${[...STATUS].join(', ')}}`)
  if (!fm.discipline || !DISCIPLINE.has(fm.discipline)) fail(rel, `frontmatter discipline "${fm.discipline ?? ''}" not in {${[...DISCIPLINE].join(', ')}}`)
  if (!fm.workflow || !WORKFLOW.has(fm.workflow)) fail(rel, `frontmatter workflow "${fm.workflow ?? ''}" not in {${[...WORKFLOW].join(', ')}}`)
  if (!fm.mode || !MODE.has(fm.mode)) fail(rel, `frontmatter mode "${fm.mode ?? ''}" not in {HITL, AHOTL}`)
  if (fm.depends_on === undefined) {
    fail(rel, 'frontmatter depends_on missing (use [] for none)')
  } else if (!/^\[[^\]]*\]$/.test(fm.depends_on)) {
    fail(rel, `depends_on must be a bracketed array, got "${fm.depends_on}"`)
  } else {
    const entries = fm.depends_on
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const entry of entries) {
      const [intentOfDep, stemOfDep] = entry.includes('/') ? entry.split('/') : [file.intent, entry]
      const stem = stemOfDep?.replace(/\.md$/, '') ?? ''
      const depPath = join(dlcRoot, intentOfDep ?? '', `${stem}.md`)
      if (!existsSync(depPath)) fail(rel, `depends_on references nonexistent unit "${entry}" (${depPath.replace(repoRoot + '/', '')})`)
    }
  }
}

function checkCriteria(file: UnitFile): void {
  const rel = `.ai-dlc/${file.intent}/${file.stem}.md`
  const seen: string[] = []
  let lastSeq = 0
  for (const match of file.text.matchAll(CC_LINE_RE)) {
    const id = match[1] ?? ''
    const tag = match[2]
    if (tag && !TAGS.has(tag)) fail(rel, `criterion ${id} has unknown tag [${tag}]`)
    if (seen.includes(id)) fail(rel, `duplicate criterion ID ${id}`)
    seen.push(id)
    const seq = Number(id.split('.').at(-1))
    if (Number.isNaN(seq)) {
      fail(rel, `criterion ${id} does not end in .<number>`)
    } else if (seq < lastSeq) {
      fail(rel, `criterion ${id} is out of order (previous ended in .${lastSeq})`)
    } else {
      lastSeq = seq
    }
  }
  // any bold CC-* token that is not a valid ID shape is a typo
  for (const match of file.text.matchAll(/\*\*(CC-[^*\s]+)\*\*/g)) {
    const token = match[1] ?? ''
    if (!CC_ID_RE.test(token) || !new RegExp(`^${CC_ID_RE.source}$`).test(token)) {
      fail(rel, `malformed criterion ID "**${token}**" (expected CC-<intent>.<n>)`)
    }
  }
  if (seen.length === 0) fail(rel, 'no Completion Criteria (expected "- [ ] **CC-… …**" lines)')
}

function main(): void {
  if (!existsSync(dlcRoot)) {
    console.error(`spec-lint: no .ai-dlc directory at ${dlcRoot}`)
    process.exit(1)
  }
  const files = listUnitFiles()
  if (files.length === 0) {
    console.error('spec-lint: no unit-*.md files found under .ai-dlc/')
    process.exit(1)
  }
  for (const file of files) {
    checkFrontmatter(file)
    checkCriteria(file)
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`spec-lint: ${problem}`)
    console.error(`spec-lint: ${problems.length} problem(s) in ${files.length} unit file(s)`)
    process.exit(1)
  }
  console.log(`spec-lint: OK — ${files.length} unit files, frontmatter + criteria IDs valid`)
}

main()
