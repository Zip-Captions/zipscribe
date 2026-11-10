// The public segmentation entry (FR-06.1). Thin re-export of the engine-pure
// adapter glue under `adapters/` — `src/engine/**` must not import the SDK
// directly (engine-purity lint, CC-01.3), so the SDK-touching pyannote
// AutoModelForAudioFrameClassification + AutoProcessor wiring lives in
// `./adapters/segmentation.ts` and this module is the stable DI seam the
// `diarize.worker.ts` / `worker-core.ts` import.

export { createPyAnnoteSegmentation, type PyAnnoteLoadSpec, type PyAnnoteSessionHandle } from './adapters/segmentation'
