// CC-02.11 `[RQ]` — the default registry for unit-03 is explicitly
// recommended in the report: {T1: (engine, model), T2: (engine, model),
// T3: (engine, model)}. Data-driven: every recommended pair must trace back
// to a measured row (a recommendation the measurements don't support is a
// defect of the report), and the human report must state the recommendation.
import { expect, test } from 'vitest'
import { ENGINE_VOCAB, REPORT_MD, REPORT_JSON, TIERS, isNonEmptyString, isRecord, parseJsonAt, rowsOf } from '../helpers/eval-report'
import { exists, readText } from '../../tests/helpers/repo'

test('CC-02.11: an explicit {T1, T2, T3} → (engine, model) default recommendation is recorded', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const recommendation = isRecord(report) ? report['recommendation'] : undefined
  expect(isRecord(recommendation), `${REPORT_JSON}.recommendation records the unit-03 default registry (CC-02.11)`).toBe(true)
  if (!isRecord(recommendation)) return

  const rows = rowsOf(report)
  const problems: string[] = []
  for (const tier of TIERS) {
    const entry = recommendation[tier]
    if (!isRecord(entry)) {
      problems.push(`recommendation.${tier} missing — every tier needs an explicit (engine, model) default`)
      continue
    }
    const { engine, model } = entry
    if (!isNonEmptyString(engine) || !(Object.values(ENGINE_VOCAB) as string[]).includes(engine)) {
      problems.push(`recommendation.${tier}.engine must be one of ${Object.values(ENGINE_VOCAB).join(', ')}, got ${JSON.stringify(entry.engine)}`)
      continue
    }
    if (!isNonEmptyString(model)) {
      problems.push(`recommendation.${tier}.model must be a non-empty model id, got ${JSON.stringify(entry.model)}`)
      continue
    }
    const supported = rows.some((row) => isRecord(row) && row['engine'] === engine && row['model'] === model)
    if (!supported) problems.push(`recommendation.${tier} (${engine}, ${model}) has no measured row backing it — defaults must rest on measurements (US-02.1)`)
  }
  expect(problems, `tier→(engine,model) default recommendation:\n${problems.join('\n')}`).toEqual([])

  expect(exists(REPORT_MD), `${REPORT_MD} exists`).toBe(true)
  const md = readText(REPORT_MD)
  const lower = md.toLowerCase()
  expect(lower.includes('recommend'), `${REPORT_MD} states the default recommendation (FR-02.6)`).toBe(true)
  for (const tier of TIERS) {
    expect(md.includes(tier), `${REPORT_MD} names the ${tier} default`).toBe(true)
  }
})
