// CC-112.1 (L1, jsdom env): the composition root installs a REAL caption
// importer. Until unit-112, `createAppContext` wires the unit-07 PLACEHOLDER
// (`createPendingUnit07ImportService`, sniff → always null) into the intake
// service (src/app/context.ts), so the production click path rejects every
// caption with `UNSUPPORTED_CAPTION` (#53). The observable seam is the frozen
// `IntakeService.handleFiles` (conventions § behaviour through public seams —
// the importer instance itself is not exported): a real `.srt` File through
// the built context must CLASSIFY (sniff → srt) and IMPORT (12 blocks), with
// zero rejections. Today the placeholder sniff denies it → the outcome carries
// `UNSUPPORTED_CAPTION` and no import — the honest RED unit-112 closes.
//
// The placeholder export parity leg (`createPendingUnit07ImportService` stays
// exported with a null sniff) is a GREEN guard for FR-112.1's test-hook
// parity clause.
//
// Environment: jsdom — the composition root legitimately uses browser globals
// (requestAnimationFrame via createBrowserRafDriver, localStorage via
// createLocalStorageSettings); jsdom supplies exactly those, nothing more.
// The context module loads through a VARIABLE dynamic import (the established
// tests-tree doctrine for graphs the node-config tsc program must not pull:
// `src/app/context` statically reaches the `?worker` module specifiers typed
// by vite/client, not by tsconfig.node.json).
//
// SECURITY-03: captions/format codes and counts only — no caption text in any
// assertion message.
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createPendingUnit07ImportService } from '../../../src/app/ports'
import type { IntakeOutcome } from '@state/services/intake'
import { REPO_ROOT } from '../../helpers/repo'

const CONTEXT_MODULE = '../../../src/app/context'

interface CompositionContext {
  intake: { handleFiles(files: readonly File[]): Promise<IntakeOutcome> }
}

interface ContextModule {
  createAppContext(options?: { ziptest?: boolean }): Promise<CompositionContext>
}

const SRT_PATH = join(REPO_ROOT, 'fixtures', 'captions', 'en-clean-ref.srt')

function srtFile(): File {
  const bytes = new Uint8Array(readFileSync(SRT_PATH))
  return new File([bytes], 'en-clean-ref.srt', { type: 'application/x-subrip' })
}

const contextPromise: Promise<CompositionContext> = (async () => {
  const mod = (await import(/* @vite-ignore */ CONTEXT_MODULE)) as unknown as ContextModule
  return mod.createAppContext({})
})()

describe('CC-112.1: the composition root installs a real caption importer (FR-112.1)', () => {
  test('CC-112.1: handleFiles of the real en-clean-ref.srt bytes through createAppContext classifies srt and imports 12 blocks — not the null-sniff placeholder rejection', async () => {
    const ctx = await contextPromise
    const outcome = await ctx.intake.handleFiles([srtFile()])
    expect(outcome.rejected, 'the real importer must not reject a real caption file (no UNSUPPORTED_CAPTION path)').toEqual([])
    expect(outcome.importedCaptions, 'the caption imports through the composition-root importer').toHaveLength(1)
    const imported = outcome.importedCaptions[0]
    expect(imported?.report.format, 'content+extension sniff returns the format, not null').toBe('srt')
    expect(imported?.report.cues, 'the frozen 12-cue fixture count').toBe(12)
    expect(imported?.report.blocks, '12 mapped blocks').toBe(12)
    expect(imported?.blocks.length, 'the payload blocks ride along').toBe(12)
    expect(outcome.mediaPosted, 'a captions-only selection posts no media probe').toBe(0)
  })

  test('CC-112.1: createPendingUnit07ImportService stays exported as the null-sniff placeholder (test-hook parity, FR-112.1)', async () => {
    const placeholder = createPendingUnit07ImportService()
    expect(await placeholder.sniff(srtFile()), 'the placeholder denies everything (its contract — never silent: intake turns null into a CODED rejection)').toBeNull()
    await expect(placeholder.importCaptions(srtFile())).rejects.toBeInstanceOf(Error)
  })
})
