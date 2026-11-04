// FR-102.5 / US-2.2.4 (L2, jsdom): the transport bar on the real shell —
// frozen testids, play/pause (aria-pressed), skips, time displays through
// THE shared formatTimecode (carried-101 minor-11: `transport-time-current`),
// loop toggle/in/out semantics, and the keyboard path through the command
// REGISTRY only (no component binds keys; the `not-editing` guard governs).
// The stage element binds the deferred element clock; the single-seek rule
// (FR-102.3) is asserted on the clock's call counts — numbers only
// (SECURITY-03). jsdom has no media stack: play/pause/canPlayType are
// environment stubs (never the thing under test).
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createEditorApp } from '@state/history'
import { createDeferredMediaClock } from '@state/services/playback/media-clock'
import { createJobsStore } from '@state/jobs'
import { createSettingsStore } from '@state/settings'
import { createIntakeService } from '@state/services/intake'
import { Workbench } from '@ui/shell/Workbench'
import { createStageController } from '../../../src/app/stage'
import { createFakeRafs } from './helpers/fake-rafs'
import { SAMPLE_ASSET, SAMPLE_SPEAKERS, sampleBlocks } from './helpers/fixture-project'
import { createFakeImportService, createFakeModelCache, createFakeSettingsStorage, createProbingEngine } from '../workbench/helpers/fake-engine'
import type { OverlayRenderer } from '@ui/canvas/overlay'
import type { MediaAsset, Seconds } from '@engine/model@102'

interface Mounted {
  app: ReturnType<typeof createEditorApp>
  mediaClock: ReturnType<typeof createDeferredMediaClock>
  rafs: ReturnType<typeof createFakeRafs>
  stage: ReturnType<typeof createStageController>
  attached: (HTMLMediaElement | null)[]
  renders: Seconds[]
}

// jsdom media stubs: the element never decodes — the clock/arbitrator/registry
// behavior under test is independent of a media stack.
function stubMedia(canPlay: string): void {
  HTMLMediaElement.prototype.play = () => Promise.resolve()
  HTMLMediaElement.prototype.pause = (): void => undefined
  HTMLMediaElement.prototype.canPlayType = () => canPlay
}

async function mount(options: { canPlay?: string; asset?: MediaAsset } = {}): Promise<Mounted> {
  stubMedia(options.canPlay ?? 'probably')
  const rafs = createFakeRafs(0)
  const mediaClock = createDeferredMediaClock()
  const app = createEditorApp({ clock: { now: () => 1_730_000_000_000 }, rafs, mediaClock })
  // The 101-frozen intake path the bridge mirrors: ProjectStore open +
  // captions-import seed (never the editor root's test seam).
  app.project.createProject(options.asset ?? SAMPLE_ASSET)
  expect(app.dispatch('captions-import', { blocks: sampleBlocks(), speakers: SAMPLE_SPEAKERS, replace: true })).toBeNull()
  const engine = createProbingEngine()
  const jobs = createJobsStore({ engine, modelCache: createFakeModelCache() })
  const { storage } = createFakeSettingsStorage()
  const settings = await createSettingsStore({ storage })
  const { service } = createFakeImportService()
  const intake = createIntakeService({ engine, jobs, project: app.project, importService: service })
  const attached: (HTMLMediaElement | null)[] = []
  const stage = createStageController({
    onAttachElement: (element) => {
      attached.push(element)
    },
  })
  const renders: Seconds[] = []
  const renderer: OverlayRenderer = {
    resize: () => undefined,
    render: (playhead) => {
      renders.push(playhead)
    },
    dispose: () => undefined,
  }
  render(<Workbench jobs={jobs} settings={settings} project={app.project} intake={intake} transport={{ app, stage, overlayRenderer: renderer }} />)
  return { app, mediaClock, rafs, stage, attached, renders }
}

function key(chord: string): void {
  // `Shift+L` = key 'L' + shiftKey; `l` = bare 'l' key (chordOf canonicalizes
  // the typed letter to the registry's uppercase form).
  const parts = chord.split('+')
  const keyName = parts.at(-1) as string
  const shift = parts.includes('Shift')
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, shiftKey: shift, bubbles: true, cancelable: true }))
  })
}

async function openMedia(m: Mounted, url: string): Promise<void> {
  await act(async () => {
    m.stage.setMediaSource(url)
  })
}

async function seek(m: Mounted, time: number): Promise<void> {
  await act(async () => {
    expect(m.app.dispatch('transport-seek', { time })).toBeNull()
  })
}

