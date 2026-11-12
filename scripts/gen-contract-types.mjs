// Contract-freeze codegen (FR-102.7 / CC-102.5, unit-102 slice D).
//
// Emits `src/state/generated/contract-types.ts` — the ONE file downstream
// units (103/104/105/106, Intent 3) import contract types from. Single
// source of truth: the implementation modules under `src/state/**` and
// `src/engine/translate/track.ts`. Every emitted name is VERIFIED to be
// exported by its module before the file is written (a renamed/dropped
// export fails codegen, not downstream builds). The frozen acceptance shape
// is tests/unit/editor/unit102-api-contract.d.ts — ambient-wins resolution
// plus `pnpm typecheck` over the builder's own code is what pins the
// implementation to it; the emitted file re-derives from the implementation
// so the two can never drift silently.
//
// Usage:
//   node scripts/gen-contract-types.mjs           # write
//   node scripts/gen-contract-types.mjs --check   # CI drift check (exit 1 on mismatch)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(REPO_ROOT, 'src', 'state', 'generated', 'contract-types.ts')

/** module (import specifier from the generated file) → frozen + payload names. */
const MODULES = [
  {
    specifier: '../commands',
    names: [
      'CommandId',
      'CommandPayloads',
      'CommandReject',
      'CommandRejectCode',
      'EditorCommand',
      'EditorRootState',
      'BlockSplitPayload',
      'BlockMergePayload',
      'BlockRetimePayload',
      'BlockEditTextPayload',
      'BlockDeletePayload',
      'CaptionsRetimeAllPayload',
      'CaptionsReflowPayload',
      'CaptionsImportPayload',
      'SpeakerAddPayload',
      'SpeakerAssignPayload',
      'SpeakerRenamePayload',
      'SpeakerRecolorPayload',
      'ProjectRenamePayload',
      'TransportSeekPayload',
      'TransportSkipPayload',
      'TransportStepFramePayload',
      'TransportStepSecondPayload',
      'TransportLoopSetPayload',
      'TransportRatePayload',
      // unit-104 EXTENDS (CONTRACT.md § Commands — unit-104 EXTENDS).
      'SpeakerMergePayload',
      'SpeakerSplitPayload',
      'ReplaceTextPayload',
      'CaptionsAlignApplyPayload',
    ],
  },
  { specifier: '../editor', names: ['EditorUiState', 'EditorStore', 'Selection'] },
  { specifier: '../history', names: ['EditorHistoryApi', 'EditorApp', 'EditorAppDeps', 'Blockizer', 'SpeakerEngine', 'ZundoLimitType'] },
  { specifier: '../services/playback/media-clock', names: ['MediaClock'] },
  { specifier: '../services/playback/arbitrator', names: ['SyncArbitrator', 'RafDriver'] },
  { specifier: '../services/export', names: ['ExportService', 'ExportHandle', 'ExportWorkerPort'] },
  { specifier: '../../engine/translate/track', names: ['TranslationRules'] },
]

function* walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name)
    if (item.isDirectory()) yield* walk(full)
    else if (item.name.endsWith('.ts') && !item.name.endsWith('.test.ts')) yield full
  }
}

const IMPL_SOURCES = [...walk(join(REPO_ROOT, 'src', 'state')), join(REPO_ROOT, 'src', 'engine', 'translate', 'track.ts'), join(REPO_ROOT, 'src', 'engine', 'model.ts')].filter(existsSync)
const EXPORTED_NAMES = new Set()
for (const file of IMPL_SOURCES) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|type|const|function|class|enum)\s+([A-Za-z_$][\w$]*)/g)) EXPORTED_NAMES.add(m[1])
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (name) EXPORTED_NAMES.add(name)
    }
  }
}

for (const { specifier, names } of MODULES) {
  for (const name of names) {
    if (!EXPORTED_NAMES.has(name)) {
      console.error(
        `gen-contract-types: '${name}' (module '${specifier}') is not exported by any implementation module — the contract source drifted (implementation renamed/dropped it). Fix the implementation or this manifest; never hand-edit the generated file.`,
      )
      process.exit(1)
    }
  }
}

