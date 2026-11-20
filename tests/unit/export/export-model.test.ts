// CC-202.3 (L2): the option ladders — never upscale, never empty.
import { describe, expect, test } from 'vitest'
import { fpsChoices, resolutionChoices } from '@ui/export/export-model'

describe('export option ladders', () => {
  test('CC-202.3: resolutions descend from source height, even, ≥ 480', () => {
    expect(resolutionChoices(1080)).toEqual([1080, 540])
    expect(resolutionChoices(720)).toEqual([720])
    expect(resolutionChoices(1081)).toEqual([1080, 540])
  })

  test('CC-202.3: sub-480 sources keep their own height (no upscale)', () => {
    expect(resolutionChoices(180)).toEqual([180])
  })

  test('CC-202.3: fps grid ≤ source', () => {
    expect(fpsChoices(60)).toEqual([60, 50, 30, 25, 24])
    expect(fpsChoices(30)).toEqual([30, 25, 24])
    expect(fpsChoices(29.97)).toEqual([25, 24])
  })

  test('CC-202.3: sub-grid fps falls back to the source, never empty', () => {
    expect(fpsChoices(10)).toEqual([10])
    expect(fpsChoices(2)).toEqual([2])
    expect(fpsChoices(0.5)).toEqual([1])
  })
})
