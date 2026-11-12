// FR-104.8 (L1) + CONTRACT.md § Commands — captions-retime-all row (orchestrator
// amendment of 2026-11-12): the payload is widened ADDITIVELY with the frozen
// engine `retimeAll` stretch knobs — every block/word time t maps to
// `round3(anchorSec + (t − anchorSec) × scale + offsetSec)` clamped into
// [0, asset.duration] (domain invariant 6 quantization, media clamp), the
// asset stays byte-identical (invariant 9), and the whole stretch is exactly
// ONE undo step. Omitted scale/anchor keep the frozen uniform-shift semantics
// byte-identically. (scale, offset) come from the pure engine `solveRetime`
// (src/engine/captions/retime.ts — pure engine imports, precedent
// tests/unit/captions/**). RED: the committed command ignores the unknown
// `scale`/`anchorSec` fields (uniform shift only) — the scale-mapping
// assertions below are real body failures, not harness errors.
// No canary content (synthetic stretch corpus).
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { block, sampleProject, word } from '../editor/helpers/fixture-project'
import { serializeProject } from '@state/services/serialize'
import { solveRetime } from '@engine/captions/retime'
import type { Project } from '@engine/model@104'
import type { EditorApp } from '@state/history'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const DURATION = 121.44

function stretchProject(): Project {
  return sampleProject({
    blocks: [
      block('blk_a', 0.5, 2.5, 'SPK_1', [word('alpha', 0.5, 1.2), word('beta', 1.3, 1.9), word('gamma', 2.0, 2.5)]),
      block('blk_b', 3.0, 5.0, 'SPK_1', [word('delta', 3.0, 4.1), word('echo', 4.2, 5.0)]),
      block('blk_c', 6.25, 7.75, 'SPK_1', [word('foxtrot', 6.25, 7.0), word('golf', 7.1, 7.75)]),
    ],
  })
}

function mount(): ReturnType<typeof createTestApp> {
  return createTestApp({ project: stretchProject() })
}

function dispatch(app: EditorApp, id: string, payload?: unknown): { threw: boolean; reject: { code: string } | null } {
  try {
    return { threw: false, reject: (app as unknown as { dispatch(id: string, payload?: unknown): { code: string } | null }).dispatch(id, payload) }
  } catch {
    return { threw: true, reject: null }
  }
}

function project(t: ReturnType<typeof createTestApp>): Project {
  return t.app.project.getState().project as Project
}

function geometry(p: Project): [string, number, number][] {
  return p.blocks.map((b): [string, number, number] => [b.id, b.start, b.end])
}

function wordTimes(p: Project): [string, number, number][] {
  return p.blocks.flatMap((b): [string, number, number][] => b.words.map((w): [string, number, number] => [w.text, w.start, w.end]))
}

function expectStretch(t: ReturnType<typeof createTestApp>, anchor: number, scale: number, offset: number): void {
  const map = (x: number): number => {
    const mapped = Math.round((anchor + (x - anchor) * scale + offset) * 1000) / 1000
    return mapped < 0 ? 0 : mapped > DURATION ? DURATION : mapped
  }
  for (const b of project(t).blocks) {
    const original = ORIGINAL_BLOCK_TIMES.get(b.id)
    expect(original, `fixture block ${b.id} exists`).toBeDefined()
    expect([b.start, b.end], `block ${b.id} maps over the anchor (FR-104.8)`).toEqual([map(original![0]), map(original![1])])
  }
  for (const b of project(t).blocks) {
    for (const w of b.words) {
      const original = ORIGINAL_WORD_TIMES.get(w.text)
      expect(original, `fixture word ${w.text} exists`).toBeDefined()
      expect([w.start, w.end], `word ${w.text} maps over the anchor (invariant 6)`).toEqual([map(original![0]), map(original![1])])
    }
  }
}

const ORIGINAL_BLOCK_TIMES = new Map<string, [number, number]>([
  ['blk_a', [0.5, 2.5]],
  ['blk_b', [3.0, 5.0]],
  ['blk_c', [6.25, 7.75]],
])

const ORIGINAL_WORD_TIMES = new Map<string, [number, number]>([
  ['alpha', [0.5, 1.2]],
  ['beta', [1.3, 1.9]],
  ['gamma', [2.0, 2.5]],
  ['delta', [3.0, 4.1]],
  ['echo', [4.2, 5.0]],
  ['foxtrot', [6.25, 7.0]],
  ['golf', [7.1, 7.75]],
])

