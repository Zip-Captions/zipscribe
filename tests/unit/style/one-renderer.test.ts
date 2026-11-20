// CC-201.5 "one renderer" (US-3.1.4 import-graph leg): engine/export/overlay.ts
// is THE caption painter — preview and burn-in both consume it; no file may
// fork a second caption text renderer (direct canvas text primitives are the
// fork signature). Timeline clip labels are a different surface (allowlisted
// with reason).
import { describe, expect, test } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../helpers/repo'

const ALLOWED_TEXT_DRAWS = new Set([
  'src/engine/export/overlay.ts', // the single caption renderer
  'src/ui/timeline/renderer.ts', // timeline clip LABELS — not captions (different surface)
  'src/ui/timeline/Timeline.tsx', // ditto (labels)
])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

describe('CC-201.5: single caption renderer', () => {
  test('CC-201.5: only overlay.ts paints caption text with canvas text primitives', () => {
    const offenders: string[] = []
    for (const file of walk(join(REPO_ROOT, 'src'))) {
      const rel = file.startsWith(REPO_ROOT) ? file.slice(REPO_ROOT.length).replace(/^[\/]/, '') : file
      const src = readFileSync(file, 'utf8')
      if (/fillText\(|strokeText\(/.test(src) && !ALLOWED_TEXT_DRAWS.has(rel)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  test('CC-201.5: drawCaptions consumers are the shared-renderer seams only', () => {
    const consumers: string[] = []
    for (const file of walk(join(REPO_ROOT, 'src'))) {
      const rel = file.startsWith(REPO_ROOT) ? file.slice(REPO_ROOT.length).replace(/^[\/]/, '') : file
      if (rel === 'src/engine/export/overlay.ts') continue
      if (/drawCaptions\s*\(/.test(readFileSync(file, 'utf8'))) consumers.push(rel)
    }
    // canvas adapter (preview), preset thumbnails (shared renderer), export worker (burn-in)
    for (const c of consumers) {
      expect(['src/ui/canvas/caption-renderer.ts', 'src/ui/style/presets.ts', 'src/workers/export.worker.ts', 'src/engine/export/probe-frame.ts']).toContain(c)
    }
    expect(consumers).toContain('src/ui/canvas/caption-renderer.ts') // preview wired
  })
})
