// Sidecar export service (FR-202.1, unit-202): pure-serializer dispatch on
// the MAIN thread (sidecars are instant, US-3.2.1) producing {filename,
// blob}. No worker, no network, no logging (SECURITY-03).
import type { ProjectSnapshot } from '../../engine/model'
import { toSrt } from '../../engine/export/srt'
import { toVtt } from '../../engine/export/vtt'
import { toJson } from '../../engine/export/json'
import { toTsv } from '../../engine/export/tsv'
import { exportFileName, type SidecarOptions } from '../../engine/export/cue-model'

export type SidecarFormat = 'srt' | 'vtt' | 'json' | 'tsv'

const MIME: Record<SidecarFormat, string> = {
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  json: 'application/json',
  tsv: 'text/tab-separated-values',
}

export interface SidecarResult {
  filename: string
  blob: Blob
  mime: string
}

export function exportSidecar(snapshot: ProjectSnapshot, options: SidecarOptions & { format: SidecarFormat }): SidecarResult {
  const body = options.format === 'srt' ? toSrt(snapshot, options) : options.format === 'vtt' ? toVtt(snapshot, options) : options.format === 'json' ? toJson(snapshot, options) : toTsv(snapshot, options)
  return {
    filename: exportFileName(snapshot.name, options.track, options.format),
    blob: new Blob([body], { type: `${MIME[options.format]};charset=utf-8` }),
    mime: MIME[options.format],
  }
}
