// CC-202.1/.5 (L1, service seam): exportSidecar() packages the pure
// serializer output into {filename, blob, mime} — names via the project
// slug + track, types per format, byte identity with the golden bodies.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../../helpers/repo'
import { exportSidecar } from '@state/services/export-sidecar'
import { sidecarSnapshot } from './helpers/sidecar-fixture'

const snapshot = sidecarSnapshot()

describe('CC-202.1/CC-202.5: export-sidecar service', () => {
  test('CC-202.5: source srt bytes, filename slug and mime', async () => {
    const out = exportSidecar(snapshot, { format: 'srt', track: 'source', speakerLabels: 'off' })
    expect(out.filename).toBe('veterans-q-a-part-2.srt')
    expect(out.mime).toContain('application/x-subrip')
    const golden = readFileSync(join(REPO_ROOT, 'fixtures', 'golden', 'sidecars', 'srt-source-off.srt'), 'utf8')
    expect(await out.blob.text()).toBe(golden)
    expect(out.blob.size).toBe(new TextEncoder().encode(golden).length)
  })

  test('CC-202.5: translation track rides the filename and the track bytes', async () => {
    const out = exportSidecar(snapshot, { format: 'vtt', track: 'fr', speakerLabels: 'vtt-voice' })
    expect(out.filename).toBe('veterans-q-a-part-2.fr.vtt')
    const golden = readFileSync(join(REPO_ROOT, 'fixtures', 'golden', 'sidecars', 'vtt-fr-voice.vtt'), 'utf8')
    expect(await out.blob.text()).toBe(golden)
  })

  test('CC-202.5: tsv mime is the registered type', () => {
    const out = exportSidecar(snapshot, { format: 'tsv', track: 'source', speakerLabels: 'off' })
    expect(out.mime).toContain('text/tab-separated-values')
  })

  test('CC-202.5: blob charset=utf-8 for the text formats', () => {
    for (const format of ['srt', 'vtt', 'json', 'tsv'] as const) {
      const out = exportSidecar(snapshot, { format, track: 'source', speakerLabels: 'off' })
      expect(out.blob.type, format).toMatch(/charset=utf-8$/)
    }
  })
})
