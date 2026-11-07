// m-a (carried from unit-101): every `cacheCopy` branch (Workbench.tsx —
// review-round honesty fix, untested until now) is pinned at the status-bar
// seam so the cached/total honesty cannot regress silently. Regression pins
// over MERGED behaviour: these pass TODAY by design (documented in the unit
// report's RED list — the honest counterpart of the RED suites).
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { mountWorkbench } from '../workbench/helpers/mount'
import { MODEL_REGISTRY } from '@engine/model/registry'
import type { ModelId } from '@engine/protocol@101'

afterEach(cleanup)

const ALL_MODEL_IDS = Object.values(MODEL_REGISTRY).map((spec) => spec.id) as ModelId[]
const T1_DEFAULT: ModelId = 'whisper-base_timestamped@608c49e6'
const NOT_T1_DEFAULT: ModelId = 'whisper-tiny_timestamped@51724429'

async function mountWithCache(cached: readonly ModelId[], tier: 'T1' | 'T2' | null = 'T1') {
  const { jobs } = await mountWorkbench({ cachedModels: cached })
  if (tier !== null) jobs.setCapability({ tier, reasons: [] })
  return jobs
}

function statusText(): string {
  return screen.getByTestId('status-bar').textContent ?? ''
}

describe('m-a: cacheCopy branches pinned (status bar)', () => {
  test('m-a: nothing cached → honest "cache empty · models download on first use"', async () => {
    await mountWithCache([])
    expect(statusText()).toContain('cache empty · models download on first use')
  })

  test('m-a: tier-default model offline-ready → "cache local" (first transcription works offline)', async () => {
    await mountWithCache([T1_DEFAULT])
    expect(statusText()).toContain('cache local')
  })

  test('m-a: cached models but NOT the tier default → honest "cache partial 1/5 · model downloads on first use"', async () => {
    await mountWithCache([NOT_T1_DEFAULT])
    expect(statusText()).toContain(`cache partial 1/${ALL_MODEL_IDS.length} · model downloads on first use`)
    expect(statusText(), 'never claims local readiness when the default model would download on first use').not.toContain('cache local')
  })

  test('m-a: every model cached → cache local (all offline-ready)', async () => {
    await mountWithCache(ALL_MODEL_IDS)
    expect(statusText()).toContain('cache local')
  })

  test('m-a: capability pending → "tier pending" in the status bar', async () => {
    await mountWithCache([], null)
    expect(statusText()).toContain('tier pending')
  })
})
