// @vitest-environment jsdom
// CC-201.3 (UI leg) + CC-201.5 (guard visible): the style tab dispatches ONE
// command per release/commit, presets are one step, contrast guard surfaces,
// aspect selector hides for audio projects.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StyleTab } from '@ui/style/StyleTab'
import type { EditorApp } from '@state/history'
import type { CaptionStyle, Project } from '@engine/model'
import { CAPTION_PRESETS } from '@engine/style/presets'

const BASE_STYLE: CaptionStyle = {
  fontFamily: 'Inter', fontWeight: 400, fontSizePct: 4, textTransform: 'none',
  color: '#ffffff', highlightColor: '#4c8dff', outlineColor: '#0d0f12', outlineWidth: 0,
  backgroundOpacity: 0, position: 'bottom', marginVPct: 6, alignment: 'center',
  maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false,
}

let dispatches: Array<{ id: string; payload: unknown }> = []

function makeApp(overrides: Partial<Project> = {}): EditorApp {
  const project: Project = {
    id: 'p', name: 'x', schemaVersion: 1,
    asset: { id: 'a', name: 'v.mp4', kind: 'video', container: 'mp4', audioCodec: 'aac', videoCodec: 'h264', duration: 120, width: 1920, height: 1080, fps: 30, fingerprint: { name: 'v', size: 1, durationMs: 120000, sampleHashes: ['a', 'b', 'c'] } },
    blocks: [], captionOrigin: 'none', translations: [], speakers: [], speakerSource: 'none',
    language: 'en', modelId: null, style: { ...BASE_STYLE }, outputAspect: '16:9',
    transcription: 'none', updatedAt: 0,
    ...overrides,
  }
  const listeners = new Set<() => void>()
  return {
    project: { getState: () => ({ project }), subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) } },
    dispatch: vi.fn(((id: string, payload: unknown) => {
      dispatches.push({ id, payload })
      if (id === 'style-patch' && project !== null) Object.assign(project.style, (payload as { patch: Partial<CaptionStyle> }).patch)
      return null
    })) as EditorApp['dispatch'],
  } as unknown as EditorApp
}

beforeEach(() => { dispatches = [] })
afterEach(cleanup)

describe('CC-201.3: style tab controls', () => {
  test('CC-201.3: applying a preset dispatches exactly one style-preset', () => {
    render(<StyleTab app={makeApp()} />)
    fireEvent.click(screen.getByTestId('preset-karaoke'))
    expect(dispatches).toEqual([{ id: 'style-preset', payload: { presetId: 'karaoke' } }])
  })

  test('CC-201.3: a slider commits exactly once on release (not per move)', () => {
    render(<StyleTab app={makeApp()} />)
    const slider = screen.getByLabelText('Size %') as HTMLInputElement
    fireEvent.pointerUp(slider, { target: { value: '7.5' } })
    const patches = dispatches.filter(d => d.id === 'style-patch')
    expect(patches).toHaveLength(1)
    expect(patches[0]?.payload).toEqual({ patch: { fontSizePct: 7.5 } })
  })

  test('CC-201.3: blur commits (keyboard-driven range), select commits immediately', () => {
    render(<StyleTab app={makeApp()} />)
    const slider = screen.getByLabelText('Margin V %') as HTMLInputElement
    fireEvent.blur(slider, { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'top' } })
    const patches = dispatches.filter(d => d.id === 'style-patch')
    expect(patches.map(p => (p.payload as { patch: Partial<CaptionStyle> }).patch)).toEqual([{ marginVPct: 12 }, { position: 'top' }])
  })

  test('CC-201.6: aspect selector present for video, hidden for audio', () => {
    const audioApp = makeApp({
      asset: { id: 'a', name: 'a.m4a', kind: 'audio', container: 'm4a', audioCodec: 'aac', videoCodec: null, duration: 120, width: 0, height: 0, fps: 0, fingerprint: { name: 'a', size: 1, durationMs: 120000, sampleHashes: ['a', 'b', 'c'] } },
    })
    render(<StyleTab app={audioApp} />)
    expect(screen.queryByLabelText('Aspect')).toBeNull()
    render(<StyleTab app={makeApp()} />)
    fireEvent.change(screen.getByLabelText('Aspect'), { target: { value: '9:16' } })
    expect(dispatches.some(d => d.id === 'output-aspect-set')).toBe(true)
  })

  test('CC-201.5: contrast guard surfaces the AA verdict (warn icon on weak pair)', () => {
    const weak = makeApp()
    weak.project.getState().project!.style = { ...BASE_STYLE, color: '#9aa2ad', outlineColor: '#808080', outlineWidth: 2 }
    render(<StyleTab app={weak} />)
    expect(screen.getByTestId('contrast-warning'), 'weak text-vs-outline warns').toBeTruthy()
  })

  test('CC-201.5: default signed style passes without warning', () => {
    render(<StyleTab app={makeApp()} />)
    expect(screen.queryByTestId('contrast-warning'), 'default passes AA').toBeNull()
  })

  test('CC-201.3: preset thumbnails render through the shared renderer (canvas 96×54)', () => {
    render(<StyleTab app={makeApp()} />)
    const thumbs = document.querySelectorAll('.ws-preset-thumb')
    expect(thumbs).toHaveLength(4)
    expect(thumbs[0]?.getAttribute('width')).toBe('96')
    expect(CAPTION_PRESETS.karaoke.patch.textTransform).toBe('uppercase')
  })
})
