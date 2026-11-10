// CC-103.4 (L1, structural half) + FR-103.1/FR-103.5: dirty-region redraw
// counting through the injected canvas recorder double — a playhead-only
// invalidation must not repaint the blocks layer, and repeated schedules
// coalesce into ONE rAF pass. Plus dpr scaling/resize and the pure
// block-visuals derivation (speaker border, low-confidence dot, ellipsize)
// as observable data (CC-103.1), and the waveform bucket mapping (FR-103.4).
// RED until `src/ui/timeline/{renderer,waveform}.ts` ship.
import { describe, expect, test } from 'vitest'
import { createFakeRafs } from '../editor/helpers/fake-rafs'
import { createCanvasRecorder } from './helpers/canvas-recorder'
import { makePeaks, makePeaksWithSilence, timelineBlocks } from './helpers/timeline-fixture'
import type { TimelineRenderState } from '@ui/timeline/renderer'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

async function makeRenderer() {
  const m = await import(/* @vite-ignore */ '@ui/timeline/renderer')
  const target = createCanvasRecorder()
  const rafs = createFakeRafs(0)
  const r = m.createTimelineRenderer({ target, rafs, palette: m.DEFAULT_TIMELINE_PALETTE })
  return { m, target, rafs, renderer: r }
}

function state(overrides: Partial<TimelineRenderState> = {}): TimelineRenderState {
  return {
    viewport: { t0: 0, pxPerSec: 100 },
    blocks: timelineBlocks(),
    selection: { anchorBlockId: 'blk_v2', focusBlockId: 'blk_v2' },
    focusBlockId: 'blk_v2',
    playhead: 4.2,
    loop: [1, 2.5],
    waveform: [],
    silence: [],
    snapIndicator: null,
    ghost: null,
    ...overrides,
  }
}

describe('CC-103.4: dirty-region redraw — no full-canvas repaint per frame', () => {
  test('CC-103.4: the first render touches every always-on layer (non-vacuity)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { renderer, target } = await makeRenderer()
    renderer.renderNow(state())
    for (const layer of ['ruler', 'waveform', 'blocks', 'handles', 'playhead'] as const) {
      expect(target.countFor(layer), `layer ${layer} drew on first paint`).toBeGreaterThan(0)
    }
    expect(target.ops().length, 'the recorder actually recorded ops').toBeGreaterThan(10)
  })

  test('CC-103.4: a scheduled frame with a clean dirty set emits NO draw ops', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { renderer, target, rafs } = await makeRenderer()
    renderer.renderNow(state())
    const opsAfterFirst = target.ops().length
    renderer.schedule()
    rafs.frame(16)
    expect(target.ops().length, 'clean frame repaints nothing').toBe(opsAfterFirst)
  })

  test('CC-103.4: a playhead-only invalidation repaints the playhead layer ONLY', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { renderer, target, rafs } = await makeRenderer()
    renderer.renderNow(state())
    const before = renderer.stats().drawsByLayer
    expect(before.playhead, 'playhead layer drew at least once before').toBeGreaterThan(0)
    renderer.invalidate('playhead')
    renderer.schedule()
    rafs.frame(16)
    const after = renderer.stats()
    expect(after.passes, 'exactly one additional flush').toBe(2)
    expect(after.drawsByLayer.blocks, 'the blocks layer was NOT repainted').toBe(before.blocks)
    expect(after.drawsByLayer.ruler, 'the ruler was NOT repainted').toBe(before.ruler)
    expect(after.drawsByLayer.waveform, 'the waveform was NOT repainted').toBe(before.waveform)
    expect(after.drawsByLayer.playhead, 'the playhead layer WAS repainted').toBeGreaterThan(before.playhead)
    expect(target.layersDrawn().includes('playhead'), 'the recorder saw playhead ops').toBe(true)
  })

  test('CC-103.4: repeated schedules coalesce to ONE rAF pass (FR-103.1 rAF-coalesced dirty flags)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { renderer, rafs } = await makeRenderer()
    renderer.renderNow(state())
    const passesBefore = renderer.stats().passes
    renderer.invalidate('blocks')
    renderer.schedule()
    renderer.invalidate('playhead')
    renderer.schedule()
    renderer.invalidate('ruler')
    renderer.schedule()
    expect(rafs.pending(), 'the three schedules sit on a single pending frame').toBe(1)
    rafs.frame(16)
    expect(renderer.stats().passes, 'three invalidations + three schedules → one pass').toBe(passesBefore + 1)
    expect(renderer.dirtyLayers(), 'the dirty set clears on flush').toEqual([])
  })
})

