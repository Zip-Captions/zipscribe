// CC-102.5 (L1): the contract-freeze deliverables exist and MATCH this frozen
// contract:
//   * `src/state/CONTRACT.md` committed (FR-102.7 — builder-authored: store
//     shape + all command payload types + SyncArbitrator interface +
//     exportService seam signatures);
//   * the generated types file `src/state/generated/contract-types.ts`
//     committed, exporting the frozen name set (unit-103/104/105/106 and
//     Intent 3 import types ONLY from it);
//   * type-level asserts: the ambient frozen contract (`@state/generated/
//     contract-types`) and the contract modules are bidirectionally
//     assignable (ambient-wins resolution is what the builder compiles
//     against — unit-101 mechanism; the export-name scan below catches a
//     generated file that drops or renames anything);
//   * `video.currentTime` is read ONLY under `src/state/services/playback/**`
//     (the lint half of CC-102.5 is the builder's eslint rule — this scan is
//     the test-side guard, engine-purity precedent).
import { describe, expect, test } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { REPO_ROOT } from '../../helpers/repo'
import type { EditorCommand, CommandId, CommandReject, CommandRejectCode, EditorRootState } from '@state/commands'
import type { EditorUiState, EditorStore } from '@state/editor'
import type { EditorApp, EditorHistoryApi } from '@state/history'
import type { MediaClock } from '@state/services/playback/media-clock'
import type { RafDriver, SyncArbitrator } from '@state/services/playback/arbitrator'
import type { ExportHandle, ExportService, ExportWorkerPort } from '@state/services/export'
import type { TranslationRules } from '@engine/translate/track@102'
import type * as Generated from '@state/generated/contract-types'

// ── type-level asserts (compile-time; no runtime) ───────────────────────────
type Assert<T extends true> = T
type Extends<A, B> = A extends B ? true : false
type Both<A, B> = Extends<A, B> extends true ? (Extends<B, A> extends true ? true : false) : false

// Generated ↔ frozen (the generated file is what downstream units import).
type _cmd = Assert<Both<Generated.EditorCommand, EditorCommand>>
type _id = Assert<Both<Generated.CommandId, CommandId>>
type _reject = Assert<Both<Generated.CommandReject, CommandReject>>
type _rejectCode = Assert<Both<Generated.CommandRejectCode, CommandRejectCode>>
type _root = Assert<Both<Generated.EditorRootState, EditorRootState>>
type _ui = Assert<Both<Generated.EditorUiState, EditorUiState>>
type _store = Assert<Extends<EditorStore, Generated.EditorStore>>
type _hist = Assert<Extends<EditorHistoryApi, Generated.EditorHistoryApi>>
type _app = Assert<Extends<EditorApp, Generated.EditorApp>>
type _clock = Assert<Both<Generated.MediaClock, MediaClock>>
type _arbitrator = Assert<Both<Generated.SyncArbitrator, SyncArbitrator>>
type _rafs = Assert<Both<Generated.RafDriver, RafDriver>>
type _export = Assert<Both<Generated.ExportService, ExportService>>
type _handle = Assert<Both<Generated.ExportHandle, ExportHandle>>
type _port = Assert<Both<Generated.ExportWorkerPort, ExportWorkerPort>>
type _rules = Assert<Both<Generated.TranslationRules, TranslationRules>>
type _limit = Assert<Generated.ZUNDO_LIMIT_TYPE_CONTRACT extends 150 ? true : false>
void (null as unknown as [_cmd, _id, _reject, _rejectCode, _root, _ui, _store, _hist, _app, _clock, _arbitrator, _rafs, _export, _handle, _port, _rules, _limit])

const CONTRACT_MD = join(REPO_ROOT, 'src', 'state', 'CONTRACT.md')
const GENERATED = join(REPO_ROOT, 'src', 'state', 'generated', 'contract-types.ts')

const GENERATED_EXPORT_NAMES = [
  'CommandId',
  'CommandPayloads',
  'CommandReject',
  'CommandRejectCode',
  'EditorCommand',
  'EditorRootState',
  'EditorUiState',
  'EditorStore',
  'Selection',
  'EditorHistoryApi',
  'EditorApp',
  'EditorAppDeps',
  'MediaClock',
  'SyncArbitrator',
  'RafDriver',
  'ExportService',
  'ExportHandle',
  'ExportWorkerPort',
  'TranslationRules',
  'SpeakerEngine',
] as const

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function tsSources(dir: string, out: string[] = []): string[] {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name)
    if (item.isDirectory()) tsSources(full, out)
    else if (item.name.endsWith('.ts') || item.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('CC-102.5 / FR-102.7: committed contract artifacts', () => {
  test('CC-102.5: src/state/CONTRACT.md is committed and covers every frozen surface (FR-102.7)', () => {
    expect(existsSync(CONTRACT_MD), 'CONTRACT.md must be committed with the unit (contract freeze)').toBe(true)
    const md = stripComments(readFileSync(CONTRACT_MD, 'utf8'))
    for (const heading of ['store', 'command', 'syncarbitrator', 'exportservice', 'payload']) {
      expect(md.toLowerCase(), `CONTRACT.md must document the ${heading} surface`).toContain(heading)
    }
    for (const id of ['block-split', 'block-merge', 'block-retime', 'block-edit-text', 'block-delete', 'block-delete-close-gap', 'captions-retime-all', 'captions-reflow', 'captions-import', 'speaker-']) {
      expect(md, `CONTRACT.md must name the ${id} command`).toContain(id)
    }
    expect(md, 'the frozen zundo configuration is part of the contract').toContain('150')
  })

  test('CC-102.5: the generated types file is committed and exports the frozen name set', () => {
    expect(existsSync(GENERATED), 'src/state/generated/contract-types.ts must be committed (generated from the same source as CONTRACT.md)').toBe(true)
    const source = stripComments(readFileSync(GENERATED, 'utf8'))
    for (const name of GENERATED_EXPORT_NAMES) {
      const exported = new RegExp(`export\\s+(?:type\\s+)?(?:\\{[^}]*\\b${name}\\b|interface\\s+${name}\\b|type\\s+${name}\\b|declare\\s+type\\s+${name}\\b)`).test(source)
      expect(exported, `generated contract types must export ${name}`).toBe(true)
    }
  })
})

describe('CC-102.5: single clock reader (lint-side guard)', () => {
  test('CC-102.5: no `.currentTime` read outside src/state/services/playback/** (components never read media element time)', () => {
    const offenders: string[] = []
    for (const file of tsSources(join(REPO_ROOT, 'src'))) {
      const rel = relative(REPO_ROOT, file)
      if (rel.startsWith(join('src', 'state', 'services', 'playback'))) continue
      if (file.includes(join('services', 'playback'))) continue
      const text = stripComments(readFileSync(file, 'utf8'))
      if (/\.currentTime\b/.test(text)) offenders.push(rel)
    }
    expect(offenders, 'only the SyncArbitrator/media-clock layer may read currentTime (FR-102.3)').toEqual([])
  })

  test('CC-102.5: the playback layer exists and is the only currentTime owner', () => {
    const playbackDir = join(REPO_ROOT, 'src', 'state', 'services', 'playback')
    expect(existsSync(playbackDir), 'the MediaClock abstraction lives in state/services/playback').toBe(true)
    const owners = tsSources(playbackDir).filter((f) => /\.currentTime\b/.test(stripComments(readFileSync(f, 'utf8'))))
    expect(owners.length, 'the element clock reads the element — at least one file under playback/**').toBeGreaterThan(0)
  })
})
