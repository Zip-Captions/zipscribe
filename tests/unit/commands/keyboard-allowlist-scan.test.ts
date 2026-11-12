// FR-105.5 (L0-style static scan, node): no onKeyDown outside the conventions
// allowlist (reviewer ALWAYS-check 11). Three legs:
//  (a) repo scan with fs: every onKeyDown occurrence in src/** lives in
//      src/ui/commands/**, src/ui/**/editable/**, or
//      src/ui/editable/TimecodeInput.tsx — comment-only mentions are excluded
//      by stripping // and /* */ comments BEFORE matching (a HOLD today: the
//      existing mentions all sit on the allowlist; the Workbench.tsx /
//      Transcript.tsx comment mentions must NOT count).
//  (b) ESLint RuleTester suite for the future custom rule (frozen name in the
//      d.ts): scripts/eslint-keyboard.mjs '@zipscribe' plugin, rule
//      no-keydown-outside-allowlist, messageId 'outsideAllowlist' — valid =
//      onKeyDown on an allowlisted filename, invalid = onKeyDown on a plain
//      component.
//  (c) wiring anchor: eslint.config.js must register the '@zipscribe' plugin
//      with this rule for src/** files (RED until the builder wires it —
//      FR-105.5 "fails lint" means the gate exists).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { RuleTester } from 'eslint'
import { describe, expect, test } from 'vitest'
import { loadSeamModule } from './helpers/seams'
import type { plugin as KeyboardPlugin } from 'scripts/eslint-keyboard.mjs'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const repoRoot = new URL('../../../', import.meta.url)
const srcRoot = join(repoRoot.pathname, 'src')

const ALLOW_EXACT = new Set(['src/ui/editable/TimecodeInput.tsx'])

function isAllowlisted(relativePath: string): boolean {
  const posix = relativePath.split(sep).join('/')
  if (ALLOW_EXACT.has(posix)) return true
  if (posix.startsWith('src/ui/commands/')) return true
  return /(^|\/)editable\//.test(posix) && posix.startsWith('src/ui/')
}

/** Strip line comments and block comments (string bodies are not stripped —
 *  onKeyDown appears in code positions only, so a code-position mention is
 *  what the scan counts and a comment mention never counts). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) out.push(full)
  }
  return out
}

describe('FR-105.5 (a): onKeyDown repo scan (comments stripped)', () => {
  test('FR-105.5: every onKeyDown in src/** lives on the conventions allowlist', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const offenders: string[] = []
    let occurrences = 0
    for (const file of walk(srcRoot)) {
      const source = stripComments(readFileSync(file, 'utf8'))
      const matches = source.match(/onKeyDown/g)
      if (matches === null) continue
      occurrences += matches.length
      if (!isAllowlisted(relative(repoRoot.pathname, file))) offenders.push(relative(repoRoot.pathname, file))
    }
    expect(occurrences, 'the scan is non-vacuous (allowlisted onKeyDown code exists today)').toBeGreaterThan(0)
    expect(offenders, `onKeyDown outside ui/commands/**, ui/**/editable/**, TimecodeInput: ${offenders.join(', ')}`).toEqual([])
  })

  test('FR-105.5: comment-only onKeyDown mentions (Workbench, Transcript) are excluded by the strip', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const shell = stripComments(readFileSync(join(srcRoot, 'ui/shell/Workbench.tsx'), 'utf8'))
    expect(/onKeyDown/.test(shell), 'Workbench.tsx mentions onKeyDown in COMMENTS only').toBe(false)
    const transcript = stripComments(readFileSync(join(srcRoot, 'ui/transcript/Transcript.tsx'), 'utf8'))
    expect(/onKeyDown/.test(transcript), 'Transcript.tsx likewise').toBe(false)
  })
})

describe('FR-105.5 (b): the @zipscribe keyboard ESLint rule (RuleTester)', () => {
  const KEYDOWN_JSX = 'export function Panel() { return <div onKeyDown={() => undefined} /> }'

  test('FR-105.5: scripts/eslint-keyboard.mjs exports the no-keydown-outside-allowlist rule; valid on allowlist paths, invalid elsewhere', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const mod = await loadSeamModule<{ plugin: typeof KeyboardPlugin }>('scripts/eslint-keyboard.mjs')
    const rule = mod.plugin.rules['no-keydown-outside-allowlist']
    expect(rule, 'frozen rule name in the @zipscribe plugin').toBeDefined()
    const ruleTester = new RuleTester({
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    })
    ruleTester.run('no-keydown-outside-allowlist', rule as never, {
      valid: [
        { code: KEYDOWN_JSX, filename: join(repoRoot.pathname, 'src/ui/commands/useCommands.tsx') },
        { code: KEYDOWN_JSX, filename: join(repoRoot.pathname, 'src/ui/transcript/editable/BlockEditor.tsx') },
        { code: KEYDOWN_JSX, filename: join(repoRoot.pathname, 'src/ui/editable/TimecodeInput.tsx') },
        { code: 'export function Plain() { return <div onClick={() => undefined} /> }', filename: join(repoRoot.pathname, 'src/ui/timeline/Timeline.tsx') },
      ],
      invalid: [
        {
          code: KEYDOWN_JSX,
          filename: join(repoRoot.pathname, 'src/ui/timeline/Timeline.tsx'),
          errors: [{ messageId: 'outsideAllowlist' }],
        },
        {
          code: KEYDOWN_JSX,
          filename: join(repoRoot.pathname, 'src/ui/shell/TransportBar.tsx'),
          errors: [{ messageId: 'outsideAllowlist' }],
        },
      ],
    })
  })
})

describe('FR-105.5 (c): the rule is wired into the lint gate', () => {
  test('FR-105.5: eslint.config.js registers @zipscribe no-keydown-outside-allowlist for src/**', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const config = readFileSync(join(repoRoot.pathname, 'eslint.config.js'), 'utf8')
    expect(config, "the '@zipscribe' keyboard plugin is wired").toContain('@zipscribe')
    expect(config, 'the frozen rule name is registered').toContain('no-keydown-outside-allowlist')
    expect(config, 'wired for src files').toMatch(/src\/\*\*/)
  })
})
