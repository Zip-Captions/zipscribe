// CC-107.1 (FR-107.1): the PURE clock-path decision, called ONCE at project
// open by the composition root. L1-table-tested against browser capability
// profiles as TEST INPUT DATA (choose-path.test.ts) — there is deliberately
// no UA sniffing and no DOM here; the DOM-side evidence gatherer lives in
// './probe-element' (composition-root only).
import type { MediaAsset } from '../../../engine/model'

export interface ElementProbeEvidence {
  /** `element.canPlayType(mime)` result; `''` means unsupported. */
  canPlayType: string
  /** The muted probe play started playback before the timeout. */
  probePlaySucceeded: boolean
}

export type PlaybackPath = 'element' | 'decoded'

export function choosePlaybackPath(asset: MediaAsset, probe: ElementProbeEvidence): PlaybackPath {
  // Video always rides the element (decoded VIDEO playback is a seed —
  // architecture § Playback & preview; the decoded clock is mono/stereo
  // audio PCM only).
  if (asset.kind !== 'audio') return 'element'
  if (probe.canPlayType === '') return 'decoded'
  if (!probe.probePlaySucceeded) return 'decoded'
  return 'element'
}
