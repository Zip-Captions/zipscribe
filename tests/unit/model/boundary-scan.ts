// Hardened FR-03.5 boundary scanner (unit-03 adversary finding 2).
//
// The frozen `boundary-guard.test.ts` (f79ddc3 — frozen author set, must not
// be edited) matches literal import specifiers only, so
// `await import('@huggingface/' + 'transformers')` walked straight through it
// (and through the old ESLint ImportExpression rule). This module is the
// hardened sibling of that scanner: it additionally rejects, in `src/engine/**`
// OUTSIDE the allowed dirs (`**/adapters/**`, which mirror the ESLint
// `allowSdkUnder` policy — `src/workers/*` is outside the scanned tree),
//   (a) any dynamic `import()` whose argument is not a single string literal
//       (template concat, variable, string concatenation — a target the
//       policy cannot inspect is itself a violation), and
//   (b) SDK package names reconstituted from split literals/templates in
//       dynamic-import position (fragment search on the de-obfuscated text).
//
// Approach + residual limits (deliberately precise, no prose false-positives):
// - Comments are stripped (newline-preserving) before scanning, so prose and
//   commented-out imports never match.
// - (a) fires on ANY non-literal dynamic-import argument — this is what makes
//   runtime-computed specifiers (`import(pkg)`, `import(a + b)`, member
//   access, calls) enforceable without trying to evaluate them.
// - (b) strips quote/concat/whitespace characters from the argument text and
//   searches for the SDK fragments; a legitimate dynamic import of a local
//   path CONTAINING such a fragment (e.g. `import('./transformers-adapter')`)
//   is therefore rejected too — accepted cost of making obfuscation
//   uniformly expensive, per the finding ("ban any occurrence of the
//   fragments … in dynamic-import position"). Rename such a helper rather
//   than adding an exclusion.
// - Residual limits: `require()` and computed member expressions are not
//   modelled (the engine tree is ESM TypeScript; the ESLint AST rule in
//   scripts/eslint-engine-purity.mjs — which this module mirrors and which CI
//   runs via `pnpm lint` — remains the primary AST-level enforcement).

export interface ScanViolation {
  line: number
  rule: string
  detail: string
}

/** Specifier globs for a static/precise match (single `*` suffix allowed). */
const SDK_PACKAGE_GLOBS = ['@huggingface/*', '@xenova/*', 'transformers', 'sherpa-onnx*', 'onnxruntime*', '@ffmpeg/*', 'ffmpeg-static', 'mediabunny*', 'cactus*', 'needle.wasm*']
const FRAMEWORK_GLOBS = ['react', 'react-dom', 'react/*', 'react-dom/*']
/** Fragments searched in reconstituted (de-obfuscated) dynamic-import positions. */
const SDK_FRAGMENTS = ['huggingface', 'transformers', 'sherpa-onnx', 'onnxruntime', 'ffmpeg', 'mediabunny', 'cactus', 'needle.wasm']
const FRAMEWORK_RECONSTRUCTED = ['react', 'react-dom']

function globHit(value: string, globs: readonly string[]): string | null {
  for (const glob of globs) {
    if (glob.endsWith('*')) {
      if (value.startsWith(glob.slice(0, -1))) return glob
    } else if (value === glob) {
      return glob
    }
  }
  return null
}

/** Block/line comments replaced with equivalent whitespace (line numbers stay true). */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\n)([ \t]*)\/\/[^\n]*/g, (_m, nl: string, indent: string) => `${nl}${indent}`)
}

/**
 * Blank the CONTENTS of string/template literals (length-preserving), so the
 * keyword regexes only see code positions — prose like
 * `return 'we import(model) from the cache'` cannot fire the dynamic-import
 * rules. Residual limit: template expressions (`${…}`) are blanked with the
 * rest of the template, so a dynamic import inside one is invisible here
 * (caught by the ESLint AST rule; vanishingly rare in engine code).
 */
export function maskStrings(text: string): string {
  const out = text.split('')
  const quoteRunners = ["'", '"', '`']
  for (let i = 0; i < out.length; i++) {
    const q = out[i]
    if (!quoteRunners.includes(q ?? '')) continue
    let j = i + 1
    while (j < out.length) {
      const c = out[j]
      if (c === '\\') {
        out[j] = ' '
        if (j + 1 < out.length) out[j + 1] = ' '
        j += 2
        continue
      }
      if (c === q) break
      if (c !== '\n') out[j] = ' '
      j++
    }
    i = j
  }
  return out.join('')
}

/** Extract the argument text of a call whose `(` is at `openIndex`; null if unbalanced. */
function callArgument(text: string, openIndex: number): { arg: string; quotedBalanced: boolean } | null {
  let depth = 0
  let quote: string | null = null
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return { arg: text.slice(openIndex + 1, i), quotedBalanced: true }
    }
  }
  return null
}

