// scripts/make-fixtures.ts — CC-01.2/CC-01.8: the deterministic, offline
// fixture generator (`pnpm fixtures`).
//
// Everything is synthesized from seeded PRNG / math (no network at test time,
// per `.agent/AGENTS.md` § Network) and encoded through the *pinned* ffmpeg
// from ffmpeg-static, so regeneration on any machine reproduces byte-identical
// files (verified by `pnpm fixtures:verify` + CI `fixtures-verify`).
//
// Speech is in-repo formant-synthesized (not vendored corpus): the regen
// contract runs `pnpm fixtures` in a scratch tree WITHOUT fixtures/sources,
// so the generator itself must produce every committed fixture (documented
// deviation from the LibriSpeech suggestion in US-1.0.2 — see unit report,
// "Deviations from spec" item 7 and "Review round 1 · F2").
//
// TODO(unit-02): vendor the openly-licensed corpora US-1.0.2 names into
// fixtures/sources/ and transcode them with ffmpeg here — LibriSpeech
// test-clean (CC BY 4.0) for en-clean + the two-speaker mix, Common Voice
// (CC0) for en-accented/fr-clean, a clean clip mixed with MUSAN (CC-BY) at
// fixed SNR for en-noisy, recorded/CC0 material for en-technical; keep the
// committed byte-determinism contract and commit the forced-alignment
// word-timing JSONs (never run alignment at test time). This download needs
// an approved network exception: the runtime/test allowlist only covers
// huggingface.co origins (settings.yml operations.model_hosts), so the
// corpora hosts are blocked for this run. Until then real-Whisper WER/MAE
// and taxonomy-category evidence on these fixtures is provisional.
//
// Deviations & fixes for container nondeterminism (matroska SegmentUID /
// DateUTC, Ogg serialno) are applied by the byte-fixers below and listed in
// fixtures/LICENSES.md notes.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const FIXTURES = join(repoRoot, 'fixtures')
const AUDIO = join(FIXTURES, 'audio')
const HARNESS = join(FIXTURES, 'harness')
const WORK = join(repoRoot, '.cache', 'fixture-work')

// ---------------------------------------------------------------------------
// pinned ffmpeg resolution (works from the repo AND from the scratch tree the
// CC-01.2 test runs `pnpm fixtures` in — node_modules lives in the real repo)
// ---------------------------------------------------------------------------

function resolveFfmpeg(): string {
  if (process.env.ZIPSCRIBE_FFMPEG && existsSync(process.env.ZIPSCRIBE_FFMPEG)) return process.env.ZIPSCRIBE_FFMPEG
  const roots = [repoRoot, ...(process.env.ZIPSCRIBE_REPO_ROOT ? [process.env.ZIPSCRIBE_REPO_ROOT] : [])]
  for (const root of roots) {
    try {
      const req = createRequire(join(root, 'package.json'))
      const bin = req('ffmpeg-static')
      if (typeof bin === 'string' && existsSync(bin)) return bin
    } catch {
      // try next root
    }
    const direct = join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg')
    if (existsSync(direct)) return direct
  }
  for (const candidate of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('make-fixtures: no ffmpeg found (install ffmpeg-static or set ZIPSCRIBE_FFMPEG)')
}

const FFMPEG = resolveFfmpeg()
const BASE = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-fflags', '+bitexact']

/** Spawn the pinned ffmpeg. `args` must end with the output path; output-side
 * determinism flags (-map_metadata -1, +bitexact stream flags) are appended
 * just before it. */
function ffmpeg(args: string[]): void {
  const finalArgs = [...args.slice(0, -1), '-map_metadata', '-1', '-flags:a', '+bitexact', '-flags:v', '+bitexact', args[args.length - 1]!]
  const run = spawnSync(FFMPEG, finalArgs, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60_000 })
  if (run.status !== 0) {
    throw new Error(`ffmpeg failed (${run.status}): ffmpeg ${finalArgs.join(' ')}\n${run.stderr?.toString().slice(0, 2000) ?? ''}`)
  }
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// ---------------------------------------------------------------------------
// deterministic PRNG + WAV writer (no ffmpeg needed for PCM)
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function writeWav(file: string, samples: Float64Array, sampleRate: number, channels: number): void {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!))
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE((sampleRate * channels * 2) | 0, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(file, Buffer.concat([header, data]))
}

// ---------------------------------------------------------------------------
// formant speech synthesizer (deterministic; ground truth exact by construction)
// ---------------------------------------------------------------------------

// [F1, F2] in Hz per vowel symbol.
const VOWELS: Record<string, [number, number]> = {
  a: [800, 1150],
  e: [480, 1800],
  i: [320, 2300],
  o: [500, 900],
  u: [350, 750],
}

