// Caption-import port (FR-104.9 / unit-104 slice D — "Bring-your-own captions"
// drop-onto-an-open-project dialog, knowledge/design.md). The UI never imports
// `engine/captions` directly (intake.ts doctrine): the heavy parse pipeline
// (import.ts + the six format parsers + decode-text) is DYNAMICALLY imported
// inside `analyze`, so it lands in a lazy chunk and stays out of the initial
// JS graph (check-bundle). The composition root injects this port through the
// Workbench transport (unit-102 `WorkbenchTransport` additive-EXTENDS
// precedent); jsdom suites mount without it and the drop keeps flowing down
// the untouched unit-101 intake path.
//
// Block-id normalization: the imported blocks are re-identified `blk-<n>` by
// start order — the SAME canonical identity rule the unit-07 golden mode
// applies before comparing against `fixtures/golden/captions/*.expected.json`
// (tests/unit/captions/canonical.ts). The ids are opaque internals (model.ts
// pins `crypto.randomUUID()` only as the engine's minting default); a stable,
// start-ordered id makes the replace-import deterministic for every downstream
// reader (rows, bridge, history) without touching any frozen behavior.
//
// SECURITY-03: failures are `CaptionFailureError` CODES/numbers (FR-07.6 — the
// engine never throws content); nothing here logs, and the report is pure
// numbers/format/encoding/codes.

import type { CaptionBlock, Project, Speaker } from '../../engine/model'
import type { ImportReport } from '../../engine/captions/import'

export interface CaptionFileInputLike {
  name: string
  bytes: Uint8Array
}

export interface CaptionAnalyzeOptions {
  /** FR-07.5 speaker-prefix policy for source imports (dialog toggle). */
  speakerPrefixes: 'auto' | 'on' | 'off'
  /** FR-07.1 re-decode override (dialog encoding override); omit for the sniff chain. */
  encoding?: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
}

export interface CaptionAnalyzeOutcome {
  report: ImportReport
  /** Report-order blocks, canonically re-identified `blk-<n>` (see header). */
  blocks: CaptionBlock[]
  /** Speakers the import minted (payload for `captions-import`). */
  speakers: readonly Speaker[]
}

export interface CaptionImportPort {
  /**
   * Parse + map WITHOUT touching the project (the report renders BEFORE the
   * user confirms — FR-104.9). Rejects with a `CaptionFailure`-shaped error
   * (codes/numbers only, FR-07.6/SECURITY-03).
   */
  analyze(project: Project, file: CaptionFileInputLike, options: CaptionAnalyzeOptions): Promise<CaptionAnalyzeOutcome>
}

/** Production port: the merged engine-07 importer behind a dynamic import. */
export function createEngineCaptionImportPort(): CaptionImportPort {
  return {
    async analyze(project, file, options): Promise<CaptionAnalyzeOutcome> {
      const { importCaptions } = await import('../../engine/captions/import')
      const outcome = await importCaptions(
        project,
        { name: file.name, bytes: file.bytes },
        { as: 'source', speakerPrefixes: options.speakerPrefixes, ...(options.encoding === undefined ? {} : { encoding: options.encoding }) },
      )
      const blocks = outcome.project.blocks.map((block, index) => ({ ...block, id: `blk-${index + 1}` }))
      return { report: outcome.report, blocks, speakers: outcome.project.speakers }
    },
  }
}
