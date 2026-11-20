// TSV sidecar (FR-202.1): `start\tend\tspeaker\ttext` with a header row;
// times as raw seconds (3-dp); RFC-4180-style quoting (quote when the field
// contains quote/tab/newline; " doubled). Pure code.
import type { ProjectSnapshot } from '../model'
import { buildCues, exportFileName, wrapRtl, isRtlTrack, type SidecarOptions } from './cue-model'

function quote(field: string): string {
  if (/[",\t\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

export function toTsv(snapshot: ProjectSnapshot, options: SidecarOptions): string {
  const cues = buildCues(snapshot, options.track)
  const rtl = options.track !== 'source' && isRtlTrack(options.track)
  const rows = ['start\tend\tspeaker\ttext']
  for (const cue of cues) {
    const speaker = options.speakerLabels === 'off' ? '' : (cue.speaker ?? '')
    const text = wrapRtl(cue.text, rtl)
    const prefix = options.speakerLabels === 'prefix' && speaker !== '' ? `[${speaker}]: ` : ''
    rows.push(`${cue.start.toFixed(3)}\t${cue.end.toFixed(3)}\t${quote(speaker)}\t${quote(prefix + text)}`)
  }
  return rows.join('\n') + '\n'
}

export { exportFileName }
