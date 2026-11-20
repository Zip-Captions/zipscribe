// Test-only style bridge (unit-201, seventh sibling of the ziptest bridges).
// Installed by App.tsx ONLY under strict `?ziptest=1` (lazy; out of the
// initial bundle). Exposes the SHARED renderer entry for golden + identity
// specs: the spec PUSHES frame data (fixture content) and receives IMAGE
// bytes back — no transcript text ever leaves via this bridge (SECURITY-03).

import { getAppContext } from '../../app/context'
import { renderProbeFrame } from '@engine/export/probe-frame'
import { safeMargins } from '@engine/export/overlay'
import type { OverlayFrame } from '@engine/export/overlay'
import type { CaptionBlock } from '@engine/model'
import { speakerPalette } from '../transcript/palette'
import { ensureDefaultFonts, enableRemoteFont, isInBundledCoverage } from '../style/fonts'
import { CAPTION_PRESETS, type PresetId } from '@engine/style/presets'
import type { CaptionStyle } from '@engine/model'

interface StyleBridge {
  /** render one overlay frame offscreen; returns a PNG data URL (image bytes only) */
  renderOverlayPng(frame: OverlayFrame, dpr?: number): Promise<string>
  ensureDefaultFonts(): Promise<void>
  enableRemoteFont(family: string): Promise<boolean>
  isInBundledCoverage(text: string): boolean
  fontLoaded(family: string, weight: number): boolean
  /** style data for golden frames (UI metadata only — SECURITY-03 safe) */
  getPresetStyle(id: string): CaptionStyle
  /** CC-201.2/US-3.1.4: render the LIVE project's captions at `time` on an
   *  OffscreenCanvas exactly as the export worker does — returns image bytes
   *  only (no text ever leaves; SECURITY-03). */
  renderCaptionsForTime(time: number, width: number, height: number, dpr?: number): Promise<string>
  aspectMargins(aspect: 'source' | '16:9' | '9:16' | '1:1' | '4:5'): { widthFraction: number; topFraction: number; bottomFraction: number }
}

declare global {
  interface Window {
    __zipStyleTest?: StyleBridge
  }
}

export function installStyleBridge(): void {
  const bridge: StyleBridge = {
    async renderOverlayPng(frame, dpr = 1) {
      const canvas = new OffscreenCanvas(frame.width * dpr, frame.height * dpr)
      const ctx = canvas.getContext('2d')
      if (ctx === null) throw new Error('STYLE_NO_CTX')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderProbeFrame(ctx, frame)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return `data:image/png;base64,${btoa(bin)}`
    },
    async ensureDefaultFonts() {
      await ensureDefaultFonts()
    },
    enableRemoteFont,
    isInBundledCoverage,
    fontLoaded(family, weight) {
      // measure OUR registration (FontFaceSet entries), not document.fonts.check
      // — check() reports true for OS-installed fallbacks, which would make the
      // offline assertion environment-dependent.
      if (typeof document === 'undefined' || !('fonts' in document)) return false
      for (const face of document.fonts) {
        if (face.family.replace(/^['"]|['"]$/g, '') === family && Number(face.weight) === weight && face.status === 'loaded') return true
      }
      return false
    },
    aspectMargins: safeMargins,
    getPresetStyle(id) {
      return structuredClone(CAPTION_PRESETS[id as PresetId]?.patch ?? CAPTION_PRESETS.minimal.patch)
    },
    async renderCaptionsForTime(time, width, height, dpr = 1) {
      const { editorApp } = getAppContext()
      const project = editorApp.project.getState().project
      if (project === null) throw new Error('STYLE_NO_PROJECT')
      const visible = project.blocks.filter((b: CaptionBlock) => b.start <= time && time < b.end)
      const canvas = new OffscreenCanvas(Math.round(width * dpr), Math.round(height * dpr))
      const ctx = canvas.getContext('2d')
      if (ctx === null) throw new Error('STYLE_NO_CTX')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderProbeFrame(ctx, {
        blocks: visible,
        time,
        style: project.style,
        track: 'source',
        width,
        height,
        speakerPalette: speakerPalette(),
        boxEdgeColor: getComputedStyle(document.documentElement).getPropertyValue('--border-subtle').trim() || 'rgba(42,47,56,0.9)',
        safe: safeMargins(project.outputAspect),
      })
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      return `data:image/png;base64,${btoa(bin)}`
    },
  }
  window.__zipStyleTest = bridge
}
