// Builder-owned harness overlay (unit-04 slice 4D) — built into
// `public/harness/` by scripts/build-harness.ts and loaded by
// `/harness/media.html` AFTER the frozen harness module.
//
// Why this exists: the frozen e2e harness injects the ffmpeg fallback seam
// with the declared FILM stand-in when `ffmpegMode: 'film'`, and its
// `ffmpegMode: 'real'` branch carries the frozen URL contract plus an
// explicit "the production ffmpeg adapter is not wired yet (builder)" throw.
// film-adapter.ts documents the contract this file implements: "`ffmpegMode:
// 'real'` throws … instead of silently greening, so the day the builder
// installs @ffmpeg/ffmpeg the specs switch over without changing their
// assertions." This overlay IS that switch-over: the builder adds
// @ffmpeg/ffmpeg + the self-hosted pinned core (scripts/copy-ffmpeg.ts) and
// the production adapter (src/engine/audio/adapters/ffmpeg.ts), and this
// module repoints the forced-ffmpeg seam at the REAL adapter without editing
// any frozen test file. The assertions are untouched — only the decoder
// standing behind the seam changes. When the pinned core is not served (RED
// phase, or a checkout without the copy step), the real path fails with
// FFMPEG_REQUIRED and every `film`-mode call transparently delegates to the
// frozen harness, exactly as before 4D. `ffmpegMode: 'real'` keeps the
// frozen honesty rule: a missing core surfaces as FFMPEG_CORE_UNAVAILABLE
// rather than a silent film fallback.
//
// SECURITY-03: only codes, numbers and sample buffers leave the page.
import { decodeAudio } from '@engine/audio/worker-core'
import { openFfmpeg } from '@engine/audio/adapters/ffmpeg'
import { sniffContainer } from '@engine/audio/adapters/probe'

/** Mirror of the frozen harness `recordEvent` (fixtures/harness.ts) so the
 * records this overlay produces are the shape the specs already assert. */
function recordEvent(event) {
  const base = { t: event.t }
  if (event.t === 'decode:support') base.path = event.path
  if (event.t === 'job:error') base.code = event.error.code
  if (event.t === 'notice') base.notice = event.notice.code
  if (event.t === 'media:probed') base.asset = event.asset
  if (event.t === 'job:progress') {
    base.processedSec = event.processedSec
    base.totalSec = event.totalSec
  }
  if (event.t === 'peaks:chunk') {
    base.firstBucket = event.firstBucket
    base.buckets = event.min.length
  }
  return base
}

/** Real-core decode: fetch the fixture from `self`, transcode through the
 * production ffmpeg adapter, run the frozen `decodeAudio` pipeline (real
 * resampler/peaks/fingerprint — nothing here stubs the unit under test),
 * and return the frozen harness record shape (including its chunk-ack
 * reader protocol). */
async function realDecodeFile(url) {
  const response = await fetch(new URL(url, globalThis.location.origin + '/').href)
  if (!response.ok) throw new Error(`fixture fetch failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const file = new File([new Blob([bytes])], url.split('/').pop() ?? 'fixture', { type: response.headers.get('content-type') ?? 'application/octet-stream' })
  const reason = { container: sniffContainer(bytes), codec: 'unknown' }
  const events = []
  const chunks = []
  const channel = new MessageChannel()
  channel.port1.onmessage = (message) => {
    const data = message.data
    if (data.t === undefined && typeof data.startSec === 'number' && data.samples instanceof Float32Array) {
      chunks.push({ startSec: data.startSec, samples: data.samples.slice() })
      channel.port2.postMessage({ t: 'ack' })
    } else if (typeof data.t === 'string') {
      events.push(recordEvent(data))
    }
  }
  channel.port1.start()
  const job = decodeAudio(
    { jobId: 'harness-ffmpeg-real', file, ports: [channel.port2] },
    {
      open: async (blob) => openFfmpeg(blob, reason),
      emit: (event) => events.push(recordEvent(event)),
    },
  )
  await job.done
  return { events, chunks, live: job.activeDecoders() }
}

const frozen = globalThis.__zipscribeMediaHarness
if (frozen && !frozen.__zipscribeFfmpegRealMode) {
  const overlay = Object.create(frozen)
  overlay.decodeFile = async (url, options) => {
    if (options?.forcedPath === 'ffmpeg') {
      const result = await realDecodeFile(url)
      const failure = result.events.find((event) => event.t === 'job:error')
      const coreMissing = failure && (failure.code === 'FFMPEG_REQUIRED' || failure.code === 'FFMPEG_CORE_UNAVAILABLE')
      if (coreMissing) {
        if (options.ffmpegMode === 'real') {
          throw Object.assign(new Error('FFMPEG_CORE_UNAVAILABLE'), { code: 'FFMPEG_CORE_UNAVAILABLE' })
        }
        // Declared film stand-in stays honest when the pinned core is absent.
        return frozen.decodeFile(url, options)
      }
      return result
    }
    return frozen.decodeFile(url, options)
  }
  overlay.__zipscribeFfmpegRealMode = true
  globalThis.__zipscribeMediaHarness = overlay
}
