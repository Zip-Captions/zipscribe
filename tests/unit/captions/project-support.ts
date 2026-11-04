// Shared project/block builders and fixture loaders for the unit-07 suites.
// Test-author-owned; nothing here is product code.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CaptionBlock, Project, Seconds, WordToken } from '@engine/model@07'
import { REPO_ROOT } from '../../helpers/repo'

/** Invariant 2: block text = words joined by ' ', '\n' after a breakAfter word. */
export function textFromWords(words: readonly WordToken[]): string {
  let text = ''
  words.forEach((word, index) => {
    text += word.text
    if (index < words.length - 1) text += word.breakAfter ? '\n' : ' '
  })
  return text
}

let blockSeq = 0

export function makeWord(text: string, start: Seconds, end: Seconds, extra: Partial<WordToken> = {}): WordToken {
  return { text, start, end, ...extra }
}

export function makeBlock(start: Seconds, end: Seconds, words: WordToken[], speakerId = 'SPK_TEST_1', id?: string): CaptionBlock {
  blockSeq += 1
  return { id: id ?? `blk-test-${blockSeq}`, start, end, text: textFromWords(words), words, speakerId }
}

/**
 * Plain words from a phrase inside [start,end] — spacing is irrelevant for the
 * QC/align/import tests (only order/text matter); times are evenly spread.
 */
export function spacedWords(phrase: string, start: Seconds, end: Seconds, timing: WordToken['timing'] = 'asr'): WordToken[] {
  const tokens = phrase.split(' ').filter((token) => token.length > 0)
  if (tokens.length === 0) return []
  const duration = (end - start) / tokens.length
  return tokens.map((token, index) => makeWord(token, round(start + index * duration), round(start + (index + 1) * duration), { timing }))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export interface ProjectOverrides {
  duration?: Seconds
  fps?: number
  blocks?: CaptionBlock[]
  language?: string | null
  speakerSource?: Project['speakerSource']
  captionOrigin?: Project['captionOrigin']
  translations?: Project['translations']
  speakers?: Project['speakers']
  maxLinesPerBlock?: 1 | 2 | 3
}

let projectSeq = 0

export function makeProject(overrides: ProjectOverrides = {}): Project {
  projectSeq += 1
  const duration = overrides.duration ?? 100
  const fps = overrides.fps ?? 25
  const name = `project-${projectSeq}.mp4`
  return {
    id: `project-${projectSeq}`,
    name: `Project ${projectSeq}`,
    schemaVersion: 1,
    asset: {
      id: `asset-${projectSeq}`,
      name,
      kind: 'video',
      container: 'mp4',
      audioCodec: 'aac',
      videoCodec: 'h264',
      duration,
      width: 1920,
      height: 1080,
      fps,
      fingerprint: { name, size: 1_000_000, durationMs: Math.round(duration * 1000), sampleHashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)] },
    },
    blocks: overrides.blocks ?? [],
    captionOrigin: overrides.captionOrigin ?? 'none',
    translations: overrides.translations ?? [],
    speakers: overrides.speakers ?? [],
    speakerSource: overrides.speakerSource ?? 'none',
    language: overrides.language ?? 'en',
    modelId: null,
    style: {
      fontFamily: 'Inter',
      fontWeight: 400,
      fontSizePct: 4,
      textTransform: 'none',
      color: '#FFFFFF',
      highlightColor: '#FFE45C',
      outlineColor: '#000000',
      outlineWidth: 2,
      backgroundOpacity: 0,
      position: 'bottom',
      marginVPct: 8,
      alignment: 'center',
      maxLinesPerBlock: overrides.maxLinesPerBlock ?? 2,
      highlightMode: 'none',
      showSpeakerBar: false,
    },
    outputAspect: 'source',
    transcription: 'none',
    updatedAt: 1_700_000_000_000,
  }
}

/** Raw bytes of a committed caption fixture (fixtures/captions/**). */
export function captionBytes(relative: string): Uint8Array {
  const path = join(REPO_ROOT, 'fixtures', relative)
  const buffer = readFileSync(path)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export function captionText(relative: string): string {
  return readFileSync(join(REPO_ROOT, 'fixtures', relative), 'utf8')
}

export function readJsonFile<T>(repoRelative: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, repoRelative), 'utf8')) as T
}

/** The import side never sees a File — CaptionFileInput is the frozen seam. */
export function captionFile(relative: string): { name: string; bytes: Uint8Array } {
  return { name: relative.split('/').pop() ?? relative, bytes: captionBytes(relative) }
}
