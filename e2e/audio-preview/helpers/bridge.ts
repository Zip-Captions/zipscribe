// Shared e2e glue for the unit-107 audio-preview specs: audio asset literals
// (manifest-backed: codecs/sample rates match fixtures/harness/manifest.json),
// bridge accessors, and in-page handles for the shared clock contract
// (tests/unit/audio-preview/clock-contract-lib.ts drives fake, element and
// decoded clocks through the SAME function — L3 vitest / L5 chromium parity).

import type { Page } from '@playwright/test'

export interface VisualizerBridge {
  ready(): Promise<void>
  getVisualizerState(): {
    framesDrawn: number
    lastFrameAtMs: number | null
    playing: boolean
    opacity: number
    mode: 'spectrum' | 'waveform'
    tinted: boolean
    dpr: number
    cssWidth: number
    cssHeight: number
    contextState: 'none' | 'suspended' | 'running' | 'closed'
    graphPath: 'none' | 'element' | 'decoded'
    underrunCount: number
    muted: boolean
    playbackPath: 'element' | 'decoded' | 'deferred'
    mediaCard: { hasDuration: boolean; hasCodec: boolean; hasSampleRate: boolean; hasChannels: boolean; hasResolution: boolean; hasFps: boolean }
  }
  resetVisualizerDiagnostics(): void
  getClockDiagnostics(): { kind: 'element' | 'decoded' | 'deferred' | 'none'; paused: boolean; currentTime: number; duration: number; rate: number; endedCount: number }
  clockControl(method: 'play' | 'pause' | 'seek' | 'setRate' | 'dispose', arg?: number): void
  setScriptedBins(db: number[] | null): void
  setScriptedWaveform(samples: number[] | null): void
  setMuted(muted: boolean): void
  readAnalyserEnergy(): number
  setVisualizerMode(mode: 'spectrum' | 'waveform'): void
  setTintBySpeaker(on: boolean): void
}

interface EditorBridgeLike {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; loop: [number, number] | null; rate: number; blockCount: number; clockTime: number }
}

export type VizState = ReturnType<VisualizerBridge['getVisualizerState']>
export type ClockDiag = ReturnType<VisualizerBridge['getClockDiagnostics']>

// --- assets (manifest-backed literals) --------------------------------------

function audioAsset(name: string, codec: string, sampleRate: number, channels: number, duration: number): Record<string, unknown> {
  return {
    id: `ASSET_107_${name.replace(/[^a-z0-9]/gi, '_')}`,
    name,
    kind: 'audio',
    container: name.split('.').at(-1),
    audioCodec: codec,
    videoCodec: null,
    duration,
    width: 0,
    height: 0,
    fps: 0,
    sampleRate,
    channels,
    fingerprint: { name, size: 4096, durationMs: Math.round(duration * 1000), sampleHashes: ['a', 'b', 'c'] },
  }
}

export const WAV_ELEMENT = { asset: audioAsset('silence-10s.wav', 'pcm_s16le', 44_100, 1, 10), src: '/fixtures/audio/silence-10s.wav' }
export const TONES = { asset: audioAsset('tones-220-1k-5k-10s.wav', 'pcm_s16le', 44_100, 1, 10), src: '/fixtures/audio/tones-220-1k-5k-10s.wav' }
export const AIFF_DECODED = { asset: audioAsset('fmt-30s.aiff', 'pcm_s16be', 16_000, 1, 30), src: '/fixtures/audio/fmt-30s.aiff' }
export const WMA_DECODED = { asset: audioAsset('fmt-30s.wma', 'wmav2', 16_000, 1, 30), src: '/fixtures/audio/fmt-30s.wma' }
export const SPEECH_M4A = { asset: audioAsset('speech-2min.m4a', 'aac-lc', 16_000, 1, 119.888), src: '/fixtures/audio/speech-2min.m4a' }
export const CLICK_WAV = { asset: audioAsset('click-track-10min.wav', 'pcm_s16le', 44_100, 1, 600), src: '/fixtures/audio/click-track-10min.wav' }
export const CLICK_AIFF = { asset: audioAsset('click-track-10min.aiff', 'pcm_s16be', 44_100, 1, 600), src: '/fixtures/audio/click-track-10min.aiff' }

/** Caption overlay input for visualizer/golden L5 — deterministic, no canary
 *  text (committed PNGs must not carry redaction sentinels). */
