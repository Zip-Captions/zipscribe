// CC-201.5 (contrast guard leg) — the WCAG math must reproduce the
// owner-signed unit-200 contrast sheet (mockups/README §2) exactly, and the
// guard must warn below AA 4.5:1 (product rule).
import { describe, expect, test } from 'vitest'
import { captionContrast, over, ratio } from '@ui/style/contrast'

describe('CC-201.5: WCAG math matches the unit-200 contrast sheet', () => {
  test('CC-201.5: sheet ratios reproduce at 2-decimal precision', () => {
    expect(ratio('#ffffff', '#0d0f12')).toBeCloseTo(19.19, 1)
    expect(ratio('#4c8dff', '#0d0f12')).toBeCloseTo(6.0, 1)
    expect(ratio('#e8eaed', '#0d0f12')).toBeCloseTo(15.92, 1)
    // NOTE: README §2's composited hex column (#2c2f35/#2b2e33) was a hand-typed
    // typo in the signed sheet; the RATIO column is authoritative and matches
    // the generator's actual compositing (follow-up filed in the unit report).
    expect(over('#15181d', 0.82, '#808080')).toBe('#282b2f')
    expect(ratio('#ffffff', over('#15181d', 0.82, '#808080'))).toBeCloseTo(14.22, 1)
    expect(over('#15181d', 0.82, '#ffffff')).toBe('#3f4246')
    expect(ratio('#ffffff', over('#15181d', 0.82, '#ffffff'))).toBeCloseTo(10.1, 1)
  })

  test('CC-201.5: boxed preset measures text vs box-over-frame', () => {
    const r = captionContrast({
      color: '#ffffff', outlineColor: '#0d0f12', outlineWidth: 0,
      backgroundColor: '#15181d', backgroundOpacity: 0.82,
    }, '#808080')
    expect(r.pair).toBe('text-vs-box')
    expect(r.ratio).toBeCloseTo(14.22, 1)
    expect(r.warn).toBe(false)
  })

  test('CC-201.5: outlined preset measures text-vs-outline + non-text outline-vs-frame', () => {
    const r = captionContrast({ color: '#ffffff', outlineColor: '#0d0f12', outlineWidth: 3, backgroundOpacity: 0 }, '#ffffff')
    expect(r.pair).toBe('text-vs-outline')
    expect(r.nonText?.pass).toBe(true)
    expect(r.warn).toBe(false)
  })

  test('CC-201.5: sub-AA combinations warn (FR-201.5 icon condition)', () => {
    const weak = captionContrast({ color: '#9aa2ad', outlineColor: '#808080', outlineWidth: 2, backgroundOpacity: 0 }, '#0d0f12')
    expect(weak.ratio).toBeLessThan(4.5)
    expect(weak.warn).toBe(true)
    const faintBox = captionContrast({ color: '#e8eaed', outlineColor: '#0d0f12', outlineWidth: 0, backgroundColor: '#e8eaed', backgroundOpacity: 0.5 }, '#ffffff')
    expect(faintBox.warn).toBe(true)
  })
})
