// @vitest-environment jsdom
// CC-202.3 + CC-202.4 (L2 matrix): the dialog renders exactly the computed
// gating model — T1/T2 full burn-in; T3 absent control + reason line; T4
// requirements copy; audio project × every tier renders NO burn-in element
// at all (no option, no disabled control, no explanatory line). Sidecars
// always offered; snapshot version surfaced (US-3.2.3).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ExportDialog } from '@ui/export/ExportDialog'
import type { BurnInGate } from '@ui/export/export-model'
import { burnInGate, fpsChoices, resolutionChoices } from '@ui/export/export-model'
import type { Capabilities } from '@engine/model/capability'
import type { ProjectSnapshot } from '@engine/model'
import { sidecarProject } from './helpers/sidecar-fixture'

afterEach(cleanup)

function caps(over: Partial<Capabilities>): Capabilities {
  return { tier: 'T1', webgpuAdapter: true, wasmSimd: true, audioDecoder: true, audioEncoder: true, videoEncoder: true, deviceMemGB: 8, online: true, ...over }
}

function snap(kind: 'audio' | 'video'): ProjectSnapshot {
  const p = sidecarProject()
  if (kind === 'audio') p.asset = { ...p.asset, kind: 'audio', videoCodec: null, width: 0, height: 0, fps: 0 }
  return { ...structuredClone(p), snapshotVersion: 9 }
}

function open(kind: 'audio' | 'video' = 'video', over: Partial<Capabilities> = {}) {
  const onSidecar = vi.fn()
  const onBurnIn = vi.fn()
  const onClose = vi.fn()
  render(<ExportDialog snapshot={snap(kind)} capabilities={caps(over)} onClose={onClose} onSidecar={onSidecar} onBurnIn={onBurnIn} />)
  return { onSidecar, onBurnIn, onClose }
}

const TIERS: readonly ('T1' | 'T2' | 'T3' | 'T4')[] = ['T1', 'T2', 'T3', 'T4']

describe('CC-202.3: capability gating matrix (video project)', () => {
  test('T1/T2: full burn-in controls (resolution + fps + start)', () => {
    for (const tier of ['T1', 'T2'] as const) {
      cleanup()
      open('video', { tier, webgpuAdapter: tier === 'T1' })
      expect(screen.getByTestId('burnin-start')).toBeTruthy()
      expect(screen.getByTestId('burnin-resolution')).toBeTruthy()
      expect(screen.getByTestId('burnin-fps')).toBeTruthy()
    }
  })
  test('T3 (no AudioEncoder): NO start control anywhere, exactly one reason line', () => {
    open('video', { tier: 'T3', webgpuAdapter: false, audioEncoder: false })
    expect(screen.queryByTestId('burnin-start')).toBeNull()
    expect(screen.queryByTestId('burnin-resolution')).toBeNull()
    const note = screen.getByTestId('burnin-absent-reason')
    expect(note.textContent).toContain('AudioEncoder')
  })
  test('T4: requirements copy, no controls, no broken options', () => {
    open('video', { tier: 'T4', webgpuAdapter: false, audioEncoder: false, videoEncoder: false, wasmSimd: false })
    expect(screen.queryByTestId('burnin-start')).toBeNull()
    expect(screen.getByTestId('requirements-copy').textContent).toContain('WebCodecs')
  })
  test('sidecars offered on every tier', () => {
    for (const tier of TIERS) {
      cleanup()
      open('video', { tier, webgpuAdapter: false, audioEncoder: false, videoEncoder: false, wasmSimd: false })
      expect(screen.getByTestId('sidecar-save')).toBeTruthy()
    }
  })
})