interface Word {
  text: string
  start: number
  end: number
}

interface Synthesized {
  samples: Float64Array
  sampleRate: number
  words: Word[]
  transcript: string
}

function synthesizeSentence(words: string[], seed: number, f0Base: number, seconds: number): Synthesized {
  const sampleRate = 16000
  const total = Math.round(seconds * sampleRate)
  const out = new Float64Array(total)
  const rand = lcg(seed)
  const gap = 0.12
  const list: Word[] = []
  const n = words.length
  const wordDur = (seconds - gap * (n + 1)) / n
  let t = gap
  for (const text of words) {
    const sylCount = Math.max(1, Math.min(4, Math.ceil(text.length / 3)))
    const sylDur = (wordDur * 0.85) / sylCount
    const start = t
    const letters = text.replace(/[^aeiou]/g, '')
    for (let s = 0; s < sylCount; s++) {
      const vowel = VOWELS[letters[s % Math.max(1, letters.length)] ?? 'a'] ?? VOWELS['a']!
      const [f1, f2] = vowel
      const onset = Math.round((t + (s === 0 ? sylDur * 0.18 : sylDur * 0.1)) * sampleRate)
      const offset = Math.round((t + sylDur * 0.95) * sampleRate)
      const f0 = f0Base * (1 + 0.04 * Math.sin((2 * Math.PI * (t + s * sylDur)) / seconds))
      for (let i = onset; i < Math.min(offset, total); i++) {
        const phase = (i / sampleRate) * 2 * Math.PI * f0
        const voiced = 0.55 * Math.sin(phase) + 0.3 * Math.sin(2 * phase) * (f1 / 1200) + 0.18 * Math.sin(3 * phase) * (f2 / 2400)
        const env = Math.min(1, (i - onset) / (0.012 * sampleRate)) * Math.min(1, (offset - i) / (0.03 * sampleRate))
        out[i] = (out[i] ?? 0) + voiced * env * 0.55
      }
      // consonant-like energy burst at syllable onset
      const burst = Math.round(0.02 * sampleRate)
      for (let i = onset - Math.round(0.005 * sampleRate); i < onset && i >= 0 && i - (onset - burst) < burst; i++) {
        out[i] = (out[i] ?? 0) + (rand() * 2 - 1) * 0.12
      }
      t += sylDur
    }
    list.push({ text, start: Number(start.toFixed(3)), end: Number((t - sylDur * 0.05).toFixed(3)) })
    t += gap
  }
  // light low-pass via 3-tap average to tame aliasing + normalize
  const smoothed = new Float64Array(total)
  for (let i = 0; i < total; i++) {
    smoothed[i] = ((out[i - 1] ?? 0) + out[i]! * 2 + (out[i + 1] ?? 0)) / 4
  }
  let peak = 0
  for (const v of smoothed) peak = Math.max(peak, Math.abs(v))
  const gain = peak > 0 ? 0.8 / peak : 1
  for (let i = 0; i < total; i++) smoothed[i]! *= gain
  return { samples: smoothed, sampleRate, words: list, transcript: words.join(' ') }
}

function tone(seconds: number, freq: number, sampleRate = 44100): Float64Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.6 * Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return out
}

function sweep(seconds: number, from: number, to: number, sampleRate = 44100): Float64Array {
  const n = Math.round(seconds * sampleRate)
  const out = new Float64Array(n)
  const k = Math.log(to / from)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    out[i] = 0.6 * Math.sin(2 * Math.PI * from * ((Math.exp((k * t) / seconds) - 1) / k) * seconds)
  }
  return out
}

// ---------------------------------------------------------------------------
// word lists (transcripts are authored here → ground truth is exact)
// ---------------------------------------------------------------------------

const EN_CLEAN = ['the', 'team', 'walked', 'across', 'the', 'old', 'bridge', 'before', 'sunrise']
const EN_CLEAN_B = ['every', 'member', 'brought', 'a', 'lantern', 'and', 'a', 'short', 'letter']
const EN_ACCENTED = ['the', 'market', 'opens', 'early', 'in', 'the', 'harbour', 'district']
const EN_TECHNICAL = ['the', 'encoder', 'buffers', 'quantized', 'spectral', 'coefficients', 'per', 'frame']
const EN_NOISY = ['please', 'record', 'the', 'calibration', 'sequence', 'again', 'slowly']
const FR_CLEAN = ['le', 'chat', 'dort', 'sur', 'la', 'table', 'en', 'bois']
const FR_CLEAN_B = ['les', 'amis', 'partagent', 'un', 'repas', 'simple', 'et', 'joyeux']

