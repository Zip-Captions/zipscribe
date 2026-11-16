// FR-107.1 DOM-side element probe (composition-root ONLY — never under unit
// test; the decision itself is pure in './choose-path', CC-107.1). Creates a
// detached muted `<audio>`, reads canPlayType(mime), attempts a timeboxed
// muted play() as probePlaySucceeded, and always tears the element down.
// Never throws: every failure mode (autoplay rejection, decode error,
// timeout) degrades to probePlaySucceeded: false — honesty clause:
// canPlayType is necessary but NOT sufficient, only the probe play decides.

import type { ElementProbeEvidence } from './choose-path'

const DEFAULT_TIMEOUT_MS = 300

export function probeElementPlayback(url: string, mime: string, opts: { timeoutMs?: number } = {}): Promise<ElementProbeEvidence> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise<ElementProbeEvidence>((resolve) => {
    const element = document.createElement('audio')
    element.muted = true
    element.preload = 'auto'
    let settled = false
    const finish = (probePlaySucceeded: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      element.removeAttribute('src')
      element.load()
      resolve({ canPlayType: element.canPlayType(mime), probePlaySucceeded })
    }
    const timer = setTimeout(() => {
      finish(false)
    }, timeoutMs)
    element.addEventListener('playing', () => {
      finish(true)
    })
    element.addEventListener('error', () => {
      finish(false)
    })
    element.src = url
    // The play() attempt itself; the 'playing' event (or a non-zero currentTime
    // at timeout) is the success evidence, everything else degrades to false.
    void element
      .play()
      .then(() => {
        if (element.currentTime > 0 || !element.paused) finish(true)
      })
      .catch(() => {
        finish(false)
      })
  })
}
