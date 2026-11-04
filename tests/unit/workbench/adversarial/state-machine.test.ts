// ADVERSARY unit-101 (category 1: STATE MACHINE) — hostile event orders against
// the frozen `jobs` and `settings` slices. Additive probes only: no production
// or frozen-test file is touched. Each test drives the PUBLIC seam (the
// injected EnginePort double / the injected SettingsStorage seam) exactly as
// the frozen suites do — the attack lives in the event ORDER and the VALUE,
// not in private internals.
//
// Red tests here are FINDINGS (root cause + argument in the adversary report);
// green tests are honest passes documenting the contract where the attack did
// not break anything.
import { describe, expect, test } from 'vitest'
import { createJobsStore } from '@state/jobs'
import { createSettingsStore, MIN_SIDEBAR_PX, MIN_TIMELINE_PX, SETTINGS_STORAGE_KEY } from '@state/settings'
import type { SettingsStorage } from '@state/settings'
import { createFakeModelCache, FakeEnginePort } from '../helpers/fake-engine'
import type { ModelId, RawSegment } from '@engine/protocol@101'

const MODEL: ModelId = 'whisper-base_timestamped@608c49e6'

function createJobsHarness(): { engine: FakeEnginePort; jobs: ReturnType<typeof createJobsStore> } {
  const engine = new FakeEnginePort()
  const jobs = createJobsStore({ engine, modelCache: createFakeModelCache() })
  return { engine, jobs }
}

function segment(start: number, text = 'seg'): RawSegment {
  return { start, end: start + 1, text, words: [] }
}

function transcribeOptions(diarize = false): { language: null; modelId: ModelId; diarize: boolean; mode: 'replace' } {
  return { language: null, modelId: MODEL, diarize, mode: 'replace' }
}

