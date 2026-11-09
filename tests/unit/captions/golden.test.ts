// CC-07.1 (L1 goldens): importCaptions(source) of every committed format and
// edge-case fixture is BYTE-EQUAL (via the canonical serialization, see
// canonical.ts) to the hand-authored fixtures/golden/captions/*.expected.json.
//
// Goldens are authored FROM THE SPEC, never from an implementation (none
// exists): block count/order, start/end (clamped per domain invariant 11),
// text (tags stripped, line breaks kept as breakAfter — invariant 2 / US-07.1
// "cue segmentation preserved"), words with the pinned estimation rule
// (tests/unit/captions/unit07-api-contract.d.ts header — e.g. vendor cue 1
// 0.000–2.000 "Café au lait" weights 4/2/4 over Σ10 → boundaries
// 0.000/0.800/1.200/2.000), speaker identity (VTT `<v>` and FR-07.5 prefixes
// → distinct positional ids) and the ImportReport (format, encoding, counts,
// detectedLanguage, adjustments). Spot derivations live in
// .night-free form in the fixtures' own headers via scripts/make-caption-
// fixtures.ts comments; every golden value is reproducible from the rule.
import { expect, test } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import type { ImportReport } from '@engine/captions/contract@07'
import { captionFile, makeProject, readJsonFile } from './project-support'
import { canonicalGolden } from './canonical'

interface Golden {
  blocks: unknown[]
  report: ImportReport
}

interface GoldenCase {
  /** Fixture path under fixtures/. */
  fixture: string
  /** Import mode override (all goldens are source imports unless stated). */
  as?: 'source' | { translation: string }
}

const CASES: GoldenCase[] = [
  { fixture: 'captions/simple.srt' }, // baseline + default speaker
  { fixture: 'captions/vendor.srt' }, // US-07.1: Windows-1252 + CRLF + <i> → TAGS_STRIPPED
  { fixture: 'captions/voices.vtt' }, // US-07.1: <v> voices, NOTE/STYLE/REGION, cue settings
  { fixture: 'captions/two-line.srt' }, // manual line break → breakAfter (invariant 2)
  { fixture: 'captions/overlap-zero-empty.srt' }, // invariant 11: clamp / 0.1 s fix / drop + counts
  { fixture: 'captions/sample.sbv' }, // YouTube SBV
  { fixture: 'captions/sample.ttml' }, // TTML/DFXP text profile incl. ttp:frameRate (50f @ 25 fps = 2.000 s)
  { fixture: 'captions/sample.ass' }, // ASS/SSA Dialogue lines, {\…} override tags stripped
  { fixture: 'captions/sample.zipscribe.json' }, // Zipscribe JSON sidecar
  { fixture: 'captions/bom-utf8.srt' }, // BOM UTF-8 (FR-07.1)
  { fixture: 'captions/bom-utf16le.srt' }, // BOM UTF-16LE
  { fixture: 'captions/bom-utf16be.srt' }, // BOM UTF-16BE
  { fixture: 'captions/accents-cp1252.srt' }, // cp1252 accents → windows-1252 fallback
  { fixture: 'captions/arabic-rtl.srt' }, // RTL Arabic text preserved verbatim
  { fixture: 'captions/speakers-brackets.srt' }, // FR-07.5 [Name]: / NAME: prefixes (auto ON at 75 %)
  { fixture: 'captions/speakers-dashes.srt' }, // FR-07.5 '- ' dash + NAME: (auto ON at 100 %)
  { fixture: 'captions/vtt-inline-timestamps.vtt' }, // <00:00:01.000> stripped from text (Risks: styling dropped, timing kept)
  { fixture: 'captions/mislabelled.srt' }, // FR-07.2 content sniff beats the .srt extension
]

for (const testCase of CASES) {
  const stem = testCase.fixture.replace('captions/', '')
  test(`CC-07.1: golden ${stem} — blocks + ImportReport byte-equal (canonical)`, async () => {
    const project = makeProject({ duration: 30 })
    const { project: imported, report } = await importCaptions(project, captionFile(testCase.fixture), { as: testCase.as ?? 'source' })
    const expected = readJsonFile<Golden>(`fixtures/golden/captions/${stem}.expected.json`)
    expect(canonicalGolden({ blocks: imported.blocks, report }), `golden mismatch for ${stem}`).toBe(canonicalGolden(expected))
  })
}
