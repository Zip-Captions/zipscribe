// ADVERSARY (unit-204, category: stateful interleavings) — `useOnlineStatus`
// (FR-204.4) at its hook seam. The frozen e2e (e2e/pwa/offline.spec.ts) pins
// the happy directions (offline → chip, reconnect → gone). This file probes
// the reconnect INTERLEAVINGS the FR-204.4 contract allows: the chip's second
// signal is "a model-host fetch failure from the jobs errors" (sticky, per the
// hook's own contract) while the jobs slice keeps `error` until the NEXT
// `startTranscribe` clears it (src/state/jobs.ts). A store mutation that does
// NOT touch `error` (any notice, capability refresh, availability probe — all
// real post-failure user paths) re-fires the hook's `sync`, which re-reads the
// stale `error.code === 'NETWORK'` and re-latches the chip.
//
// Contract cited: unit-204 US-204.2 (line 25) — "the `Offline` chip … it
// disappears on reconnect." A chip that reappears after having disappeared,
// with NO new failure, claims Offline while the browser is online (design.md
// § Offline & install: the chip is honest-status; product.md rule 4 — never a
// fake claim).
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, test } from 'vitest'
import { createJobsStore, type EnginePort, type ModelCachePort } from '../../state/jobs'
import type { AsrEvent, MediaEvent } from '../../engine/protocol'
import { useOnlineStatus, type OnlineStatus } from './use-online-status'

function makeEngine(): { engine: EnginePort; postAsr: (event: AsrEvent) => void; postMedia: (event: MediaEvent) => void } {
  const asrListeners = new Set<(event: AsrEvent) => void>()
  const mediaListeners = new Set<(event: MediaEvent) => void>()
  const engine: EnginePort = {
    postMedia: () => undefined,
    postAsr: () => undefined,
    postDiarize: () => undefined,
    onAsrEvent: (listener) => {
      asrListeners.add(listener)
      return () => asrListeners.delete(listener)
    },
    onMediaEvent: (listener) => {
      mediaListeners.add(listener)
      return () => mediaListeners.delete(listener)
    },
    dispose: () => undefined,
  }
  return { engine, postAsr: (event) => asrListeners.forEach((listener) => listener(event)), postMedia: (event) => mediaListeners.forEach((listener) => listener(event)) }
}

function mount(jobs: ReturnType<typeof createJobsStore>): () => OnlineStatus {
  let latest: OnlineStatus = { offline: false }
  function Harness(): null {
    latest = useOnlineStatus(jobs)
    return null
  }
  render(createElement(Harness))
  return () => latest
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('FR-204.4 / US-204.2: useOnlineStatus reconnect interleavings (adversary)', () => {
  test('ADVERSE UOS.1: stale NETWORK jobs error must not re-latch the chip after the online event', async () => {
    const { engine, postAsr } = makeEngine()
    const modelCache: ModelCachePort = { listCached: () => Promise.resolve([]) }
    const jobs = createJobsStore({ engine, modelCache })
    const status = mount(jobs)
    await flush()

    // 1. Model-host fetch failure (coded NETWORK job error) while the browser
    //    still reports onLine=true — the FR-204.4 second signal: chip ON.
    postAsr({ t: 'job:error', jobId: 'JOB_A', error: { code: 'NETWORK', retryable: true, detail: 'model_host_unreachable' } })
    await flush()
    expect(status().offline, 'a coded NETWORK job error raises the offline chip').toBe(true)

    // 2. Reconnect: the `online` event clears the sticky fetch-failure signal.
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(status().offline, 'the chip disappears on reconnect (US-204.2)').toBe(false)

    // 3. NO new failure — the jobs store merely mutates (an engine `notice`,
    //    e.g. a tier probe — every store notification re-runs the hook's sync)
    //    while `error` still holds the OLD NETWORK code (jobs.ts clears error
    //    only in the next startTranscribe).
    postAsr({ t: 'notice', jobId: 'JOB_A', notice: { code: 'WORKER_RECYCLED' } })
    await flush()
    expect(status().offline, 'a store mutation carrying the STALE NETWORK error must not resurrect the chip — the user is online (US-204.2 "it disappears on reconnect")').toBe(false)
  })

  test('ADVERSE UOS.2: offline event DURING a model-host failure, then reconnect — chip clears and stays cleared', async () => {
    const { engine, postAsr } = makeEngine()
    const modelCache: ModelCachePort = { listCached: () => Promise.resolve([]) }
    const jobs = createJobsStore({ engine, modelCache })
    const status = mount(jobs)
    await flush()

    postAsr({ t: 'job:error', jobId: 'JOB_B', error: { code: 'NETWORK', retryable: true, detail: 'model_host_unreachable' } })
    await flush()
    expect(status().offline).toBe(true)

    // The OS offline event lands while the failure is already sticky.
    window.dispatchEvent(new Event('offline'))
    await flush()
    expect(status().offline, 'offline event keeps the chip up (both signals)').toBe(true)

    // Reconnect storm: online → offline → online, quickly, with the stale
    // error still in the store. The final `online` must clear BOTH signals.
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(status().offline, 'a reconnect storm ends online — chip must be gone').toBe(false)

    // And it STAYS gone: no further failures, only a capability refresh.
    jobs.setCapability({ tier: 'T2', reasons: [] })
    await flush()
    expect(status().offline, 'post-reconnect store mutation with the stale error must not re-latch (US-204.2)').toBe(false)
  })

  test('ADVERSE UOS.3 (survived): plain offline/online events alone toggle the chip without the jobs store', async () => {
    const { engine } = makeEngine()
    const modelCache: ModelCachePort = { listCached: () => Promise.resolve([]) }
    const jobs = createJobsStore({ engine, modelCache })
    const status = mount(jobs)
    await flush()
    expect(status().offline, 'online boot shows no chip').toBe(false)
    window.dispatchEvent(new Event('offline'))
    await flush()
    expect(status().offline).toBe(true)
    window.dispatchEvent(new Event('online'))
    await flush()
    expect(status().offline).toBe(false)
  })
})
