// media.worker (FR-1.0.2 / unit-04): a THIN adapter over the frozen
// `@engine/audio/worker-core` surface — the boundary speaks the protocol.ts
// `MediaRequest`/`MediaEvent` unions; every byte of decode logic lives in the
// engine module (media-worker-wiring pins this shape). The mediabunny seam
// arrives via the adapter import (SDKs are allowed under adapters/ only).

import * as core from '@engine/audio/worker-core'
import { openMediabunny } from '@engine/audio/adapters/mediabunny'
import type { MediaEvent, MediaRequest } from '@engine/protocol'

interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<MediaRequest>) => void) | null
  postMessage(message: MediaEvent, options?: StructuredSerializeOptions): void
}

const scope = globalThis as unknown as DedicatedWorkerScope

scope.onmessage = (event: MessageEvent<MediaRequest>) => {
  core.handleMediaRequest(
    event.data,
    {
      postMessage: (message, transfer) => scope.postMessage(message, transfer ? { transfer } : undefined),
    },
    {
      open: (file, options) =>
        openMediabunny(file, {
          onFallback: options?.onFallback,
          // FR-04.5: the ffmpeg.wasm fallback is lazy-imported on first need
          // (own chunk, off the initial budget); the core itself is
          // self-hosted under /wasm/ffmpeg (scripts/copy-ffmpeg.ts).
          openFfmpeg: async (blob, reason) => {
            const { openFfmpeg } = await import('@engine/audio/adapters/ffmpeg')
            return openFfmpeg(blob, reason)
          },
        }),
      emit: () => undefined,
    },
  )
}
