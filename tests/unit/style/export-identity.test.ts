// CC-201.2 (L1 legs) — the export path consumes THE renderer (full round-trip
// SSIM arrives with unit-202's real pipeline; US-3.1.4's two-context parity
// runs as the e2e spec e2e/style/overlay-identity.spec.ts).
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../helpers/repo'
import { renderProbeFrame } from '@engine/export/probe-frame'
import type { CaptionBlock, CaptionStyle } from '@engine/model'

const STYLE: CaptionStyle = {
  fontFamily: 'Inter', fontWeight: 700, fontSizePct: 5, textTransform: 'none',
  color: '#ffffff', highlightColor: '#4c8dff', outlineColor: '#0d0f12', outlineWidth: 2,
  backgroundOpacity: 0, position: 'bottom', marginVPct: 6, alignment: 'center',
  maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false,
}
const BLOCK: CaptionBlock = {
  id: 'b', start: 0, end: 3, text: 'identity check', words: [
    { text: 'identity', start: 0, end: 1.5 }, { text: 'check', start: 1.5, end: 3 },
  ], speakerId: 'SPK_1',
}

function fakeCtx() {
  const lines: string[] = []
  return {
    ctx: {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, direction: 'ltr', textAlign: 'left', textBaseline: 'alphabetic',
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {},
      fill() {}, stroke() {}, fillRect() {}, clearRect() {}, setTransform() {},
      fillText: (t: string) => { lines.push(t) },
      strokeText: (t: string) => { lines.push(`s:${t}`) },
      measureText: (t: string) => ({ width: t.length * 8 }),
    } as unknown as CanvasRenderingContext2D,
    lines,
  }
}

describe('CC-201.2: export stub consumes the shared renderer', () => {
  test('CC-201.2: renderProbeFrame draws via overlay.ts (single source)', () => {
    const { ctx, lines } = fakeCtx()
    renderProbeFrame(ctx, { blocks: [BLOCK], time: 1.6, style: STYLE, track: 'source', width: 1280, height: 720 })
    expect(lines).toContain('s:identity check')
    expect(lines).toContain('identity check')
  })

  test('CC-201.2: the export worker imports the probe-frame entry and registers bundled faces (FR-201.4)', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/workers/export.worker.ts'), 'utf8')
    expect(src).toMatch(/renderProbeFrame/)
    expect(src).toMatch(/probe-frame/)
    expect(src).toMatch(/fonts\.add/)
    expect(src).toMatch(/BUNDLED_FONT_FACES/)
    expect(src).toMatch(/new OffscreenCanvas/)
  })
})
