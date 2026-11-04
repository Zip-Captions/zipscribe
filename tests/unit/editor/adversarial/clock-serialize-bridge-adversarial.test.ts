// ADVERSARY (unit-102, category 2 — clock/serialize/bridge hostile probes).
// Additive ONLY: the frozen suites (arbitrator, serialize, transport-commands,
// editor-bridge-gate, contract) stay untouched; this file probes what they do
// NOT pin — dt-spike and media-end extrapolation bounds, the deferred clock's
// detach/attach mid-play transitions, visibilitychange resync inside a loop,
// seek/setLoop hostile ranges, canonical serializer edges (-0, integer-vs-float,
// half-way rounding, huge finite numbers, key ordering incl. numeric-ish +
// unicode, `__proto__` own keys, empty arrays), the CC-102.5 lint rule's real
// ESLint completeness (computed/destructuring/template forms), and the
// editor-bridge double-install + query-gate hardening against prototype
// pollution and location spoofing. Titles: `ADVERSE CS.n: <CC/FR-ID or
// invariant> — <attack>`.
// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isChildRun, REPO_ROOT } from '../../../helpers/repo'
import { createSyncArbitrator } from '@state/services/playback/arbitrator'
import { createDeferredMediaClock } from '../../../../src/state/services/playback/media-clock'
import { canonicalize, parseProject, serializeProject } from '@state/services/serialize'
import { createTestApp } from '../helpers/editor-app'
import { block, sampleProject, SAMPLE_ASSET, word } from '../helpers/fixture-project'
import { createFakeMediaClock } from '../helpers/fake-media-clock'
import { createFakeRafs } from '../helpers/fake-rafs'
import type { Project } from '@engine/model'

function setup(options: { duration?: number } = {}): { rafs: ReturnType<typeof createFakeRafs>; clock: ReturnType<typeof createFakeMediaClock>; arbitrator: ReturnType<typeof createSyncArbitrator> } {
  const rafs = createFakeRafs(0)
  const clock = createFakeMediaClock(rafs, options.duration ?? 60)
  const arbitrator = createSyncArbitrator({ clock, rafs })
  return { rafs, clock, arbitrator }
}

function fakeElement(startTime: number): { el: unknown; set(t: number): void } {
  const state = {
    currentTime: startTime,
    duration: 60,
    paused: true,
    playbackRate: 1,
    play: () => {
      state.paused = false
      return Promise.resolve()
    },
    pause: () => {
      state.paused = true
    },
  }
  return { el: state as unknown, set: (t: number) => void (state.currentTime = t) }
}

// The editor bridge reaches the SAME receivers the UI uses — boot a minimal,
// worker-free app context and hand it out (context.ts is replaced wholesale;
// its worker imports never load).
vi.mock('../../../../src/app/context', async () => {
  const { createEditorApp: createApp } = await import('@state/history')
  const { createDeferredMediaClock: createDeferred } = await import('../../../../src/state/services/playback/media-clock')
  const { createFakeRafs: createRafs } = await import('../helpers/fake-rafs')
  const { sampleProject: sample } = await import('../helpers/fixture-project')
  const mediaClock = createDeferred()
  const editorApp = createApp({ clock: { now: () => 0 }, rafs: createRafs(0), mediaClock, initialProject: sample() })
  const stage = { setMediaSource: (_url: string | null) => undefined, isVideoReady: () => true }
  // Structural context: the bridge destructures exactly these three receivers.
  const ctx = { editorApp, stage, mediaClock }
  return { getAppContext: () => ctx }
})

function w(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>
}