describe('ADVERSE SM: jobs slice under hostile event order', () => {
  test('ADVERSE SM.1: FR-2.0.6 streaming invariant — a job:segments batch for an UNRELATED jobId must not contaminate the running job (attack: stale worker flush during a live job)', () => {
    const { engine, jobs } = createJobsHarness()
    jobs.startTranscribe(transcribeOptions())
    const running = jobs.getState().running?.jobId
    expect(typeof running).toBe('string')

    engine.emitAsr({ t: 'job:segments', jobId: 'job-unrelated-1', segments: [segment(0, 'stale-a')] })
    expect(jobs.getState().segments, 'a foreign jobId must not reach the streaming rows (job:done/job:error already filter by jobId — job:segments must too)').toEqual([])

    // Not a blanket "ignore everything" assertion: the RUNNING job's own batches still merge.
    engine.emitAsr({ t: 'job:segments', jobId: running as string, segments: [segment(2, 'mine')] })
    expect(jobs.getState().segments.map((s) => s.text)).toEqual(['mine'])
  })

  test('ADVERSE SM.2: FR-2.0.4 streaming invariant — a late flush of a CANCELLED job (its own jobId) must not land in the streaming rows after cancel (attack: in-flight batch resolves post-cancel)', () => {
    const { engine, jobs } = createJobsHarness()
    jobs.startTranscribe(transcribeOptions())
    const jobId = jobs.getState().running?.jobId as string

    engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(0, 'before-cancel')] })
    expect(jobs.getState().segments.length).toBe(1)

    jobs.cancel()
    engine.emitAsr({ t: 'job:segments', jobId, segments: [segment(5, 'after-cancel')] })
    expect(jobs.getState().segments.map((s) => s.text), 'a cancelled job has no streaming rows to feed').toEqual(['before-cancel'])
  })

  test('ADVERSE SM.3: contract JobsState.error — an error event for an UNRELATED jobId must not populate the error slot while a different job runs (attack: stale job:error from a previously orphaned job)', () => {
    const { engine, jobs } = createJobsHarness()
    jobs.startTranscribe(transcribeOptions())
    const running = jobs.getState().running?.jobId as string

    engine.emitAsr({ t: 'job:error', jobId: 'job-stale-9', error: { code: 'NETWORK', retryable: true } })
    expect(jobs.getState().error, 'only the running job may own the error slot (job:done already filters by jobId)').toBeNull()

    // The running job's own error still records (guard: the fix must be filtering, not muting).
    engine.emitAsr({ t: 'job:error', jobId: running, error: { code: 'GPU_OOM', retryable: true } })
    expect(jobs.getState().error).toEqual({ code: 'GPU_OOM', retryable: true })
  })

  test('ADVERSE SM.4: FR-2.0.2 one-running-job — starting a second job while one runs must not orphan the first (attack: back-to-back startTranscribe, then cancel must reach every started job)', () => {
    const { engine, jobs } = createJobsHarness()
    jobs.startTranscribe(transcribeOptions())
    const first = jobs.getState().running?.jobId as string
    jobs.startTranscribe(transcribeOptions())
    const second = jobs.getState().running?.jobId as string
    expect(first).not.toBe(second)

    const started = engine.asrRequests.filter((r) => r.t === 'transcribe').map((r) => (r.t === 'transcribe' ? r.jobId : ''))
    expect(started).toEqual([first, second])

    jobs.cancel()
    const cancelled = new Set(engine.asrRequests.filter((r) => r.t === 'cancel').map((r) => (r.t === 'cancel' ? r.jobId : '')))
    expect(cancelled.has(second), 'the current job is cancelled').toBe(true)
    expect(cancelled.has(first), 'the displaced job is unreachable after replacement — the worker keeps running an uncancellable job').toBe(true)
  })

  test('ADVERSE SM.5: contract JobsState.error — job:error after the SAME job already completed records the error and never resurrects running (attack: error-after-done; honest pass: contract says job:error updates state)', () => {
    const { engine, jobs } = createJobsHarness()
    jobs.startTranscribe(transcribeOptions())
    const jobId = jobs.getState().running?.jobId as string

    engine.emitAsr({ t: 'job:done', jobId })
    expect(jobs.getState().running).toBeNull()

    engine.emitAsr({ t: 'job:error', jobId, error: { code: 'ENGINE_INTERNAL', retryable: false } })
    expect(jobs.getState().running, 'a finished job must not be marked running again').toBeNull()
    expect(jobs.getState().error, 'the late error still records per contract (job:error updates state)').toEqual({ code: 'ENGINE_INTERNAL', retryable: false })
  })

  test('ADVERSE SM.6: FR-2.0.4 progress — regression of processedSec mid-job must follow the latest event, never stick (attack: 60 s → 10 s regression; honest pass: no monotonicity requirement exists in the spec)', () => {
    const { engine, jobs } = createJobsHarness()
    jobs.startTranscribe(transcribeOptions())
    const jobId = jobs.getState().running?.jobId as string

    engine.emitAsr({ t: 'job:progress', jobId, processedSec: 60, totalSec: 120 })
    engine.emitAsr({ t: 'job:progress', jobId, processedSec: 10, totalSec: 120 })
    expect(jobs.getState().progress, 'latest event wins (resume/scrub semantics); a sticky regression would be the defect').toEqual({ processedSec: 10, totalSec: 120 })
  })

  test('ADVERSE SM.7: FR-2.0.6 notice flooding — 1000 rapid notice events record without throwing and leave the rest of the slice intact (honest pass: the frozen shape notices: Notice[] is an unbounded sink; no cap is specified)', () => {
    const { engine, jobs } = createJobsHarness()
    jobs.startTranscribe(transcribeOptions())
    const running = jobs.getState().running

    for (let i = 0; i < 1000; i += 1) engine.emitAsr({ t: 'notice', notice: { code: 'WORKER_RECYCLED', params: { n: i } } })

    expect(jobs.getState().notices.length, 'every notice is recorded (none silently dropped)').toBe(1000)
    expect(jobs.getState().running, 'flooding must not disturb the running job').toBe(running)
  })

  test('ADVERSE SM.8: FR-2.0.6 cancel ordering — cancel() after the job already finished (job:done) posts NOTHING (attack: orphan diarize/media cancels for a dead jobId)', () => {
    const { engine, jobs } = createJobsHarness()
    jobs.startTranscribe(transcribeOptions(true))
    const jobId = jobs.getState().running?.jobId as string
    engine.emitAsr({ t: 'job:done', jobId })

    jobs.cancel()
    expect(engine.asrRequests.filter((r) => r.t === 'cancel').length, 'no cancel for a finished job').toBe(0)
    expect(engine.diarizeRequests.filter((r) => r.t === 'cancel').length, 'no diarize cancel for a finished job either').toBe(0)
    expect(engine.mediaRequests.filter((r) => r.t === 'cancel').length).toBe(0)
  })
})

