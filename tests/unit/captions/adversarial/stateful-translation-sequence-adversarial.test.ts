// Adversarial round (MALFORMED/STATEFUL-INTERLEAVING category): sequences of
// `importCaptions` calls — source mode then translation mode on the returned
// project, same-language re-import, and the FR-07.3 confirm-gate re-import.
// Contract: unit-07 FR-07.3 (line 45): translation cues → max-overlap block,
// several cues space-joined, unmatched dropped and counted CUE_UNMATCHED,
// origin 'imported', status 'edited'; "As source: replaces blocks … existing
// translations are kept only if the user confirmed (they'd all become
// stale/unmatched)". Domain: model.ts:105 / domain.md:48 "at most one track
// per language"; domain.md:65 invariant 10 "Every TranslationEntry key
// resolves to an existing source block … Retiming a source block never marks
// translations stale"; domain.md:66 invariant 11. Frozen d.ts:143-144 pins
// keepTranslations semantics ("all keys would be unmatched — domain invariant
// 10").
import { expect, test } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import { checkCaptions, sourceTextHash } from '@engine/captions/qc'
import type { Project } from '@engine/model@07'
import { canonical } from '../canonical'
import { makeProject } from '../project-support'

const enc = new TextEncoder()
const NO_YIELD = async (): Promise<void> => undefined

const p3 = (value: number, width: number): string => String(value).padStart(width, '0')
const srtTime = (totalMs: number): string => `${p3(Math.floor(totalMs / 3_600_000), 2)}:${p3(Math.floor(totalMs / 60_000) % 60, 2)}:${p3(Math.floor(totalMs / 1_000) % 60, 2)},${p3(totalMs % 1_000, 3)}`

function srtFile(name: string, cues: { start: number; end: number; text: string }[]): { name: string; bytes: Uint8Array } {
  const body = cues.map((cue, index) => `${index + 1}\n${srtTime(Math.round(cue.start * 1000))} --> ${srtTime(Math.round(cue.end * 1000))}\n${cue.text}`).join('\n\n')
  return { name, bytes: enc.encode(body) }
}

/** Source track: four disjoint cues [0,2] [4,8] [9,10.8] [11,12.8]. */
function sourceSrt(): { name: string; bytes: Uint8Array } {
  return srtFile('seq-source.srt', [
    { start: 0, end: 2, text: 'one two' },
    { start: 4, end: 8, text: 'three four five six' },
    { start: 9, end: 10.8, text: 'seven eight' },
    { start: 11, end: 12.8, text: 'nine ten' },
  ])
}

/** Translation cues: one per early block, two space-joined on block 2, one matching nothing. */
function translationSrt(): { name: string; bytes: Uint8Array } {
  return srtFile('seq-translation.srt', [
    { start: 0.1, end: 1.9, text: 'uno' },
    { start: 4.1, end: 5.9, text: 'dos a' },
    { start: 6.1, end: 7.9, text: 'dos b' },
    { start: 9.1, end: 10.7, text: 'tres' },
    { start: 50, end: 51, text: 'nobody here' },
  ])
}

async function chained(): Promise<Project> {
  const imported = await importCaptions(makeProject(), sourceSrt(), { as: 'source', scheduleYield: NO_YIELD })
  return imported.project
}

test('ADVERSARIAL (stateful): source mode then translation mode on the RETURNED project — max-overlap mapping, several cues space-joined on one block, unmatched cue counted once (CUE_UNMATCHED 1, never dropped silently), track origin imported / engine null / entry status edited, every entry key resolves to a live source block (invariant 10), report.blocks is the untouched source-block count, and the input project stays byte-identical (FR-07.3, import.ts:20-21)', async () => {
  const before = await chained()
  const snapshot = canonical(before)
  const blockIds = before.blocks.map((block) => block.id)

  const outcome = await importCaptions(before, translationSrt(), { as: { translation: 'es' }, scheduleYield: NO_YIELD })
  expect(outcome.project === before, 'a new project object').toBe(false)
  expect(outcome.report.blocks, 'translation mode never changes the block count').toBe(4)
  expect(outcome.report.adjustments.find((adjustment) => adjustment.code === 'CUE_UNMATCHED')?.count, 'the far cue counted once').toBe(1)
  expect(outcome.project.translations.length).toBe(1)
  const track = outcome.project.translations[0]!
  expect([track.language, track.origin, track.engine]).toEqual(['es', 'imported', null])

  const entries = track.entries
  expect(Object.keys(entries).sort(), 'keys are exactly the three covered source blocks').toEqual([blockIds[0], blockIds[1], blockIds[2]].sort())
  expect(entries[blockIds[0]!]!.text).toBe('uno')
  expect(entries[blockIds[1]!]!.text, 'two cues on one block are space-joined (FR-07.3)').toBe('dos a dos b')
  expect(Object.values(entries).every((entry) => entry.status === 'edited'), 'human-authored (FR-07.3)').toBe(true)
  for (const [key, entry] of Object.entries(entries)) {
    const block = before.blocks.find((candidate) => candidate.id === key)!
    expect(entry.sourceHash, 'fresh hash at import time — not stale').toBe(sourceTextHash(block.text))
  }

  const issues = checkCaptions(outcome.project)
  expect(issues.filter((issue) => issue.code === 'TRANSLATION_STALE'), 'nothing stale right after import').toEqual([])
  expect(issues.filter((issue) => issue.code === 'TRANSLATION_MISSING'), 'the uncovered block reports MISSING on the es track').toEqual([{ code: 'TRANSLATION_MISSING', blockId: blockIds[3], track: 'es', value: 1 }])
  expect(canonical(before), 'input project never mutated').toBe(snapshot)
})

