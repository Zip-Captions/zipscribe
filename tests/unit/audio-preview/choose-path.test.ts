// CC-107.1 (L1): `choosePlaybackPath` decision table — EVERY entry of
// fixtures/audio/ × {chromium, webkit} capability profile → expected path
// (element clock vs decoded clock, unit-107 US-107.1). The per-browser
// evidence columns are TEST INPUT DATA (documented capability profiles —
// chromium's and webkit's media element support; L4 anchors the chromium
// column against measured `canPlayType` in `e2e/audio-preview/clocks.spec.ts`).
// The expected column is the criterion — it stays pinned even where both
// clocks would work (element whenever the element can be trusted).
//
// RED mechanism: dynamic import of the unbuilt `@state/services/playback/
// choose-path` (intended missing-module seam, unit-101…106 doctrine); types
// from unit107-api-contract.d.ts. Pure function — no DOM, no timers.
import { readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { MediaAsset } from '@engine/model@102'
import type { ElementProbeEvidence, PlaybackPath } from '@state/services/playback/choose-path'

const CHOOSE_PATH_MODULE = '@state/services/playback/choose-path'
type ChoosePathModule = typeof import('@state/services/playback/choose-path')

type BrowserProfile = 'chromium' | 'webkit'

interface Row {
  /** Exact filename under fixtures/audio/ (table completeness asserted). */
  file: string
  chromium: ElementProbeEvidence
  webkit: ElementProbeEvidence
  expected: Record<BrowserProfile, PlaybackPath>
}

/** Supported ⇒ non-empty canPlayType string; unsupported ⇒ ''. */
const yes = (v = 'probably'): ElementProbeEvidence => ({ canPlayType: v, probePlaySucceeded: true })
const no = (): ElementProbeEvidence => ({ canPlayType: '', probePlaySucceeded: false })
const playFail = (v = 'probably'): ElementProbeEvidence => ({ canPlayType: v, probePlaySucceeded: false })

const both = (p: PlaybackPath): Record<BrowserProfile, PlaybackPath> => ({ chromium: p, webkit: p })

const TABLE: readonly Row[] = [
  // Container/codec families the media element plays on both engines.
  { file: 'fmt-30s.wav', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'fmt-30s.ref.wav', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'silence-10s.wav', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'tones-220-1k-5k-10s.wav', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'fmt-30s.mp3', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'fmt-30s.vbr.mp3', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'fmt-30s.flac', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'sweep-20-20k-10s.flac', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'fmt-30s.m4a', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'fmt-30s.m4b', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'fmt-30s.aac', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'speech-2min.m4a', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'speech-2spk-2min.m4a', chromium: yes(), webkit: yes(), expected: both('element') },
  { file: 'fmt-30s.opus', chromium: yes(), webkit: yes('maybe'), expected: both('element') },
  { file: 'fmt-30s.oga', chromium: yes(), webkit: yes('maybe'), expected: both('element') },
  // Ogg-vorbis: Chromium plays, Safari does not (no vorbis decode).
  { file: 'fmt-30s.ogg', chromium: yes(), webkit: no(), expected: { chromium: 'element', webkit: 'decoded' } },
  // WebM-audio: Chromium plays; webkit's webm support is video-only.
  { file: 'fmt-30s.weba', chromium: yes(), webkit: no(), expected: { chromium: 'element', webkit: 'decoded' } },
  // Apple-family containers: Chromium cannot, WebKit can.
  { file: 'fmt-30s.aiff', chromium: no(), webkit: yes(), expected: { chromium: 'decoded', webkit: 'element' } },
  { file: 'fmt-30s.alac.m4a', chromium: no(), webkit: yes(), expected: { chromium: 'decoded', webkit: 'element' } },
  { file: 'fmt-30s.caf', chromium: no(), webkit: yes(), expected: { chromium: 'decoded', webkit: 'element' } },
  // Never playable by either element (unit-04 manifest: ffmpeg-only path).
  { file: 'fmt-30s.wma', chromium: no(), webkit: no(), expected: both('decoded') },
  { file: 'fmt-30s.amr', chromium: no(), webkit: no(), expected: both('decoded') },
  { file: 'fmt-30s.3gp', chromium: no(), webkit: no(), expected: both('decoded') },
  { file: 'fmt-30s.mka', chromium: no(), webkit: no(), expected: both('decoded') },
  // Junk bytes with a plausible name: canPlayType is MIME-gated (non-empty)
  // but the muted probe play fails → decoded (probePlaySucceeded gate).
  { file: 'not-audio.mp3', chromium: playFail(), webkit: playFail(), expected: both('decoded') },
]

function assetFor(row: Row): MediaAsset {
  const container = row.file.split('.').pop() ?? 'bin'
  return {
    id: `ASSET_${row.file}`,
    name: row.file,
    kind: 'audio',
    container,
    audioCodec: 'x-test',
    videoCodec: null,
    duration: 30,
    width: 0,
    height: 0,
    fps: 0,
    fingerprint: { name: row.file, size: 1024, durationMs: 30_000, sampleHashes: ['a', 'b', 'c'] },
  }
}

describe('CC-107.1: choosePlaybackPath decision table', () => {
  const choose = async (): Promise<ChoosePathModule['choosePlaybackPath']> => (await import(/* @vite-ignore */ CHOOSE_PATH_MODULE)).choosePlaybackPath

  for (const row of TABLE) {
    for (const profile of ['chromium', 'webkit'] as const) {
      test(`CC-107.1: ${row.file} on ${profile} chooses ${row.expected[profile]}`, async () => {
        const choosePlaybackPath = await choose()
        const evidence = profile === 'chromium' ? row.chromium : row.webkit
        expect(choosePlaybackPath(assetFor(row), evidence)).toBe(row.expected[profile])
      })
    }
  }

  test('CC-107.1: the table covers every fixtures/audio/ entry', async () => {
    await choose() // RED gate: module must exist
    const files = readdirSync(new URL('../../../fixtures/audio/', import.meta.url)).filter((f) => !f.startsWith('.'))
    const covered = new Set(TABLE.map((r) => r.file))
    for (const file of files) expect(covered, `fixtures/audio/${file} is in the decision table`).toBe(true)
  })

  test('CC-107.1: video assets ALWAYS choose the element clock (decoded video is a seed)', async () => {
    const choosePlaybackPath = await choose()
    const video: MediaAsset = { id: 'A', name: 'v.mp4', kind: 'video', container: 'mp4', audioCodec: 'aac', videoCodec: 'avc1', duration: 10, width: 640, height: 360, fps: 25, fingerprint: { name: 'v.mp4', size: 1, durationMs: 10_000, sampleHashes: ['a', 'b', 'c'] } }
    expect(choosePlaybackPath(video, no())).toBe('element')
    expect(choosePlaybackPath(video, yes())).toBe('element')
  })

  test('CC-107.1: a non-empty canPlayType is NOT sufficient — the probe play decides', async () => {
    const choosePlaybackPath = await choose()
    const audio = assetFor({ ...TABLE[0]!, file: 'edge.wav' })
    expect(choosePlaybackPath(audio, playFail('maybe'))).toBe('decoded')
    expect(choosePlaybackPath(audio, yes('maybe'))).toBe('element')
  })
})
