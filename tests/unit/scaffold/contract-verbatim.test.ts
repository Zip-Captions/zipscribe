// Adversarial regression (fresh-session red-team of unit-01): the two contract
// files must stay generated from the architecture.md blocks.
//
// Contract sources:
// - unit-01 Technical Specification: "src/engine/protocol.ts + src/engine/model.ts
//   **created verbatim from knowledge/architecture.md** (these two files ARE the
//   contract; other units import, never redefine)".
// - `.agent/AGENTS.md` § When documents disagree, rule 1: the files are
//   "generated verbatim from knowledge/architecture.md by unit-01".
// - `.agent/REVIEW.md` Always-check 5 (contract drift).
//
// Byte-verbatim is impossible alongside the `format:check` gate (prettier
// strips semicolons and re-wraps), and the builder documented the mechanical
// `export`/`import type` additions in the file headers. This test pins the
// enforceable core: the declarations are token-for-token identical modulo
// comments, semicolons, whitespace, `export`, and union leading-`|`, and the
// files contain no extra or missing declarations. Any future field/shape edit
// without the matching architecture.md change fails here.
import { describe, expect, test } from 'vitest'
import { readText } from '../../helpers/repo'

function tsBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]!)
}

function normalize(ts: string): string {
  return ts
    .split('\n')
    .filter((line) => !line.trim().startsWith('import type'))
    .map((line) => {
      const comment = line.indexOf('//')
      return comment >= 0 ? line.slice(0, comment) : line
    })
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\bexport\b/g, '')
    .replace(/;/g, ' ')
    .replace(/=\s*\|/g, '=')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}|<>,:])\s*/g, '$1')
    .trim()
}

function firstDifference(a: string, b: string): string {
  let i = 0
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
  const from = Math.max(0, i - 60)
  return `divergence at token ${i}:\n  architecture.md: …${a.slice(from, i + 100)}\n  src file:        …${b.slice(from, i + 100)}`
}

const ARCH = 'knowledge/architecture.md'

describe('adversarial: contract files track architecture.md verbatim', () => {
  test('ADVERSARIAL: src/engine/model.ts matches the architecture.md domain block token-for-token', () => {
    const blocks = tsBlocks(readText(`.ai-dlc/${ARCH}`))
    expect(blocks.length, `${ARCH} exposes the contract ts blocks`).toBeGreaterThanOrEqual(2)
    const expected = normalize(blocks[0]!)
    const actual = normalize(readText('src/engine/model.ts'))
    expect(actual, firstDifference(expected, actual)).toBe(expected)
  })

  test('ADVERSARIAL: src/engine/protocol.ts matches the architecture.md protocol block token-for-token', () => {
    const blocks = tsBlocks(readText(`.ai-dlc/${ARCH}`))
    expect(blocks.length, `${ARCH} exposes the contract ts blocks`).toBeGreaterThanOrEqual(2)
    const expected = normalize(blocks[1]!)
    const actual = normalize(readText('src/engine/protocol.ts'))
    expect(actual, firstDifference(expected, actual)).toBe(expected)
  })

  test('ADVERSARIAL: the contract files define exactly the declared type/interface set — no redefinitions, no omissions', () => {
    const blocks = tsBlocks(readText(`.ai-dlc/${ARCH}`))
    const names = (ts: string): string[] => ts.match(/^(?:export\s+)?(?:type|interface)\s+([A-Za-z0-9_]+)/gm)?.map((line) => line.replace(/^(?:export\s+)?(?:type|interface)\s+/, '')) ?? []
    const pairs: [string, string][] = [
      [blocks[0]!, 'src/engine/model.ts'],
      [blocks[1]!, 'src/engine/protocol.ts'],
    ]
    for (const [block, file] of pairs) {
      expect(names(readText(file)).sort(), `${file} must define exactly its block declarations`).toEqual(names(block).sort())
    }
  })
})
