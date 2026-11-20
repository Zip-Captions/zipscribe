// Capability gating model for the export dialog (FR-202.2, CC-202.3/CC-202.4).
// Computed options — never hidden-but-broken. Pure function of
// (capabilities, asset.kind); the dialog renders exactly this model.
import type { Capabilities } from '../../engine/model/capability'

export type BurnInGate =
  | { mode: 'full' } // T1/T2 video: encoder set complete
  | { mode: 'absent-reason'; reason: string } // T3 video: absent control + one line
  | { mode: 'requirements' } // T4 video: requirements copy, no controls
  | { mode: 'none' } // any tier, audio project: renders nothing at all

export const REQUIREMENTS_COPY = 'Burn-in MP4 needs WebCodecs video + audio encoders (Chrome/Edge 120+, Firefox 135+, Safari 26+). Sidecar exports (SRT/VTT/JSON/TSV) always work.'

export function burnInGate(capabilities: Capabilities, kind: 'audio' | 'video'): BurnInGate {
  if (kind === 'audio') return { mode: 'none' }
  if (capabilities.tier === 'T4') return { mode: 'requirements' }
  if (capabilities.videoEncoder && capabilities.audioEncoder) return { mode: 'full' }
  const missing: string[] = []
  if (!capabilities.videoEncoder) missing.push('VideoEncoder')
  if (!capabilities.audioEncoder) missing.push('AudioEncoder')
  return { mode: 'absent-reason', reason: `Burn-in MP4 unavailable — ${missing.join(' + ')} not supported in this browser.` }
}

/** Resolution ladder ≤ source (never upscales): full height then halving to ≥480, even numbers. */
export function resolutionChoices(sourceHeight: number): number[] {
  const out: number[] = []
  let h = sourceHeight % 2 === 0 ? sourceHeight : sourceHeight - 1
  while (h >= 480) {
    out.push(h)
    h = Math.floor(h / 2 / 2) * 2
  }
  if (out.length === 0) out.push(h > 0 ? h : 480)
  return out
}

/** fps ladder ≤ source from the standard grid. */
export const FPS_GRID = [60, 50, 30, 25, 24] as const
export function fpsChoices(sourceFps: number): number[] {
  const grid = FPS_GRID.filter((f) => f <= Math.floor(sourceFps))
  // sub-grid sources (e.g. 10 fps fixtures): offer the source itself rather
  // than an empty ladder or an upscale.
  return grid.length > 0 ? grid : [Math.max(1, Math.floor(sourceFps))]
}
