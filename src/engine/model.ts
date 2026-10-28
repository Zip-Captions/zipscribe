// Domain types — single source of truth.
//
// Created VERBATIM from `.ai-dlc/knowledge/architecture.md` § "Canonical domain
// model (engine/model.ts)" per unit-01 FR. The only modifications are the
// mechanical `export` keywords (other units must be able to `import` them —
// the architecture file mandates "other units import, never redefine") and the
// single type-only import of `ModelId`, whose canonical home is protocol.ts.
// Never edit the shape of these types here; propose a "Contract changes" entry
// in the unit report so architecture.md is updated first.

import type { ModelId } from './protocol'

export type Seconds = number // absolute media time, float, 3-decimal precision ceiling

export interface WordToken {
  text: string // no leading/trailing whitespace; punctuation attached to the preceding word
  start: Seconds
  end: Seconds
  probability?: number // 0..1, only when the engine exposes it (registry flag `confidence`)
  speakerId?: string // word-level speaker truth (diarization); block.speakerId is the majority
  breakAfter?: boolean // manual line break after this word (Shift+Enter)
  timing?: 'asr' | 'aligned' | 'estimated' | 'manual' // default 'asr'; imported captions start 'estimated'
}

export interface CaptionBlock {
  id: string // crypto.randomUUID()
  start: Seconds
  end: Seconds
  text: string // derived: words joined by ' ' ('\n' where breakAfter) — see domain invariant 2
  words: WordToken[] // invariant: sorted, within [start, end]
  speakerId: string // Speaker.id (majority of word speakerIds)
  confidence?: number // 0..1 mean word probability, absent when engine has no probabilities
  retimeFromWords?: boolean // if true, text edits re-derive word timings (default false = timings frozen)
}

export interface Speaker {
  id: string
  label: string
  color: string
} // id `SPK_<n>` durable; label editable; color from palette

export interface MediaFingerprint {
  name: string
  size: number
  durationMs: number
  sampleHashes: [string, string, string]
}

export interface MediaAsset {
  id: string
  name: string
  kind: 'video' | 'audio'
  container: string
  audioCodec: string | null
  videoCodec: string | null
  duration: Seconds
  width: number
  height: number
  fps: number // audio-only: width = height = fps = 0
  fingerprint: MediaFingerprint
}

export interface CaptionStyle {
  fontFamily: string
  fontWeight: 400 | 700
  fontSizePct: number // % canvas height
  textTransform: 'none' | 'lowercase' | 'uppercase'
  color: string
  highlightColor: string
  outlineColor: string
  outlineWidth: number
  backgroundColor?: string
  backgroundOpacity: number
  position: 'top' | 'center' | 'bottom'
  marginVPct: number
  alignment: 'left' | 'center' | 'right'
  maxLinesPerBlock: 1 | 2 | 3
  highlightMode: 'none' | 'karaoke' | 'bold-active'
  showSpeakerBar: boolean
  animationPreset?: string
}

export type OutputAspect = 'source' | '16:9' | '9:16' | '1:1' | '4:5'

export interface TranslationEntry {
  text: string // may contain '\n' line breaks; no word timings (cue-level only)
  status: 'translated' | 'edited' | 'failed'
  sourceHash: string // hash of the source block.text it was made from; mismatch ⇒ stale
}

export interface TranslationTrack {
  language: string // BCP-47 target, e.g. 'fr', 'zh-Hant'
  origin: 'machine' | 'imported' | 'manual'
  engine: 'chrome-translator' | null
  entries: Record<string, TranslationEntry> // keyed by source CaptionBlock.id — timing is always the source block's
}

export interface Project {
  id: string
  name: string
  schemaVersion: number
  asset: MediaAsset
  blocks: CaptionBlock[] // the SOURCE track (language = project.language)
  captionOrigin: 'none' | 'transcribed' | 'imported' | 'mixed'
  translations: TranslationTrack[] // at most one per language
  speakers: Speaker[]
  speakerSource: 'none' | 'auto-beta' | 'manual'
  language: string | null // BCP-47 primary tag ('en', 'fr') of the source track; null = engine auto-detect pending
  modelId: ModelId | null // model that produced the transcript (provenance)
  style: CaptionStyle
  outputAspect: OutputAspect
  transcription: 'none' | 'partial' | 'complete' // 'partial' after cancel/interrupt
  updatedAt: number // epoch ms
}

export type ProjectSnapshot = Readonly<Project> & { snapshotVersion: number } // immutable copy handed to export
