// export.worker entry stub (FR-1.0.2) — typed with its own request/event
// union; the real frame render → VideoEncoder → mux arrives in unit-202.
// CC-201.2 wiring already holds: burn-in frames draw through the SHARED
// renderer (engine/export/overlay via probe-frame), and the bundled faces are
// registered on the worker scope (FR-201.4) so OffscreenCanvas rasterization
// matches the preview pixel-for-pixel policy (SSIM ≥ 0.99, not byte-exact).
import type { ExportEvent, ExportRequest } from '../engine/protocol'
import { renderProbeFrame } from '../engine/export/probe-frame'
import { safeMargins } from '../engine/export/overlay'
import { BUNDLED_FONT_FACES } from '../engine/style/fonts-manifest'
const DEFAULT_SPEAKER_PALETTE = ['#4c8dff', '#e5534b', '#4ab871', '#d9a03f', '#a06bd9', '#3fb8c9', '#d96ba0', '#8fa03f']

interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<ExportRequest>) => void) | null
  postMessage(message: ExportEvent, options?: StructuredSerializeOptions): void
  fonts?: { add(face: FontFace): void }
  FontFace?: typeof FontFace
}

const scope = globalThis as unknown as DedicatedWorkerScope

function registerBundledFonts(): void {
  const FontFaceCtor = scope.FontFace
  const fonts = scope.fonts
  if (FontFaceCtor === undefined || fonts === undefined) return
  for (const face of BUNDLED_FONT_FACES.filter(f => !f.lazy)) {
    // worker scope has fetch; load() resolves on the worker event loop
    void new FontFaceCtor(face.family, `url(${face.url})`, { weight: String(face.weight) }).load()
      .then(loaded => fonts.add(loaded))
      .catch(() => undefined) // offline-first: bundled load failure falls back per policy
  }
}
registerBundledFonts()

scope.onmessage = (event: MessageEvent<ExportRequest>) => {
  const request = event.data
  if (request.t === 'export' || request.t === 'cancel') {
    if (request.t === 'export') {
      // CC-201.2: the stub consumes the shared renderer exactly as the
      // unit-202 loop will. No blocks/project yet in the protocol payload
      // (frozen ExportSettings) — until 202 ships the real frame contract,
      // render an empty-stage frame to prove the code path is live.
      try {
        const { width, height } = request.settings
        const canvas = new OffscreenCanvas(width, height)
        const ctx = canvas.getContext('2d')
        if (ctx !== null) {
          const snapshot = request.snapshot
          const t = snapshot.blocks[0]?.start ?? 0
          renderProbeFrame(ctx, {
            blocks: snapshot.blocks.filter(b => b.start <= t && t < b.end),
            time: t,
            style: snapshot.style,
            track: 'source',
            width,
            height,
            speakerPalette: DEFAULT_SPEAKER_PALETTE,
            safe: safeMargins(snapshot.outputAspect),
          })
        }
      } catch {
        // environments without OffscreenCanvas (node typecheck) keep the stub green
      }
    }
    scope.postMessage({ t: 'job:done', jobId: request.jobId } satisfies ExportEvent)
  }
}