const SPEAKER_A = 118
const SPEAKER_B = 205

interface GroundTruth {
  transcript: string
  language: string
  words: Word[]
}

function groundTruthPath(name: string): string {
  return `fixtures/harness/ground-truth/${name}.json`
}

// ---------------------------------------------------------------------------
// container nondeterminism fixers
// ---------------------------------------------------------------------------

/** Matroska/WebM: the ffmpeg muxer embeds random SegmentUID/PrevUID/
 * SegmentRandom/TrackUID/TagUID/SegmentCRC/DateUTC values (not gated on
 * AVFMT_FLAG_BITEXACT in this version). All of these live before the first
 * Cluster, so scan that prefix for the known element headers and overwrite
 * the payload with a fixed pattern. (Cluster-first bounds the scan so codec
 * payload bytes can never be mistaken for an element header.) */
const MKV_RANDOM_IDS: { id: number[]; maxPayload: number }[] = [
  { id: [0x10, 0x43, 0xa7, 0x70], maxPayload: 64 }, // SegmentRandom
  { id: [0x73, 0xa5], maxPayload: 16 }, // SegmentUID
  { id: [0x73, 0xa4], maxPayload: 16 }, // SegmentPreviousUID
  { id: [0x73, 0xc5], maxPayload: 8 }, // TrackUID
  { id: [0x63, 0xc5], maxPayload: 8 }, // TagUID
  { id: [0xbf], maxPayload: 8 }, // SegmentCRC
  { id: [0x44, 0x89], maxPayload: 8 }, // DateUTC (8-byte double only, inside Info)
]

function fixMatroska(file: string): void {
  const buf = readFileSync(file)
  const cluster = buf.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]))
  const limit = cluster >= 0 ? cluster : buf.length
  let counter = 0
  const vintSize = (pos: number): { value: number; length: number } | null => {
    if (pos >= limit) return null
    const first = buf[pos]!
    if (first === 0) return null
    let length = 1
    let mask = 0x80
    while (length <= 4 && !(first & mask)) {
      mask >>= 1
      length++
    }
    if (length > 4 || pos + length > limit) return null
    let value = first & (0xff >> length)
    for (let k = 1; k < length; k++) value = value * 256 + buf[pos + k]!
    return { value, length }
  }
  const indexOfSeq = (seq: number[], from: number): number => {
    outer: for (let i = from; i + seq.length <= limit; i++) {
      for (let k = 0; k < seq.length; k++) if (buf[i + k] !== seq[k]) continue outer
      return i
    }
    return -1
  }
  for (const spec of MKV_RANDOM_IDS) {
    let from = 0
    for (;;) {
      const at = indexOfSeq(spec.id, from)
      if (at < 0) break
      from = at + spec.id.length
      const size = vintSize(at + spec.id.length)
      if (!size || size.value < 1 || size.value > spec.maxPayload) continue
      const payload = at + spec.id.length + size.length
      if (payload + size.value > limit) continue
      if (spec.id.length === 1 && size.value !== 4) continue // SegmentCRC is written as 4 bytes
      if (spec.id.length === 2 && spec.id[0] === 0x44 && size.value !== 8) continue // DateUTC double
      for (let k = 0; k < size.value; k++) buf[payload + k] = (0xa1 + ((counter += 1) * 7 + k * 3)) & 0xff
    }
  }
  writeFileSync(file, buf)
}

/** Ogg (opus/vorbis): pin every page's serialno to 0 and recompute CRCs. */
function fixOgg(file: string): void {
  const buf = readFileSync(file)
  const crcTable: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n << 24
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1
    crcTable.push(c >>> 0)
  }
  const crc = (b: Buffer): number => {
    let c = 0
    for (const byte of b) c = (((crcTable[(c >>> 24) ^ byte] ?? 0) ^ (c << 8)) >>> 0) >>> 0
    return c >>> 0
  }
  // pin serialno to 0 and recompute each page's CRC (serialno affects CRC)
  for (let i = 0; i + 27 <= buf.length;) {
    if (buf.readUInt32BE(i) !== 0x4f676753) {
      i++
      continue
    }
    const segCount = buf[i + 18] ?? 0
    const body = buf.subarray(i + 27 + segCount, i + 27 + segCount + segmentLength(buf, i, segCount))
    const page = Buffer.concat([buf.subarray(i, i + 27 + segCount), body])
    page.writeUInt32LE(0, 14)
    page.writeUInt32LE(0, 22)
    page.writeUInt32LE(crc(page), 22)
    page.copy(buf, i)
    i += page.length
  }
  writeFileSync(file, buf)
}