describe('CC-103.1 + FR-103.1: dpr scaling and resize', () => {
  test('CC-103.1: resize scales the backing store by dpr and records the dpr transform', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { renderer, target } = await makeRenderer()
    renderer.resize(400, 100, 2)
    expect(target.width, 'backing store width = round(css × dpr)').toBe(800)
    expect(target.height, 'backing store height = round(css × dpr)').toBe(200)
    expect(target.transforms().at(-1), 'the dpr scale transform is recorded').toEqual([2, 0, 0, 2, 0, 0])
    renderer.resize(400, 100, 1)
    expect(target.width, 'dpr 1 → 1:1 backing store').toBe(400)
    expect(target.transforms().at(-1), 'identity transform at dpr 1').toEqual([1, 0, 0, 1, 0, 0])
  })

  test('CC-103.1: the loop-region shade is the viewport-mapped rectangle (FR-103.6)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const vp = await import(/* @vite-ignore */ '@ui/timeline/viewport')
    const shade = vp.loopShade([1, 2.5], { t0: 0, pxPerSec: 100 })
    expect(shade?.x, 'x = (1 − 0)·100').toBe(100)
    expect(shade?.width, 'width = (2.5 − 1)·100').toBe(150)
    expect(vp.loopShade(null, { t0: 0, pxPerSec: 100 }), 'no loop region → no shade').toBeNull()
  })
})

describe('CC-103.1 + FR-103.5: block visuals are data', () => {
  const opts = { viewport: { t0: 0.5, pxPerSec: 120 }, selected: false, focused: false, ghosted: false, speakerColor: '#4c8dff' }

  test('CC-103.1: time-width mapping is the viewport mapping applied to the block span', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { m } = await makeRenderer()
    const blk = timelineBlocks()[0]
    if (blk === undefined) throw new Error('fixture missing')
    const visual = m.blockVisuals(blk, opts)
    expect(visual.x, 'x = (start − t0)·pxPerSec').toBeCloseTo((blk.start - 0.5) * 120, 6)
    expect(visual.width, 'width = (end − start)·pxPerSec').toBeCloseTo((blk.end - blk.start) * 120, 6)
    expect(visual.speakerColor, 'speaker color from the caller-resolved palette').toBe('#4c8dff')
    expect(visual.ellipsizedText.length, 'preview text derived from the block text').toBeGreaterThan(0)
  })

  test('CC-103.1: the low-confidence dot flag is data — 0.2 low, 0.98/absent not low', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { m } = await makeRenderer()
    const blocks = timelineBlocks()
    const low = blocks.find((b) => b.id === 'blk_v2')
    const high = blocks.find((b) => b.id === 'blk_v5')
    const none = blocks.find((b) => b.id === 'blk_v3')
    if (low === undefined || high === undefined || none === undefined) throw new Error('fixture missing')
    expect(m.blockVisuals(low, opts).lowConfidence, 'confidence 0.2 → dot').toBe(true)
    expect(m.blockVisuals(high, opts).lowConfidence, 'confidence 0.98 → no dot').toBe(false)
    expect(m.blockVisuals(none, opts).lowConfidence, 'absent confidence (invariant 7) → no dot').toBe(false)
  })

  test('CC-103.1: text that does not fit is ellipsized with U+2026; short text passes through', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { m } = await makeRenderer()
    const measure = (t: string) => t.length * 6
    const narrow = { id: 'blk_w', start: 0, end: 0.05, text: 'a very long sentence that cannot fit a five-pixel-wide block at all', words: [{ text: 'x', start: 0, end: 0.05 }], speakerId: 'SPK_1' }
    const noFit = m.blockVisuals(narrow, { ...opts, viewport: { t0: 0, pxPerSec: 100 }, measure })
    expect(noFit.truncated, 'does-not-fit → truncated').toBe(true)
    expect(noFit.ellipsizedText.endsWith('\u2026'), 'ellipsized text ends with U+2026').toBe(true)
    const fits = m.blockVisuals({ ...narrow, text: 'ok' }, { ...opts, viewport: { t0: 0, pxPerSec: 100 }, measure })
    expect(fits.truncated, 'short text is not truncated').toBe(false)
    expect(fits.ellipsizedText, 'untruncated text passes through').toBe('ok')
  })

  test('CC-103.1: selected/focused/ghosted state passes through the visuals', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { m } = await makeRenderer()
    const blk = timelineBlocks()[0]
    if (blk === undefined) throw new Error('fixture missing')
    const visual = m.blockVisuals(blk, { ...opts, selected: true, focused: true, ghosted: true })
    expect([visual.selected, visual.focused, visual.ghosted], 'state flags').toEqual([true, true, true])
  })
})

