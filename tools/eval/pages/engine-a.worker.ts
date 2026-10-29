// tools/eval/pages/engine-a.worker.ts — engine A, pinned runtime
// (@huggingface/transformers ~3.8.1 — settings.yml version_pins). Vite
// bundles the worker from the pinned devDependency; nothing is fetched from a
// CDN at runtime (US-02.2).
import * as transformers from '@huggingface/transformers'
import { installEngineAWorker } from './engine-a-impl'
import type { InjectedRuntime } from './asr-runner'

const runtime = {
  pipeline: (task: string, model: string, options: Record<string, unknown>) => transformers.pipeline(task as never, model, options as never),
  env: transformers.env,
} as unknown as InjectedRuntime

installEngineAWorker(runtime)
