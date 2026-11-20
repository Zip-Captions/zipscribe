// CC-202.1 + CC-202.5 (L1, byte-exact): sidecar goldens. Goldens are PURE
// serializer output (platform-independent; the serializers' own purity is the
// determinism argument — no pinned docker needed). Re-bless ONLY via
// `GOLDEN=1 corepack pnpm vitest run tests/unit/export/sidecar-goldens` —
// and only when the SERIALIZER (not the golden) is what changed; the review
// checklist treats golden churn as a defect unless justified.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../../helpers/repo'
import { sidecarSnapshot } from './helpers/sidecar-fixture'
import { toSrt } from '@engine/export/srt'
import { toVtt } from '@engine/export/vtt'
import { toJson } from '@engine/export/json'
import { toTsv } from '@engine/export/tsv'
import type { ProjectSnapshot } from '@engine/model'

const GOLDEN_DIR = join(REPO_ROOT, 'fixtures', 'golden', 'sidecars')
const GENERATE = process.env.GOLDEN === '1'
const snapshot = sidecarSnapshot()

interface Cell { name: string; body: string }

function matrix(snap: ProjectSnapshot): Cell[] {
  const cells: Cell[] = []
  for (const track of ['source', 'fr', 'ar']) {
    for (const speakerLabels of ['off', 'prefix'] as const) {
      const opts = { track, speakerLabels }
      cells.push({ name: `srt-${track}-${speakerLabels}.srt`, body: toSrt(snap, opts) })
      cells.push({ name: `tsv-${track}-${speakerLabels}.tsv`, body: toTsv(snap, opts) })
      cells.push({ name: `vtt-${track}-${speakerLabels}.vtt`, body: toVtt(snap, opts) })
    }
    cells.push({ name: `vtt-${track}-voice.vtt`, body: toVtt(snap, { track, speakerLabels: 'vtt-voice' }) })
    cells.push({ name: `json-${track}.json`, body: toJson(snap, { track, speakerLabels: 'off' }) })
  }
  const audio: ProjectSnapshot = { ...structuredClone(snap), asset: { ...snap.asset, kind: 'audio', videoCodec: null, width: 0, height: 0, fps: 0 } }
  cells.push({ name: 'audio-source-off.srt', body: toSrt(audio, { track: 'source', speakerLabels: 'off' }) })
  cells.push({ name: 'audio-source-off.vtt', body: toVtt(audio, { track: 'source', speakerLabels: 'off' }) })
  cells.push({ name: 'audio-source-off.json', body: toJson(audio, { track: 'source', speakerLabels: 'off' }) })
  cells.push({ name: 'audio-source-off.tsv', body: toTsv(audio, { track: 'source', speakerLabels: 'off' }) })
  return cells
}

describe('CC-202.1/CC-202.5: sidecar goldens byte-exact', () => {
  const cells = matrix(snapshot)
  if (GENERATE) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    for (const c of cells) writeFileSync(join(GOLDEN_DIR, c.name), c.body)
  }
  for (const cell of cells) {
    test(`CC-202.1: ${cell.name} matches the committed golden`, () => {
      const file = join(GOLDEN_DIR, cell.name)
      expect(existsSync(file), `${cell.name} missing — regenerate with GOLDEN=1`).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe(cell.body)
    })
  }
})
