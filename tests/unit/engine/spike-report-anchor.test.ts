// Intent-1 CC-I1.1 (L1, docs anchor): the model spike report is COMMITTED and
// complete — measured WER/RTF/memory/word-timing error per engine-tier, the
// 3.8.1-vs-4.x #1739 leak measurement, license verifications and the approved
// default registry. Downstream units build on it (unit-03's registry, unit-05's
// WER/MAE baselines and the worker-recycle ceiling all read these artifacts),
// so this anchor asserts structure, not prose: the machine-readable
// docs/spikes/model-eval-report.json plus the human-readable .md sections.
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TIER_DEFAULT_MODEL, getModel } from '@engine/model/registry'
import { REPO_ROOT } from '../../helpers/repo'

const JSON_PATH = join(REPO_ROOT, 'docs/spikes/model-eval-report.json')
const MD_PATH = join(REPO_ROOT, 'docs/spikes/model-eval-report.md')

interface EvalRow {
  engineId: string
  version: string
  model: string
  revision: string
  tier: string
  ok: boolean
  wer: number | null
  wordTimingMAEms: number | null
  rtf: number | null
  wallMs: number | null
  peakJsHeapBytes: number | null
  license: string
}
interface LeakRow {
  version: string
  gpuMemGrowthPerWindowBytes: number | null
}
interface Report {
  rows: EvalRow[]
  leak: LeakRow[]
  leakPinRecommendation: string
  licenses: { candidate: string; status: string }[]
  recommendation: Record<'T1' | 'T2' | 'T3', { engine: string; model: string }>
}

const report = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as Report
const md = readFileSync(MD_PATH, 'utf8')

describe('CC-I1.1: the committed spike report carries the measurements downstream units build on', () => {
  test('CC-I1.1: measured rows cover every engine tier with WER/RTF/memory/word-timing figures and licenses', () => {
    const okRows = report.rows.filter((row) => row.ok)
    expect(okRows.length, 'the report contains successful measured rows').toBeGreaterThan(0)
    for (const engineId of ['A', 'B', 'C']) {
      expect(report.rows.some((row) => row.engineId === engineId), `engine ${engineId} (A transformers.js, B sherpa-onnx, C cactus-needle) is benchmarked`).toBe(true)
    }
    for (const tier of ['T1', 'T2']) {
      expect(okRows.some((row) => row.tier === tier), `at least one OK measured row on tier ${tier}`).toBe(true)
    }
    for (const row of okRows) {
      expect(row.wer, `row ${row.model}: WER measured`).not.toBeNull()
      expect(row.rtf, `row ${row.model}: RTF measured`).not.toBeNull()
      expect(row.wordTimingMAEms, `row ${row.model}: word-timing MAE measured`).not.toBeNull()
      expect(row.wallMs, `row ${row.model}: wall time measured`).not.toBeNull()
      // WER is a ratio, not a probability: insertions may push it above 1
      // (the committed sherpa row legitimately reads 1.25) — require a
      // finite, non-negative measured number.
      expect(Number.isFinite(row.wer) && (row.wer as number) >= 0, `row ${row.model}: WER is a finite non-negative ratio`).toBe(true)
      expect(row.license, `row ${row.model}: license recorded`).not.toBe('')
      // Memory doctrine (report header): peak heap is either a sample or a
      // per-row documented reason — never silently 0 (asserted structurally:
      // rows carry the peakJsHeapBytes field; the md documents n/a handling).
      expect(row, `row ${row.model}: memory field present`).toHaveProperty('peakJsHeapBytes')
    }
  })

  test('CC-I1.1: the 3.8.1-vs-4.x leak study measures both sides and drives the version pin', () => {
    const on38 = report.leak.find((row) => row.version.startsWith('3.8'))
    const on4x = report.leak.find((row) => row.version.startsWith('4.'))
    expect(on38, 'the pinned 3.8.1 leak side is measured').toBeDefined()
    expect(on4x, 'the 4.x comparison side is measured').toBeDefined()
    expect(on38?.gpuMemGrowthPerWindowBytes, '3.8.1 per-window GPU growth measured (bytes)').not.toBeNull()
    expect(on4x?.gpuMemGrowthPerWindowBytes, '4.x per-window GPU growth measured (bytes)').not.toBeNull()
    expect(report.leakPinRecommendation, 'the pin recommendation reads the measurement').toContain('3.8')
    expect(md, 'the human-readable report carries the leak study section').toMatch(/#1739 leak study/)
  })

  test('CC-I1.1: license verification is recorded and blocked-pending candidates are never benchmarked', () => {
    expect(report.licenses.length, 'license verifications recorded').toBeGreaterThan(0)
    for (const entry of report.licenses) {
      expect(entry.status, `${entry.candidate}: license status recorded`).toMatch(/verified-ok|blocked-pending/)
      if (entry.status === 'blocked-pending') {
        const slug = entry.candidate.match(/\(([^/]+\/[^)]+)\)/)?.[1] ?? entry.candidate
        expect(report.rows.some((row) => row.model.includes(slug.split('/')[1] ?? slug)), `blocked-pending ${entry.candidate} has NO benchmark row`).toBe(false)
      }
    }
    expect(md, 'the human-readable report carries the license section').toMatch(/## License verification/)
  })

  test('CC-I1.1: the approved default registry matches the spike recommendation and resolves in the shipped registry', () => {
    expect(md, 'the human-readable report carries the recommendation section').toMatch(/## Recommendation/)
    for (const tier of ['T1', 'T2', 'T3'] as const) {
      const rec = report.recommendation[tier]
      expect(rec, `spike recommends a default model for ${tier}`).toBeDefined()
      const registryId = TIER_DEFAULT_MODEL[tier]
      expect(registryId, `the shipped registry pins a default for ${tier}`).not.toBe('')
      // The substantive link: the recommended model must be a MEASURED row
      // whose revision carries the registry id's revision prefix
      // (registry id shape 'name@revisionPrefix').
      const revisionPrefix = registryId.split('@')[1] ?? ''
      const row = report.rows.find((r) => r.model === rec.model && r.revision.startsWith(revisionPrefix))
      expect(row, `${tier}: the recommended model (${rec.model}) with the registry revision prefix (${revisionPrefix}) is a MEASURED row in the spike report`).toBeDefined()
      expect(row?.ok, `${tier}: the default's measured row is an OK run`).toBe(true)
      expect(getModel(registryId), `${tier}: registry id resolves in MODEL_REGISTRY`).toBeDefined()
    }
  })
})
