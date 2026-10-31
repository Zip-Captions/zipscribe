// CC-04.4/CC-04.5 (FR-04.6/FR-04.9): content sniffing and the per-session
// support matrix. Detection is by MAGIC BYTES, never by extension alone
// (`not-audio.mp3` must sniff as 'unknown'); the matrix is an in-memory cache
// keyed by file, so the same file never re-decides within a session.
//
// Runs inside the media worker beside mediabunny (this module itself imports
// no SDK — the sniffing is pure bytes).

/** Signature registry: every magic rule `sniffContainer` applies (precision
 * documentation for the probe surface — CC-04.5 registry-precision test). */
export const ALL_FORMAT_HINTS: readonly string[] = [
  'ftyp@4 — ISO-BMFF family: mp4/m4a/m4b and 3gp (brand at 8..12)',
  'OggS@0 — Ogg container (vorbis/opus/flac-in-ogg)',
  'RIFF@0 + WAVE@8 — WAVE PCM/float',
  'FORM@0 + AIFF|AIFC@8 — AIFF/AIFC PCM (big-endian)',
  'fLaC@0 — native FLAC',
  '1A 45 DF A3@0 — EBML (Matroska/WebM audio: weba/mka)',
  '30 26 B2 75 8E 66 CF 11@0 — ASF GUID (WMA)',
  'FF Fx@0 (mask F6) — ADTS AAC frame sync',
  'ID3@0 or FExx/FFDx@0 — MPEG audio (CBR/VBR MP3)',
  '#!AMR@0 — AMR-NB/AMR-WB',
  'caff@0 — Core Audio Format',
]

/** `-`-joined hex of `bytes[at, at + length)`; `''` when the region is short. */
export function formatSignature(bytes: Uint8Array, at: number, length: number): string {
  if (!Number.isInteger(at) || at < 0 || !Number.isInteger(length) || length <= 0 || at + length > bytes.length) return ''
  const parts: string[] = []
  for (let index = at; index < at + length; index++) parts.push(bytes[index]!.toString(16).padStart(2, '0'))
  return parts.join('-')
}

function asciiAt(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false
  for (let index = 0; index < text.length; index++) {
    if (bytes[at + index] !== text.charCodeAt(index)) return false
  }
  return true
}

function bytesAt(bytes: Uint8Array, at: number, values: readonly number[]): boolean {
  if (at + values.length > bytes.length) return false
  for (let index = 0; index < values.length; index++) {
    if (bytes[at + index] !== values[index]) return false
  }
  return true
}

const ASF_GUID = [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]

/** Content sniff over a sample of the file's head bytes (FR-04.9). */
export function sniffContainer(bytes: Uint8Array): string {
  if (asciiAt(bytes, 4, 'ftyp')) return 'mp4'
  if (asciiAt(bytes, 0, 'OggS')) return 'ogg'
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WAVE')) return 'wav'
  if (asciiAt(bytes, 0, 'FORM') && (asciiAt(bytes, 8, 'AIFF') || asciiAt(bytes, 8, 'AIFC'))) return 'aiff'
  if (asciiAt(bytes, 0, 'fLaC')) return 'flac'
  if (bytesAt(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'matroska'
  if (bytesAt(bytes, 0, ASF_GUID)) return 'asf'
  if (asciiAt(bytes, 0, 'caff')) return 'caf'
  if (asciiAt(bytes, 0, '#!AMR')) return 'amr'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return 'aac'
  if (asciiAt(bytes, 0, 'ID3')) return 'mp3'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'mp3'
  return 'unknown'
}

export interface SupportEntry {
  container: string
  codec: string
  supported: 'webcodecs' | 'ffmpeg' | 'none'
}

export interface SupportMatrix {
  probe(fileKey: string, container: string, codec: string, env: { webcodecs: boolean; ffmpeg: boolean }): SupportEntry
  entries(): SupportEntry[]
}

/** Containers the WebCodecs stack has no decoder for — ffmpeg territory
 * (FR-04.5 fallback set; mirrors the documented per-browser matrix). */
const FF_ONLY_CONTAINERS = new Set(['aiff', 'aifc', 'caf', 'wma', 'asf', 'amr', 'amr-nb', 'amr-wb', '3gp', '3gpp', '3g2'])
const FF_ONLY_CODECS = new Set(['alac', 'wmav1', 'wmav2', 'amr-nb', 'amr-wb', 'sipr', 'cook', 'atrc', 'ra-144', 'ra-288'])

function normalizeContainer(container: string, fileKey: string): string {
  const lowered = container.toLowerCase().trim()
  const bare = lowered.includes('/') ? lowered.slice(lowered.indexOf('/') + 1) : lowered
  if (bare !== '' && bare !== 'unknown' && bare !== 'none' && bare !== 'ffmpeg') {
    switch (bare) {
      case '3gpp':
      case '3g2':
        return '3gp'
      case 'wave':
      case 'x-wav':
        return 'wav'
      case 'aifc':
      case 'x-aiff':
        return 'aiff'
      case 'x-matroska':
      case 'webm':
        return 'matroska'
      case 'asx':
      case 'x-ms-wma':
        return 'asf'
      default:
        return bare
    }
  }
  // mediabunny did not parse it: fall back to the extension hint as raw
  // evidence (the file is still sniffed by content for `sniffContainer`).
  const match = /\.([a-z0-9]+)(?:\?[^/]*)?$/i.exec(fileKey)
  return match?.[1]?.toLowerCase() ?? 'unknown'
}

function normalizeCodec(codec: string): string {
  const lowered = codec.toLowerCase().trim()
  const bare = lowered.includes('/') ? lowered.slice(lowered.indexOf('/') + 1) : lowered
  if (bare.startsWith('mp3')) return 'mp3'
  if (bare.startsWith('amr')) return bare.includes('wb') ? 'amr-wb' : 'amr-nb'
  if (bare.startsWith('wma')) return bare.startsWith('wmav') ? bare : 'wmav2'
  if (bare === 'pcm_s16be' || bare === 'pcm-s16be') return 'pcm_s16be'
  return bare
}

/** Per-session support matrix (FR-04.6): the decision is computed once per
 * `fileKey` and cached in memory; `entries()` replays insertion order. */
export function createSupportMatrix(): SupportMatrix {
  const cache = new Map<string, SupportEntry>()
  return {
    probe(fileKey, container, codec, env) {
      const cached = cache.get(fileKey)
      if (cached) return cached
      const normalizedContainer = normalizeContainer(container, fileKey)
      const normalizedCodec = normalizeCodec(codec)
      const ffmpegOnly = FF_ONLY_CONTAINERS.has(normalizedContainer) || FF_ONLY_CODECS.has(normalizedCodec)
      let supported: SupportEntry['supported']
      if (ffmpegOnly) supported = env.ffmpeg ? 'ffmpeg' : 'none'
      else if (env.webcodecs) supported = 'webcodecs'
      else if (env.ffmpeg) supported = 'ffmpeg'
      else supported = 'none'
      const entry: SupportEntry = { container: normalizedContainer, codec: normalizedCodec, supported }
      cache.set(fileKey, entry)
      return entry
    },
    entries() {
      return [...cache.values()]
    },
  }
}