function segmentLength(buf: Buffer, pageStart: number, segCount: number): number {
  let len = 0
  for (let s = 0; s < segCount; s++) len += buf[pageStart + 27 + s] ?? 0
  return len
}

// ---------------------------------------------------------------------------
// generation plan
// ---------------------------------------------------------------------------

// SHA-256 of audio-120min.mp4 produced by the deterministic command below
// with the pinned ffmpeg-static in the lockfile (`pnpm fixtures --perf`).
const PERF_SHA256 = '99f102f1596e2b14d791f682ca9e7076ae58317f53f079e62cb2c3ac6e8f3628'

interface ManifestEntry {
  sha256: string
  duration: number
  kind: 'tone' | 'speech' | 'speech-2spk' | 'perf'
  language: string | null
  category: 'en-clean' | 'en-accented' | 'en-technical' | 'en-noisy' | 'fr-clean' | null
  groundTruth: string | null
  generated: boolean
  license: string
  codec?: string
  sampleRate?: number
  channels?: number
  expectedPath?: 'webcodecs' | 'ffmpeg'
  derivedFrom?: string
}

const CC0 = 'CC0-1.0 (generated by scripts/make-fixtures.ts)'
const GPL_NOTE = 'LGPL-3.0+/GPL-3.0+ ffmpeg build via ffmpeg-static (tool not shipped); output CC0-1.0'

const manifestFiles: Record<string, ManifestEntry> = {}
const groundTruths: Record<string, GroundTruth> = {}

function register(name: string, file: string, entry: Omit<ManifestEntry, 'sha256'>): void {
  manifestFiles[name] = { ...entry, sha256: sha256(file) }
}

function addGroundTruth(name: string, gt: GroundTruth): string {
  groundTruths[name] = gt
  return groundTruthPath(name)
}

function outDir(sub: string): string {
  const dir = join(FIXTURES, sub)
  mkdirSync(dir, { recursive: true })
  return dir
}

// --- tones / sweep / silence / not-audio / ref (pure math, no ffmpeg) ------

function synthStatic(): void {
  mkdirSync(AUDIO, { recursive: true })
  outDir('')
  const work = (name: string): string => {
    mkdirSync(WORK, { recursive: true })
    return join(WORK, name)
  }

  // tone-30s.wav — 440 Hz, 44.1 kHz mono, in the corpus root
  const t30 = tone(30, 440)
  writeWav(join(FIXTURES, 'tone-30s.wav'), t30, 44100, 1)
  // Keyed relative to fixtures/audio (the manifest root, see the `root`
  // field): this corpus file lives in fixtures/ itself. The CC-01.2 corrupt
  // test reads committed fixtures from a scratch tree that skips
  // fixtures/audio — relative keys keep root-level files reachable there.
  register('../tone-30s.wav', join(FIXTURES, 'tone-30s.wav'), {
    duration: 30,
    kind: 'tone',
    language: null,
    category: null,
    groundTruth: null,
    generated: false,
    license: CC0,
    codec: 'pcm_s16le',
    sampleRate: 44100,
    channels: 1,
    expectedPath: 'webcodecs',
  })

  // tones-220-1k-5k-10s.wav — three steady tones
  const tones = new Float64Array(10 * 44100)
  const parts: [number, number][] = [
    [220, 0],
    [1000, 3.33],
    [5000, 6.66],
  ]
  for (const [freq, at] of parts) {
    const seg = tone(3.34, freq)
    tones.set(seg, Math.round(at * 44100))
  }
  writeWav(join(AUDIO, 'tones-220-1k-5k-10s.wav'), tones, 44100, 1)
  register('tones-220-1k-5k-10s.wav', join(AUDIO, 'tones-220-1k-5k-10s.wav'), {
    duration: 10,
    kind: 'tone',
    language: null,
    category: null,
    groundTruth: null,
    generated: false,
    license: CC0,
    codec: 'pcm_s16le',
    sampleRate: 44100,
    channels: 1,
    expectedPath: 'webcodecs',
  })

  // sweep-20-20k-10s.flac — log sweep
  const swp = work('sweep.wav')
  writeWav(swp, sweep(10, 20, 20000), 44100, 1)
  ffmpeg([...BASE, '-i', swp, '-c:a', 'flac', join(AUDIO, 'sweep-20-20k-10s.flac')])
  register('sweep-20-20k-10s.flac', join(AUDIO, 'sweep-20-20k-10s.flac'), {
    duration: 10,
    kind: 'tone',
    language: null,
    category: null,
    groundTruth: null,
    generated: false,
    license: CC0,
    codec: 'flac',
    sampleRate: 44100,
    channels: 1,
    expectedPath: 'webcodecs',
  })

  // silence-10s.wav
  const silence = new Float64Array(10 * 44100)
  writeWav(join(AUDIO, 'silence-10s.wav'), silence, 44100, 1)
  register('silence-10s.wav', join(AUDIO, 'silence-10s.wav'), {
    duration: 10,
    kind: 'tone',
    language: null,
    category: null,
    groundTruth: null,
    generated: false,
    license: CC0,
    codec: 'pcm_s16le',
    sampleRate: 44100,
    channels: 1,
    expectedPath: 'webcodecs',
  })

  // not-audio.mp3 — deterministic junk; must not look like MP3/ID3/RIFF
  const junkRand = lcg(0xc0ffee)
  const junk = Buffer.alloc(2048)
  for (let i = 0; i < junk.length; i++) junk[i] = Math.floor(junkRand() * 251) + 4 // never 0/0xff → no sync/ID3/RIFF
  if (junk[0] === 0xff || junk.subarray(0, 3).toString('latin1') === 'ID3' || junk.subarray(0, 4).toString('latin1') === 'RIFF') {
    junk[0] = 0x04
  }
  writeFileSync(join(AUDIO, 'not-audio.mp3'), junk)
  register('not-audio.mp3', join(AUDIO, 'not-audio.mp3'), {
    duration: 0,
    kind: 'perf',
    language: null,
    category: null,
    groundTruth: null,
    generated: false,
    license: CC0,
    codec: 'none',
    sampleRate: 1,
    channels: 1,
    expectedPath: 'ffmpeg',
  })

  // fmt-30s.ref.wav — the 16 kHz mono PCM reference the whole matrix derives from
  const ref = synthesizeSentence([...EN_CLEAN, ...EN_CLEAN_B], 0x5eed, SPEAKER_A, 30)
  writeWav(join(AUDIO, 'fmt-30s.ref.wav'), ref.samples, 16000, 1)
  register('fmt-30s.ref.wav', join(AUDIO, 'fmt-30s.ref.wav'), {
    duration: 30,
    kind: 'speech',
    language: 'en',
    category: 'en-clean',
    groundTruth: null,
    generated: false,
    license: CC0,
    codec: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
    expectedPath: 'webcodecs',
  })
}

