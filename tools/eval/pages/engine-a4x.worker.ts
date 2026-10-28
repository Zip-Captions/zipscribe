// tools/eval/pages/engine-a4x.worker.ts — engine A's #1739 leak-study twin:
// the LATEST 4.x runtime from the isolated npm install under
// tools/eval/node-4x (vite alias @hf4x, vite.config.ts). Same protocol as
// engine-a.worker.ts so the two versions are measured identically (US-02.3).
// The ambient typing for @hf4x (hf4x.d.ts) reuses the 3.8.1 surface — the
// leak study only touches pipeline()/env/dispose(), unchanged across 3.8→4.x.
import * as transformers from '@hf4x'
import { installEngineAWorker } from './engine-a-impl'
import type { InjectedRuntime } from './asr-runner'

const runtime = {
  pipeline: (task: string, model: string, options: Record<string, unknown>) => transformers.pipeline(task as never, model, options as never),
  env: transformers.env,
} as unknown as InjectedRuntime

installEngineAWorker(runtime)
