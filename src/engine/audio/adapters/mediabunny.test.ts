// Unit-04 slice 4D — L1 guard on the metadata-first duration rule
// (src/engine/audio/adapters/mediabunny.ts). Regression: fmt-30s.weba carried a
// randomised Matroska Duration element (0x4489 — mislabelled DateUTC in the
// fixture recipe) and the old `Number.isFinite(v) && v > 0` rule served
// 1.99e-195 s as the declared duration, poisoning progress/totalSec. The
// envelope keeps a healthy container's own metadata (the fast path) while
// implausible values fall through to `computeDuration()`.

import { describe, expect, test } from 'vitest'
import { isPlausibleDeclaredDuration, METADATA_DURATION_MAX_SEC, METADATA_DURATION_MIN_SEC } from './mediabunny'

describe('isPlausibleDeclaredDuration (unit-04 4D sanity envelope)', () => {
  test('accepts real-world durations at the envelope edges', () => {
    expect(isPlausibleDeclaredDuration(30)).toBe(true)
    expect(isPlausibleDeclaredDuration(METADATA_DURATION_MIN_SEC)).toBe(true)
    expect(isPlausibleDeclaredDuration(METADATA_DURATION_MAX_SEC)).toBe(true)
  })

  test('rejects the weba-regression value and every non-positive / non-finite shape', () => {
    expect(isPlausibleDeclaredDuration(1.9915549954142635e-195)).toBe(false)
    expect(isPlausibleDeclaredDuration(0)).toBe(false)
    expect(isPlausibleDeclaredDuration(-30)).toBe(false)
    expect(isPlausibleDeclaredDuration(Number.NaN)).toBe(false)
    expect(isPlausibleDeclaredDuration(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isPlausibleDeclaredDuration(Number.MAX_VALUE)).toBe(false)
  })

  test('rejects non-numbers (undefined metadata ⇒ computeDuration fallback)', () => {
    expect(isPlausibleDeclaredDuration(undefined)).toBe(false)
    expect(isPlausibleDeclaredDuration(null)).toBe(false)
    expect(isPlausibleDeclaredDuration('30')).toBe(false)
  })
})