afterEach(cleanup)

describe('FR-102.5: the transport bar renders the frozen control set', () => {
  test('FR-102.5: every frozen testid exists with its contract semantics', async () => {
    const m = await mount();
    await openMedia(m, '/fixtures/speech-2min.mp4')
    expect(screen.getByTestId('stage-video'), 'the stage element the element clock owns').toBeTruthy()
    expect(screen.getByTestId('transport-play-pause').getAttribute('aria-pressed'), 'play/pause aria-pressed = playing').toBe('false')
    expect(screen.getByTestId('transport-skip-back')).toBeTruthy()
    expect(screen.getByTestId('transport-skip-forward')).toBeTruthy()
    expect(screen.getByTestId('transport-loop-toggle').getAttribute('aria-pressed'), 'loop aria-pressed = loop on').toBe('false')
    expect(screen.getByTestId('transport-loop-in').getAttribute('aria-disabled'), 'I/O aria-disabled when no loop').toBe('true')
    expect(screen.getByTestId('transport-loop-out').getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByTestId('transport-rate')).toBeTruthy()
  })

  test('minor 11 (carried): transport-time-current renders through the shared formatTimecode', async () => {
    const m = await mount();
    await openMedia(m, '/fixtures/speech-2min.mp4')
    expect(screen.getByTestId('transport-time-current').textContent).toBe('00:00.0')
    expect(screen.getByTestId('transport-time-total').textContent, 'asset.duration 121.44 formats 02:01.4 (sampleProject)').toBe('02:01.4')
    await seek(m, 12.34)
    expect(screen.getByTestId('transport-time-current').textContent).toBe('00:12.3')
  })

  test('FR-102.6: the overlay canvas mounts inside the 101-reserved layer and renders from the arbitrator samples (no second rAF)', async () => {
    const m = await mount();
    await openMedia(m, '/fixtures/speech-2min.mp4')
    const host = screen.getByTestId('preview-canvas-layer')
    expect(host.querySelector('canvas'), 'the overlay canvas lives in the reserved host').not.toBeNull()
    expect(host.querySelector('canvas')?.style.pointerEvents).toBe('none')
    expect(m.rafs.pending(), 'ONE rAF loop app-wide: only the arbitrator requested a frame').toBe(1)
    await seek(m, 30)
    expect(m.renders.at(-1), 'seek re-renders the overlay through the arbitrator subscription').toBe(30)
  })

  test('FR-102.6 (audio): the 0×0 asset gets the 16:9 visualizer slot beneath the overlay', async () => {
    const m = await mount({ asset: { ...SAMPLE_ASSET, kind: 'audio', width: 0, height: 0, fps: 0 } })
    await openMedia(m, '/fixtures/voice.m4a')
    expect(screen.getByTestId('stage-visualizer-slot'), 'the unit-107 visualizer host sits beneath the caption overlay').toBeTruthy()
    expect(screen.getByTestId('stage-video')).toBeTruthy()
  })

  test('FR-102.3: an unplayable container shows the coded stage-notice (editing stays available)', async () => {
    const m = await mount({ canPlay: '' })
    await openMedia(m, '/fixtures/weird.xyz')
    const notice = screen.getByTestId('stage-notice')
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toContain('PREVIEW_UNSUPPORTED')
    expect(m.app.getCommand('block-split'), 'commands stay available while the notice is shown').toBeDefined()
  })
})

