// Unit-102 deterministic project fixtures (conventions § Mocks and fakes).
// SECURITY-03: `SAMPLE_CANARY_TEXT` carries the shared canary marker — suites
// that render or log projects built here must attach `createRedactionSpy()`
// (conventions § Principles 4). All numbers are 3-decimal already (the
// serializer's canonical rule) so a fixture is its own serialization input.
import { CANARY_MARKER } from '../../../../src/test-support/redaction'
import type { CaptionBlock, MediaAsset, Project, Seconds, Speaker, WordToken } from '@engine/model@102'

export function word(text: string, start: Seconds, end: Seconds, extra: Partial<WordToken> = {}): WordToken {
  return { text, start, end, ...extra }
}

/** Join matching domain invariant 2 (the same rule `deriveBlockText` freezes). */
export function joinWords(words: readonly WordToken[]): string {
  return words.map((w, i) => (i > 0 && words[i - 1]?.breakAfter === true ? '\n' : i > 0 ? ' ' : '') + w.text).join('')
}

export function block(id: string, start: Seconds, end: Seconds, speakerId: string, words: WordToken[], extra: Partial<CaptionBlock> = {}): CaptionBlock {
  return { id, start, end, text: joinWords(words), words, speakerId, ...extra }
}

export function speaker(id: string, label: string, color: string): Speaker {
  return { id, label, color }
}

export const SAMPLE_SPEAKERS: Speaker[] = [speaker('SPK_1', 'Speaker 1', '#4c8dff'), speaker('SPK_2', 'Speaker 2', '#ff6b6b')]

export const SAMPLE_ASSET: MediaAsset = {
  id: 'ASSET_102',
  name: 'speech-2min.mp4',
  kind: 'video',
  container: 'mp4',
  audioCodec: 'aac',
  videoCodec: 'avc1',
  duration: 121.44,
  width: 1280,
  height: 720,
  fps: 25,
  fingerprint: { name: 'speech-2min.mp4', size: 627251, durationMs: 121440, sampleHashes: ['h1', 'h2', 'h3'] },
}

/** Three deterministic sorted blocks; block 2 carries the canary marker. */
export function sampleBlocks(): CaptionBlock[] {
  return [
    block('blk_a', 0.5, 2.5, 'SPK_1', [word('alpha', 0.5, 1.2), word('beta', 1.3, 1.9), word('gamma', 2.0, 2.5)]),
    block('blk_b', 3.0, 5.0, 'SPK_2', [word(CANARY_MARKER, 3.0, 4.1, { probability: 0.9 }), word('delta', 4.2, 5.0)]),
    block('blk_c', 6.25, 7.75, 'SPK_1', [word('epsilon', 6.25, 7.0, { breakAfter: true }), word('zeta', 7.1, 7.75)]),
  ]
}

export function sampleProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj_102',
    name: 'Sample project',
    schemaVersion: 1,
    asset: SAMPLE_ASSET,
    blocks: sampleBlocks(),
    captionOrigin: 'transcribed',
    translations: [],
    speakers: SAMPLE_SPEAKERS.map((s) => ({ ...s })),
    speakerSource: 'auto-beta',
    language: 'en',
    modelId: 'whisper-base_timestamped@608c49e6',
    style: {
      fontFamily: 'Inter',
      fontWeight: 400,
      fontSizePct: 8,
      textTransform: 'none',
      color: '#e8eaed',
      highlightColor: '#4c8dff',
      outlineColor: '#0d0f12',
      outlineWidth: 2,
      backgroundOpacity: 0,
      position: 'bottom',
      marginVPct: 6,
      alignment: 'center',
      maxLinesPerBlock: 2,
      highlightMode: 'none',
      showSpeakerBar: false,
    },
    outputAspect: 'source',
    transcription: 'complete',
    updatedAt: 1730000000000,
    ...overrides,
  }
}

/** Canonical fixture for `fixtures/golden/project-canonical-v1.json` — a
 *  fixed project (no overrides) whose canonical bytes the golden pins. The
 *  golden was derived by the test author from `src/engine/model.ts` field
 *  membership + the invariant-8 canonicalization rules (sorted keys, no
 *  undefined, 3-decimal numbers) — see the golden README row. */
export const GOLDEN_PROJECT: Project = sampleProject({
  translations: [
    {
      language: 'fr',
      origin: 'machine',
      engine: 'chrome-translator',
      entries: {
        blk_a: { text: 'alpha beta gamma', status: 'translated', sourceHash: 'hash_a1' },
      },
    },
  ],
})
