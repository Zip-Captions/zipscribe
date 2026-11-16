// CC-107.2 (L3, vitest leg): the shared clock contract against the FAKE
// clock — `runClockContract` (clock-contract-lib.ts, the ONE contract all
// three clocks pass) driven in-process with the real `createSyncArbitrator`
// over the manual rAF driver (no timers — conventions § 3). The real element
// and decoded clocks pass the SAME function in
// `e2e/audio-preview/clocks.spec.ts` (chromium, playwright-credited).
import { describe, expect, test } from 'vitest'
import { createSyncArbitrator } from '@state/services/playback/arbitrator'
import { createFakeRafs } from '../editor/helpers/fake-rafs'
import { createFakeMediaClock } from '../../../src/test-support/fake-media-clock'
import { runClockContract } from './clock-contract-lib'
import type { ArbitratorContractHandle, ClockContractHandle } from './clock-contract-lib'

const DURATION = 10
const FRAME_MS = 16

describe('CC-107.2: clock contract — fake clock (L3)', () => {
  test('CC-107.2: the fake clock passes the full MediaClock contract (play/pause/seek/loop/rate/ended)', async () => {
    const rafs = createFakeRafs()
    const clock = createFakeMediaClock({ duration: DURATION })
    const arbitrator = createSyncArbitrator({ clock, rafs })

    // Scripted time: every wait pumps identical fake-rAF frames AND advances
    // the fake clock (element-style in-flight advance).
    const pump = async (ms: number): Promise<void> => {
      const frames = Math.max(1, Math.round(ms / FRAME_MS))
      for (let i = 0; i < frames; i++) {
        clock.advance(FRAME_MS)
        rafs.frame(FRAME_MS)
      }
    }

    const clockHandle: ClockContractHandle = {
      kind: 'fake',
      play: async () => {
        clock.play()
      },
      pause: async () => {
        clock.pause()
      },
      seek: async (t) => {
        clock.seek(t)
        rafs.frame(0)
      },
      setRate: async (r) => {
        clock.setRate(r)
      },
      time: async () => clock.currentTime(),
      duration: async () => clock.duration,
      paused: async () => clock.paused,
      endedCount: async () => clock.endedCount,
      wait: (ms) => pump(ms),
      dispose: async () => {
        clock.dispose()
      },
    }
    const arbHandle: ArbitratorContractHandle = {
      command: async (id, payload) => {
        const p = payload as { start?: number; end?: number; time?: number } | undefined
        if (id === 'transport-loop-set') arbitrator.setLoop([p?.start ?? 0, p?.end ?? 0])
        else if (id === 'transport-loop-clear') arbitrator.setLoop(null)
        else if (id === 'transport-seek') arbitrator.seek(p?.time ?? 0)
        else if (id === 'transport-play') arbitrator.play()
        else if (id === 'transport-pause') arbitrator.pause()
        else throw new Error(`unexpected contract command ${id}`)
        return null
      },
      playhead: async () => arbitrator.playhead,
      playing: async () => arbitrator.playing,
      wait: (ms) => pump(ms),
    }

    const violations = await runClockContract(clockHandle, arbHandle)
    expect(violations, `contract violations:\n${violations.join('\n')}`).toEqual([])
  })
})
