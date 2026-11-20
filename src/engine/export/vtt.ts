// WebVTT serializer (FR-202.1, US-3.2.1). `WEBVTT` header; times
// `HH:MM:SS.mmm`; escape matrix & < > + no surviving `-->`; speaker labels as
// `<v Name>` (vtt-voice mode) per the W3C WebVTT spec. Pure code.
import type { ProjectSnapshot } from '../model'
import { blockText, buildCues, exportFileName, timeCode, vttEscape, wrapRtl, isRtlTrack, type SidecarOptions } from './cue-model'

export function toVtt(snapshot: ProjectSnapshot, options: SidecarOptions): string {
  const cues = buildCues(snapshot, options.track).filter((c) => blockText(c.text) !== '')
  const rtl = options.track !== 'source' && isRtlTrack(options.track)
  const chunks: string[] = []
  cues.forEach((cue, i) => {
    const text = wrapRtl(vttEscape(blockText(cue.text)), rtl)
    const head = options.speakerLabels !== 'off' && cue.speaker !== null ? (options.speakerLabels === 'vtt-voice' ? `<v ${vttEscape(cue.speaker)}>` : `[${cue.speaker}]: `) : ''
    const body = head === '' ? text : `${head}${text}`
    chunks.push(`cue-${String(i + 1)}\n${timeCode(cue.start, '.')} --> ${timeCode(cue.end, '.')}\n${body}`)
  })
  return 'WEBVTT\n\n' + chunks.join('\n\n') + (chunks.length > 0 ? '\n' : '')
}

export { exportFileName }
