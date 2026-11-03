// CC-101.4 (L2, jsdom): tier chip GPU/CPU/Limited with the tierNotice tooltip,
// and the T4 blocked screen (fake capability, no panels).
//
// Contract: US-2.0.3 + FR-2.0.4 — "tier chip shows GPU/CPU/Limited with
// tooltip explaining what's degraded (from jobs.tierNotice); T4 renders the
// blocked screen (no panels) with requirements list" (architecture.md §
// Degradation tiers — T4: no WASM SIMD or deviceMemory < 4 → hard-stop).
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { mountWorkbench } from './helpers/mount'
import type { CapabilitySnapshot } from '@state/jobs'
import type { Notice } from '@engine/protocol@101'

afterEach(cleanup)

const T1: CapabilitySnapshot = { tier: 'T1', reasons: [] }
const T2: CapabilitySnapshot = { tier: 'T2', reasons: [] }
const T3: CapabilitySnapshot = { tier: 'T3', reasons: [] }
const T4: CapabilitySnapshot = { tier: 'T4', reasons: ['NO_WASM_SIMD', 'DEVICE_MEMORY_BELOW_4GB'] }

describe('CC-101.4: tier chip and T4 blocked screen', () => {
  test('CC-101.4: the chip shows GPU / CPU / Limited for T1 / T2 / T3 from the fake capability', async () => {
    const { jobs } = await mountWorkbench({ project: {} })
    const chip = screen.getByTestId('tier-chip')
    jobs.setCapability(T1)
    expect(chip.textContent, 'T1 WebGPU → GPU').toBe('GPU')
    jobs.setCapability(T2)
    expect(chip.textContent, 'T2 WASM-CPU → CPU').toBe('CPU')
    jobs.setCapability(T3)
    expect(chip.textContent, 'T3 Limited → Limited').toBe('Limited')
    expect(screen.getByTestId('status-bar').textContent, 'status bar carries the tier too (FR-2.0.4)').toMatch(/Limited/)
  })

  test('CC-101.4: the chip tooltip explains what is degraded (from jobs.tierNotice), never the bare code', async () => {
    const { jobs } = await mountWorkbench({ project: {} })
    jobs.setCapability(T2)
    expect(screen.getByTestId('tier-chip').textContent).toBe('CPU')

    const notice: Notice = { code: 'TIER_DOWNGRADE', params: { from: 'T1', to: 'T2' } }
    jobs.setTierNotice(notice)
    const tooltip = screen.getByTestId('tier-tooltip')
    expect(tooltip.textContent, 'degradation copy is rendered for the notice code (design: UI maps code → copy)').toBeTruthy()
    expect(tooltip.textContent, 'the raw code is never the whole tooltip').not.toBe(notice.code)

    jobs.setTierNotice(null)
    expect(screen.queryByTestId('tier-tooltip'), 'no notice → no degradation tooltip').toBeNull()
  })

  test('CC-101.4: T4 renders the blocked screen with the requirements list and no panels at all', async () => {
    const { jobs } = await mountWorkbench({ project: { captionImport: undefined } })
    jobs.setCapability(T4)
    expect(screen.getByTestId('blocked-screen'), 'T4 hard-stop screen').toBeTruthy()
    const requirements = screen.getAllByTestId('blocked-requirement')
    expect(requirements.length, 'requirements list (WebGPU/SIMD/memory)').toBeGreaterThanOrEqual(2)
    for (const panel of ['panel-sidebar', 'panel-stage', 'panel-timeline']) {
      expect(screen.queryByTestId(panel), `T4 shows no ${panel}`).toBeNull()
    }
    expect(screen.queryByTestId('transcribe-button'), 'no workbench actions behind the blocked screen').toBeNull()
    expect(screen.queryByTestId('drop-zone'), 'not even the drop zone').toBeNull()
  })

  test('CC-101.4: a working tier never renders the blocked screen', async () => {
    const { jobs } = await mountWorkbench({ project: {} })
    jobs.setCapability(T1)
    expect(screen.queryByTestId('blocked-screen')).toBeNull()
    expect(screen.getByTestId('panel-sidebar')).toBeTruthy()
  })
})
