// Canvas recorder double — the injected `DrawTarget` (unit103-api-contract.d.ts
// § @ui/timeline/renderer). Records every op inside its beginLayer/endLayer
// bracket so the dirty-region redraw counts are observable (CC-103.4) without
// touching a real canvas (jsdom has none; node has no DOM at all).
// SECURITY-03: only op NAMES, numeric args and color TOKEN strings recorded;
// fillText records the drawn text — suites passing canary content through a
// render must attach `createRedactionSpy` (the recorder itself never logs).
import type { DrawTarget, TimelineLayer } from '@ui/timeline/renderer'

export interface CanvasDrawRecord {
  layer: TimelineLayer | 'unlayered'
  op: string
  args: Array<string | number>
  /** fillStyle/strokeStyle active at record time (design token values). */
  style: string
}

export interface CanvasRecorder extends DrawTarget {
  ops(): readonly CanvasDrawRecord[]
  /** All ops recorded inside `beginLayer(layer)` … `endLayer()`. */
  drawsFor(layer: TimelineLayer): CanvasDrawRecord[]
  /** Distinct layers that received at least one op. */
  layersDrawn(): TimelineLayer[]
  /** Every recorded setTransform argument tuple, in order. */
  transforms(): Array<Array<string | number>>
  /** fillText payloads per layer (visual text assertions). */
  texts(layer?: TimelineLayer): Array<{ layer: TimelineLayer | 'unlayered'; text: string }>
  /** Count of recorded ops in `layer` — the redraw-count sampler. */
  countFor(layer: TimelineLayer): number
  clear(): void
}

export function createCanvasRecorder(): CanvasRecorder {
  const recorded: CanvasDrawRecord[] = []
  const transforms: Array<Array<string | number>> = []
  let current: TimelineLayer | 'unlayered' = 'unlayered'

  const recorder: CanvasRecorder = {
    width: 0,
    height: 0,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '12px Inter',
    beginLayer: (layer: TimelineLayer) => {
      current = layer
    },
    endLayer: () => {
      current = 'unlayered'
    },
    setTransform: (a, b, c, d, e, f) => {
      const args = [a, b, c, d, e, f]
      transforms.push(args)
      recorded.push({ layer: current, op: 'setTransform', args, style: recorder.fillStyle })
    },
    clearRect: (x, y, w, h) => recorded.push({ layer: current, op: 'clearRect', args: [x, y, w, h], style: recorder.fillStyle }),
    fillRect: (x, y, w, h) => recorded.push({ layer: current, op: 'fillRect', args: [x, y, w, h], style: recorder.fillStyle }),
    strokeRect: (x, y, w, h) => recorded.push({ layer: current, op: 'strokeRect', args: [x, y, w, h], style: recorder.strokeStyle }),
    fillText: (text, x, y) => recorded.push({ layer: current, op: 'fillText', args: [text, x, y], style: recorder.fillStyle }),
    beginPath: () => recorded.push({ layer: current, op: 'beginPath', args: [], style: recorder.strokeStyle }),
    moveTo: (x, y) => recorded.push({ layer: current, op: 'moveTo', args: [x, y], style: recorder.strokeStyle }),
    lineTo: (x, y) => recorded.push({ layer: current, op: 'lineTo', args: [x, y], style: recorder.strokeStyle }),
    stroke: () => recorded.push({ layer: current, op: 'stroke', args: [], style: recorder.strokeStyle }),
    measureText: (text: string) => ({ width: text.length * 6 }),
    ops: () => recorded,
    drawsFor: (layer: TimelineLayer) => recorded.filter((entry) => entry.layer === layer),
    layersDrawn: () => [...new Set(recorded.filter((entry) => entry.layer !== 'unlayered').map((entry) => entry.layer))] as TimelineLayer[],
    transforms: () => transforms,
    texts: (layer?: TimelineLayer) =>
      recorded
        .filter((entry) => entry.op === 'fillText' && (layer === undefined || entry.layer === layer))
        .map((entry) => ({ layer: entry.layer, text: String(entry.args[0] ?? '') })),
    countFor: (layer: TimelineLayer) => recorded.filter((entry) => entry.layer === layer).length,
    clear: () => {
      recorded.length = 0
      transforms.length = 0
      current = 'unlayered'
    },
  }
  return recorder
}
