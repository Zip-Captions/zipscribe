// Intake service — the drop/sample pipeline between the shell and the engine.
//
// Shapes are the unit-101 frozen contract
// (tests/unit/workbench/unit101-api-contract.d.ts § @state/services/intake).
// Caption parsing never happens here: file acceptance goes through the
// unit-07 `ImportCaptionsService` seam (content sniff + extension), and media
// reaches the media worker as a `probe` MediaRequest; the `media:probed`
// reply creates the project (media + captions in one drop → imported source
// track, US-2.0.2). Nothing is silently dropped: every rejected file is
// reported with a reason CODE only (SECURITY-03).

import type { CaptionBlock } from '../../engine/model'
import type { EnginePort, JobsStore } from '../jobs'
import type { ProjectStore } from '../project'
import { newJobId } from '../ids'

/**
 * VERBATIM from architecture.md § "engine/captions — pure, main-thread" while
 * unit-07 is unmerged (frozen contract note). On merge, re-export the real
 * `src/engine/captions` types instead of declaring them here.
 */
export type CaptionFormat = 'srt' | 'vtt' | 'sbv' | 'ttml' | 'ass' | 'zipscribe-json'

export interface ImportReport {
  format: CaptionFormat
  encoding: string
  cues: number
  blocks: number
  detectedLanguage: string | null
  adjustments: { code: 'OVERLAP_CLAMPED' | 'ZERO_DURATION_FIXED' | 'TAGS_STRIPPED' | 'POSITION_DROPPED' | 'STYLE_DROPPED' | 'EMPTY_CUE_DROPPED' | 'CUE_UNMATCHED'; count: number }[]
}

export interface CaptionImportResult {
  report: ImportReport
  blocks: CaptionBlock[]
}

/**
 * UNIT-07 SEAM: caption-file intake. Tests inject a fake importer returning a
 * canned `ImportReport`; the real implementation lands with unit-07
 * (`importCaptions`). The UI must never import `engine/captions` directly.
 */
export interface ImportCaptionsService {
  /** Content sniff + extension (US-2.0.2); null = not a caption file we accept. */
  sniff(file: File): Promise<CaptionFormat | null>
  importCaptions(file: File): Promise<CaptionImportResult>
}

export interface RejectedFile {
  /** Extension + MIME summary — NOT the file name (SECURITY-03: the toast shows codes, not user strings). */
  reason: 'UNSUPPORTED_TYPE' | 'UNSUPPORTED_CAPTION'
}

export interface IntakeOutcome {
  /** A `probe` MediaRequest was posted for each accepted media file. */
  mediaPosted: number
  importedCaptions: CaptionImportResult[]
  rejected: RejectedFile[]
}

export interface IntakeService {
  /** Classifies every dropped file — nothing is silently dropped (CC-101.2). */
  handleFiles(files: readonly File[]): Promise<IntakeOutcome>
  /** US-2.0.2: fetches SAMPLE_CLIP_URL, wraps a File, runs it through handleFiles. */
  loadSample(): Promise<void>
}

/** App-served sample copied from fixtures at BUILD time — fixtures/ itself is never served (CC-101.2). */
export const SAMPLE_CLIP_URL = '/samples/speech-2min.mp4'

// architecture.md § Supported media — native + ffmpeg-fallback container set.
const MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'ts',
  'mp3',
  'm4a',
  'm4b',
  'aac',
  'wav',
  'flac',
  'ogg',
  'oga',
  'opus',
  'weba',
  'mka',
  'aif',
  'aiff',
  'wma',
  'amr',
  '3gp',
  '3gpp',
  'caf',
])

// design.md § Bring-your-own captions extensions — sniff (seam) still decides.
const CAPTION_EXTENSIONS: ReadonlySet<string> = new Set(['vtt', 'srt', 'sbv', 'ttml', 'xml', 'dfxp', 'ass', 'ssa', 'json'])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function isMediaFile(file: File): boolean {
  if (MEDIA_EXTENSIONS.has(extensionOf(file.name))) return true
  return file.type.startsWith('video/') || file.type.startsWith('audio/')
}

export function createIntakeService(deps: { engine: EnginePort; jobs: JobsStore; project: ProjectStore; importService: ImportCaptionsService }): IntakeService {
  // IN.3/IN.4 (adversary adjudication): per-drop pairing — each imported
  // caption is bound to the probe jobId ITS OWN drop posts, so a slow probe
  // reply can never consume a later drop's caption (a global FIFO leaked) and
  // an unpaired import of a captions-only drop can never resurface.
  const pendingByProbeJobId = new Map<string, CaptionImportResult>()

  deps.engine.onMediaEvent((event) => {
    if (event.t !== 'media:probed') return
    const captionImport = pendingByProbeJobId.get(event.jobId)
    pendingByProbeJobId.delete(event.jobId)
    deps.project.createProject(event.asset, captionImport)
  })

  async function handleFiles(files: readonly File[]): Promise<IntakeOutcome> {
    const outcome: IntakeOutcome = { mediaPosted: 0, importedCaptions: [], rejected: [] }
    const media: File[] = []
    const captions: File[] = []
    for (const file of files) {
      if (isMediaFile(file)) {
        media.push(file)
        continue
      }
      if (CAPTION_EXTENSIONS.has(extensionOf(file.name))) {
        let format: CaptionFormat | null = null
        try {
          format = await deps.importService.sniff(file)
        } catch {
          // IN.1 (adversary adjudication, CC-101.2): a rejecting seam degrades
          // to a rejected entry with a reason CODE — it must never take the
          // drop (or the sibling media probe) down with it.
          outcome.rejected.push({ reason: 'UNSUPPORTED_CAPTION' })
          continue
        }
        if (format !== null) captions.push(file)
        else outcome.rejected.push({ reason: 'UNSUPPORTED_CAPTION' })
      } else {
        outcome.rejected.push({ reason: 'UNSUPPORTED_TYPE' })
      }
    }

    const imported: CaptionImportResult[] = []
    for (const file of captions) {
      try {
        imported.push(await deps.importService.importCaptions(file))
      } catch {
        // IN.2 (adversary adjudication, CC-101.2): same rule mid-pipeline —
        // report the CODE, keep classifying, still probe the media.
        outcome.rejected.push({ reason: 'UNSUPPORTED_CAPTION' })
      }
    }
    outcome.importedCaptions = imported

    const pairable = [...imported]
    for (const file of media) {
      const jobId = newJobId()
      const captionImport = pairable.shift()
      if (captionImport !== undefined) pendingByProbeJobId.set(jobId, captionImport)
      deps.engine.postMedia({ t: 'probe', jobId, file })
      outcome.mediaPosted += 1
    }
    return outcome
  }

  return {
    handleFiles,
    async loadSample(): Promise<void> {
      const response = await fetch(SAMPLE_CLIP_URL)
      const bytes = await response.arrayBuffer()
      const name = SAMPLE_CLIP_URL.slice(SAMPLE_CLIP_URL.lastIndexOf('/') + 1)
      await handleFiles([new File([bytes], name, { type: 'video/mp4' })])
    },
  }
}
