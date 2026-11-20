// SRT serializer (FR-202.1, US-3.2.1). Times `HH:MM:SS,mmm`; blocks separated
// by a blank line; numbering from 1; \\n preserved; speaker label as
// `[Name]: ` prefix on the first line when enabled. Pure code.
import type { ProjectSnapshot } from '../model'
import { blockText, buildCues, exportFileName, sanitizeTimingLines, timeCode, wrapRtl, isRtlTrack, type SidecarOptions } from './cue-model'

export function toSrt(snapshot: ProjectSnapshot, options: SidecarOptions): string {
  const cues = buildCues(snapshot, options.track).filter((c) => blockText(c.text) !== '')
  const rtl = options.track !== 'source' && isRtlTrack(options.track)
  const chunks: string[] = []
  cues.forEach((cue, i) => {
    const head = options.speakerLabels === 'off' || cue.speaker === null ? '' : `[${cue.speaker}]: `
    const text = wrapRtl(sanitizeTimingLines(blockText(cue.text)), rtl)
    const body = head === '' ? text : `${head}${text}`
    chunks.push(`${String(i + 1)}\n${timeCode(cue.start, ',')} --> ${timeCode(cue.end, ',')}\n${body}`)
  })
  return chunks.join('\n\n') + (chunks.length > 0 ? '\n' : '')
}

export { exportFileName }
