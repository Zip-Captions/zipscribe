// Intent 1 (Local Transcribe Engine) — whole-engine L5 legs that no single unit
// suite owns (intent-1 closure suite, doctrine: e2e/intent/caption-studio-ui.spec.ts;
// per-ID describes with leading citations per [107-ADJ 25]).
//
// CC-I1.5 — with `navigator.gpu` absent the PRODUCTION capability path
// (probeDeviceCapability, src/app/ports.ts) must self-select T2 (wasm) with zero
// user configuration, and a `tiny` transcription must still complete e2e through
// the real media worker + asr.worker + blockize chain.
// CC-I1.9 — `speech-2min.m4a` transcribes to the same blocks as
// `speech-2min.mp4` (word tokens identical in order/text, every start/end within
// ± 50 ms) — the container-agnosticism proof on top of the unit-04 matrix.
//
// Model weights come ONLY from the local cache via the route in helpers/asr.ts
// (SECURITY-03/ops doctrine): a non-allowlisted request fails the run.
import { expect, test } from '@playwright/test'
import { assertModelCachePresent, routeAsrNetwork, startHarnessServer, stopHarnessServer, type HarnessServer, type NetworkCounters } from '../asr/helpers/asr'

const PORT = 4317 // distinct from every e2e harness port (4311–4315, incl. the 4314 memory-project recycle spec)
/** CC-I1.9 word/block timing tolerance, in seconds (intent.md: ± 50 ms). */
const WORD_TOLERANCE_SEC = 0.05

let server: HarnessServer | undefined

interface RunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  cancelled: boolean
  downgraded: boolean
  segmentCount: number
  wordCount: number
  blocks: { start: number; end: number; text: string }[]
  words: { start: number; end: number; text: string }[]
  hypothesis: string
  selectedTier?: 'T1' | 'T2' | 'T3'
  selectedDevice?: 'wasm' | 'webgpu'
  eventSummary: { t: string; code?: string; notice?: string }[]
  runWallMs: number
}

test.beforeAll(async () => {
  if (process.env.ZIPSCRIBE_CHILD === '1') return // gates-scaffold child: both describes skip; no server to boot
  assertModelCachePresent()
  server = await startHarnessServer(PORT, { isolated: false, probePath: '/e2e/asr/fixtures/harness.html' })
})
test.afterAll(async () => {
  if (server) await stopHarnessServer(server.child)
})

async function runHarness(page: import('@playwright/test').Page, options: Record<string, unknown>, counters: NetworkCounters): Promise<RunSummary> {
  await routeAsrNetwork(page, `http://127.0.0.1:${PORT}`, counters)
  await page.goto('/e2e/asr/fixtures/harness.html')
  await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeAsrHarnessReady === true, { timeout: 30_000 })
  return page.evaluate((opts) => (globalThis as unknown as { __zipscribeAsrHarness: { runTranscription(o: Record<string, unknown>): Promise<RunSummary> } }).__zipscribeAsrHarness.runTranscription(opts), options)
}

test.describe('CC-I1.5: WebGPU-less auto-selection completes a tiny transcription e2e with no user configuration', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: `http://127.0.0.1:${PORT}` })
  test.setTimeout(15 * 60_000)

  test('CC-I1.5: with navigator.gpu removed, the production capability probe self-selects T2 (wasm) and the tiny run completes', async ({ page }) => {
    // Zero user configuration: only the environment lies (the probe itself,
    // the worker host and the real asr.worker run untouched).
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true })
    })
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    const summary = await runHarness(page, { fixture: 'fixtures/speech-2min.mp4', modelId: 'whisper-tiny-timestamped', language: 'en', autoTier: true }, counters)

    expect(summary.error, `auto-tier run failed: ${JSON.stringify(summary.error)} (events: ${JSON.stringify(summary.eventSummary)})`).toBeUndefined()
    expect(summary.selectedTier, 'the production probe self-selected the T2 tier').toBe('T2')
    expect(summary.selectedDevice, 'the production probe self-selected the wasm device').toBe('wasm')
    expect(summary.cancelled).toBe(false)
    expect(summary.downgraded, 'a clean T2 run needs no downgrade').toBe(false)
    expect(summary.segmentCount, 'the run produced segments').toBeGreaterThan(0)
    expect(summary.wordCount, 'segments carry word tokens').toBeGreaterThan(0)
    expect(summary.blocks.length, 'blockize produced blocks').toBeGreaterThan(0)
    expect(counters.blocked, `non-allowlisted origins requested: ${[...new Set(counters.blocked)].join(', ')}`).toEqual([])
    expect(counters.modelHost, 'model weights came from the local cache').toBeGreaterThan(0)
  })
})

test.describe('CC-I1.9: m4a and mp4 twins transcribe to the same blocks (± 50 ms per word)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: `http://127.0.0.1:${PORT}` })
  test.setTimeout(25 * 60_000)

  test('CC-I1.9: speech-2min.m4a yields the same blocks and word tokens as speech-2min.mp4 within ± 50 ms', async ({ page, browser }) => {
    const base = { modelId: 'whisper-tiny-timestamped', language: 'en', tier: 'T2', device: 'wasm' } as const
    const mp4Counters: NetworkCounters = { modelHost: 0, blocked: [] }
    const mp4 = await runHarness(page, { ...base, fixture: 'fixtures/speech-2min.mp4' }, mp4Counters)
    expect(mp4.error, `mp4 run failed: ${JSON.stringify(mp4.error)}`).toBeUndefined()
    expect(mp4.wordCount, 'mp4 run produced words').toBeGreaterThan(0)

    // Fresh context: no decoder/session state may leak between the two runs.
    const m4aPage = await (await browser.newContext()).newPage()
    const m4aCounters: NetworkCounters = { modelHost: 0, blocked: [] }
    const m4a = await runHarness(m4aPage, { ...base, fixture: 'fixtures/audio/speech-2min.m4a' }, m4aCounters)
    expect(m4a.error, `m4a run failed: ${JSON.stringify(m4a.error)}`).toBeUndefined()

    expect(m4a.words.length, `word count parity with mp4 (${mp4.words.length})`).toBe(mp4.words.length)
    for (let i = 0; i < mp4.words.length; i++) {
      const a = mp4.words[i]!
      const b = m4a.words[i]!
      expect(b.text, `word ${i} text differs`).toBe(a.text)
      expect(Math.abs(b.start - a.start), `word ${i} ("${a.text}") start drifts > 50 ms`).toBeLessThanOrEqual(WORD_TOLERANCE_SEC)
      expect(Math.abs(b.end - a.end), `word ${i} ("${a.text}") end drifts > 50 ms`).toBeLessThanOrEqual(WORD_TOLERANCE_SEC)
    }
    expect(m4a.blocks.length, `block count parity with mp4 (${mp4.blocks.length})`).toBe(mp4.blocks.length)
    for (let i = 0; i < mp4.blocks.length; i++) {
      const a = mp4.blocks[i]!
      const b = m4a.blocks[i]!
      expect(b.text, `block ${i} text differs`).toBe(a.text)
      expect(Math.abs(b.start - a.start), `block ${i} start drifts > 50 ms`).toBeLessThanOrEqual(WORD_TOLERANCE_SEC)
      expect(Math.abs(b.end - a.end), `block ${i} end drifts > 50 ms`).toBeLessThanOrEqual(WORD_TOLERANCE_SEC)
    }
    expect(m4aCounters.blocked, `non-allowlisted origins requested: ${[...new Set(m4aCounters.blocked)].join(', ')}`).toEqual([])
  })
})
