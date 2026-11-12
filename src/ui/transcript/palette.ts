// Recolor palette (US-2.1.7): the design token `--speaker-palette`
// (knowledge/design.md § Design tokens, defined in workbench.css per theme) is
// the single source in a real browser; jsdom (no computed token) falls back
// to the engine palette constant (src/engine/diarize/assign.ts) so L2 suites
// stay deterministic. No raw hex is ever restated here (conventions § UI
// conventions).

import { SPEAKER_PALETTE } from '../../engine/diarize/assign'

export function speakerPalette(): readonly string[] {
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--speaker-palette')
    const parsed = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => /^#[0-9a-f]{3,8}$/i.test(entry))
    if (parsed.length > 0) return parsed
  }
  return SPEAKER_PALETTE
}
