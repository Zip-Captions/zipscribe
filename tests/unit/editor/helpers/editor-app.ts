// The standard unit-102 fixture: `createEditorApp` wired with every fake —
// manual rAF driver, fake element clock, speaker-engine seam fake, recording
// translation rules, fake blockizer and an injected FakeClock for the
// merge-window. Downstream units (103–106, Intent 3) reuse this entry.
//
// RED until the builder ships `src/state/history.ts` (`@state/history`) — the
// runtime import below is the intended RED seam (contract file header).
import { createFakeClock } from '../../../../src/test-support/fake-clock'
import { createFakeRafs } from './fake-rafs'
import { createFakeMediaClock } from './fake-media-clock'
import type { FakeMediaClock } from './fake-media-clock'
import { createFakeSpeakerEngine } from './fake-speaker-engine'
import type { FakeSpeakerEngine } from './fake-speaker-engine'
import { createRecordingTranslationRules } from './fake-translation-rules'
import type { RecordingTranslationRules } from './fake-translation-rules'
import { sampleProject } from './fixture-project'
import { createEditorApp } from '@state/history'
import type { EditorApp } from '@state/history'
import type { CaptionBlock, Project, WordToken } from '@engine/model@102'
import type { MediaClock } from '@state/services/playback/media-clock'
import type { FakeRafs } from './fake-rafs'

export interface TestAppOptions {
  project?: Project
  withMediaClock?: boolean
  mediaDuration?: number
  /** Seed blocks through the same `captions-import` command path. */
  blocks?: CaptionBlock[]
}

export interface TestApp {
  app: EditorApp
  rafs: FakeRafs
  clock: ReturnType<typeof createFakeClock>
  mediaClock: FakeMediaClock | null
  speakerEngine: FakeSpeakerEngine
  translationRules: RecordingTranslationRules
  /** Drive the media element + the arbitrator loop in one step. */
  frame(dtMs: number): void
}

/** Deterministic 2-word-group blockizer (reflow fake — the production default
 *  is the merged unit-05 blockizer, tests never depend on its policy here). */
export function pairBlockizer(words: readonly WordToken[]): { start: number; end: number; text: string; words: WordToken[]; speakerId: string }[] {
  const out: { start: number; end: number; text: string; words: WordToken[]; speakerId: string }[] = []
  for (let i = 0; i < words.length; i += 2) {
    const group = words.slice(i, i + 2)
    const first = group[0]
    const last = group[group.length - 1]
    if (first === undefined || last === undefined) continue
    out.push({
      start: first.start,
      end: last.end,
      text: group.map((w) => w.text).join(' '),
      words: group.map((w) => ({ ...w })),
      speakerId: group.find((w) => w.speakerId !== undefined)?.speakerId ?? 'SPK_1',
    })
  }
  return out
}

export function createTestApp(options: TestAppOptions = {}): TestApp {
  const rafs = createFakeRafs(0)
  const clock = createFakeClock(1_730_000_000_000)
  const speakerEngine = createFakeSpeakerEngine()
  const translationRules = createRecordingTranslationRules()
  const mediaClock: MediaClock | null = options.withMediaClock === true ? createFakeMediaClock(rafs, options.mediaDuration ?? 121.44) : null

  const app = createEditorApp({
    clock,
    rafs,
    mediaClock: mediaClock ?? undefined,
    speakerEngine,
    translationRules,
    blockizer: pairBlockizer,
    initialProject: options.project ?? sampleProject(),
  })

  for (const extra of options.blocks ?? []) {
    const importResult = app.dispatch('captions-import', { blocks: [extra], replace: false })
    if (importResult !== null) throw new Error(`extra-block import rejected: ${importResult.code}`)
  }
  return {
    app,
    rafs,
    clock,
    mediaClock: mediaClock as FakeMediaClock | null,
    speakerEngine,
    translationRules,
    frame: (dtMs) => {
      if (mediaClock !== null) (mediaClock as FakeMediaClock).frame(dtMs)
      else rafs.frame(dtMs)
    },
  }
}

export { sampleProject }
