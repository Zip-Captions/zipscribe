// Unit-102 carries the unit-101 review obligations as pinned NEW tests
// (production fixes land with the unit-102 builder; frozen 101 suites stay
// untouched). MAJOR-7: project rename is an undoable zundo-backed command.
// MAJOR-5: transcribe popover language/model/diarize are remembered per
// settings (store-level contract; the popover reads them). Minor 11:
// `formatTimecode` lives in ONE shared module (`src/ui/format.ts`) and the
// shell renders time through it.
//
// RED notes: MAJOR-7/MAJOR-5 fail at the unresolved `@state/history` /
// unset seam method (not-yet-built); the formatTimecode pins fail on the
// missing `@ui/format` module and the missing transport time display.
import { describe, expect, test } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { REPO_ROOT } from '../../helpers/repo'
import { createSettingsStore } from '@state/settings'
import { createTestApp } from './helpers/editor-app'
import { createFakeSettingsStorage } from '../workbench/helpers/fake-engine'
import { formatTimecode, parseTimecode } from '@ui/format'
import type { TranscribePrefs } from '@state/editor-prefs@102'
import type { SettingsStore, WorkbenchSettings } from '@state/settings'
import type { ModelId } from '@engine/protocol@102'

interface SettingsStore102 extends SettingsStore {
  setTranscribePrefs(prefs: Partial<TranscribePrefs>): void
}
interface WorkbenchSettings102 extends WorkbenchSettings {
  transcribe: TranscribePrefs
}

function walkTs(dir: string, visit: (file: string) => void): void {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name)
    if (item.isDirectory()) walkTs(full, visit)
    else if (/\.(ts|tsx)$/.test(item.name)) visit(full)
  }
}

function as102(store: SettingsStore): SettingsStore102 {
  return store as SettingsStore102
}
function settingsOf(store: SettingsStore): WorkbenchSettings102 {
  return store.getState() as WorkbenchSettings102
}

describe('MAJOR-7 (carried from unit-101): project rename is undoable/redoable', () => {
  test('MAJOR-7: project-rename goes through the undoable command system — undo reverts, redo re-applies', () => {
    const { app } = createTestApp()
    const original = app.project.getState().project?.name
    expect(original).toBe('Sample project')
    expect(app.getCommand('project-rename'), 'the rename command is registered').toBeDefined()

    expect(app.dispatch('project-rename', { name: 'Interview cut 2' })).toBeNull()
    expect(app.project.getState().project?.name).toBe('Interview cut 2')
    expect(app.history.undoCount(), 'rename is ONE history step (zundo-backed)').toBe(1)

    app.history.undo()
    expect(app.project.getState().project?.name, 'undo restores the previous name').toBe(original)
    app.history.redo()
    expect(app.project.getState().project?.name, 'redo re-applies the rename').toBe('Interview cut 2')
  })

  test('MAJOR-7: the undoable rename replaces the shell path — the 101 setProjectName member still exists but rename flows as a command', () => {
    const { app } = createTestApp()
    expect(typeof app.project.setProjectName, '101 frozen member kept (EXTENDS, never breaks)').toBe('function')
    expect(app.getCommand('project-rename'), 'the canonical rename surface is the command').toBeDefined()
  })
})

describe('MAJOR-5 (carried from unit-101): transcribe popover memory per settings', () => {
  test('MAJOR-5: setTranscribePrefs persists language/model/diarize and a fresh store re-hydrates them', async () => {
    const { storage } = createFakeSettingsStorage()
    const store = await createSettingsStore({ storage })

    const rememberedModel: ModelId = 'whisper-base_timestamped@608c49e6'
    as102(store).setTranscribePrefs({ language: 'fr', modelId: rememberedModel, diarize: true })
    expect(settingsOf(store).transcribe, 'the live slice reflects the remembered prefs').toEqual({
      language: 'fr',
      modelId: 'whisper-base_timestamped@608c49e6',
      diarize: true,
    })

    const reopened = await createSettingsStore({ storage })
    expect(settingsOf(reopened).transcribe, 'reopening the app remembers the popover selections (design.md)').toEqual({
      language: 'fr',
      modelId: 'whisper-base_timestamped@608c49e6',
      diarize: true,
    })
  })

  test('MAJOR-5: defaults when never chosen; partial updates merge; corrupt values degrade to defaults', async () => {
    const { storage } = createFakeSettingsStorage()
    const fresh = await createSettingsStore({ storage })
    expect(settingsOf(fresh).transcribe, 'defaults: auto language, no pinned model, diarize off').toEqual({ language: null, modelId: null, diarize: false })

    as102(fresh).setTranscribePrefs({ language: 'es' })
    as102(fresh).setTranscribePrefs({ diarize: true })
    expect(settingsOf(fresh).transcribe, 'partial updates merge with the stored prefs').toEqual({ language: 'es', modelId: null, diarize: true })

    const { storage: corrupt } = createFakeSettingsStorage({
      'zipscribe.settings.workbench': '{"transcribe":{"language":42,"modelId":{},"diarize":"yes"}}',
    })
    const recovered = await createSettingsStore({ storage: corrupt })
    expect(settingsOf(recovered).transcribe, 'corrupt persisted prefs hydrate to defaults, never throw (SET.2 symmetry)').toEqual({ language: null, modelId: null, diarize: false })
  })
})

describe('Minor 11 (carried from unit-101): formatTimecode has ONE source', () => {
  test('minor 11: formatTimecode formats the transport display (00:12.3) and inverse-parses', () => {
    expect(formatTimecode(0)).toBe('00:00.0')
    expect(formatTimecode(12.34)).toBe('00:12.3')
    expect(formatTimecode(121.44)).toBe('02:01.4')
    expect(formatTimecode(3661.5)).toBe('1:01:01.5')
    expect(formatTimecode(12.36, { fps: 25 })).toBe('00:12:09')
    expect(parseTimecode('00:12.3')).toBeCloseTo(12.3, 6)
    expect(parseTimecode('00:12:09', { fps: 25 })).toBeCloseTo(12.36, 6)
    expect(parseTimecode('not a timecode')).toBeNull()
  })

  test('minor 11: `function formatTimecode` is DEFINED exactly once, in src/ui/format.ts', () => {
    const definers: string[] = []
    walkTs(join(REPO_ROOT, 'src'), (full) => {
      if (/function formatTimecode|const formatTimecode\s*=/.test(readFileSync(full, 'utf8'))) definers.push(relative(REPO_ROOT, full))
    })
    expect(definers, 'one shared implementation (conventions § State & commands)').toEqual([join('src', 'ui', 'format.ts')])
  })

  test('minor 11: every component rendering the transport time display imports formatTimecode from the shared module', () => {
    const renderers: string[] = []
    walkTs(join(REPO_ROOT, 'src', 'ui'), (full) => {
      if (readFileSync(full, 'utf8').includes('transport-time-current')) renderers.push(relative(REPO_ROOT, full))
    })
    expect(renderers.length, 'the transport bar renders transport-time-current (FR-102.5)').toBeGreaterThan(0)
    for (const rel of renderers) {
      const text = readFileSync(join(REPO_ROOT, rel), 'utf8')
      expect(text, `${rel} must format via the shared ui/format`).toMatch(/from\s+['"][^'"]*format['"]/)
    }
  })
})