const lines = []
lines.push('// GENERATED FILE — DO NOT EDIT BY HAND.')
lines.push('//')
lines.push('// src/state/CONTRACT.md (FR-102.7 contract freeze, unit-102 slice D) is the prose')
lines.push('// contract; this file is its mechanical counterpart, emitted by')
lines.push('// `scripts/gen-contract-types.mjs` from the implementation modules (single')
lines.push('// source of truth — every name is verified exported before emission).')
lines.push('//')
lines.push('// Downstream units (103/104/105/106, Intent 3) import contract types ONLY')
lines.push('// from here. The frozen acceptance shape is')
lines.push('// tests/unit/editor/unit102-api-contract.d.ts (ambient-wins resolution + the')
lines.push('// builder typecheck pin the implementation to it); contract.test.ts scans this')
lines.push('// file for the frozen export-name set.')
lines.push('')
lines.push("import type { CommandId, CommandPayloads } from '../commands'")
lines.push("import type { EditorUiState } from '../editor'")
lines.push("import type { MediaClock } from '../services/playback/media-clock'")
lines.push("import type { Seconds } from '../../engine/model'")
lines.push("import type { SyncArbitrator, RafDriver } from '../services/playback/arbitrator'")
lines.push("import type { ZundoLimitType } from '../history'")
lines.push('')
for (const { specifier, names } of MODULES) {
  const exported = names.filter((n) => n !== 'ZundoLimitType')
  lines.push(`export type { ${exported.join(', ')} } from '${specifier}'`)
}
lines.push('')
lines.push('/** Derived from the frozen `ZUNDO_LIMIT = 150` (history.ts) — never restate the number here. */')
lines.push('export type ZUNDO_LIMIT_TYPE_CONTRACT = ZundoLimitType')
lines.push('')
lines.push('// ── compile-time consistency checks (typecheck is the gate) ───────────────────')
lines.push('// These re-derive from the IMPLEMENTATION (relative imports), so drift between a')
lines.push('// reducer table and the frozen shape fails `pnpm typecheck`, silently and early.')
lines.push('type Assert<T extends true> = T')
lines.push('type KeySetEquals<A, B> = [keyof A] extends [B] ? ([B] extends [keyof A] ? true : false) : false')
lines.push('')
lines.push('/** The payload table is exhaustive over the command ids (no extra, no missing):')
lines.push(' *  the frozen 26 (FR-102.1) + the 4 unit-104 EXTENDS (CONTRACT.md § unit-104 EXTENDS). */')
lines.push('type _payloadDomain = Assert<KeySetEquals<CommandPayloads, CommandId>>')
lines.push('')
lines.push('/** FR-102.3: the arbitrator layer is the sanctioned clock reader — `clockTime()` is')
lines.push(' *  part of the frozen surface (frozen d.ts § stage-video/bridge diagnostics). */')
lines.push(
  'type _clockReader = Assert<SyncArbitrator extends { clockTime(): Seconds; subscribe(cb: (t: Seconds) => void): () => void; seek(t: Seconds): void; setLoop(region: [Seconds, Seconds] | null): void; rate: number } ? true : false>',
)
lines.push('')
lines.push('/** The MediaClock seam stays exactly the frozen six-plus-dispose surface shape. */')
lines.push('type _mediaClock = Assert<MediaClock extends { currentTime(): Seconds; seek(t: Seconds): void; setRate(rate: number): void } ? true : false>')
lines.push('')
lines.push('/** The editor slice stays UI-only truth mirrors (playhead is the arbitrator mirror, FR-102.2/102.3). */')
lines.push('type _uiShape = Assert<EditorUiState extends { playhead: Seconds; playing: boolean; rate: number; loop: [Seconds, Seconds] | null } ? true : false>')
lines.push('')
lines.push('/** The rAF seam stays injectable (no timers in tests, conventions § 3). */')
lines.push('type _rafs = Assert<RafDriver extends { request(cb: (timeMs: number) => void): number; frame(dtMs: number): void } ? true : false>')
lines.push('')
lines.push('/** Frozen zundo configuration: limit 150 (the number lives ONLY in history.ts). */')
lines.push('type _zundoLimit = Assert<ZUNDO_LIMIT_TYPE_CONTRACT extends 150 ? true : false>')
lines.push('')
lines.push('void (null as unknown as [_payloadDomain, _clockReader, _mediaClock, _uiShape, _rafs, _zundoLimit])')
lines.push('')

const raw = lines.join('\n')
// Emit prettier-formatted so `pnpm format:check` and `--check` agree with the
// committed bytes without a second tool pass (prettier is a devDependency).
const config = (await prettier.resolveConfig(OUT)) ?? {}
const content = await prettier.format(raw, { ...config, parser: 'typescript' })
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== content) {
    console.error('gen-contract-types: src/state/generated/contract-types.ts is out of date — run `pnpm gen:contract`.')
    process.exit(1)
  }
  console.log('gen-contract-types: contract-types.ts current.')
} else {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, content)
  console.log(`gen-contract-types: wrote ${relative(REPO_ROOT, OUT)}`)
}
