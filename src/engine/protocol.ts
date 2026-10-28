// Worker message unions — single source of truth.
//
// Created VERBATIM from `.ai-dlc/knowledge/architecture.md` § "Worker protocol
// (engine/protocol.ts)" per unit-01 FR. The only modifications are the
// mechanical `export` keywords (the worker stubs and every later unit import
// these — "other units import, never redefine") and the type-only imports of
// the shared domain types whose canonical home is model.ts.
// Discriminated unions with `t:` tags only; no stringly-typed commands.

import type { MediaAsset, ProjectSnapshot, Seconds, WordToken } from './model'

export type Tier = 'T1' | 'T2' | 'T3' | 'T4' // capability class (see Degradation tiers) — UI-facing
export type Device = 'webgpu' | 'wasm' // inference backend — engine-facing. Never call a Device a "tier".
export type ModelId = string // registry key, e.g. 'whisper-base_timestamped@608c49e6'

export interface PcmChunk {
  startSec: Seconds
  samples: Float32Array
} // 16 kHz mono f32, 1 s batches, transferable

export type PcmSource = { kind: 'transfer'; buffer: ArrayBuffer } | { kind: 'stream'; port: MessagePort } // stream mandatory for long media

export interface VadSegment {
  start: Seconds
  end: Seconds
}

export interface RawSegment {
  start: Seconds
  end: Seconds
  text: string
  words: WordToken[]
  probability?: number
}

export interface DiarFrames {
  speakers: number
  frames: { start: Seconds; end: Seconds; speaker: number; prob: number }[]
}

export interface PeaksData {
  bucketSec: number
  min: Float32Array
  max: Float32Array
}

export type EngineErrorCode =
  | 'MODEL_UNLOADED'
  | 'CACHE_CORRUPT'
  | 'NETWORK'
  | 'QUOTA_EXCEEDED'
  | 'GPU_OOM'
  | 'SESSION_LOST'
  | 'DECODE_STALL'
  | 'DIAR_SESSION_LOST'
  | 'UNSUPPORTED_MEDIA'
  | 'FFMPEG_REQUIRED'
  | 'ENCODER_UNSUPPORTED'
  | 'CANCELLED'
  | 'ENGINE_INTERNAL'

export interface EngineError {
  code: EngineErrorCode
  retryable: boolean
  detail?: string
} // detail: codes/numbers only — NEVER content (SECURITY-03)

export type NoticeCode = 'TIER_DOWNGRADE' | 'MULTI_TRACK' | 'FFMPEG_FALLBACK' | 'WORKER_RECYCLED' | 'OFFLINE_MODEL_MISSING' | 'PLAYBACK_STALL' | 'PREVIEW_UNSUPPORTED'

export interface Notice {
  code: NoticeCode
  params?: Record<string, string | number>
} // UI maps code → copy

// Events shared by all workers
export type JobEvent =
  | { t: 'job:progress'; jobId: string; processedSec: number; totalSec: number }
  | { t: 'job:done'; jobId: string }
  | { t: 'job:error'; jobId: string; error: EngineError }
  | { t: 'notice'; jobId?: string; notice: Notice }

export type ModelEvent =
  | { t: 'model:confirm-required'; model: ModelId; bytes: number } // > 100 MB gate (unit-03)
  | { t: 'model:progress'; model: ModelId; phase: 'download' | 'compile'; received: number; total?: number }
  | { t: 'model:ready'; model: ModelId; device: Device }
  | { t: 'model:error'; model: ModelId; error: EngineError }

// media.worker
export type MediaRequest = { t: 'probe'; jobId: string; file: File } | { t: 'decode'; jobId: string; file: File; ports: MessagePort[] } | { t: 'cancel'; jobId: string }
// tee: identical PcmChunks to every port (ASR + diarize)

export type MediaEvent =
  | JobEvent
  | { t: 'media:probed'; jobId: string; asset: MediaAsset }
  | { t: 'peaks:chunk'; jobId: string; firstBucket: number; min: Float32Array; max: Float32Array }
  | { t: 'decode:support'; jobId: string; path: 'webcodecs' | 'ffmpeg' }

// asr.worker
export type AsrRequest =
  | { t: 'loadModel'; model: ModelId; device: Device }
  | { t: 'confirmDownload'; model: ModelId }
  | { t: 'transcribe'; jobId: string; pcm: PcmSource; sampleRate: 16000; language: string | null; resumeFromSec?: Seconds }
  | { t: 'cancel'; jobId: string }
  | { t: 'unload' }

export type AsrEvent =
  | JobEvent
  | ModelEvent
  | { t: 'vad:segments'; jobId: string; segments: VadSegment[] }
  | { t: 'job:segments'; jobId: string; segments: RawSegment[] } // streamed batches, sorted

// diarize.worker
export type DiarizeRequest =
  | { t: 'loadModels' }
  | { t: 'diarize'; jobId: string; pcm: PcmSource; sampleRate: 16000; vad?: VadSegment[]; maxSpeakers?: number }
  | { t: 'cancel'; jobId: string }
  | { t: 'unload' }

export type DiarizeEvent = JobEvent | ModelEvent | { t: 'diar:frames'; jobId: string; frames: DiarFrames }

// export.worker
export interface ExportSettings {
  format: 'mp4-burn-in'
  width: number
  height: number
  fps: number
}

export type ExportRequest = { t: 'export'; jobId: string; snapshot: ProjectSnapshot; file: File; settings: ExportSettings } | { t: 'cancel'; jobId: string }

export type ExportEvent = JobEvent | { t: 'export:result'; jobId: string; blob: Blob }