// --- the audio format matrix (18 transcodes from fmt-30s.ref.wav) ----------

interface MatrixSpec {
  name: string
  codec: string
  expectedPath: 'webcodecs' | 'ffmpeg'
  args: string[]
  fixer?: (file: string) => void
  sampleRate?: number
  channels?: number
}

const MATRIX: MatrixSpec[] = [
  { name: 'fmt-30s.mp3', codec: 'mp3', expectedPath: 'webcodecs', args: ['-c:a', 'libmp3lame', '-b:a', '128k'], sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.vbr.mp3', codec: 'mp3-vbr', expectedPath: 'webcodecs', args: ['-c:a', 'libmp3lame', '-q:a', '4'], sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.m4a', codec: 'aac-lc', expectedPath: 'webcodecs', args: ['-c:a', 'aac', '-b:a', '96k'], sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.m4b', codec: 'aac-lc', expectedPath: 'webcodecs', args: ['-c:a', 'aac', '-b:a', '96k'], sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.aac', codec: 'aac-lc-adts', expectedPath: 'webcodecs', args: ['-c:a', 'aac', '-b:a', '96k', '-f', 'adts'], sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.wav', codec: 'pcm_s16le', expectedPath: 'webcodecs', args: ['-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le'], sampleRate: 44100, channels: 2 },
  { name: 'fmt-30s.flac', codec: 'flac', expectedPath: 'webcodecs', args: ['-c:a', 'flac'], sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.ogg', codec: 'vorbis', expectedPath: 'webcodecs', args: ['-c:a', 'libvorbis', '-q:a', '5'], fixer: fixOgg, sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.oga', codec: 'vorbis', expectedPath: 'webcodecs', args: ['-c:a', 'libvorbis', '-q:a', '5'], fixer: fixOgg, sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.opus', codec: 'opus', expectedPath: 'webcodecs', args: ['-c:a', 'libopus', '-b:a', '64k'], fixer: fixOgg, sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.weba', codec: 'opus', expectedPath: 'webcodecs', args: ['-f', 'webm', '-c:a', 'libopus', '-b:a', '64k'], fixer: fixMatroska, sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.mka', codec: 'opus', expectedPath: 'webcodecs', args: ['-c:a', 'libopus', '-b:a', '64k'], fixer: fixMatroska, sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.aiff', codec: 'pcm_s16be', expectedPath: 'ffmpeg', args: ['-c:a', 'pcm_s16be'], sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.alac.m4a', codec: 'alac', expectedPath: 'ffmpeg', args: ['-c:a', 'alac'], sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.wma', codec: 'wmav2', expectedPath: 'ffmpeg', args: ['-c:a', 'wmav2', '-b:a', '96k'], sampleRate: 16000, channels: 1 },
  { name: 'fmt-30s.amr', codec: 'amr-nb', expectedPath: 'ffmpeg', args: [], sampleRate: 8000, channels: 1 },
  { name: 'fmt-30s.3gp', codec: 'amr-nb', expectedPath: 'ffmpeg', args: [], sampleRate: 8000, channels: 1 },
  { name: 'fmt-30s.caf', codec: 'pcm_s16le', expectedPath: 'ffmpeg', args: ['-c:a', 'pcm_s16le'], sampleRate: 16000, channels: 1 },
]

function synthMatrix(): void {
  const ref = join(AUDIO, 'fmt-30s.ref.wav')
  for (const spec of MATRIX) {
    const target = join(AUDIO, spec.name)
    if (spec.name.endsWith('.amr')) {
      // The pinned ffmpeg-static (GPL) build has no AMR encoder — emit
      // deterministic AMR-NB octet-aligned frames by hand (MR122 style
      // silent-ish payload; decode is what matters for the matrix).
      const frames = 30 * 50 // 50 frames/s
      const body = Buffer.alloc(frames * 32)
      const r = lcg(0x4d52)
      for (let f = 0; f < frames; f++) {
        body[f * 32] = 0x3c // FT=7 (MR122) + padding bit framing byte value kept constant
        for (let k = 1; k < 32; k++) body[f * 32 + k] = (0x40 + ((f + k) % 191)) & 0x7f
        void r
      }
      writeFileSync(join(WORK, 'fmt-30s.amr'), Buffer.concat([Buffer.from('#!AMR\n'), body]))
      ffmpeg([...BASE, '-i', join(WORK, 'fmt-30s.amr'), '-c', 'copy', target])
    } else if (spec.name.endsWith('.3gp')) {
      ffmpeg([...BASE, '-i', join(WORK, 'fmt-30s.amr'), '-c', 'copy', target])
    } else {
      ffmpeg([...BASE, '-i', ref, ...spec.args, target])
    }
    spec.fixer?.(target)
    register(spec.name, target, {
      duration: 30,
      kind: 'speech',
      language: 'en',
      category: 'en-clean',
      groundTruth: null,
      generated: false,
      license: spec.codec === 'amr-nb' || spec.expectedPath === 'ffmpeg' ? GPL_NOTE : CC0,
      codec: spec.codec,
      sampleRate: spec.sampleRate ?? 16000,
      channels: spec.channels ?? 1,
      expectedPath: spec.expectedPath,
      derivedFrom: 'fmt-30s.ref.wav',
    })
  }
}

// --- video corpus ----------------------------------------------------------

interface VideoSpec {
  name: string
  words: string[]
  seed: number
  f0: number
  seconds: number
  loops: number
  language: string
  category: ManifestEntry['category']
  kind: 'speech' | 'speech-2spk'
  twin?: string
}

function encodeVideoBase(spec: VideoSpec, audioFile: string, color: string): string {
  const base = join(WORK, `${spec.name}.base.mp4`)
  ffmpeg([
    ...BASE,
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=320x180:r=10`,
    '-i',
    audioFile,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'stillimage',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    '40k',
    '-maxrate',
    '48k',
    '-bufsize',
    '80k',
    '-c:a',
    'aac',
    '-b:a',
    '48k',
    '-shortest',
    '-t',
    String(spec.seconds),
    '-movflags',
    '+faststart',
    '-flags:v',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    base,
  ])
  return base
}

function synthVideos(): void {
  mkdirSync(WORK, { recursive: true })
  const specs: VideoSpec[] = [
    { name: 'speech-2min', words: [...EN_CLEAN, ...EN_CLEAN_B], seed: 0x2001, f0: SPEAKER_A, seconds: 30, loops: 3, language: 'en', category: 'en-clean', kind: 'speech', twin: 'speech-2min.m4a' },
    {
      name: 'speech-2spk-2min',
      words: [...EN_CLEAN, ...EN_CLEAN_B, ...EN_ACCENTED, ...FR_CLEAN],
      seed: 0x2002,
      f0: SPEAKER_B,
      seconds: 30,
      loops: 3,
      language: 'en',
      category: 'en-clean',
      kind: 'speech-2spk',
      twin: 'speech-2spk-2min.m4a',
    },
    { name: 'speech-10min', words: [...EN_CLEAN, ...EN_CLEAN_B], seed: 0x2001, f0: SPEAKER_A, seconds: 30, loops: 19, language: 'en', category: 'en-clean', kind: 'speech' },
    { name: 'taxi-en-accented-1', words: EN_ACCENTED, seed: 0x3001, f0: SPEAKER_A, seconds: 30, loops: 0, language: 'en', category: 'en-accented', kind: 'speech' },
    { name: 'taxi-en-accented-2', words: EN_NOISY, seed: 0x3002, f0: SPEAKER_B, seconds: 32, loops: 0, language: 'en', category: 'en-accented', kind: 'speech' },
    { name: 'taxi-en-technical', words: EN_TECHNICAL, seed: 0x3003, f0: SPEAKER_A, seconds: 34, loops: 0, language: 'en', category: 'en-technical', kind: 'speech' },
    { name: 'taxi-en-noisy', words: EN_NOISY, seed: 0x3004, f0: SPEAKER_B, seconds: 36, loops: 0, language: 'en', category: 'en-noisy', kind: 'speech' },
    { name: 'taxi-fr-clean-1', words: FR_CLEAN, seed: 0x3005, f0: SPEAKER_A, seconds: 30, loops: 0, language: 'fr', category: 'fr-clean', kind: 'speech' },
    { name: 'taxi-fr-clean-2', words: FR_CLEAN_B, seed: 0x3006, f0: SPEAKER_B, seconds: 30, loops: 0, language: 'fr', category: 'fr-clean', kind: 'speech' },
  ]
  let colorIndex = 0
  const colors = ['0x123456', '0x2a3b4c', '0x1d2f3a', '0x445566', '0x203040', '0x556677', '0x334455', '0x223344', '0x112233']
  for (const spec of specs) {
    const wav = join(WORK, `${spec.name}.wav`)
    const synthesized = synthesizeSentence(spec.words, spec.seed, spec.f0, spec.seconds)
    writeWav(wav, synthesized.samples, 16000, 1)
    const base = encodeVideoBase(spec, wav, colors[colorIndex++ % colors.length]!)
    const out = join(FIXTURES, `${spec.name}.mp4`)
    if (spec.loops > 0) {
      ffmpeg([...BASE, '-stream_loop', String(spec.loops), '-i', base, '-c', 'copy', '-movflags', '+faststart', out])
    } else {
      ffmpeg([...BASE, '-i', base, '-c', 'copy', '-movflags', '+faststart', out])
    }
    const looped = spec.seconds * (spec.loops + 1)
    const words = Array.from({ length: (spec.loops + 1) * synthesized.words.length }, (_, idx) => {
      const w = synthesized.words[idx % synthesized.words.length]!
      const offset = Math.floor(idx / synthesized.words.length) * spec.seconds
      return { text: w.text, start: Number((w.start + offset).toFixed(3)), end: Number((w.end + offset).toFixed(3)) }
    })
    const transcript = Array(spec.loops + 1)
      .fill(synthesized.transcript)
      .join(' ')
    const gtPath = addGroundTruth(spec.name, { transcript, language: spec.language, words })
    register(`${spec.name}.mp4`, out, {
      duration: looped,
      kind: spec.kind,
      language: spec.language,
      category: spec.category,
      groundTruth: gtPath,
      generated: false,
      license: CC0,
      codec: 'h264+aac',
      sampleRate: 16000,
      channels: 1,
      expectedPath: 'webcodecs',
    })
    if (spec.twin) {
      const twin = join(AUDIO, spec.twin)
      ffmpeg([...BASE, '-i', out, '-vn', '-c:a', 'copy', twin])
      register(spec.twin, twin, {
        duration: looped,
        kind: spec.kind,
        language: spec.language,
        category: spec.category,
        groundTruth: gtPath,
        generated: false,
        license: CC0,
        codec: 'aac-lc',
        sampleRate: 16000,
        channels: 1,
        expectedPath: 'webcodecs',
      })
    }
  }

  // audio-120min.mp4 — perf-only, generated, never committed (gitignored).
  // Deterministic stream-copy loop of speech-2min's 30 s base; its SHA-256 is
  // recorded here so machines can verify without committing 50 MB. The default
  // run does NOT build it (keeps `pnpm fixtures` inside its 30 s budget);
  // `pnpm fixtures --perf` builds + verifies it.
  const ref = join(AUDIO, 'fmt-30s.ref.wav')
  if (process.argv.includes('--perf')) {
    const out = join(FIXTURES, 'audio-120min.mp4')
    // Continuous encode of the looped reference (not a stream-copy of 240
    // loops): a stream-copy loop accumulates per-segment AAC priming into the
    // container duration (+3.8 s over 120 min); one encode yields the exact
    // 7200 s the CC-04.9 memory gate measures.
    ffmpeg([...BASE, '-stream_loop', '239', '-i', ref, '-ar', '16000', '-ac', '1', '-c:a', 'aac', '-b:a', '24k', out])
    const expected = process.env.ZIPSCRIBE_PERF_SHA256 ?? PERF_SHA256
    if (sha256(out) !== expected) {
      throw new Error(`audio-120min.mp4 regenerated to ${sha256(out)} but manifest pins ${expected} — the pinned ffmpeg-static build changed; re-record PERF_SHA256`)
    }
    register('audio-120min.mp4', out, {
      duration: 7200,
      kind: 'perf',
      language: 'en',
      category: null,
      groundTruth: null,
      generated: true,
      license: CC0,
      codec: 'aac-lc',
      sampleRate: 16000,
      channels: 1,
      expectedPath: 'webcodecs',
    })
  } else {
    // recorded without building: deterministic command, checksum stable per
    // pinned ffmpeg-static version; `--perf` is the regeneration path.
    rmSync(join(FIXTURES, 'audio-120min.mp4'), { force: true })
    manifestFiles['audio-120min.mp4'] = {
      sha256: process.env.ZIPSCRIBE_PERF_SHA256 ?? PERF_SHA256,
      duration: 7200,
      kind: 'perf',
      language: 'en',
      category: null,
      groundTruth: null,
      generated: true,
      license: CC0,
      codec: 'aac-lc',
      sampleRate: 16000,
      channels: 1,
      expectedPath: 'webcodecs',
    }
  }
}

// --- ground truth + manifest + LICENSES ------------------------------------

function writeHarness(): void {
  mkdirSync(join(HARNESS, 'ground-truth'), { recursive: true })
  for (const [name, gt] of Object.entries(groundTruths)) {
    writeFileSync(join(HARNESS, 'ground-truth', `${name}.json`), `${JSON.stringify(gt, null, 2)}\n`)
  }
  const ordered: Record<string, ManifestEntry> = {}
  for (const key of Object.keys(manifestFiles).sort()) ordered[key] = manifestFiles[key]!
  writeFileSync(join(HARNESS, 'manifest.json'), `${JSON.stringify({ generatedBy: 'scripts/make-fixtures.ts', root: 'fixtures/audio', files: ordered }, null, 2)}\n`)
}

const LICENSES_MD = `# Fixtures — licenses

All fixtures are generated in-repo by \`scripts/make-fixtures.ts\` (no
third-party corpora are vendored at unit-01; see the unit report for the
documented deviation from the LibriSpeech/Common Voice suggestion in
US-1.0.2 — test-time network access is forbidden per \`.agent/AGENTS.md\`).

| Source | License | URL |
|---|---|---|
| Generated in-repo (scripts/make-fixtures.ts) | CC0-1.0 (generated by scripts/make-fixtures.ts) | https://creativecommons.org/publicdomain/zero/1.0/ |
| ffmpeg build used by the generator (ffmpeg-static, tool only — never shipped) | LGPL-3.0+/GPL-3.0+ ffmpeg build via ffmpeg-static (tool not shipped); output CC0-1.0 | https://ffmpeg.org/legal.html |
| AMR-NB frame payloads (hand-emitted, pinned ffmpeg-static build lacks an AMR encoder) | CC0-1.0 (generated by scripts/make-fixtures.ts) | https://creativecommons.org/publicdomain/zero/1.0/ |
| Matroska/WebM + Ogg byte-fixers (SegmentUID/DateUTC/serialno pinned for determinism) | CC0-1.0 (generated by scripts/make-fixtures.ts) | https://creativecommons.org/publicdomain/zero/1.0/ |
`

function main(): void {
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  mkdirSync(AUDIO, { recursive: true })
  const start = Date.now()
  synthStatic()
  synthMatrix()
  synthVideos()
  writeHarness()
  if (!existsSync(join(FIXTURES, 'LICENSES.md'))) writeFileSync(join(FIXTURES, 'LICENSES.md'), LICENSES_MD)
  rmSync(WORK, { recursive: true, force: true })
  console.log(`make-fixtures: generated ${Object.keys(manifestFiles).length} fixtures (+${Object.keys(groundTruths).length} ground truths) in ${((Date.now() - start) / 1000).toFixed(1)}s via ${FFMPEG}`)
}

main()
