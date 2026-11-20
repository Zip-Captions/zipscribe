// Test-only style bridge (unit-201, seventh sibling of the ziptest bridges).
// Installed by App.tsx ONLY under strict `?ziptest=1` (lazy; out of the
// initial bundle). Exposes the SHARED renderer entry for golden + identity
// specs: the spec PUSHES frame data (fixture content) and receives IMAGE
// bytes back — no transcript text ever leaves via this bridge (SECURITY-03).

import { renderProbeFrame } from '@engine/export/probe-frame'
import { safeMargins } from '@engine/export/overlay'
import type { OverlayFrame } from '@engine/export/overlay'
import { ensureDefaultFonts, enableRemoteFont, isInBundledCoverage } from '../style/fonts'

interface StyleBridge {
  /** render one overlay frame offscreen; returns a PNG data URL (image bytes only) */
  renderOverlayPng(frame: OverlayFrame, dpr?: number): Promise<string>
  ensureDefaultFonts(): Promise<void>
  enableRemoteFont(family: string): Promise<boolean>
  isInBundledCoverage(text: string): boolean
  fontLoaded(family: string, weight: number): boolean
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
      return typeof document !== 'undefined' && 'fonts' in document && document.fonts.check(`${weight} 40px "${family}"`)
    },
    aspectMargins: safeMargins,
  }
  window.__zipStyleTest = bridge
}
