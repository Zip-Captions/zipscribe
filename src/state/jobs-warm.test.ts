// Review r1 (finding 3) regression home [CC-204.2] (L1, node): the FR-204.2
// main-thread warm on the ONLINE real lane must never (a) re-download a row
// the verified cache already holds — `ensureOffline` fetches + re-verifies the
// FULL row per call, so an ungated warm re-downloaded every cached model on
// every startTranscribe — nor (b) start fetching an uncached > 100 MB model
// ahead of the unit-03 `model:confirm-required` gate resolving (the
// zero-bytes-until-confirm invariant on the transcribe path). The warm seam
// (the composition root's `ensureOffline` caller) is the counter: one warm
// call == one full model-bytes download.
import { describe, expect, test } from 'vitest'
import { createJobsStore } from './jobs'
import type { JobsStore } from './jobs'
import type { EnginePort, ModelCachePort } from './jobs'
import type { AsrEvent, ModelId } from '../engine/protocol'

const SMALL_MODEL: ModelId = 'sherpa-zipformer-en-int8@11a70a47' // registry approxBytes 71 MB (< 100 MB gate)
const LARGE_MODEL: ModelId = 'whisper-base_timestamped@608c49e6' // registry approxBytes 211 MB (> 100 MB gate)

function createEngineDouble(): { engine: EnginePort; emitAsr: (event: AsrEvent) => void } {
  const asrListeners: ((event: AsrEvent) => void)[] = []
  const engine: EnginePort = {
    postMedia: () => undefined,
    postAsr: () => undefined,
    postDiarize: () => undefined,
    onMediaEvent: () => () => undefined,
    onAsrEvent: (listener) => {
      asrListeners.push(listener)
      return () => asrListeners.splice(asrListeners.indexOf(listener), 1)
    },
    dispose: () => {
      asrListeners.length = 0
    },
  }
  return { engine, emitAsr: (event) => [...asrListeners].forEach((listener) => listener(event)) }
}

/** One jobs store + warm rig: the warm double stands in for `context.ts`'s
 *  `void modelCache.ensureOffline(id)` — one call == one fetch + verify + put
 *  sequence, so `fetches` counts model bytes downloaded; `present` mirrors the
 *  verified cache the presence short-circuit consults. */
function createWarmRig(cached: readonly ModelId[] = []): { jobs: JobsStore; fetches: ModelId[]; emitAsr: (event: AsrEvent) => void } {
  const present = new Set<ModelId>(cached)
  const fetches: ModelId[] = []
  const modelCache: ModelCachePort = {
    listCached: () => Promise.resolve([...present]),
    isOfflineReady: (id) => Promise.resolve(present.has(id)),
  }
  const { engine, emitAsr } = createEngineDouble()
  const jobs = createJobsStore({
    engine,
    modelCache,
    warmModelCache: (id) => {
      fetches.push(id)
      present.add(id) // the all-or-nothing put lands — the row is now cached
    },
  })
  jobs.setCapability({ tier: 'T2', reasons: [] })
  return { jobs, fetches, emitAsr }
}

function startTranscribe(jobs: JobsStore, modelId: ModelId): void {
  jobs.startTranscribe({ language: 'en', modelId, diarize: false, mode: 'replace' })
}

async function flushWarm(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Review r1 (finding 3) [CC-204.2]: online warm — presence short-circuit + confirm gate', () => {
  test('CC-204.2: cached model → no re-download — the second run fetches ZERO', async () => {
    const uncached = createWarmRig([])
    startTranscribe(uncached.jobs, SMALL_MODEL)
    await flushWarm()
    expect(uncached.fetches, 'first uncached run warms the row (used once → offline-ready)').toEqual([SMALL_MODEL])
    startTranscribe(uncached.jobs, SMALL_MODEL)
    await flushWarm()
    expect(uncached.fetches, 'the cached second run must add ZERO fetches (ensureOffline re-fetches the full row per call)').toHaveLength(1)

    const alreadyCached = createWarmRig([SMALL_MODEL])
    startTranscribe(alreadyCached.jobs, SMALL_MODEL)
    await flushWarm()
    expect(alreadyCached.fetches, 'a row already offline-ready is never fetched again').toEqual([])
  })

  test('CC-204.2: uncached > 100 MB → the warm fetches NOTHING before the model:confirm-required gate resolves', async () => {
    const rig = createWarmRig([])
    startTranscribe(rig.jobs, LARGE_MODEL)
    await flushWarm()
    expect(rig.fetches, 'a 211 MB row must not start downloading ahead of the confirmation (unit-03 zero-bytes-until-confirm on the transcribe path)').toEqual([])
  })

  test('CC-204.2: confirmModelDownload releases the deferred warm, and the cached row never re-fetches', async () => {
    const rig = createWarmRig([])
    startTranscribe(rig.jobs, LARGE_MODEL)
    await flushWarm()
    expect(rig.fetches, 'pre-confirm: no bytes').toEqual([])

    rig.jobs.confirmModelDownload(LARGE_MODEL)
    await flushWarm()
    expect(rig.fetches, 'the user acceptance releases the warm this run deferred').toEqual([LARGE_MODEL])

    startTranscribe(rig.jobs, LARGE_MODEL)
    await flushWarm()
    expect(rig.fetches, 'the now-cached row adds ZERO further fetches').toEqual([LARGE_MODEL])
  })

  test('CC-204.2: the completed gate-owner load (model:ready) releases the deferred warm — used once → offline-ready', async () => {
    const rig = createWarmRig([])
    startTranscribe(rig.jobs, LARGE_MODEL)
    await flushWarm()
    expect(rig.fetches, 'no confirm, no completed load → still nothing fetched').toEqual([])

    rig.emitAsr({ t: 'model:ready', model: LARGE_MODEL, device: 'wasm' })
    await flushWarm()
    expect(rig.fetches, 'the gate-owner load finished (bytes already moved worker-side) → warm materializes the verified cache').toEqual([LARGE_MODEL])

    startTranscribe(rig.jobs, LARGE_MODEL)
    await flushWarm()
    expect(rig.fetches, 'presence short-circuit after the release: zero further fetches').toEqual([LARGE_MODEL])
  })
})
