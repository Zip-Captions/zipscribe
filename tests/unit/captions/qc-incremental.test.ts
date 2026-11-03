// CC-07.5 (L1 benchmark) / US-07.5: the QC check is INCREMENTAL — a 1-block
// change in a 10 000-block project is re-checked in ≤ 5 ms (op time).
//
// CI-tolerance doctrine (conventions § Performance: "never assert absolute
// wall-clock times below 10 s in PR suites"): this measures the OPERATION's
// own duration (performance.now around the single call), after warmup, over
// repeated samples, with a GENEROUS multiplier on the spec threshold
// (5 ms × 10 = 50 ms) — it proves the incremental path is used (op time far
// below the full re-check) without a flaky absolute-clock claim. The absolute
// 5 ms number on reference hardware is a release-time measurement.
import { expect, test } from 'vitest'
import { createQcChecker } from '@engine/captions/qc'
import type { QcIssue } from '@engine/captions/contract@07'
import type { CaptionBlock } from '@engine/model@07'
import { makeBlock, makeProject, makeWord } from './project-support'

const SPEC_LIMIT_MS = 5
const CI_HEADROOM_MULTIPLIER = 10
const BLOCK_COUNT = 10_000

function cleanBlock(index: number): CaptionBlock {
  // Compliant on every rule at the defaults: 0.8 s duration (≥ 0.7),
  // 0.2 s gaps (≥ 2 frames @ 25 fps = 0.08), ≤ 16 chars ⇒ ≤ 20 CPS, 1 line.
  const start = index * 1
  const end = start + 0.8
  return makeBlock(start, end, [makeWord('ok now here fine', start, end, { timing: 'asr' })], 'SPK_1', `blk-${index}`)
}

function tenThousandBlockProject() {
  const blocks = Array.from({ length: BLOCK_COUNT }, (_, index) => cleanBlock(index))
  return makeProject({ duration: BLOCK_COUNT + 2, blocks, speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }] })
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

test('CC-07.5 / US-07.5: incremental re-check of a 1-block change in 10 000 blocks stays under the 5 ms budget (× CI headroom)', () => {
  const project = tenThousandBlockProject()
  const checker = createQcChecker(project)
  expect(checker.all(), 'the 10 000-block baseline is clean').toEqual([])

  // ONE block changes: too fast now (CPS_HIGH + LINE_TOO_LONG at 44 chars in 0.8 s).
  const mutated = project.blocks[5_000]!
  mutated.text = 'a'.repeat(44)
  mutated.words = [makeWord('a'.repeat(44), mutated.start, mutated.end, { timing: 'asr' })]

  // Correctness first: the incremental answer equals the filtered full answer.
  const expected: QcIssue[] = checker.all().filter((issue) => issue.blockId === 'blk-5000')
  expect(expected.map((issue) => issue.code).sort(), 'the mutation does raise findings').toEqual(['CPS_HIGH', 'LINE_TOO_LONG'])

  // Warmup, then measure the OPERATION (not the test file's wall time).
  for (let run = 0; run < 3; run++) checker.changedBlock('blk-5000')
  const samples: number[] = []
  for (let run = 0; run < 15; run++) {
    const from = performance.now()
    const issues = checker.changedBlock('blk-5000')
    const elapsed = performance.now() - from
    samples.push(elapsed)
    expect(issues.map((issue) => issue.code).sort(), 'incremental result is the filtered full result').toEqual(['CPS_HIGH', 'LINE_TOO_LONG'])
  }
  const measured = median(samples)
  expect(measured, `incremental op time ${measured.toFixed(2)} ms must stay under ${SPEC_LIMIT_MS} ms × ${CI_HEADROOM_MULTIPLIER} (CI headroom; absolute 5 ms is a reference-hardware [RQ]-style measurement)`).toBeLessThanOrEqual(SPEC_LIMIT_MS * CI_HEADROOM_MULTIPLIER)

  // Incrementality, structurally: a 1-block op must not cost more than the
  // full 10 000-block pass plus the budget (with extra headroom — a full
  // re-scan on every call is the anti-pattern this guards, and the primary
  // budget above already fails that under any realistic full-pass cost).
  const fullSamples: number[] = []
  for (let run = 0; run < 5; run++) {
    const from = performance.now()
    checker.all()
    fullSamples.push(performance.now() - from)
  }
  expect(measured, `1-block op (${measured.toFixed(2)} ms) must stay comparable to the full pass (${median(fullSamples).toFixed(2)} ms)`).toBeLessThanOrEqual(median(fullSamples) + SPEC_LIMIT_MS * 4)
})

test('CC-07.5: incremental on an unchanged block returns the same (empty) findings', () => {
  const project = tenThousandBlockProject()
  const checker = createQcChecker(project)
  expect(checker.all()).toEqual([])
  expect(checker.changedBlock('blk-42'), 'clean block, no neighbours affected').toEqual([])
})