export const STAGE_BLOCKS: unknown[] = [
  {
    id: 'blk_107_a',
    start: 0.2,
    end: 4.8,
    text: 'steady tone alpha',
    words: [
      { text: 'steady', start: 0.2, end: 1.2, timing: 'estimated' },
      { text: 'tone', start: 1.3, end: 2.4, timing: 'estimated' },
      { text: 'alpha', start: 2.5, end: 4.8, timing: 'estimated' },
    ],
    speakerId: 'SPK_1',
  },
  {
    id: 'blk_107_b',
    start: 5.0,
    end: 9.6,
    text: 'steady tone beta',
    words: [
      { text: 'steady', start: 5.0, end: 6.0, timing: 'estimated' },
      { text: 'tone', start: 6.1, end: 7.2, timing: 'estimated' },
      { text: 'beta', start: 7.3, end: 9.6, timing: 'estimated' },
    ],
    speakerId: 'SPK_1',
  },
]

// --- page glue ---------------------------------------------------------------

export async function openAudioProject(page: Page, fixture: { asset: Record<string, unknown>; src: string }, blocks?: unknown[]): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean((window as unknown as { __zipVisualizerBridge?: unknown }).__zipVisualizerBridge), undefined, { timeout: 20_000 })
  await page.evaluate(
    ([asset, src, b]) => {
      const w = window as unknown as { __zipEditorBridge?: EditorBridgeLike }
      w.__zipEditorBridge?.openProjectWithMedia(asset, src, b)
    },
    [fixture.asset, fixture.src, blocks] as const,
  )
  // The active clock (and graph for element/decoded paths) exist once the
  // project is open; the media card is the observable readiness signal.
  await page.waitForFunction(() => {
    const b = (window as unknown as { __zipVisualizerBridge?: VisualizerBridge }).__zipVisualizerBridge
    const d = b?.getClockDiagnostics()
    return d !== undefined && d.kind !== 'none' && d.kind !== 'deferred' && d.duration > 0
  }, undefined, { timeout: 30_000 })
}

export function bridge(page: Page): {
  state: () => Promise<VizState>
  clock: () => Promise<ClockDiag>
  control: (m: 'play' | 'pause' | 'seek' | 'setRate' | 'dispose', arg?: number) => Promise<void>
  reset: () => Promise<void>
  setScriptedBins: (db: number[] | null) => Promise<void>
  setScriptedWaveform: (s: number[] | null) => Promise<void>
  setMuted: (m: boolean) => Promise<void>
  energy: () => Promise<number>
  setMode: (m: 'spectrum' | 'waveform') => Promise<void>
  setTint: (on: boolean) => Promise<void>
} {
  const call = <T>(method: string, arg?: unknown): Promise<T> =>
    page.evaluate(
      ([m, a]) => {
        const b = (window as unknown as Record<string, Record<string, ((...args: unknown[]) => unknown) | undefined> | undefined>).__zipVisualizerBridge
        if (b === undefined) throw new Error('__zipVisualizerBridge missing — page not opened with ?ziptest=1')
        const fn = b[m]
        if (fn === undefined) throw new Error(`__zipVisualizerBridge.${m} not implemented`)
        return fn(a) as T
      },
      [method, arg] as [string, unknown],
    )
  return {
    state: () => call<VizState>('getVisualizerState'),
    clock: () => call<ClockDiag>('getClockDiagnostics'),
    control: (m, arg) =>
      page.evaluate(
        ([mm, aa]) => {
          const b = (window as unknown as { __zipVisualizerBridge?: { clockControl: (m: string, a?: number) => void } }).__zipVisualizerBridge
          b?.clockControl(mm, aa)
        },
        [m, arg] as [string, number | undefined],
      ),
    reset: () => call('resetVisualizerDiagnostics'),
    setScriptedBins: (db) => call('setScriptedBins', db),
    setScriptedWaveform: (s) => call('setScriptedWaveform', s),
    setMuted: (m) => call('setMuted', m),
    energy: () => call('readAnalyserEnergy'),
    setMode: (m) => call('setVisualizerMode', m),
    setTint: (on) => call('setTintBySpeaker', on),
  }
}

export function editor(page: Page): {
  state: () => Promise<{ playhead: number; playing: boolean; clockTime: number }>
  command: (id: string, payload?: unknown) => Promise<{ code: string } | null>
} {
  return {
    state: () =>
      page.evaluate(() => {
        const b = (window as unknown as { __zipEditorBridge?: EditorBridgeLike }).__zipEditorBridge
        const s = b?.getEditorState()
        return { playhead: s?.playhead ?? -1, playing: s?.playing ?? false, clockTime: s?.clockTime ?? -1 }
      }),
    command: (id, payload) =>
      page.evaluate(
        ([i, p]) => {
          const b = (window as unknown as { __zipEditorBridge?: EditorBridgeLike }).__zipEditorBridge
          return b?.command(i, p) ?? null
        },
        [id, payload] as [string, unknown],
      ),
  }
}