test('ADVERSARIAL (stateful): one track per language while earlier targets exist — es then pt then es again; at most one per language at every step (model.ts:105, domain.md:48), the second es REPLACES the first (content of the later import, keys against the CURRENT blocks) and pt survives untouched; a same-language re-import never throws (replace, not reject)', async () => {
  const project = await chained()
  const blockIds = project.blocks.map((block) => block.id)

  const step1 = await importCaptions(project, translationSrt(), { as: { translation: 'es' }, scheduleYield: NO_YIELD })
  const step2 = await importCaptions(step1.project, srtFile('pt.srt', [{ start: 0.1, end: 1.9, text: 'hum dois' }]), { as: { translation: 'pt' }, scheduleYield: NO_YIELD })
  expect(step2.project.translations.map((track) => track.language), 'both targets coexist').toEqual(['es', 'pt'])

  const esAgain = await importCaptions(step2.project, srtFile('es2.srt', [{ start: 4.1, end: 5.9, text: 'cuatro nuevo' }]), { as: { translation: 'es' }, scheduleYield: NO_YIELD })
  expect(esAgain.project.translations.map((track) => track.language), 'same language twice → replaced in place-ordered list, never duplicated').toEqual(['pt', 'es'])
  const fresh = esAgain.project.translations.find((track) => track.language === 'es')!
  expect(Object.keys(fresh.entries), 'the re-import keys against the current source blocks').toEqual([blockIds[1]])
  expect(fresh.entries[blockIds[1]!]!.text, 'content of the LATER import wins').toBe('cuatro nuevo')
  const survivor = esAgain.project.translations.find((track) => track.language === 'pt')!
  expect(Object.keys(survivor.entries), 'pt untouched by the es re-import').toEqual([blockIds[0]!])

  for (const track of esAgain.project.translations) {
    for (const key of Object.keys(track.entries)) expect(blockIds, `entry key ${key} must resolve (invariant 10)`).toContain(key)
  }
})

test('ADVERSARIAL (stateful): re-importing the source track WITHOUT confirmation drops every translation track (FR-07.3 "kept only if the user confirmed"; import.ts:390) — the returned project satisfies invariant 10 vacuously and QC carries zero translation issues', async () => {
  const chainedProject = await chained()
  const withEs = await importCaptions(chainedProject, translationSrt(), { as: { translation: 'es' }, scheduleYield: NO_YIELD })
  const withPt = await importCaptions(withEs.project, srtFile('pt.srt', [{ start: 0.1, end: 1.9, text: 'hum' }]), { as: { translation: 'pt' }, scheduleYield: NO_YIELD })

  const reimported = await importCaptions(withPt.project, srtFile('new-source.srt', [
    { start: 0, end: 1, text: 'fresh one' },
    { start: 1.5, end: 2.5, text: 'fresh two' },
  ]), { as: 'source', scheduleYield: NO_YIELD })

  expect(reimported.project.translations, 'no confirmation → every track dropped').toEqual([])
  expect(reimported.project.blocks.length).toBe(2)
  expect(checkCaptions(reimported.project).filter((issue) => issue.code.startsWith('TRANSLATION')), 'invariant 10 holds vacuously').toEqual([])
})

test('stateful VIOLATION: the FR-07.3 confirm-gate (keepTranslations: true) re-import leaves EVERY TranslationEntry key dangling — source re-import mints new block ids (crypto.randomUUID) but retains the old tracks verbatim (import.ts:390), so domain.md:65 invariant 10 "Every TranslationEntry key resolves to an existing source block" is violated by the returned project, and the spec\'s promise (unit-07 line 45 "they\'d all become stale/unmatched") is not even honoured as stale — QC flags every new block TRANSLATION_MISSING instead. import.ts:62-63 itself cites invariant 10 as the reason the DEFAULT drops them; the confirmed path performs no re-key or reconciliation', async () => {
  const chainedProject = await chained()
  const withEs = await importCaptions(chainedProject, translationSrt(), { as: { translation: 'es' }, scheduleYield: NO_YIELD })

  const reimported = await importCaptions(withEs.project, srtFile('new-source2.srt', [
    { start: 0, end: 1, text: 'fresh one' },
    { start: 1.5, end: 2.5, text: 'fresh two' },
  ]), { as: 'source', keepTranslations: true, scheduleYield: NO_YIELD })

  expect(reimported.project.translations.length, 'the confirmation keeps the es track').toBe(1)
  const newBlockIds = reimported.project.blocks.map((block) => block.id)
  const issues = checkCaptions(reimported.project)
  expect(issues.filter((issue) => issue.code === 'TRANSLATION_MISSING').length, 'evidence: every new block is MISSING (orphaned), not STALE as FR-07.3 promises').toBe(2)

  const unresolved: string[] = []
  for (const track of reimported.project.translations) {
    for (const key of Object.keys(track.entries)) {
      if (!newBlockIds.includes(key)) unresolved.push(`${track.language}:${key}`)
    }
  }
  expect(unresolved, 'invariant 10 (domain.md:65): every TranslationEntry key must resolve to an existing source block after a confirmed source re-import').toEqual([])
})