const LITERAL_ARG = /^\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*$/
const SINGLE_QUOTE_ESCAPES = /\\(['"\\])/g

function deObfuscate(arg: string): string {
  return arg.replace(/['"`+\s()\[\],[\];:.]/g, '').toLowerCase()
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++
  return line
}

// Scan one engine source file. `sdkAllowed: true` marks a file under the
// adapters/ subtree (SDK imports permitted there; framework imports and the
// non-inspectable-target ban on framework reconstitutions still apply).
export function scanEngineSource(text: string, opts: { sdkAllowed?: boolean } = {}): ScanViolation[] {
  const violations: ScanViolation[] = []
  const code = stripComments(text)
  // Positions for the dynamic-import scan come from the string-masked copy so
  // prose inside string literals cannot fire; specifier values are read from
  // the original code (static import specifiers cannot appear inside strings
  // in valid syntax — a residual limit: prose such as `text = "from 'react'"`
  // could theoretically trip the precise static match, same as the frozen
  // guard's approach).
  const masked = maskStrings(code)
  const sdkAllowed = opts.sdkAllowed ?? false

  // Static imports/re-exports and fully-literal dynamic imports: precise
  // specifier match. The dynamic form requires the closing paren so a
  // concatenation (`import('@huggingface/' + 'transformers')`) is judged by
  // the de-obfuscating dynamic rules below, not half-matched as a literal.
  const specifierRegex = /(?:\b(?:from|import)\s+|\bimport\s*\(\s*)(['"])([^'"]+)\1(\s*\))?/g
  for (const match of code.matchAll(specifierRegex)) {
    const value = match[2] ?? ''
    const isDynamicLiteralForm = match[0].includes('(') && match[3] !== undefined
    if (!isDynamicLiteralForm && match[0].includes('(')) continue // partial literal of a concat — dynamic rules own it
    const index = match.index ?? 0
    const framework = globHit(value, FRAMEWORK_GLOBS)
    if (framework) {
      violations.push({ line: lineAt(code, index), rule: 'framework-import', detail: `'${value}' (framework glob ${framework})` })
      continue
    }
    if (!sdkAllowed) {
      const sdk = globHit(value, SDK_PACKAGE_GLOBS)
      if (sdk) violations.push({ line: lineAt(code, index), rule: 'sdk-import', detail: `'${value}' (SDK glob ${sdk})` })
    }
  }

  // Dynamic import() position: (a) non-literal argument is itself a
  // violation outside allowed dirs; (b) de-obfuscated fragments are rejected.
  // (Positions from the masked copy; argument text from the original.)
  const dynamic = /\bimport\s*\(/g
  for (const match of masked.matchAll(dynamic)) {
    if (match.index === undefined) continue
    // `.import(` is a member call, not the dynamic-import operator.
    const before = masked.slice(0, match.index).trimEnd()
    if (before.endsWith('.')) continue
    const openIndex = code.indexOf('(', match.index)
    const parsed = openIndex >= 0 ? callArgument(code, openIndex) : null
    const index = match.index
    if (!parsed) {
      if (!sdkAllowed) violations.push({ line: lineAt(code, index), rule: 'non-static-dynamic-import', detail: 'unbalanced dynamic import() — target unverifiable' })
      continue
    }
    const literal = LITERAL_ARG.exec(parsed.arg)
    if (literal) {
      const value = (literal[2] ?? '').replace(SINGLE_QUOTE_ESCAPES, '$1')
      const framework = globHit(value, FRAMEWORK_GLOBS)
      if (framework) {
        violations.push({ line: lineAt(code, index), rule: 'framework-import', detail: `dynamic import('${value}')` })
      } else if (!sdkAllowed) {
        const sdk = globHit(value, SDK_PACKAGE_GLOBS)
        if (sdk) violations.push({ line: lineAt(code, index), rule: 'sdk-import', detail: `dynamic import('${value}')` })
      }
      continue
    }
    // Non-static argument.
    const reconstructed = deObfuscate(parsed.arg)
    const framework = reconstructed !== '' && FRAMEWORK_RECONSTRUCTED.some((name) => reconstructed === name || reconstructed.startsWith(`${name}/`))
    if (framework) {
      violations.push({ line: lineAt(code, index), rule: 'framework-import', detail: `dynamic import(<non-static>) reconstructs a framework package` })
      continue
    }
    if (!sdkAllowed) {
      const fragment = SDK_FRAGMENTS.find((f) => reconstructed.includes(f))
      if (fragment) {
        violations.push({ line: lineAt(code, index), rule: 'sdk-obfuscated-dynamic-import', detail: `dynamic import(<non-static>) reconstructs an SDK name (fragment '${fragment}')` })
      } else {
        violations.push({ line: lineAt(code, index), rule: 'non-static-dynamic-import', detail: 'dynamic import() target is not a single string literal — unverifiable, therefore banned outside **/adapters/**' })
      }
    }
  }
  return violations
}