describe('CC-202.4: audio-project gating — every tier, zero burn-in DOM', () => {
  for (const tier of TIERS) {
    test(`audio × ${tier}: no burn-in element, no reason line — sidecar dialog`, () => {
      open('audio', { tier })
      expect(screen.queryByTestId('burnin-start')).toBeNull()
      expect(screen.queryByTestId('burnin-resolution')).toBeNull()
      expect(screen.queryByTestId('burnin-fps')).toBeNull()
      expect(screen.queryByTestId('burnin-absent-reason')).toBeNull()
      expect(screen.queryByTestId('requirements-copy')).toBeNull()
      expect(screen.getByTestId('sidecar-save')).toBeTruthy()
    })
  }
  test('pure model agrees with the DOM', () => {
    for (const tier of TIERS) {
      const g = burnInGate(caps({ tier }), 'audio')
      expect(g.mode).toBe('none')
    }
    expect((burnInGate(caps({ tier: 'T3', audioEncoder: false }), 'video') as Extract<BurnInGate, { mode: 'absent-reason' }>).reason).toContain('AudioEncoder')
  })
})

describe('US-3.2.1/.3: options surface', () => {
  test('track selector lists source + each translation language', () => {
    open('video')
    const sel = screen.getByTestId('sidecar-track') as HTMLSelectElement
    const opts = [...sel.options].map(o => o.value)
    expect(opts).toEqual(['source', 'fr', 'ar'])
  })
  test('sidecar save dispatches current selection; MP4 dispatches ≤source settings', () => {
    const { onSidecar, onBurnIn } = open('video')
    fireEvent.click(screen.getByTestId('sidecar-format-vtt'))
    fireEvent.click(screen.getByTestId('sidecar-save'))
    expect(onSidecar).toHaveBeenCalledWith({ format: 'vtt', track: 'source', speakerLabels: 'off' })
    fireEvent.click(screen.getByTestId('burnin-start'))
    const settings = onBurnIn.mock.calls[0]?.[0]
    expect(settings.width <= 1920 && settings.height <= 1080 && settings.fps <= 30).toBe(true)
  })
  test('snapshot version surfaced (US-3.2.3 progress provenance)', () => {
    open('video')
    expect(screen.getByTestId('snapshot-version').textContent).toContain('9')
  })

  test('FR-302.3: burn-in track selector lists source + tracks and drives onBurnIn.track', () => {
    const { onBurnIn } = open('video')
    const sel = screen.getByTestId('burnin-track') as HTMLSelectElement
    expect([...sel.options].map((o) => o.value)).toEqual(['source', 'fr', 'ar'])
    fireEvent.change(sel, { target: { value: 'fr' } })
    fireEvent.click(screen.getByTestId('burnin-start'))
    expect(onBurnIn).toHaveBeenCalledWith(expect.objectContaining({ track: 'fr', format: 'mp4-burn-in' }))
  })

  test('US-302.3: Export all languages dispatches one sidecar per track', () => {
    const { onSidecar } = open('video')
    fireEvent.click(screen.getByTestId('sidecar-format-srt'))
    fireEvent.click(screen.getByTestId('sidecar-all'))
    expect(onSidecar).toHaveBeenCalledTimes(3)
    expect(onSidecar.mock.calls.map((c) => (c[0] as { track: string }).track)).toEqual(['source', 'fr', 'ar'])
  })

  test('US-302.3: Export all languages is disabled with no translation tracks, enabled with tracks', () => {
    const sourceOnly: ProjectSnapshot = { ...snap('video'), translations: [] }
    render(<ExportDialog snapshot={sourceOnly} capabilities={caps({})} onClose={vi.fn()} onSidecar={vi.fn()} onBurnIn={vi.fn()} />)
    const all = screen.getByTestId('sidecar-all') as HTMLButtonElement
    expect(all.disabled, 'no translation tracks ⇒ Export all languages disabled').toBe(true)
    cleanup()
    const { onSidecar } = open('video')
    const enabled = screen.getByTestId('sidecar-all') as HTMLButtonElement
    expect(enabled.disabled, 'with tracks it is enabled').toBe(false)
    fireEvent.click(enabled)
    expect(onSidecar).toHaveBeenCalled()
  })
  test('ladders never upscale', () => {
    expect(resolutionChoices(1080)).toEqual([1080, 540])
    expect(resolutionChoices(360)).toEqual([360])
    expect(fpsChoices(25)).toEqual([25, 24])
    expect(fpsChoices(59.94)).toEqual([50, 30, 25, 24])
  })
})