describe('FR-104.8 / @104 EXTENDS: captions-retime-all scale+offset over the anchor', () => {
  test('FR-104.8: captions-retime-all applies solveRetime scale+offset over the anchor, clamped, media never moves', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)

    // (scale, offset) from the pure engine two-point solve, sanity-pinned.
    const solution = solveRetime(1.0, 2.0, 5.0, 8.0)
    expect(solution, 'solveRetime sanity (1→2, 5→8)').toEqual({ anchorSec: 0, scale: 1.5, offsetSec: 0.5 })

    const t = mount()
    const before = serializeProject(project(t))
    const assetBefore = structuredClone(project(t).asset)
    const undoBefore = t.app.history.undoCount()
    const outcome = dispatch(t.app, 'captions-retime-all', { offsetSec: solution.offsetSec, scale: solution.scale, anchorSec: solution.anchorSec })
    expect(outcome.threw, "captions-retime-all is not registered in the command registry (expected id 'captions-retime-all')").toBe(false)
    expect(outcome.reject, `retime-all rejected (${outcome.reject?.code ?? 'n/a'})`).toBeNull()

    // scale 1.5, offset 0.5, anchor 0 → round3(1.5t + 0.5); frozen table
    // (independent of expectStretch's map — oracle sanity per the close-gap style).
    expect(geometry(project(t)), 'blocks map to round3(1.5t + 0.5)').toEqual([
      ['blk_a', 1.25, 4.25],
      ['blk_b', 5.0, 8.0],
      ['blk_c', 9.875, 12.125],
    ])
    expect(wordTimes(project(t)), 'words map to round3(1.5t + 0.5)').toEqual([
      ['alpha', 1.25, 2.3],
      ['beta', 2.45, 3.35],
      ['gamma', 3.5, 4.25],
      ['delta', 5.0, 6.65],
      ['echo', 6.8, 8.0],
      ['foxtrot', 9.875, 11.0],
      ['golf', 11.15, 12.125],
    ])
    expect(t.app.history.undoCount(), 'the whole stretch is exactly ONE undo step').toBe(undoBefore + 1)
    expect(project(t).asset, 'media never moves (invariant 9)').toEqual(assetBefore)
    t.app.history.undo()
    expect(serializeProject(project(t)), 'undo restores byte-equal state').toBe(before)

    // NON-ZERO ANCHOR: scale 1.2, offset 0.2 about anchor 1.0 → round3(1.2t + 0.2).
    const a = mount()
    const aBefore = serializeProject(project(a))
    const aUndo = a.app.history.undoCount()
    const aOutcome = dispatch(a.app, 'captions-retime-all', { offsetSec: 0.2, scale: 1.2, anchorSec: 1.0 })
    expect(aOutcome.reject, 'anchor stretch accepted').toBeNull()
    expectStretch(a, 1.0, 1.2, 0.2)
    expect(geometry(project(a)), 'anchor 1.0 map (1.2t + 0.2)').toEqual([
      ['blk_a', 0.8, 3.2],
      ['blk_b', 3.8, 6.2],
      ['blk_c', 7.7, 9.5],
    ])
    expect(a.app.history.undoCount(), 'ONE undo step').toBe(aUndo + 1)
    a.app.history.undo()
    expect(serializeProject(project(a)), 'undo byte-equal').toBe(aBefore)

    // CLAMPED BOTH ENDS: scale 22.5, offset −12.5 → floor clamps blk_a/blk_b low,
    // ceiling clamps blk_c onto asset.duration.
    const c = mount()
    const cBefore = serializeProject(project(c))
    const cUndo = c.app.history.undoCount()
    const cOutcome = dispatch(c.app, 'captions-retime-all', { offsetSec: -12.5, scale: 22.5, anchorSec: 0 })
    expect(cOutcome.reject, 'clamped stretch accepted').toBeNull()
    expectStretch(c, 0, 22.5, -12.5)
    expect(geometry(project(c)), 'clamp into [0, duration]').toEqual([
      ['blk_a', 0, 43.75],
      ['blk_b', 55.0, 100.0],
      ['blk_c', 121.44, 121.44],
    ])
    expect(project(c).blocks[2]?.end, 'ceiling clamp lands on asset.duration').toBe(DURATION)
    expect(project(c).blocks[0]?.start, 'floor clamp lands on 0').toBe(0)
    expect(c.app.history.undoCount(), 'ONE undo step').toBe(cUndo + 1)
    c.app.history.undo()
    expect(serializeProject(project(c)), 'undo byte-equal').toBe(cBefore)
  })

  test('FR-104.8: frozen offset-only call (no scale/anchor) is byte-identical to the uniform shift', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const before = serializeProject(project(t))
    const undoBefore = t.app.history.undoCount()
    const outcome = dispatch(t.app, 'captions-retime-all', { offsetSec: 0.5 })
    expect(outcome.threw).toBe(false)
    expect(outcome.reject, 'frozen offset-only call accepted').toBeNull()
    // Frozen semantics preserved: every time is round3(t + 0.5), gaps intact.
    expect(geometry(project(t)), 'uniform shift by +0.5').toEqual([
      ['blk_a', 1.0, 3.0],
      ['blk_b', 3.5, 5.5],
      ['blk_c', 6.75, 8.25],
    ])
    expect(wordTimes(project(t)), 'words shift uniformly by +0.5').toEqual([
      ['alpha', 1.0, 1.7],
      ['beta', 1.8, 2.4],
      ['gamma', 2.5, 3.0],
      ['delta', 3.5, 4.6],
      ['echo', 4.7, 5.5],
      ['foxtrot', 6.75, 7.5],
      ['golf', 7.6, 8.25],
    ])
    expect(t.app.history.undoCount(), 'still exactly ONE undo step').toBe(undoBefore + 1)
    t.app.history.undo()
    expect(serializeProject(project(t)), 'undo byte-equal').toBe(before)
  })
})
