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

// Transferred ports arrive on `event.ports`; the copies inside `event.data`
// are neutered placeholders (FR-108.2 doctrine, unit-204): re-attach the
// live ports before the core posts pcm chunks through them.
function restorePorts(request: MediaRequest, transferred: readonly MessagePort[] | undefined): MediaRequest {
  if (transferred === undefined || transferred.length === 0) return request
  if (request.t === 'decode') return { ...request, ports: transferred.slice(0, request.ports.length) }
  if (request.t === 'decode-playback') return { ...request, port: transferred[0] as MessagePort }
  return request
}

scope.onmessage = (event: MessageEvent<MediaRequest>) => {
  core.handleMediaRequest(
    restorePorts(event.data, event.ports),
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

// FR-108.2 (unit-204): boot pump. Without a worker-initiated post at
// evaluation end, a request posted by the host on the SAME tick the worker
// is created is never delivered (Chromium module-worker message pump,
// measured deterministically on the preview build: the decode request sat
// unread forever). Host-side folds ignore it — the unmatched jobId hits the
// no-op event group (jobs.ts `decode:support` case).
scope.postMessage({ t: 'decode:support', jobId: 'media-worker-boot', path: 'webcodecs' })