function storageDouble(initial: Record<string, string> = {}, options: { getRejects?: boolean; setRejects?: boolean } = {}): { storage: SettingsStorage; writes: { key: string; value: string }[] } {
  const backing = new Map(Object.entries(initial))
  const writes: { key: string; value: string }[] = []
  const storage: SettingsStorage = {
    get: (key) => (options.getRejects === true ? Promise.reject(new Error('idb_unavailable')) : Promise.resolve(backing.get(key) ?? null)),
    set: (key, value) => {
      if (options.setRejects === true) return Promise.reject(new Error('quota_exceeded'))
      backing.set(key, value)
      writes.push({ key, value })
      return Promise.resolve()
    },
  }
  return { storage, writes }
}

describe('ADVERSE SET: settings slice with hostile values and hostile storage', () => {
  test('ADVERSE SET.1: CC-101.1/US-2.0.1 — setPanelSize with NaN/±Infinity must never leave non-finite sizes in state or persisted JSON (attack: non-finite panel sizes through the public setter)', async () => {
    const { storage, writes } = storageDouble()
    const settings = await createSettingsStore({ storage })

    settings.setPanelSize('sidebar', Number.NaN)
    settings.setPanelSize('sidebar', Number.POSITIVE_INFINITY)
    settings.setPanelSize('timeline', Number.NEGATIVE_INFINITY)

    const state = settings.getState()
    expect(Number.isFinite(state.panels.sidebarPx), 'NaN/Infinity must never persist as a panel size').toBe(true)
    expect(Number.isFinite(state.panels.timelinePx)).toBe(true)
    expect(state.panels.sidebarPx).toBeGreaterThanOrEqual(MIN_SIDEBAR_PX)
    expect(state.panels.timelinePx).toBeGreaterThanOrEqual(MIN_TIMELINE_PX)

    const persisted = JSON.parse(writes.at(-1)?.value ?? '{}') as { panels?: { sidebarPx?: unknown; timelinePx?: unknown } }
    expect(persisted.panels?.sidebarPx, 'the persisted copy mirrors the sanitized state').toBe(state.panels.sidebarPx)
    expect(persisted.panels?.timelinePx).toBe(state.panels.timelinePx)
  })

  test('ADVERSE SET.2: US-2.0.1 layout-boundedness — an absurd size (1e12 px) must be bounded by the slice, through BOTH setPanelSize and hydration (attack: corrupt/hostile storage makes the sidebar swallow the entire viewport)', async () => {
    const { storage } = storageDouble()
    const settings = await createSettingsStore({ storage })
    settings.setPanelSize('sidebar', 1e12)
    expect(settings.getState().panels.sidebarPx, 'a CSS-px panel width beyond any display is as corrupt as NaN and must be bounded (only MIN is specified — see report, spec ambiguity)').toBeLessThan(100_000)

    const tampered = storageDouble({ [SETTINGS_STORAGE_KEY]: '{"panels":{"sidebarPx":1e12,"timelinePx":1e12}}' })
    const hydrated = await createSettingsStore({ storage: tampered.storage })
    expect(hydrated.getState().panels.sidebarPx, 'hydration of a 1e12 px persisted size must be bounded too').toBeLessThan(100_000)
    expect(hydrated.getState().panels.timelinePx).toBeLessThan(100_000)
  })

  test('ADVERSE SET.3: contract createSettingsStore hydration — a fuzz matrix of corrupted persisted JSON hydrates sane defaults and never throws (attack: null/array/boolean/wrong-type/1e400/__proto__ payloads)', async () => {
    const corrupt: readonly string[] = ['{not json', '', 'null', 'true', '"a string"', '[1,2,3]', '{"panels":null}', '{"panels":{"sidebarPx":"500","timelinePx":true}}', '{"collapsed":{"sidebar":"yes","timeline":1}}', '{"theme":"halloween"}', '{"panels":{"sidebarPx":1e400}}', '{"__proto__":{"panels":{"sidebarPx":9}}}']
    for (const raw of corrupt) {
      const { storage } = storageDouble({ [SETTINGS_STORAGE_KEY]: raw })
      await expect(createSettingsStore({ storage }), `corrupt payload must hydrate, not reject: ${raw}`).resolves.toBeTruthy()
      const settings = await createSettingsStore({ storage })
      const state = settings.getState()
      expect(state.panels.sidebarPx, `sidebar defaults for ${raw}`).toBe(320)
      expect(state.panels.timelinePx, `timeline defaults for ${raw}`).toBe(200)
      expect(state.theme, `theme defaults to dark for ${raw}`).toBe('dark')
      expect(state.collapsed).toEqual({ sidebar: false, timeline: false })
      expect(Number.isInteger(state.panels.sidebarPx)).toBe(true)
    }
    expect(({} as Record<string, unknown>).panels, 'hydration never pollutes Object.prototype').toBeUndefined()
  })

  test('ADVERSE SET.4: contract createSettingsStore — "Hydrates from storage … never throws" must survive a REJECTING storage read (attack: transient IDB failure on get; the unit-106 adapter is allowed to reject, and a rejected boot means a blank app via App.tsx)', async () => {
    const { storage } = storageDouble({}, { getRejects: true })
    let store: Awaited<ReturnType<typeof createSettingsStore>> | 'rejected' = 'rejected'
    try {
      store = await createSettingsStore({ storage })
    } catch {
      // stays 'rejected'
    }
    expect(store !== 'rejected', 'a failed read must behave like a first run (defaults), never reject the store').toBe(true)
    if (store === 'rejected') return
    expect(store.getState().panels.sidebarPx).toBeGreaterThanOrEqual(MIN_SIDEBAR_PX)
  })

  test('ADVERSE SET.5: US-2.0.1 — collapse everything, resize both panels while collapsed, expand: the sizes return unchanged and persisted (attack: collapse/resize interleave losing the remembered geometry)', async () => {
    const { storage, writes } = storageDouble()
    const settings = await createSettingsStore({ storage })

    settings.toggleCollapsed('sidebar')
    settings.toggleCollapsed('timeline')
    expect(settings.getState().collapsed).toEqual({ sidebar: true, timeline: true })

    settings.setPanelSize('sidebar', 480)
    settings.setPanelSize('timeline', 260)

    settings.toggleCollapsed('sidebar')
    settings.toggleCollapsed('timeline')

    const state = settings.getState()
    expect(state.collapsed).toEqual({ sidebar: false, timeline: false })
    expect(state.panels.sidebarPx, 'a collapsed panel must keep (and restore) its size').toBe(480)
    expect(state.panels.timelinePx).toBe(260)

    const persisted = JSON.parse(writes.at(-1)?.value ?? '{}') as { panels?: { sidebarPx?: number; timelinePx?: number } }
    expect(persisted.panels?.sidebarPx).toBe(480)
    expect(persisted.panels?.timelinePx).toBe(260)
  })

  test('ADVERSE SET.6: contract persist fire-and-forget — a storage that ALWAYS rejects on set must not throw out of any setter (attack: quota/private-mode persistence failure)', async () => {
    const { storage } = storageDouble({}, { setRejects: true })
    const settings = await createSettingsStore({ storage })
    expect(() => {
      settings.setPanelSize('sidebar', 400)
      settings.toggleCollapsed('timeline')
      settings.setTheme('light')
    }, 'a storage failure must never break an interaction (settings.ts persist contract)').not.toThrow()
    expect(settings.getState().panels.sidebarPx).toBe(400)
  })
})