describe('ADVERSE CS (unit-102 adversary): clock / serialize / bridge hostile probes', () => {
  test('ADVERSE CS.1: CC-102.2 / US-2.1.5 — a 30 s rAF gap (backgrounded tab) advances the playhead at most the modelled 1 s × rate, never teleports it', () => {
    const { rafs, arbitrator } = setup()
    arbitrator.play()
    rafs.frame(30_000)
    expect(arbitrator.playhead, 'the modelled frame is capped at MAX_MODELLED_FRAME_MS').toBeLessThanOrEqual(1.001)
    expect(arbitrator.playhead).toBeGreaterThanOrEqual(0.99)

    const t2 = setup()
    t2.arbitrator.play()
    t2.arbitrator.rate = 2
    t2.rafs.frame(30_000)
    expect(t2.arbitrator.playhead, 'the dt cap is rate-scaled, still bounded').toBeLessThanOrEqual(2.001)
  })

  test('ADVERSE CS.2: US-2.1.5 — playhead must not run away past the media end while the element is pinned at duration (one-truth breach)', () => {
    const { rafs, clock, arbitrator } = setup({ duration: 60 })
    arbitrator.seek(60)
    arbitrator.play()
    // The element never advances past its duration (an <video> stops at `ended`);
    // only rAF keeps flushing. dt-modeling must not extrapolate past the clock.
    for (let i = 0; i < 10; i++) rafs.frame(16)
    expect(clock.currentTime(), 'the element truth stays at duration').toBe(60)
    expect(arbitrator.playhead, 'playhead may not outrun the clock past the media end').toBeLessThanOrEqual(60 + 1e-6)
  })

  test('ADVERSE CS.3: FR-102.3 — attaching → DETACHING → re-attaching the element mid-play is inert: the playhead does not regress to 0', () => {
    const rafs = createFakeRafs(0)
    const clock = createDeferredMediaClock()
    const arbitrator = createSyncArbitrator({ clock, rafs })
    const first = fakeElement(5)
    clock.attach(first.el as never)
    arbitrator.play()
    rafs.frame(16)
    const held = arbitrator.playhead
    expect(held, 'attached clock is followed').toBeGreaterThan(4)

    clock.attach(null)
    rafs.frame(16)
    expect(arbitrator.playhead, 'a detach is not a seek to 0 — the playhead may only advance (detached behavior is inert)').toBeGreaterThanOrEqual(held - 1e-6)

    clock.attach(first.el as never)
    rafs.frame(16)
    expect(arbitrator.playhead, 're-attach follows the element again').toBeGreaterThanOrEqual(5)
  })

  test('ADVERSE CS.4: CC-102.2 — visibilitychange resync while looping still wraps [b → a] when the element raced past the loop end', () => {
    const { clock, arbitrator } = setup({ duration: 60 })
    clock.setRawTime(11.98)
    arbitrator.setLoop([10, 12])
    arbitrator.play()
    // Backgrounded: the element advanced past the loop end while rAF was frozen.
    clock.setRawTime(12.4)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(Math.abs(arbitrator.playhead - 10), 'the resync re-enters the loop at a').toBeLessThanOrEqual(0.033)
    expect(clock.seekTargets, 'the wrap issued the loop seek').toContain(10)
  })

  test('ADVERSE CS.5: US-2.2.4 — seek negative / past duration clamps; NaN rejects with ZERO clock seeks', () => {
    const t = createTestApp({ withMediaClock: true })
    if (t.mediaClock === null) throw new Error('media clock missing')
    expect(t.app.dispatch('transport-seek', { time: -5 })).toBeNull()
    expect(t.app.editor.getState().playhead).toBe(0)
    expect(t.mediaClock.seekTargets.at(-1), 'the clamped 0 is what the element is asked for').toBe(0)

    expect(t.app.dispatch('transport-seek', { time: 1e9 })).toBeNull()
    expect(t.app.editor.getState().playhead).toBe(121.44)
    expect(t.mediaClock.seekTargets.at(-1)).toBe(121.44)

    const before = t.mediaClock.seekCalls
    expect(t.app.dispatch('transport-seek', { time: Number.NaN })?.code).toBe('INVALID_PAYLOAD')
    expect(t.app.editor.getState().playhead, 'NaN never touches the playhead').toBe(121.44)
    expect(t.mediaClock.seekCalls, 'a rejected seek never proxies to the element').toBe(before)
  })

  test('ADVERSE CS.6: FR-102.5 — transport-loop-set rejects inverted, zero-length and NaN/out-of-media regions', () => {
    const t = createTestApp()
    const invalid: ReadonlyArray<readonly [number, number]> = [
      [5, 4],
      [5, 5],
      [Number.NaN, 6],
      [0.5, Number.POSITIVE_INFINITY],
      [-1, 5],
      [0, 1e9],
    ]
    for (const [start, end] of invalid) {
      expect(t.app.dispatch('transport-loop-set', { start, end })?.code, `loop ${String(start)}→${String(end)}`).toBe('LOOP_RANGE_INVALID')
    }
    expect(t.app.editor.getState().loop).toBeNull()
    expect(t.app.history.undoCount(), 'UI-only: loop probes create no steps').toBe(0)
  })

  test('ADVERSE CS.7: FR-102.3 / CC-102.2 — an inverted loop region [b → a] (b < a) must be inert in the arbitrator, never a fabricated forward jump', () => {
    const { rafs, clock, arbitrator } = setup({ duration: 60 })
    arbitrator.seek(3)
    arbitrator.setLoop([6, 4]) // region [a=6, b=4]: the documented wrap is [b → a] — meaningless when b < a
    arbitrator.play()
    for (let i = 0; i < 100 && arbitrator.playhead < 5; i++) rafs.frame(16)
    expect(clock.seekTargets.includes(6), 'the arbitrator must not seek to a past b because of an inverted region').toBe(false)
    expect(arbitrator.playhead, 'no forward teleport without a user action').toBeLessThan(5)
  })

  test('ADVERSE CS.8: CC-102.4 / invariant 8 — canonical numbers: -0, integer-vs-float, half-way rounding fixed point, and finite numbers never serialize as null', () => {
    expect(canonicalize({ v: -0 }), 'negative zero canonicalizes to 0 (the golden byte form)').toBe('{"v":0}')
    expect(canonicalize({ v: 1 }), 'no integer/float noise').toBe('{"v":1}')
    expect(canonicalize({ v: 30.0 }), '30.0 === 30 in JS, emits the shortest form').toBe('{"v":30}')
    for (const v of [0.0005, -0.0005, 0.0015, -0.0015, 1.0005]) {
      const once = canonicalize({ v })
      expect(canonicalize(JSON.parse(once) as { v: number }), 'the 3-decimal rule is a fixed point (no drift on re-serialize)').toBe(once)
    }
    // Hostile-but-valid: parseProject admits any FINITE number (1e308), so
    // serialize must round-trip it — not silently emit JSON `null`.
    let hugeBytes: string | null = null
    let hugeThrew = false
    try {
      hugeBytes = canonicalize({ v: 1e308 })
    } catch {
      hugeThrew = true
    }
    expect(hugeThrew || (hugeBytes !== null && !hugeBytes.includes('null')), 'a finite number must never canonicalize to null').toBe(true)
    const huge = sampleProject({ asset: { ...SAMPLE_ASSET, duration: 1e308 } })
    expect(() => parseProject(serializeProject(huge)), 'invariant 8: a parse-valid project survives autosave reload').not.toThrow()
  })

  test('ADVERSE CS.9: CC-102.4 — key ordering with numeric-ish + unicode keys, __proto__ own keys, and empty blocks/words arrays survive parse∘serialize', () => {
    expect(canonicalize({ '10': 1, '9': 2, Z: 3, a: 4, é: 5 }), 'code-unit sorted keys (numeric-ish before letters, unicode last)').toBe('{"10":1,"9":2,"Z":3,"a":4,"é":5}')

    const hostileEntries = JSON.parse(
      '{"__proto__":{"text":"x","sourceHash":"h1","status":"translated"},"10":{"text":"y","sourceHash":"h2","status":"edited"},"9":{"text":"z","sourceHash":"h3","status":"translated"},"é":{"text":"u","sourceHash":"h4","status":"translated"}}',
    ) as Record<string, never>
    const translations = JSON.parse('[{"language":"fr","origin":"machine","engine":null,"entries":{}}]') as { entries: Record<string, never> }[]
    if (translations[0] !== undefined) translations[0].entries = hostileEntries
    const p = sampleProject({
      blocks: [block('blk_empty_words', 1, 2, 'SPK_1', [])],
      speakers: [],
      translations: translations as unknown as Project['translations'],
    })
    const json = serializeProject(p)
    expect(json, 'the own __proto__ key survives as data, not as a prototype mutation').toContain('"__proto__"')
    expect(parseProject(json), 'hostile-but-valid project round-trips deep-equal').toEqual(p)
  })

  test('ADVERSE CS.10: CC-102.5 — the real ESLint rule flags every media currentTime access FORM outside playback/** (dot, write, computed, destructuring, aliased, template)', () => {
    if (isChildRun()) return // spawns a node toolchain; not for the gates-scaffold child
    const probes = [
      'export const readDot = (el: HTMLMediaElement): number => el.currentTime',
      'export const writeDot = (el: HTMLMediaElement, t: number): void => { el.currentTime = t }',
      "export const readComputed = (el: HTMLMediaElement): number => el['currentTime']",
      'export const readDestructure = (el: HTMLMediaElement): number => { const { currentTime } = el; return currentTime }',
      'export const readAliased = (el: HTMLMediaElement): number => { const { currentTime: ct } = el; return ct }',
      'export const readTemplate = (el: HTMLMediaElement): number => el[`currentTime`]',
    ]
    // The test-side scan (contract.test) only sees `.currentTime` — the
    // template form is invisible to it, so lint is the ONLY guard here:
    expect(probes[5], 'template form carries currentTime but no dot-notation token').toBe('export const readTemplate = (el: HTMLMediaElement): number => el[`currentTime`]')
    expect(/\.currentTime\b/u.test(probes[5] ?? ''), 'the frozen text scan cannot see it').toBe(false)

    const dir = join(REPO_ROOT, 'src', 'ui', '__adv_fixture_clock__')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'probe.ts')
    writeFileSync(file, `${probes.join('\n')}\n`)
    try {
      const run = spawnSync('corepack', ['pnpm', 'exec', 'eslint', '--no-ignore', '--format=json', file], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000 })
      const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
      const parsed = JSON.parse(output.slice(output.indexOf('['))) as { messages?: { ruleId?: string; line?: number }[] }[]
      const flagged = new Set(parsed.flatMap((entry) => (entry.messages ?? []).filter((m) => m.ruleId === '2:zipscribe/no-media-current-time').map((m) => m.line ?? -1)))
      for (let i = 0; i < probes.length; i++) {
        expect(flagged.has(i + 1), `the CC-102.5 lint rule must flag the ${probes[i] ?? ''} form outside playback/**`).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('ADVERSE CS.11: FR-102.3 / SECURITY — the editor bridge installs twice idempotently and every receiver stays functional through the second install', async () => {
    const BRIDGE_MODULE = ['@ui', 'testing', 'editor-bridge'].join('/')
    const mod = (await import(BRIDGE_MODULE)) as { installEditorBridge(): void }
    mod.installEditorBridge()
    const first = w().__zipEditorBridge
    mod.installEditorBridge()
    const second = w().__zipEditorBridge
    expect(first, 'first install exposes the bridge').toBeDefined()
    expect(second, 'the second install leaves exactly one live bridge').toBeDefined()
    expect(second, 'the global points at the newest install').toBe(w().__zipEditorBridge)
    if (typeof second !== 'object' || second === null) throw new Error('bridge missing')
    const bridge = second as {
      openProjectWithMedia(asset: never, srcUrl: string, blocks?: never[]): void
      command(id: string, payload?: unknown): { code: string } | null
      getEditorState(): { playhead: number; seekCount: number }
      scrubTo(t: number): void
      releaseScrub(): void
    }
    bridge.openProjectWithMedia(SAMPLE_ASSET as never, 'blob:fixture-adversary', [block('adv_bridge', 1, 2, 'SPK_1', [word('hi', 1, 2)])] as never)
    expect(bridge.command('transport-seek', { time: 3 }), 'commands dispatch into the real command system').toBeNull()
    expect(bridge.getEditorState().playhead).toBe(3)
    bridge.scrubTo(10)
    bridge.releaseScrub()
    expect(bridge.getEditorState().playhead, 'scrub session works through the re-installed bridge').toBe(10)
    expect(bridge.getEditorState().seekCount, 'one seek for the command + one for the scrub; the release adds none').toBe(2)
    expect(() => bridge.command('definitely-not-a-command', {}), 'unknown ids throw per the frozen dispatch contract').toThrow(/UNKNOWN_COMMAND/u)
  })

  test('ADVERSE CS.12: FR-102.3 / SECURITY — the ziptest query gate survives prototype pollution and location.search spoof attempts (jsdom-permitted ones)', () => {
    const source = readFileSync(join(REPO_ROOT, 'src', 'App.tsx'), 'utf8')
    const gate = source.match(/new URLSearchParams\(window\.location\.search\)\.get\('ziptest'\) === '1'/u)?.[0]
    expect(gate, 'the gate is URLSearchParams.get — property access would be pollution-unsafe').toBeDefined()
    if (gate === undefined) throw new Error('gate expression missing')

    Object.defineProperty(Object.prototype, 'ziptest', { value: '1', configurable: true })
    try {
      history.replaceState(null, '', '/')
      expect(new Function(`return (${gate})`)(), 'prototype-polluted `ziptest` must not open the gate').toBe(false)
      history.replaceState(null, '', '/?ziptest=1')
      expect(new Function(`return (${gate})`)(), 'a REAL query still opens the gate').toBe(true)
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>)['ziptest']
      history.replaceState(null, '', '/')
    }
    expect(() => Object.defineProperty(window.location, 'search', { value: '?ziptest=1', configurable: true }), 'jsdom keeps location.search unforgeable').toThrow()
  })
})
