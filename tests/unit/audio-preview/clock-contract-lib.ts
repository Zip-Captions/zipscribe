// Unit-107 CC-107.2 — the ONE MediaClock contract, runner-neutral (no test
// framework here by design): the vitest suite drives `runClockContract`
// against the shared fake clock (in-process), and the chromium spec drives
// the SAME function against the real element-audio and decoded clocks
// through `__zipVisualizerBridge`. Three clocks, one contract.
//
// Returns violation strings (never throws on contract failure) — the caller
// fails its own assertion with the joined list, so one run reports every
// break instead of stopping at the first.

export interface ClockContractHandle {
  readonly kind: 'fake' | 'element' | 'decoded'
  play(): Promise<void>
  pause(): Promise<void>
  seek(t: number): Promise<void>
  setRate(rate: number): Promise<void>
  time(): Promise<number>
  duration(): Promise<number>
  paused(): Promise<boolean>
  endedCount(): Promise<number>
  /** Await `ms` of real (in-page) or scripted (fake) time. */
  wait(ms: number): Promise<void>
  dispose(): Promise<void>
}

/** Arbitrator mediation for the loop leg (bridge `command` + playhead poll;
 *  the fake leg wraps a real SyncArbitrator over the fake clock + fake rAF). */
export interface ArbitratorContractHandle {
  command(id: string, payload?: unknown): Promise<unknown>
  playhead(): Promise<number>
  playing(): Promise<boolean>
  wait(ms: number): Promise<void>
}

export type ClockViolations = string[]

/** Tolerance for |time() − seekTarget| (CC-107.2 seek clause). */
const SEEK_SETTLE_TOLERANCE = 0.25
/** Relative band on advance-factor vs rate (element clocks jitter; decoded
 *  clocks are sample-counted; the fake is exact). */
const RATE_BAND = 0.2

export async function runClockContract(clock: ClockContractHandle, arbitrator: ArbitratorContractHandle): Promise<ClockViolations> {
  const v: ClockViolations = []
  const at = async (label: string, check: () => Promise<string | null>): Promise<void> => {
    try {
      const fail = await check()
      if (fail !== null) v.push(`${clock.kind}: ${label}: ${fail}`)
    } catch (e) {
      v.push(`${clock.kind}: ${label}: THREW ${e instanceof Error ? `${e.name}` : typeof e}`)
    }
  }

  await at('initial state is paused with a finite non-negative duration', async () => {
    const d = await clock.duration()
    const p = await clock.paused()
    if (!(d > 0) || !Number.isFinite(d)) return `duration ${String(d)}`
    if (p !== true) return `paused ${String(p)}`
    return null
  })

  await at('play makes paused false and position advance with time', async () => {
    await clock.play()
    const p = await clock.paused()
    if (p !== true && p !== false) return `paused ${String(p)}`
    if (p !== false) return 'still paused after play'
    const t0 = await clock.time()
    await clock.wait(500)
    const t1 = await clock.time()
    if (!(t1 > t0)) return `time did not advance (${t0} → ${t1})`
    await clock.pause()
    return null
  })

  await at('pause freezes the position', async () => {
    const p = await clock.paused()
    if (p !== true) return `paused ${String(p)} after pause`
    const t0 = await clock.time()
    await clock.wait(300)
    const t1 = await clock.time()
    if (Math.abs(t1 - t0) > 0.02) return `advanced while paused (${t0} → ${t1})`
    return null
  })

  await at('seek lands within tolerance and preserves paused state', async () => {
    const target = Math.min(3.5, (await clock.duration()) - 0.5)
    await clock.seek(target)
    const t = await clock.time()
    if (Math.abs(t - target) > SEEK_SETTLE_TOLERANCE) return `time ${String(t)} vs target ${String(target)}`
    const p = await clock.paused()
    if (p !== true) return 'seek started playback'
    return null
  })

  await at('loop region wraps [b → a] while playing (via arbitrator)', async () => {
    const d = await clock.duration()
    const b = Math.min(2, d * 0.4)
    const e = b + 0.5
    // ALL motion through the arbitrator — its own play state drives the
    // loop-wrap sampler (arbitrator.ts frozen wrap semantics [b → a]).
    await arbitrator.command('transport-loop-set', { start: 0, end: e })
    await arbitrator.command('transport-seek', { time: b - 0.2 })
    await arbitrator.command('transport-play', undefined)
    // Poll for a playhead regression inside the region (the wrap).
    let prev = await arbitrator.playhead()
    let wrapped = false
    const deadline = Date.now() + 4000
    while (Date.now() < deadline && !wrapped) {
      await arbitrator.wait(40)
      const now = await arbitrator.playhead()
      if (prev >= e - 0.05 && now < b + 0.2) wrapped = true
      prev = now
    }
    await arbitrator.command('transport-pause', undefined)
    await arbitrator.command('transport-loop-clear', undefined)
    if (!wrapped) return `no [${String(b)} → 0] wrap observed within 4 s (last playhead ${String(prev)})`
    return null
  })

  for (const rate of [2, 0.5, 1] as const) {
    await at(`setRate(${String(rate)}) scales advance within ±20 %`, async () => {
      await clock.seek(0.5)
      await clock.setRate(rate)
      await clock.play()
      const t0 = await clock.time()
      await clock.wait(600)
      const t1 = await clock.time()
      await clock.pause()
      const advance = t1 - t0
      const expected = 0.6 * rate
      const lo = expected * (1 - RATE_BAND)
      const hi = expected * (1 + RATE_BAND)
      if (!(advance >= lo && advance <= hi)) return `advanced ${advance.toFixed(3)} s in ~0.6 s at rate ${String(rate)} (want ${lo.toFixed(3)}–${hi.toFixed(3)})`
      return null
    })
  }
  await at('rate restore to 1 keeps the clock usable', async () => {
    await clock.setRate(1)
    await clock.seek(0)
    await clock.play()
    await clock.wait(300)
    const t = await clock.time()
    await clock.pause()
    if (!(t > 0)) return `no advance after rate restore (${String(t)})`
    return null
  })

  await at('ended → paused, endedCount >= 1, clamped position, play restarts from ~0', async () => {
    const d = await clock.duration()
    await clock.seek(Math.max(0, d - 0.1))
    await clock.play()
    const deadline = Date.now() + 4000
    let p = await clock.paused()
    while (p !== true && Date.now() < deadline) {
      await clock.wait(100)
      p = await clock.paused()
    }
    if (p !== true) return 'never paused at end of media'
    const ec = await clock.endedCount()
    if (!(ec >= 1)) return `endedCount ${String(ec)}`
    const t = await clock.time()
    if (!(t <= d + 0.05)) return `time ${String(t)} past duration ${String(d)}`
    await clock.play()
    const t2 = await clock.time()
    if (!(t2 < 0.5)) return `play after ended did not restart from ~0 (time ${String(t2)})`
    await clock.pause()
    return null
  })

  await at('dispose is idempotent and leaves the clock inert', async () => {
    await clock.dispose()
    await clock.dispose()
    const p = await clock.paused()
    if (p !== true) return `paused ${String(p)} after dispose`
    return null
  })

  return v
}
