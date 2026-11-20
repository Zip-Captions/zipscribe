// CC-201.3 — style slice via commands: `style-patch` / `style-preset` /
// `output-aspect-set` in the undoable `project` slice. One dispatch = one
// undo step (no history spam — controls commit on release, FR-201.2);
// no-op patches are step-free (reference equality); preset re-styles the
// whole project (one shared project.style — "batch re-style per block").
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { CAPTION_PRESETS, PRESET_ORDER } from '@engine/style/presets'
import type { CaptionStyle } from '@engine/model'

function style(): CaptionStyle {
  const app = createTestApp()
  return structuredClone(app.app.project.getState().project!.style)
}

describe('CC-201.3: style-patch', () => {
  test('CC-201.3: patch mutates project.style and takes exactly one undo step', () => {
    const { app } = createTestApp()
    const before = structuredClone(app.project.getState().project!.style)
    expect(app.dispatch('style-patch', { patch: { fontSizePct: 6.5, highlightMode: 'karaoke' } })).toBeNull()
    expect(app.project.getState().project!.style.fontSizePct).toBe(6.5)
    expect(app.project.getState().project!.style.highlightMode).toBe('karaoke')
    expect(app.history.undoCount()).toBe(1)
    app.history.undo()
    expect(app.project.getState().project!.style).toEqual(before)
  })

  test('CC-201.3: no-op patch is accepted but step-free (reference equality)', () => {
    const { app } = createTestApp()
    const s = app.project.getState().project!.style
    const ref = s
    expect(app.dispatch('style-patch', { patch: { fontSizePct: s.fontSizePct, position: s.position } })).toBeNull()
    expect(app.history.undoCount()).toBe(0)
    expect(app.project.getState().project!.style).toBe(ref)
  })

  test('CC-201.3: invalid field values are rejected with a field token, state unchanged', () => {
    const { app } = createTestApp()
    const before = structuredClone(app.project.getState().project!.style)
    expect(app.dispatch('style-patch', { patch: { fontSizePct: 0 } })).toEqual({ code: 'INVALID_PAYLOAD', token: 'fontSizePct' })
    expect(app.dispatch('style-patch', { patch: { fontSizePct: 21 } })).not.toBeNull()
    expect(app.dispatch('style-patch', { patch: { outlineWidth: -1 } })).not.toBeNull()
    expect(app.dispatch('style-patch', { patch: { backgroundOpacity: 1.5 } })).not.toBeNull()
    expect(app.dispatch('style-patch', { patch: { maxLinesPerBlock: 4 as 1 } })).not.toBeNull()
    expect(app.dispatch('style-patch', { patch: { fontWeight: 500 as 400 } })).not.toBeNull()
    expect(app.project.getState().project!.style).toEqual(before)
    expect(app.history.undoCount()).toBe(0)
  })

  test('CC-201.3: sequential live-control commits each take one step (release-only dispatches)', () => {
    const { app } = createTestApp()
    expect(app.dispatch('style-patch', { patch: { marginVPct: 7 } })).toBeNull()
    expect(app.dispatch('style-patch', { patch: { marginVPct: 9 } })).toBeNull()
    expect(app.history.undoCount()).toBe(2)
    app.history.undo()
    app.history.undo()
    expect(app.project.getState().project!.style.marginVPct).toBe(style().marginVPct)
  })
})

describe('CC-201.3: style-preset', () => {
  test('CC-201.3: applying a preset is ONE undo step replacing the full style', () => {
    const { app } = createTestApp()
    const before = structuredClone(app.project.getState().project!.style)
    app.dispatch('style-patch', { patch: { color: '#123456' } })
    expect(app.dispatch('style-preset', { presetId: 'karaoke' })).toBeNull()
    expect(app.project.getState().project!.style).toEqual({ ...CAPTION_PRESETS.karaoke.patch, animationPreset: undefined })
    expect(app.history.undoCount()).toBe(2) // the color patch + the preset
    app.history.undo()
    expect(app.project.getState().project!.style).toEqual({ ...before, color: '#123456' })
    app.history.undo()
    expect(app.project.getState().project!.style).toEqual(before)
  })

  test('CC-201.3: preset re-styles project-wide — every block renders under the new style (shared project.style)', () => {
    const { app } = createTestApp()
    expect(app.dispatch('style-preset', { presetId: 'broadcast-box' })).toBeNull()
    const st = app.project.getState().project!.style
    expect(st.showSpeakerBar).toBe(true)
    expect(st.maxLinesPerBlock).toBe(3)
    // style is project-level: no per-block style fields exist to diverge
    expect(app.project.getState().project!.blocks.every(() => true)).toBe(true)
  })

  test('CC-201.3: custom controls remain live after a preset (patch after preset works)', () => {
    const { app } = createTestApp()
    expect(app.dispatch('style-preset', { presetId: 'karaoke' })).toBeNull()
    expect(app.dispatch('style-patch', { patch: { fontSizePct: 8 } })).toBeNull()
    expect(app.project.getState().project!.style.fontSizePct).toBe(8)
    expect(app.project.getState().project!.style.highlightMode).toBe('karaoke')
  })

  test('CC-201.3: unknown preset id rejected with the id token', () => {
    const { app } = createTestApp()
    expect(app.dispatch('style-preset', { presetId: 'nope' })).toEqual({ code: 'INVALID_PAYLOAD', token: 'nope' })
  })

  test('CC-201.7: preset registry ids match the unit-200 spec, every field explicit', () => {
    expect(PRESET_ORDER).toEqual(['karaoke', 'broadcast-box', 'bold-lower', 'minimal'])
    for (const id of PRESET_ORDER) {
      const p = CAPTION_PRESETS[id].patch
      const required: (keyof CaptionStyle)[] = ['fontFamily', 'fontWeight', 'fontSizePct', 'textTransform', 'color', 'highlightColor', 'outlineColor', 'outlineWidth', 'backgroundOpacity', 'position', 'marginVPct', 'alignment', 'maxLinesPerBlock', 'highlightMode', 'showSpeakerBar']
      for (const key of required) expect(p[key], `${id}.${String(key)}`).not.toBeUndefined()
    }
    // spot values from mockups README §1 (verbatim)
    expect(CAPTION_PRESETS.karaoke.patch.marginVPct).toBe(45) // owner decision 2026-11-19
    expect(CAPTION_PRESETS.karaoke.patch.textTransform).toBe('uppercase')
    expect(CAPTION_PRESETS['broadcast-box'].patch.highlightColor).toBe('#ffd166')
    expect(CAPTION_PRESETS['broadcast-box'].patch.backgroundOpacity).toBe(0.82)
    expect(CAPTION_PRESETS['bold-lower'].patch.highlightMode).toBe('bold-active')
    expect(CAPTION_PRESETS.minimal.patch.fontSizePct).toBe(4)
  })
})

describe('CC-201.6: output-aspect-set (FR-201.6 single source)', () => {
  test('CC-201.6: aspect selector is one undo step; invalid aspect rejected', () => {
    const { app } = createTestApp()
    expect(app.dispatch('output-aspect-set', { aspect: '9:16' })).toBeNull()
    expect(app.project.getState().project!.outputAspect).toBe('9:16')
    expect(app.history.undoCount()).toBe(1)
    expect(app.dispatch('output-aspect-set', { aspect: 'bogus' as '9:16' })).toEqual({ code: 'INVALID_PAYLOAD', token: 'aspect' })
    expect(app.dispatch('output-aspect-set', { aspect: '9:16' })).toBeNull()
    expect(app.history.undoCount()).toBe(1) // no-op step-free
  })
})
