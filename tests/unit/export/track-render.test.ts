// FR-302.3 / US-302.3 (L1): the shared overlay renderer consumes a pure
// display-block mapping for translation tracks — per-source-block translated
// text, same style rules (the caller keeps style/geometry), failed/missing
// entries absent, source track byte-identical (identity pin: burn-in of the
// source track must never change pixel behaviour).
import { describe, expect, test } from 'vitest'
import { displayBlocksForTrack } from '@engine/export/overlay'
import type { Project, ProjectSnapshot } from '@engine/model@102'
import { block, sampleProject, speaker } from '../editor/helpers/fixture-project'

const SPEAKERS = [speaker('SPK_1', 'Speaker 1', '#4c8dff')]

function projectWithTranslations(): Project {
  const blocks = [
    block('b1', 0, 2, 'SPK_1', [{ text: 'hello', start: 0, end: 1 }, { text: 'world', start: 1, end: 2 }]),
    block('b2', 3, 5, 'SPK_1', [{ text: 'second', start: 3, end: 5 }]),
    block('b3', 6, 8, 'SPK_1', [{ text: 'third', start: 6, end: 8 }]),
    block('b4', 9, 11, 'SPK_1', [{ text: 'fourth', start: 9, end: 11 }]),
  ]
  return sampleProject({
    language: 'en',
    blocks,
    speakers: SPEAKERS,
    translations: [
      {
        language: 'fr',
        origin: 'machine',
        engine: 'chrome-translator',
        entries: {
          b1: { text: 'bonjour le monde', status: 'translated', sourceHash: 'h1' },
          b2: { text: 'deuxième', status: 'edited', sourceHash: 'h2' },
          b4: { text: 'quatrième', status: 'failed', sourceHash: 'h4' },
        },
      },
    ],
  })
}

describe('FR-302.3: translation display blocks (burn-in/preview track input)', () => {
  test('FR-302.3: source track maps identity (same blocks, words intact)', () => {
    const project = projectWithTranslations()
    const out = displayBlocksForTrack(project, 'source')
    expect(out).toEqual(project.blocks)
  })

  test('FR-302.3: translation track replaces text per source block, keeps timing/speaker/id', () => {
    const project = projectWithTranslations()
    const out = displayBlocksForTrack(project, 'fr')
    // b1 translated, b2 edited (kept), b3 missing → absent, b4 failed → absent.
    expect(out.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(out[0]?.text).toBe('bonjour le monde')
    expect(out[0]?.start).toBe(0)
    expect(out[0]?.end).toBe(2)
    expect(out[0]?.speakerId).toBe('SPK_1')
    // block-level only: translations own no word timings (domain glossary)
    expect(out[0]?.words).toEqual([])
    expect(out[1]?.text).toBe('deuxième')
  })

  test('FR-302.3: an unknown track language yields no blocks (never the source)', () => {
    const project = projectWithTranslations()
    expect(displayBlocksForTrack(project, 'de')).toEqual([])
  })

  test('FR-302.3: the snapshot input is never mutated (immutable export contract)', () => {
    const project = projectWithTranslations()
    const before = JSON.stringify(project.blocks)
    displayBlocksForTrack(project as unknown as ProjectSnapshot, 'fr')
    expect(JSON.stringify(project.blocks)).toBe(before)
  })
})
