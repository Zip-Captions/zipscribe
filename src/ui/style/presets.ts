// Preset registry (FR-201.3). The patch table is the engine-side verbatim
// unit-200 spec (`engine/style/presets.ts`, FR-201.7); this module adds the
// thumbnail RENDERER — thumbnails are produced by the same shared overlay
// renderer against a sample block, never static images (no drift).

import { CAPTION_PRESETS, PRESET_ORDER, type CaptionPreset, type PresetId } from '@engine/style/presets'
import { drawCaptions } from '@engine/export/overlay'
import type { CaptionBlock } from '@engine/model'

export { CAPTION_PRESETS, PRESET_ORDER, type CaptionPreset, type PresetId }

/** Sample block for thumbnails — same corpus as the unit-200 renders. */
export const THUMBNAIL_SAMPLE: CaptionBlock = {
  id: 'thumb', start: 0, end: 4, text: 'welcome back',
  words: [
    { text: 'welcome', start: 0, end: 2 },
    { text: 'back', start: 2, end: 4 },
  ],
  speakerId: 'SPK_1',
}

/** Draw a preset preview (mid-grey frame, worst case per design pass) into
 *  any 2D context at (w, h) — used by the preset picker thumbnails. */
export function renderPresetThumbnail(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, preset: CaptionPreset, w: number, h: number, time = 2.6): void {
  ctx.save()
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
  drawCaptions(ctx, {
    blocks: [THUMBNAIL_SAMPLE],
    time,
    style: preset.patch,
    track: 'source',
    width: w,
    height: h,
    speakerPalette: preset.id === 'broadcast-box' ? ['#4c8dff'] : [],
  })
}