describe('FR-102.5 / US-2.2.4: transport control semantics (registry → commands → clock)', () => {
  test('play/pause: button toggles the slice truth and proxies ONE clock play/pause each', async () => {
    const m = await mount();
    await openMedia(m, '/fixtures/speech-2min.mp4')
    fireEvent.click(screen.getByTestId('transport-play-pause'))
    expect(m.app.editor.getState().playing).toBe(true)
    expect(screen.getByTestId('transport-play-pause').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('transport-play-pause'))
    expect(m.app.editor.getState().playing).toBe(false)
    expect(m.app.arbitrator?.playing, 'the element clock saw exactly one play and one pause').toBe(false)
  })

  test('skips: ±5 s buttons drive transport-skip with one clock seek each', async () => {
    const m = await mount();
    await openMedia(m, '/fixtures/speech-2min.mp4')
    await seek(m, 10)
    const seeksBefore = m.mediaClock.seekCount
    fireEvent.click(screen.getByTestId('transport-skip-forward'))
    expect(m.app.editor.getState().playhead).toBe(15)
    expect(m.mediaClock.seekCount - seeksBefore, 'one seek per skip (single-seek rule)').toBe(1)
    fireEvent.click(screen.getByTestId('transport-skip-back'))
    expect(m.app.editor.getState().playhead).toBe(10)
  })

  test('loop I/O + toggle: in/out set endpoints from the playhead, Y toggles with re-arm memory', async () => {
    const m = await mount();
    await openMedia(m, '/fixtures/speech-2min.mp4')
    await seek(m, 10)
    fireEvent.click(screen.getByTestId('transport-loop-in'))
    expect(m.app.editor.getState().loop, 'I from playhead defaults OUT to the media end').toEqual([10, 121.44])
    expect(m.app.arbitrator?.loop, 'the region reaches the clock owner').toEqual([10, 121.44])
    await seek(m, 20)
    fireEvent.click(screen.getByTestId('transport-loop-out'))
    expect(m.app.editor.getState().loop).toEqual([10, 20])
    fireEvent.click(screen.getByTestId('transport-loop-toggle'))
    expect(m.app.editor.getState().loop, 'Y disarms').toBeNull()
    fireEvent.click(screen.getByTestId('transport-loop-toggle'))
    expect(m.app.editor.getState().loop, 'Y re-arms the remembered region').toEqual([10, 20])
  })

  test('US-2.2.4: keyboard chords dispatch through the registry (Space/Y/L/arrows), guarded while editing', async () => {
    const m = await mount();
    await openMedia(m, '/fixtures/speech-2min.mp4')
    key('Space')
    expect(m.app.editor.getState().playing, 'Space → play').toBe(true)
    key('Space')
    expect(m.app.editor.getState().playing, 'Space again → pause').toBe(false)
    key('L')
    expect(m.app.editor.getState().playhead, 'L = +5 s').toBe(5)
    key('Shift+L')
    expect(m.app.editor.getState().playhead, 'Shift+L = +10 s').toBe(15)
    key('J')
    expect(m.app.editor.getState().playhead, 'J = −5 s').toBe(10)
    key('ArrowLeft')
    expect(m.app.editor.getState().playhead, '← = −1 frame @25 fps').toBe(9.96)
    key('Shift+ArrowRight')
    expect(m.app.editor.getState().playhead, 'Shift+→ = +1 s').toBe(10.96)
    key('y')
    expect(m.app.editor.getState().loop, 'Y toggles the loop (last region re-armed after earlier commands? none) — null-safe').toBeNull()
    expect(m.app.dispatch('transport-loop-set', { start: 1, end: 2 })).toBeNull()
    key('y')
    expect(m.app.editor.getState().loop, 'Y disarms the region').toBeNull()
    key('i')
    expect(m.app.editor.getState().loop, 'I sets IN from the playhead (region re-armed) or starts one').not.toBeNull()
    // `not-editing` guard: chords are dead while the project-name input has focus.
    const nameInput = screen.getByTestId('project-name')
    nameInput.focus()
    const playhead = m.app.editor.getState().playhead
    key('L')
    key('Space')
    expect(m.app.editor.getState().playhead, 'L is suppressed while editing (conventions § UI conventions)').toBe(playhead)
    expect(m.app.editor.getState().playing, 'Space is suppressed while editing').toBe(false)
    nameInput.blur()
  })

  test('rate: the menu button cycles through transport-rate with the clock setRate mirror', async () => {
    const m = await mount();
    await openMedia(m, '/fixtures/speech-2min.mp4')
    fireEvent.click(screen.getByTestId('transport-rate'))
    expect(m.app.editor.getState().rate).toBe(1.5)
    expect(m.app.arbitrator?.rate).toBe(1.5)
  })

  test('the stage element binds the deferred element clock (attach on mount, detach on unmount)', async () => {
    const m = await mount();
    await openMedia(m, '/fixtures/speech-2min.mp4')
    expect(m.attached.at(-1), 'the video element reached the clock layer').toBeInstanceOf(HTMLMediaElement)
    const video = screen.getByTestId('stage-video') as HTMLVideoElement
    expect(video.muted, 'muted + playsInline for headless autoplay (frozen bridge contract)').toBe(true)
    expect(video.hasAttribute('playsinline'), 'playsInline for headless autoplay (frozen bridge contract)').toBe(true)
    cleanup()
    expect(m.attached.at(-1), 'unmount detaches the element from the clock').toBeNull()
  })
})
