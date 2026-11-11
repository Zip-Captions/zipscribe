// The public speaker-embedding entry (FR-06.1). Thin re-export of the
// engine-pure adapter glue — the ERes2Net ONNX runs through the
// transformers.js-bundled onnxruntime-web `InferenceSession` (no second ORT
// copy); the SDK-touching session construction lives in
// `./adapters/embeddings.ts` (engine-purity, CC-01.3), and the Kaldi-fbank
// frontend in `./adapters/fbank.ts`. This module is the stable DI seam the
// `diarize.worker.ts` imports.

export { createERes2NetEmbeddings, type ERes2NetLoadSpec } from './adapters/embeddings'
export { computeFbank, FBANK_NUM_BINS } from './adapters/fbank'
