// Translation apply service (FR-301.5) — the state-layer bridge that runs a
// TranslationSession and applies its batched results as JOB OUTPUT
// (`applyWithoutHistory` — never undo steps, like transcribe's stream
// commits), while the session's plan works from the run-start snapshot.
//
// A superseded run (new run on the same session — target-language switch) or
// a cancelled one delivers nothing: the session discards in-flight results,
// and late batches hitting a swapped project id are dropped here too.
//
// SECURITY-03: nothing here logs text; errors carry codes only.

import type { Project, TranslationEntry } from '../../engine/model'
import type { TranslationEngine } from '../../engine/translate/engine'
import { translateError } from '../../engine/translate/engine'
import { createTranslationSession, type RunStats, type SessionRunOptions, type TranslationSession } from '../../engine/translate/session'
import { applyEntries } from '../../engine/translate/track'
import type { EditorApp } from '../history'

export interface TranslationApplyService {
  session: TranslationSession
  run(project: Project, language: string, options?: SessionRunOptions): Promise<RunStats>
  dispose(): void
}

export function createTranslationApplyService(deps: { editorApp: EditorApp; engine: TranslationEngine; scheduler?: () => Promise<void> }): TranslationApplyService {
  const session = createTranslationSession(deps.engine, deps.scheduler === undefined ? {} : { scheduler: deps.scheduler })
  return {
    session,
    async run(project, language, options = {}) {
      if (!project.translations.some((t) => t.language === language)) {
        const rejection = deps.editorApp.dispatch('translation-add-track', { language, origin: 'machine' })
        if (rejection !== null) throw translateError('PAIR_UNAVAILABLE', false, `ADD_TRACK:${rejection.code}`)
      }
      return session.run(project, language, {
        ...options,
        onEntries: (entries: readonly { blockId: string; entry: TranslationEntry }[]) => {
          const current = deps.editorApp.project.getState().project
          if (current === null || current.id !== project.id) return // project swapped mid-run ⇒ stale batch, discard
          deps.editorApp.applyWithoutHistory((draft) => {
            if (draft.project !== null) applyEntries(draft.project, language, entries)
          })
          options.onEntries?.(entries)
        },
      })
    },
    dispose: () => {
      session.dispose()
    },
  }
}
