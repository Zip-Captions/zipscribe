// Export-side shared entry (CC-201.2): the export worker renders every frame
// through drawCaptions via this module — preview (ui/canvas adapter) and
// burn-in (worker OffscreenCanvas) therefore execute the SAME renderer code
// path, not two lookalikes. Unit-202 builds the real encode loop on top of
// this; the worker stub consumes it already.

import { drawCaptions, type OverlayFrame } from './overlay'

export type OverlayProbeFrame = Omit<OverlayFrame, never>

/** Draw one overlay frame on any 2D context (worker OffscreenCanvas parity). */
export function renderProbeFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, frame: OverlayProbeFrame): void {
  drawCaptions(ctx, frame)
}