describe('CC-103.1 + FR-103.4: waveform bucket mapping (PeaksData → pixels)', () => {
  test('CC-103.1: re-bucketing is zoom-aware — coarse merges (min/max preserved), fine splits (exact copy)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await import(/* @vite-ignore */ '@ui/timeline/waveform')
    const peaks = makePeaks(0.01, 500) // 0–5 s, deterministic sawtooth-ish amplitudes
    // Coarse: 200 px / 40 pxPerSec = 5 s visible, 2 px buckets = 0.05 s → 100 buckets of 5 native each.
    const coarse = m.rebucketPeaks(peaks, { t0: 0, pxPerSec: 40 }, 200, 2)
    expect(coarse.length, '5 s ÷ 0.05 s buckets').toBe(100)
    let firstFiveMax = -Infinity
    for (let i = 0; i < 5; i++) firstFiveMax = Math.max(firstFiveMax, peaks.max[i] ?? 0)
    expect(coarse[0]?.max, 'merged bucket takes the native max').toBe(firstFiveMax)
    expect(coarse[0]?.min, 'and the native min (symmetric fake)').toBe(-firstFiveMax)
    // Fine: 500 px / 400 pxPerSec = 1.25 s visible, 2 px buckets = 0.005 s → 250 buckets, one native per two buckets.
    const fine = m.rebucketPeaks(peaks, { t0: 0, pxPerSec: 400 }, 500, 2)
    expect(fine.length, '1.25 s ÷ 0.005 s buckets').toBe(250)
    expect(fine[0]?.min, 'split buckets copy the native value (no invention)').toBe(peaks.min[0])
    expect(fine[0]?.max).toBe(peaks.max[0])
    expect(fine[4]?.min, 'bucket 4 = native bucket 2 (0.02 s)').toBe(peaks.min[2])
    expect(fine[4]?.max).toBe(peaks.max[2])
  })

  test('CC-103.1: re-bucketing respects the scrolled viewport', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await import(/* @vite-ignore */ '@ui/timeline/waveform')
    const peaks = makePeaks(0.01, 500)
    const buckets = m.rebucketPeaks(peaks, { t0: 2, pxPerSec: 100 }, 100, 2)
    expect(buckets[0]?.t0, 'first visible bucket starts at the viewport t0').toBe(2)
    expect(buckets.at(-1)?.t1, 'last bucket ends at t0 + widthPx/pxPerSec = 3 s').toBeCloseTo(3, 6)
  })

  test('CC-103.1: silence markers are the maximal near-zero runs (FR-103.4)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await import(/* @vite-ignore */ '@ui/timeline/waveform')
    const markers = m.silenceMarkers(makePeaksWithSilence(0.01, 100, 20, 30), 0.01)
    expect(markers, 'one maximal silent interval 0.2–0.3 s').toEqual([[0.2, 0.3]])
  })

  test('CC-103.4: the renderer paints waveform buckets and silence markers in the waveform layer', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await import(/* @vite-ignore */ '@ui/timeline/waveform')
    const { renderer, target } = await makeRenderer()
    const buckets = m.rebucketPeaks(makePeaks(0.01, 500), { t0: 0, pxPerSec: 40 }, 200, 2)
    renderer.renderNow(state({ waveform: buckets, silence: [[0.2, 0.3]] }))
    expect(target.countFor('waveform'), 'bucket geometry drew in the waveform layer').toBeGreaterThan(0)
  })
})
