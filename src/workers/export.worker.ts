// Export worker (FR-202.3, unit-202): burn-in MP4 via mediabunny.
// Pipeline: Input(BlobSource) → Conversion (video: resize≤source + fps
// normalise + per-frame overlay `process` hook drawing at each sample's
// EXACT timestamp via the shared renderer; audio: transmux-copy when the
// source codec is MP4-compatible — mediabunny's default `preferred` copy
// mode — else decode + re-encode to AAC) → Output(Mp4OutputFormat,
// BufferTarget) → export:result Blob. Encoder config is owned by mediabunny
// (it probes WebCodecs support internally per codec — the avc ladder); the
// dialog-level capability gate (T1/T2) is the user-facing gate, this worker
// maps any residual encoder failure to ENCODER_UNSUPPORTED codes only
// (SECURITY-03 — names/codes, never messages).
// FR-202.4: bundled faces are registered before the first frame is drawn.
// Cancel: the active Conversion is cancel()d (encoder flush is bounded —
// CC-202.6 measures ≤ 2 s in e2e). Progress ≥ 1 Hz via createProgressPacer.
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from 'mediabunny'
import { drawCaptions, safeMargins } from '../engine/export/overlay'
import { createProgressPacer } from '../engine/export/burn-in-pacing'
import { BUNDLED_FONT_FACES } from '../engine/style/fonts-manifest'
import type { ExportEvent, ExportRequest } from '../engine/protocol'

interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<ExportRequest>) => void) | null
  postMessage(message: ExportEvent, options?: StructuredSerializeOptions): void
  FontFace?: typeof FontFace
  fonts?: FontFaceSet
}

const scope = globalThis as unknown as DedicatedWorkerScope

function registerBundledFonts(): Promise<void> {
  const FontFaceCtor = scope.FontFace
  const fonts = scope.fonts
  if (FontFaceCtor === undefined || fonts === undefined) return Promise.resolve()
  const pending = BUNDLED_FONT_FACES.filter((f) => !f.lazy).map(
    (face) =>
      new FontFaceCtor(face.family, `url(${face.url})`, { weight: String(face.weight) })
        .load()
        .then((loaded) => {
          fonts.add(loaded)
        })
        .catch(() => undefined), // offline-first: bundled failure falls back per policy
  )
  return Promise.all(pending).then(() => undefined)
}

const fontsReady = registerBundledFonts()

interface ActiveJob {
  conversion: Conversion | null
  cancelled: boolean
  /** Exactly-once guard for the CC-202.6 cancel-ack (job:done after cancel). */
  acked: boolean
}

/** Post the terminal cancel-ack once — the run row clears on this event. */
function ackCancel(job: ActiveJob, jobId: string): void {
  if (job.acked) return
  job.acked = true
  post({ t: 'job:done', jobId })
}

const active = new Map<string, ActiveJob>()

function post(event: ExportEvent): void {
  scope.postMessage(event)
}

async function runExport(request: Extract<ExportRequest, { t: 'export' }>, job: ActiveJob): Promise<void> {
  const { jobId } = request
  try {
    await runExportInner(request, job)
  } catch (err) {
    if (job.cancelled) return
    const name = err instanceof Error ? err.name : 'unknown'
    const encoder = name === 'NotSupportedError' || name === 'EncodingError'
    post({ t: 'job:error', jobId, error: { code: encoder ? 'ENCODER_UNSUPPORTED' : 'ENGINE_INTERNAL', retryable: !encoder, detail: name } })
  }
}

