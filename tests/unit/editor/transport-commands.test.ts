// US-2.2.4 / FR-102.5 (L1): transport semantics as COMMAND DISPATCHES on the
// store/arbitrator seam — Space → play/pause, J/L → ±5 s (Shift → ±10 s),
// ←/→ → ±1 frame (asset fps), Shift+←/→ → ±1 s, I/O loop in/out from the
// playhead, Y loop toggle. The keyboard→command BINDING table is unit-105;
// here the commands themselves must exist, move the playhead through the
// arbitrator (clamped to [0, duration]), and own exactly one clock seek each.
import { describe, expect, test } from 'vitest'
import { createTestApp } from './helpers/editor-app'

function transport() {
  const t = createTestApp({ withMediaClock: true })
  return t
}

describe('US-2.2.4: transport commands at the store/arbitrator seam', () => {
  test('FR-102.5 (Space): play/pause commands drive the arbitrator and editor slice', () => {
    const { app } = transport()
    expect(app.dispatch('transport-play', undefined)).toBeNull()
    expect(app.editor.getState().playing, 'editor slice mirrors playback (transport UI renders it)').toBe(true)
    expect(app.arbitrator?.playing).toBe(true)

    expect(app.dispatch('transport-pause', undefined)).toBeNull()
    expect(app.editor.getState().playing).toBe(false)
    expect(app.arbitrator?.playing).toBe(false)
  })

  test('US-2.2.4 (J/L): transport-skip moves the playhead by the given seconds, clamped to the media', () => {
    const { app } = transport()
    expect(app.dispatch('transport-seek', { time: 10 })).toBeNull()
    expect(app.editor.getState().playhead).toBeCloseTo(10, 6)

    expect(app.dispatch('transport-skip', { seconds: -5 })).toBeNull()
    expect(app.editor.getState().playhead, 'J = −5 s').toBeCloseTo(5, 6)
    expect(app.dispatch('transport-skip', { seconds: -10 })).toBeNull()
    expect(app.editor.getState().playhead, 'Shift+J = −10 s').toBeCloseTo(0, 6)
    expect(app.dispatch('transport-skip', { seconds: -5 })).toBeNull()
    expect(app.editor.getState().playhead, 'clamped at 0 — never negative').toBe(0)

    expect(app.dispatch('transport-skip', { seconds: 130 })).toBeNull()
    expect(app.editor.getState().playhead, 'clamped at duration').toBe(121.44)
  })

  test('US-2.2.4 (←/→): one frame is 1/fps from the asset (25 fps → 0.04 s)', () => {
    const { app } = transport()
    app.dispatch('transport-seek', { time: 10 })
    expect(app.dispatch('transport-step-frame', { frames: 1 })).toBeNull()
    expect(app.editor.getState().playhead, '→ = +1 frame @25fps').toBeCloseTo(10.04, 6)
    expect(app.dispatch('transport-step-frame', { frames: -2 })).toBeNull()
    expect(app.editor.getState().playhead, '← = −1 frame, twice').toBeCloseTo(9.96, 6)
  })

  test('US-2.2.4 (Shift+←/→): one second steps', () => {
    const { app } = transport()
    app.dispatch('transport-seek', { time: 10 })
    expect(app.dispatch('transport-step-second', { seconds: -1 })).toBeNull()
    expect(app.editor.getState().playhead).toBeCloseTo(9, 6)
    expect(app.dispatch('transport-step-second', { seconds: 1 })).toBeNull()
    expect(app.editor.getState().playhead).toBeCloseTo(10, 6)
  })

  test('US-2.2.4: every seek-flavored transport command issues EXACTLY one clock seek (single-seek rule)', () => {
    const { app, mediaClock } = transport()
    if (mediaClock === null) throw new Error('media clock missing')
    const base = mediaClock.seekCalls
    app.dispatch('transport-seek', { time: 3 })
    app.dispatch('transport-skip', { seconds: 5 })
    app.dispatch('transport-step-frame', { frames: 1 })
    app.dispatch('transport-step-second', { seconds: 1 })
    expect(mediaClock.seekCalls - base, 'four commands → four element seeks, never two per command').toBe(4)
  })

  test('FR-102.5 (I/O/Y): loop set / in-out from playhead / toggle / clear live on the editor slice', () => {
    const { app } = transport()
    expect(app.dispatch('transport-loop-set', { start: 4, end: 8 })).toBeNull()
    expect(app.editor.getState().loop).toEqual([4, 8])
    expect(app.arbitrator?.loop).toEqual([4, 8])

    app.dispatch('transport-seek', { time: 12 })
    expect(app.dispatch('transport-loop-in', undefined)).toBeNull()
    expect(app.editor.getState().loop?.[0], 'I sets the loop IN from the playhead').toBe(12)

    app.dispatch('transport-seek', { time: 18 })
    expect(app.dispatch('transport-loop-out', undefined)).toBeNull()
    expect(app.editor.getState().loop?.[1], 'O sets the loop OUT from the playhead').toBe(18)

    const loopBefore = app.editor.getState().loop
    expect(app.dispatch('transport-loop-toggle', undefined)).toBeNull()
    expect(app.editor.getState().loop, 'Y toggles the loop off').toBeNull()
    expect(app.dispatch('transport-loop-toggle', undefined)).toBeNull()
    expect(app.editor.getState().loop, 'Y again re-arms the previous region').toEqual(loopBefore)

    expect(app.dispatch('transport-loop-clear', undefined)).toBeNull()
    expect(app.editor.getState().loop).toBeNull()
  })

  test('FR-102.5: transport commands are UI-only — no history steps (FR-102.2 undoable:false)', () => {
    const { app } = transport()
    app.dispatch('transport-play', undefined)
    app.dispatch('transport-seek', { time: 7 })
    app.dispatch('transport-skip', { seconds: 5 })
    app.dispatch('transport-rate', { rate: 1.5 })
    expect(app.history.undoCount()).toBe(0)
  })

  test('FR-102.3: the playhead only ever comes from the clock — paused frames freeze it', () => {
    const { app, mediaClock, frame } = transport()
    if (mediaClock === null) throw new Error('media clock missing')
    app.dispatch('transport-play', undefined)
    frame(100)
    const advanced = app.editor.getState().playhead
    expect(advanced, 'rAF sampling from the injected clock advanced the playhead').toBeGreaterThan(0.09)
    app.dispatch('transport-pause', undefined)
    frame(100)
    expect(app.editor.getState().playhead, 'frozen while paused (single truth)').toBe(advanced)
  })
})
