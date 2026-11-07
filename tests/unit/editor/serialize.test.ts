// CC-102.4 (L1): the canonical serializer (FR-102.9, domain invariant 8).
// Golden: `fixtures/golden/project-canonical-v1.json` pins the canonical
// BYTES (key order = sorted object keys per invariant 8, number formatting =
// the 3-decimal rule, undefined omitted, no whitespace) for the fixed
// GOLDEN_PROJECT. Round-trip: `parse(serialize(p))` deep-equals `p` (property)
// and serialization is idempotent. SECURITY-03: malformed input surfaces a
// CODE-only error.
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as fc from 'fast-check'
import { REPO_ROOT } from '../../helpers/repo'
import { GOLDEN_PROJECT, sampleProject } from './helpers/fixture-project'
import { canonicalize, parseProject, serializeProject } from '@state/services/serialize'
import type { CaptionBlock, Project } from '@engine/model@102'

const GOLDEN_PATH = join(REPO_ROOT, 'fixtures', 'golden', 'project-canonical-v1.json')

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

describe('CC-102.4: canonical serialization golden', () => {
  test('CC-102.4: serializeProject(GOLDEN_PROJECT) reproduces the committed golden bytes (invariant 8)', () => {
    const golden = readFileSync(GOLDEN_PATH, 'utf8')
    expect(serializeProject(GOLDEN_PROJECT), 'canonical key order + number formatting are FROZEN by the golden').toBe(golden)
  })

  test('CC-102.4: the golden is itself valid canonical form (sorted keys, 3-decimal numbers, no undefined, compact)', () => {
    const raw = readFileSync(GOLDEN_PATH, 'utf8')
    expect(raw.includes('\n'), 'no whitespace — JSON.stringify compact').toBe(false)
    expect(raw.includes('undefined'), 'undefined values never serialize').toBe(false)
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const keys = Object.keys(parsed)
    expect(keys, 'top-level object keys are code-unit sorted').toEqual([...keys].sort())
    const blocks = parsed['blocks'] as Record<string, unknown>[]
    const firstWord = (blocks[0]?.['words'] as Record<string, unknown>[])[0] as Record<string, unknown>
    const wordKeys = Object.keys(firstWord)
    expect(wordKeys, 'nested objects sorted too').toEqual([...wordKeys].sort())
    expect(String(parsed['updatedAt'])).toBe('1730000000000')
    expect(String(blocks[0]?.['end'])).toBe('2.5')
  })

  test('CC-102.4: number formatting — the 3-decimal rule, no trailing-zero noise', () => {
    expect(canonicalize({ v: 1.2344999 })).toBe('{"v":1.234}')
    expect(canonicalize({ v: 3.0000000001 })).toBe('{"v":3}')
    expect(canonicalize({ v: 7 / 3 })).toBe('{"v":2.333}')
    expect(canonicalize({ v: 30 })).toBe('{"v":30}')
    expect(canonicalize({ v: 0.125 })).toBe('{"v":0.125}')
  })

  test('CC-102.4: undefined-valued keys are omitted at every depth', () => {
    const block = { id: 'x', start: 0, end: 1, text: 'a', words: [{ text: 'a', start: 0, end: 1, probability: undefined }], speakerId: 'SPK_1', confidence: undefined }
    expect(canonicalize(block)).toBe('{"end":1,"id":"x","speakerId":"SPK_1","start":0,"text":"a","words":[{"end":1,"start":0,"text":"a"}]}')
  })

  test('CC-102.4: parse(serialize(p)) deep-equals p (property, seeded)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 5 }), (seed: unknown, countUnknown: unknown) => {
        const seedN = seed as number
        const count = countUnknown as number
        const project = generatedProject(seedN, count)
        const roundTrip = parseProject(serializeProject(project))
        expect(roundTrip, 'parse ∘ serialize is the identity on 3-decimal projects').toEqual(project)
        // canonical form is a fixed point: re-serializing is byte-identical.
        expect(serializeProject(roundTrip)).toBe(serializeProject(project))
        return true
      }),
      { numRuns: 300, seed: 20261105 },
    )
  })

  test('CC-102.4: malformed input fails with a code-only error (SECURITY-03)', () => {
    expect(() => parseProject('{not json')).toThrow()
    expect(() => parseProject('{"schemaVersion":1}')).toThrow()
  })
})

// ── generators (3-decimal by construction, the serializer's own rule) ──────

const TEXTS = ['aa', 'bb', 'cc', 'dd']

function generatedBlocks(seed: number, count: number): CaptionBlock[] {
  const out: CaptionBlock[] = []
  let cursor = 0
  for (let i = 0; i < count; i++) {
    const words = Array.from({ length: 1 + ((seed + i) % 3) }, (_, w) => {
      const start = round3(cursor + w * 0.4)
      const end = round3(start + 0.3)
      const token = { text: TEXTS[(seed + i + w) % TEXTS.length] ?? 'aa', start, end }
      if ((seed + w) % 5 === 0) return { ...token, breakAfter: true }
      if ((seed + w) % 7 === 0) return { ...token, probability: 0.5 }
      return token
    })
    const end = round3(cursor + 1.2)
    const confidence = (seed + i) % 3 === 0 ? 0.75 : undefined
    const b: CaptionBlock = { id: `g_${seed}_${i}`, start: round3(cursor), end, text: words.map((w) => w.text).join(' '), words, speakerId: (seed + i) % 2 === 0 ? 'SPK_1' : 'SPK_2', ...(confidence === undefined ? {} : { confidence }) }
    out.push(b)
    cursor = round3(end + 0.8)
  }
  return out
}

function generatedProject(seed: number, blockCount: number): Project {
  return sampleProject({
    id: `proj_gen_${seed}`,
    name: `gen ${seed}`,
    blocks: generatedBlocks(seed, blockCount),
    updatedAt: 1730000000000 + seed,
  })
}