async function runExportInner(request: Extract<ExportRequest, { t: 'export' }>, job: ActiveJob): Promise<void> {
  const { jobId, snapshot, file, settings } = request
  await fontsReady // FR-202.4: faces before the first frame
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const totalSec = snapshot.asset.duration > 0 ? snapshot.asset.duration : await input.computeDuration()

  const width = settings.width
  const height = settings.height
  let ctx: OffscreenCanvasRenderingContext2D | null = null
  let canvas: OffscreenCanvas | null = null

  const pacer = createProgressPacer(totalSec, (processedSec, total) => {
    post({ t: 'job:progress', jobId, processedSec, totalSec: total })
  })
  // mediabunny's onProgress is coarse (per-track milestones) — the ≥ 1 Hz
  // guarantee (US-3.2.2) rides the frame hook below (frames/fps).
  let framesProcessed = 0

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      width,
      height,
      fit: 'fill',
      frameRate: settings.fps,
      process: (sample) => {
        if (ctx === null || canvas === null) {
          canvas = new OffscreenCanvas(width, height)
          const created = canvas.getContext('2d')
          if (created === null) throw new Error('canvas2d_unavailable')
          ctx = created
        }
        const c = ctx
        if (c === null) throw new Error('canvas2d_unavailable')
        c.setTransform(1, 0, 0, 1, 0, 0)
        c.clearRect(0, 0, width, height)
        sample.drawWithFit(c, { fit: 'fill' })
        const t = sample.timestamp
        drawCaptions(c, {
          blocks: snapshot.blocks.filter((b) => b.start <= t && t < b.end),
          time: t,
          style: snapshot.style,
          track: 'source',
          width,
          height,
          speakerPalette: DEFAULT_SPEAKER_PALETTE,
          safe: safeMargins(snapshot.outputAspect),
        })
        framesProcessed += 1
        pacer.update(Math.min(framesProcessed / settings.fps, totalSec))
        return canvas
      },
    },
  })
  job.conversion = conversion
  if (job.cancelled) {
    ackCancel(job, jobId)
    return
  }
  if (!conversion.isValid) {
    post({ t: 'job:error', jobId, error: { code: 'UNSUPPORTED_MEDIA', retryable: false, detail: 'conversion-invalid' } })
    return
  }
  conversion.onProgress = (progress) => {
    pacer.update(progress * totalSec)
  }
  try {
    await conversion.execute()
  } catch (err) {
    if (job.cancelled) {
      // Backstop ack (the cancel() promise is the primary): execute() has
      // now rejected with ConversionCanceledError, flush landed. The row
      // clears on THIS ack, so "cancel ≤ 2 s" measures the real flush.
      ackCancel(job, jobId)
      return
    }
    const name = err instanceof Error ? err.name : 'unknown'
    const encoder = name === 'NotSupportedError' || name === 'EncodingError'
    post({ t: 'job:error', jobId, error: { code: encoder ? 'ENCODER_UNSUPPORTED' : 'ENGINE_INTERNAL', retryable: !encoder, detail: name } })
    return
  }
  if (job.cancelled) {
    ackCancel(job, jobId)
    return
  }
  pacer.finish()
  const buffer = output.target.buffer
  if (buffer === null) {
    post({ t: 'job:error', jobId, error: { code: 'ENGINE_INTERNAL', retryable: false, detail: 'buffer-null' } })
    return
  }
  post({ t: 'export:result', jobId, blob: new Blob([buffer], { type: 'video/mp4' }) })
  post({ t: 'job:done', jobId })
}

scope.onmessage = (event: MessageEvent<ExportRequest>) => {
  const request = event.data
  if (request.t === 'export') {
    const job: ActiveJob = { conversion: null, cancelled: false, acked: false }
    active.set(request.jobId, job)
    void runExport(request, job).finally(() => {
      active.delete(request.jobId)
    })
    return
  }
  const job = active.get(request.jobId)
  if (job === undefined) return
  job.cancelled = true
  if (job.conversion === null) {
    ackCancel(job, request.jobId) // cancelled before init: nothing to flush
    return
  }
  // Docs (mediabunny.dev/guide/converting-media-files § Canceling): cancel()
  // resolves once canceled and makes execute() throw ConversionCanceledError.
  // The ack rides cancel()'s own resolution — the authoritative bounded-stop
  // signal — with the execute()-reject path as backstop (both guarded).
  void job.conversion.cancel().then(() => ackCancel(job, request.jobId))
}

const DEFAULT_SPEAKER_PALETTE: readonly string[] = ['#4c8dff', '#e5534b', '#4ab871', '#d29922', '#a371f7', '#3fb9b0', '#db61a2', '#8b949e']
