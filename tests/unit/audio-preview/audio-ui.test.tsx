// CC-107.8 (L2, jsdom): audio-project workbench UI (US-107.3) — the Media
// tab card shows codec / sample rate / channels / duration and NO resolution
// or fps for `asset.kind === 'audio'`; the output-aspect selector is absent
// from the DOM (audio AND video — none exists today, its absence is the
// pin); the export dialog/DOM contains no burn-in option anywhere (L5 twin:
// e2e/audio-preview/accessibility.spec.ts on speech-2min.m4a; enforced again
// in styling-and-export/unit-202). Video card keeps its Resolution row
// (conditional not flipped).
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { MediaAsset } from '@engine/model@102'
import { mountWorkbench } from '../workbench/helpers/mount'
import { CANNED_IMPORT_RESULT } from '../workbench/helpers/fake-engine'

function audioAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'ASSET_107_audio',
    name: 'podcast.m4a',
    kind: 'audio',
    container: 'm4a',
    audioCodec: 'aac',
    videoCodec: null,
    duration: 121.44,
    width: 0,
    height: 0,
    fps: 0,
    sampleRate: 44_100,
    channels: 1,
    fingerprint: { name: 'podcast.m4a', size: 4096, durationMs: 121_440, sampleHashes: ['a', 'b', 'c'] },
    ...overrides,
  }
}

function videoAsset(): MediaAsset {
  return audioAsset({ id: 'ASSET_107_video', name: 'clip.mp4', kind: 'video', container: 'mp4', videoCodec: 'avc1', width: 1280, height: 720, fps: 25, sampleRate: undefined, channels: undefined })
}

async function openMediaTab(): Promise<void> {
  const tab = await screen.findByTestId('tab-media')
  tab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

afterEach(() => {
  cleanup()
})

describe('CC-107.8: audio-project UI', () => {
  test('CC-107.8: audio Media card — codec, sample rate, channels, duration; NO resolution/fps', async () => {
    await mountWorkbench({ project: { asset: audioAsset(), captionImport: CANNED_IMPORT_RESULT } })
    await openMediaTab()
    const card = await screen.findByTestId('media-asset-card')
    const labels = Array.from(card.querySelectorAll('dt')).map((dt) => (dt.textContent ?? '').trim())
    expect(labels, 'audio rows: Duration, Container, Audio(+codec) and Sample rate + Channels').toEqual(expect.arrayContaining(['Duration', 'Sample rate', 'Channels']))
    expect(labels, 'no Resolution/Video rows for audio').not.toContain('Resolution')
    expect(labels).not.toContain('Video')
    const text = card.textContent ?? ''
    expect(text, 'name renders').toContain('podcast.m4a')
    expect(text, 'codec renders').toContain('aac')
    expect(text, 'sample rate value renders as `<n> Hz` (pinned)').toMatch(/44100\s*Hz/)
    expect(text, 'no resolution row for audio').not.toMatch(/×/)
    expect(text, 'no fps for audio').not.toMatch(/fps/i)
    expect(card.querySelector('[data-testid="media-resolution"], [data-testid*="resolution"]'), 'no resolution testid').toBeNull()
  })

  test('CC-107.8: audio sample-rate/channels rows degrade honestly when the probe lacked them', async () => {
    await mountWorkbench({ project: { asset: audioAsset({ sampleRate: undefined, channels: undefined }), captionImport: CANNED_IMPORT_RESULT } })
    await openMediaTab()
    const card = await screen.findByTestId('media-asset-card')
    expect(card.textContent ?? '', 'still no crash, em-dash fallback').toContain('—')
  })

  test('CC-107.8: the video card still shows Resolution/fps (the audio condition did not flip)', async () => {
    await mountWorkbench({ project: { asset: videoAsset(), captionImport: CANNED_IMPORT_RESULT } })
    await openMediaTab()
    const card = await screen.findByTestId('media-asset-card')
    expect(card.textContent ?? '').toContain('1280×720')
    expect(card.textContent ?? '').toMatch(/fps/i)
  })

  test('CC-107.8: no output-aspect selector and NO burn-in element anywhere in the audio workbench DOM', async () => {
    await mountWorkbench({ project: { asset: audioAsset(), captionImport: CANNED_IMPORT_RESULT } })
    await openMediaTab()
    await screen.findByTestId('media-asset-card')
    // The export button exists and is ENABLED (blocks seeded) — the audit
    // covers the whole live DOM, not just what is currently visible.
    const exportButton = await screen.findByTestId('export-button')
    expect((exportButton as HTMLButtonElement).disabled, 'export reachable (blocks present)').toBe(false)
    expect(document.querySelector('[data-testid*="aspect"]'), 'no aspect selector element').toBeNull()
    expect(document.querySelector('[data-testid*="burn"]'), 'no burn-in element in the DOM').toBeNull()
    expect(document.querySelector('option[value*="burn-in"]'), 'no burn-in option').toBeNull()
    expect(document.body.textContent ?? '', 'no burn-in copy').not.toMatch(/burn[\s-]?in/i)
  })
})
