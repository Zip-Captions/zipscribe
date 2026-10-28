// Shared readers for the unit-02 spike artifacts, used by the `qualify/**`
// suites (L6 — run by `pnpm qualify` on reference hardware, never in the
// per-PR suite; see vitest.config.qualify.ts).
//
// ARTIFACT CONTRACT (defines what the FR-02.1 harness must emit; authored from
// the unit spec alone, before any implementation exists):
//
//   docs/spikes/model-eval-report.md    — human report (FR-02.6: measured
//       table, tier→(engine,model) recommendation, license results, rejection
//       reasons). Existence + engine mentions asserted against the text.
//   docs/spikes/model-eval-report.json  — machine-readable mirror so every
//       qualify assertion is data-driven over measured artifacts:
//   {
//     rows: [ { engine, engineId: 'A'|'B'|'C', version, model, revision,
//               device: 'webgpu'|'wasm', tier: 'T1'|'T2'|'T3', corpusClip,
//               wer, wordTimingMAEms, rtf, peakJsHeapBytes,
//               gpuMemGrowthPerWindowBytes, punctuated, confidence,
//               languageDetect, timestamps: 'word-native'|'word-dtw'|'segment',
//               license, verified: true,
//               vendorWer?, degradedVsVendor? } ],        // US-02.1 / FR-02.4 / FR-02.8
//     leak: [ { version, model, device, windowSeconds: 28, windowCount: 20,
//               gpuMemBytesAfterWindow: number[], perWindowGrowthBytes,
//               disposeReclaims, recycleCeilingBytes } ],  // US-02.3 (CC-02.2)
//     leakPinRecommendation: string,                       // pin decision (CC-02.2)
//     networkAudit: [ { engineId, pass, artifact } ],      // US-02.2 (CC-02.4/02.9);
//         // `artifact` = repo-relative path to a JSON request log:
//         // { engineId, pass, requests: [{ url }] } — FR-02.1 hygiene +
//         // SECURITY-03: no string value anywhere in it may contain
//         // whitespace (URLs/ids/timestamps only, never transcript text).
//     baselineCheck: { whisperBaseT1Rtf, baseline, outcome: 'confirmed'|'corrected', statement },
//     parakeetVerdict: { loads, rtf?, blockerIssue?, note? },  // CC-02.8
//     recommendation: { T1: { engine, model }, T2: {...}, T3: {...} },  // CC-02.11
//     licenses: [ { candidate, status: 'verified-ok'|'blocked-pending', note? } ],  // CC-02.10
//   }
//
// `engine` values are the controlled vocabulary ENGINE_VOCAB below;
// `engineId` is the Candidates-table letter (A/B/C) from the unit spec.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'

export const REPORT_MD = 'docs/spikes/model-eval-report.md'
export const REPORT_JSON = 'docs/spikes/model-eval-report.json'

export const ENGINE_VOCAB: Record<'A' | 'B' | 'C', string> = {
  A: 'transformers.js',
  B: 'sherpa-onnx',
  C: 'cactus-needle',
}
export const ENGINE_IDS = ['A', 'B', 'C'] as const
export const TIMESTAMP_MODES = ['word-native', 'word-dtw', 'segment'] as const
export const DEVICES = ['webgpu', 'wasm'] as const
export const TIERS = ['T1', 'T2', 'T3'] as const
export const LICENSE_STATUSES = ['verified-ok', 'blocked-pending'] as const

export function parseJsonAt(repoPath: string): unknown | null {
  const absolute = join(REPO_ROOT, repoPath)
  if (!existsSync(absolute)) return null
  try {
    return JSON.parse(readFileSync(absolute, 'utf8')) as unknown
  } catch {
    return null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function rowsOf(report: unknown): unknown[] {
  return isRecord(report) && Array.isArray(report.rows) ? report.rows : []
}

/** Adopted engineIds = the engines named in the CC-02.11 default recommendation. */
export function adoptedEngineIds(report: unknown): string[] {
  const rec = isRecord(report) && isRecord(report.recommendation) ? report.recommendation : {}
  const ids = new Set<string>()
  for (const tier of TIERS) {
    const entry = rec[tier]
    if (!isRecord(entry)) continue
    for (const id of ENGINE_IDS) {
      if (entry.engine === ENGINE_VOCAB[id]) ids.add(id)
    }
  }
  return [...ids]
}

/** `settings.yml operations.model_hosts` (the runtime request allowlist). */
export function readModelHosts(): string[] {
  const text = readFileSync(join(REPO_ROOT, '.ai-dlc/settings.yml'), 'utf8')
  const after = text.split('model_hosts:')[1] ?? ''
  const hosts: string[] = []
  for (const line of after.split(/\r?\n/)) {
    const url = line.match(/^\s*-\s*(https:\/\/[^\s#]+)/)
    if (url?.[1]) hosts.push(url[1])
    else if (line.trim() !== '' && !/^\s/.test(line) && hosts.length > 0) break
  }
  return hosts
}

/** True when the URL's host is the local preview origin (`self`) or an entry
 *  of the model_hosts allowlist (`*.` = any subdomain, per settings.yml). */
export function hostAllowed(rawUrl: string, modelHosts: string[]): boolean {
  let host: string
  try {
    host = new URL(rawUrl).hostname
  } catch {
    return false
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
  for (const entry of modelHosts) {
    const pattern = entry.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (pattern.startsWith('*.')) {
      const bare = pattern.slice(2)
      if (host === bare || host.endsWith(`.${bare}`)) return true
    } else if (host === pattern) {
      return true
    }
  }
  return false
}

/** FR-02.1 hygiene / SECURITY-03 structural redaction check: returns the JSON
 *  path of the first string value containing whitespace (a transcript-text
 *  tell), or null when the artifact holds only urls/ids/timestamps. */
export function firstWhitespaceString(value: unknown, path = '$'): string | null {
  if (typeof value === 'string') return /\s/.test(value) ? path : null
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const hit = firstWhitespaceString(value[index], `${path}[${index}]`)
      if (hit) return hit
    }
    return null
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (/\s/.test(key)) return `${path}.<key ${key}>`
      const hit = firstWhitespaceString(child, `${path}.${key}`)
      if (hit) return hit
    }
  }
  return null
}
