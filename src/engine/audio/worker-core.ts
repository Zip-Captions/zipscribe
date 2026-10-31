// Re-export seam: the frozen Task-4 surface (`@engine/audio/worker-core`,
// unit04-api-contract.d.ts) lives in `./decode` — `src/workers/media.worker.ts`
// namespace-imports THIS module so the worker body stays a thin adapter.

export type { AudioSampleLike, AudioTrackLike, DecodeDeps, DecodeJob, DecodePath, DecodeProbe, MediaSourceLike, MediaWorkerEvent, MeterReading, PlaybackDeps, PlaybackJob } from './decode'
export { PcmChunkStream, decodeAudio, decodeForPlayback, handleMediaRequest, referenceMeter, teePcm, transferSource } from './decode'
