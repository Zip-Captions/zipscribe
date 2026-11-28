// CC-112.2 (L2, jsdom): the Media-tab caption-add affordance per media state.
// Measured gap (#53 step-2): once media loads, the first-run DropZone (the
// ONLY "Choose file…" — Workbench DropZone's media-intake-button) unmounts
// and the caption-add control count drops to 0 — a caption file cannot be
// added by click at all. FR-112.2 pins: an open project keeps a caption-add
// affordance in the Media tab, owning its hidden `multiple` input exactly
// like the unit-109 MediaIntakeButton (label-root containment — the e2e
// owner-input contract this unit's L5 spec relies on via
// `data-testid=media-caption-add`).
//
// Per-state contract (both directions — the affordance must not become a
// silent-loss trap either): with NO project the Media tab shows its empty
// copy and NO caption-add control (a caption picked without media would be
// imported into nothing — intake pairs captions to a media probe only);
// with media loaded the control is present, visible, and owns the multiple
// file input.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { sampleProject } from '../editor/helpers/fixture-project'
import { createFakeImportService, createFakeModelCache, createFakeSettingsStorage, createProbingEngine } from './helpers/fake-engine'
import { createFakeTranslationEngine } from '../editor/helpers/fake-export-port'
import { createJobsStore } from '@state/jobs'
import { createSettingsStore } from '@state/settings'
import { createIntakeService } from '@state/services/intake'
import { mountWorkbench } from './helpers/mount'
import { createStageController } from '../../../src/app/stage'
import { Workbench } from '@ui/shell/Workbench'
import { installDomStubs } from '../transcript/helpers/dom-stubs'
import type { CaptionImportPort } from '@state/services/caption-import'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'

const CONTROL = '[data-testid="media-caption-add"]'

const NOOP_PORT: CaptionImportPort = {
  analyze: async () => {
    throw new Error('NOT_USED_IN_L2')
  },
}

let DISPOSE: (() => void) | null = null

async function mountWithProject(): Promise<void> {
  installDomStubs()
  const t = createTestApp({ project: sampleProject() })
  const engine = createProbingEngine()
  const jobs = createJobsStore({ engine, modelCache: createFakeModelCache(), translation: { engine: createFakeTranslationEngine(), editorApp: t.app } })
  const { storage } = createFakeSettingsStorage()
  const settings = await createSettingsStore({ storage })
  const intake = createIntakeService({ engine, jobs, project: t.app.project, importService: createFakeImportService().service })
  const stage = createStageController({ onAttachElement: () => undefined })
  act(() => {
    render(
      <Workbench
        jobs={jobs}
        settings={settings}
        project={t.app.project}
        intake={intake}
        transport={{ app: t.app, stage, rafs: t.rafs, captionImport: NOOP_PORT }}
      />,
    )
  })
  DISPOSE = () => t.app.dispose()
}

afterEach(() => {
  cleanup()
  DISPOSE?.()
  DISPOSE = null
})

describe('CC-112.2: the Media tab keeps a caption-add affordance when media is loaded', () => {
  test('CC-112.2: with media loaded the Media tab shows a visible caption-add control owning a hidden multiple file input (#53 step-2)', async () => {
    if (CHILD) return
    await mountWithProject()
    fireEvent.click(screen.getByTestId('tab-media'))
    expect(screen.getByTestId('media-asset-card'), 'the asset card proves media is loaded (precondition)').toBeTruthy()

    const controls = document.querySelectorAll(CONTROL)
    expect(controls.length, 'the Media tab keeps a caption-add affordance after media loads (Choose file… alone drops to 0 today — #53)').toBe(1)
    const root = controls[0] as HTMLElement
    expect(root.offsetParent !== null || root.getClientRects().length > 0, 'the affordance is visible, not a hidden leftover').toBe(true)
    expect(root.querySelector('button'), 'it carries a real button (the click entry)').not.toBeNull()
    const input = root.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input, 'the affordance owns its hidden input INSIDE the root (MediaIntakeButton containment contract — the L5 setInputFiles leg resolves it)').not.toBeNull()
    expect(input?.multiple, 'the input keeps the multiple intake semantics').toBe(true)
  })

  test('CC-112.2: with NO media the Media tab shows the honest empty copy and no caption-add control (no silent-loss affordance)', async () => {
    if (CHILD) return
    await mountWorkbench({})
    fireEvent.click(screen.getByTestId('tab-media'))
    expect(screen.getByTestId('panel-sidebar').textContent ?? '', 'the empty Media tab states its state').toContain('No media loaded')
    expect(document.querySelectorAll(CONTROL).length, 'without a project a caption pick would import into nothing — the affordance must not be offered').toBe(0)
  })
})
