// scripts/fetch-vendor-fixtures.ts — vendors the one real-world captioned
// fixture: a ~2-minute clip of the Senate of Canada webcast (SenParlVu
// meeting 15671, Senate Sitting No. 101, 2026-11-05 — the Acting Leader of
// the Opposition's Veterans' Week statement) together with its
// human-authored CART closed-caption feed.
//
// This is a SETUP step with network access (like `pnpm models:fetch`);
// tests never touch the network (AGENTS.md). Run `pnpm fixtures:fetch-vendor`.
//
// Provenance: captions verified verbatim against the official Debates of the
// Senate (Hansard) for that sitting (sencanada.ca …/451/debates/101db_2026-11-05-e)
// — see fixtures/LICENSES.md for the Open Parliament Licence record.
// The ParlVu feed has CART chunk-drop artifacts (missing words such as
// "return" in "who did not return."); the ground-truth JSON repairs those
// from the Hansard (drop-repairs only — CART wording is kept where the
// edited Hansard differs). See CORRECTIONS below.
//
// Media timeline: SenParlVu's player code says mediaStartTime = actualStart −
// PreRoll (30 s), but this VOD empirically runs media time = t_rel − 3 for
// t_rel relative to the event wall-clock start (2026-11-05T13:29:12.05) —
// see EVENT.preRoll for the measurement. Captions are rebased to clip media
// time so caption t == audio-media t.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../..')
const req = createRequire(import.meta.url)

const LICENSE = 'Open Parliament Licence 1.0 (Parliament of Canada — vendored by scripts/fetch-vendor-fixtures.ts)'

const EVENT = {
  id: 15671,
  captionsUrl: 'https://senparlvu.parl.gc.ca/Harmony/en/api/PowerBrowserData/GetClosedCaption?meetingID=15671',
  streamUrl: 'https://senvuvod01.azureedge.net/pvvodsoc-en/_definst_/mp4:azrsoc02/archives/PVHD/2026/2026-11-05/15671_Senate%20sitting%20no.%20101_13-29-12_VH.mp4/playlist.m3u8?audioindex=1&wowzalanguage=eng',
  // Media↔event offset: the player code says mediaStartTime = actualStart −
  // PreRoll (30 s), but the VOD at streamUrl is offset differently — the
  // word-timing Δ between whisper-tiny native timestamps and the human CART
  // timeline measured −32.95 s (median, 183 LCS pairs, outside-engine repro
  // 2026-11-09) on a cut using preRoll=30, and −0.19 s (p10 −3.6, p90 +2.0)
  // on this cut (ss = windowStart + preRoll). So media time = t_rel − 3 for
  // this VOD and clip media t == caption t.
  preRoll: -3.0,
  windowStart: 180.0,
  windowEnd: 303.244,
}

// Feed cues whose Begin (rel. seconds) is a key here are chunk-drops in the
// as-delivered feed; the replacement text restores the dropped words from
// the official Senate Hansard for the same utterance.
const CORRECTIONS: Array<[number, string]> = [
  [200.808, 'the precious souls who did not return.'],
  [205.579, 'within our own shared Canadian story, in'],
  [228.736, 'have been forever shaped by service.'],
  [240.614, 'Like millions of people of Korean heritage across Canada and'],
  [258.098, 'is to pass these truths on to our'],
  [284.692, 'may we hold their'],
  [289.563, 'never take our freedoms for granted'],
]

interface Cue {
  Begin: string
  End: string
  Content: string
}

// Feed cues to exclude from both as-delivered and ground-truth outputs even
// when they overlap the window edge (float-safe boundary exclusion).
const SKIP_CUE_BEGINS = [303.244] // French "Nous nous Souviendrons d'eux." starts at the clip's end

const force = process.argv.includes('--force')
const blockedOnly = process.argv.includes('--blocked')

// Paragraph-block target for the blocked caption variant: merge as-delivered
// CART cues until a block accumulates this many word tokens (~20 s of speech).
// The aligner's contract (align.ts boundary guards) assumes blocks span an
// utterance; the CART feed's ~0.65 s micro-cues fragment mid-sentence and no
// model timing can land inside them (ledger 2026-11-09).
const MAX_BLOCK_WORDS = 60

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

function resolveFfmpeg(): string {
  if (process.env.ZIPSCRIBE_FFMPEG && existsSync(process.env.ZIPSCRIBE_FFMPEG)) return process.env.ZIPSCRIBE_FFMPEG
  try {
    const bin = req('ffmpeg-static')
    if (typeof bin === 'string' && existsSync(bin)) return bin
  } catch {
    /* fall through */
  }
  throw new Error('fetch-vendor-fixtures: ffmpeg-static not installed')
}

function parseTime(iso: string): number {
  // "2026-11-05T13:29:12.05" → seconds (wall); only used relative to t0.
  const m = /T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(iso)
  if (!m) throw new Error(`unexpected cue timestamp ${iso}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number('0.' + (m[4] ?? '0'))
}

function fmt(s: number, comma: boolean): string {
  const ms = Math.round(s * 1000)
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0')
  const mi = String(Math.floor(ms / 60_000) % 60).padStart(2, '0')
  const se = String(Math.floor(ms / 1000) % 60).padStart(2, '0')
  const mm = String(ms % 1000).padStart(3, '0')
  return `${h}:${mi}:${se}${comma ? ',' : '.'}${mm}`
}

function tokenCount(text: string): number {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/.test(w)).length
}

// Deterministic merge of consecutive cues into paragraph blocks: a block
// closes when adding the next cue would exceed maxWords (or at end of input).
function mergeIntoBlocks(cues: Array<{ start: number; end: number; text: string }>, maxWords: number) {
  const blocks: Array<{ start: number; end: number; text: string }> = []
  let cur: { start: number; end: number; parts: string[]; words: number } | null = null
  for (const c of cues) {
    const n = tokenCount(c.text)
    if (cur !== null && cur.words + n > maxWords) {
      blocks.push({ start: cur.start, end: cur.end, text: cur.parts.join(' ') })
      cur = null
    }
    if (cur === null) cur = { start: c.start, end: c.end, parts: [c.text], words: n }
    else {
      cur.end = c.end
      cur.parts.push(c.text)
      cur.words += n
    }
  }
  if (cur !== null) blocks.push({ start: cur.start, end: cur.end, text: cur.parts.join(' ') })
  return blocks
}

function out(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  console.log(`wrote ${path.slice(repoRoot.length + 1)}`)
}

async function main(): Promise<void> {
  const licenses = readFileSync(join(repoRoot, 'fixtures', 'LICENSES.md'), 'utf8')
  if (!licenses.includes(LICENSE)) {
    throw new Error(`fixtures/LICENSES.md has no record for "${LICENSE}"`)
  }

  // 1. Caption feed (as delivered) → fixtures/sources/
  const srcJson = join(repoRoot, 'fixtures', 'sources', `senate-${EVENT.id}.captions.json`)
  let feed: { en: Cue[]; fr: Cue[] }
  if (existsSync(srcJson) && !force) {
    feed = JSON.parse(readFileSync(srcJson, 'utf8'))
    console.log(`kept fixtures/sources/senate-${EVENT.id}.captions.json`)
  } else {
    const res = await fetch(EVENT.captionsUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    if (!res.ok) throw new Error(`caption feed fetch failed: ${res.status}`)
    feed = (await res.json()) as { en: Cue[]; fr: Cue[] }
    out(srcJson, JSON.stringify(feed) + '\n')
  }

  const first = feed.en[0]
  if (!first) throw new Error('caption feed has no English cues')
  const t0 = parseTime(first.Begin)
  const rel = (c: Cue): { start: number; end: number; text: string } => ({
    start: parseTime(c.Begin) - t0,
    end: parseTime(c.End) - t0,
    text: c.Content.trim(),
  })

  const cues = feed.en.map(rel).filter((c) => c.end > EVENT.windowStart && c.start < EVENT.windowEnd && !SKIP_CUE_BEGINS.some((b) => Math.abs(c.start - b) < 0.05))
  if (cues.length === 0) throw new Error('no caption cues in window')
  const clipped = cues.map((c) => ({
    start: Math.max(c.start, EVENT.windowStart) - EVENT.windowStart,
    end: Math.min(c.end, EVENT.windowEnd) - EVENT.windowStart,
    text: c.text,
    origStart: c.start,
  }))

  // 2. As-delivered captions (verbatim incl. chunk-drop artifacts), rebased.
  const vtt = ['WEBVTT', ''].concat(clipped.map((c) => `${fmt(c.start, false)} --> ${fmt(c.end, false)}\n${c.text}\n`)).join('\n')
  out(join(repoRoot, 'fixtures', 'captions', 'senate-veterans-2min.vtt'), vtt)
  const srt = clipped.map((c, i) => `${i + 1}\n${fmt(c.start, true)} --> ${fmt(c.end, true)}\n${c.text}\n`).join('\n')
  out(join(repoRoot, 'fixtures', 'captions', 'senate-veterans-2min.srt'), srt)

  // 2b. Blocked variant (align-mae e2e input): identical token stream and
  //     order, cues merged into ≈MAX_BLOCK_WORDS-word paragraph blocks so
  //     each block spans an utterance (see MAX_BLOCK_WORDS note).
  const blockedPath = join(repoRoot, 'fixtures', 'captions', 'senate-veterans-2min-blocked.vtt')
  const blocked = mergeIntoBlocks(clipped, MAX_BLOCK_WORDS)
  const blockedVtt = ['WEBVTT', ''].concat(blocked.map((c) => `${fmt(c.start, false)} --> ${fmt(c.end, false)}\n${c.text}\n`)).join('\n')
  out(blockedPath, blockedVtt)
  const blockedEntry: Record<string, unknown> = {
    sha256: sha256(readFileSync(blockedPath)),
    generated: false,
    license: LICENSE,
    kind: 'captions',
    language: 'en',
  }

  if (blockedOnly) {
    mergeManifest({ 'captions/senate-veterans-2min-blocked.vtt': blockedEntry })
    return
  }

  // 3. Ground truth: CART wording with Hansard drop-repairs; parenthetical
  //    stage notes ("(Prayers)") and chair speaker tags excluded; filler
  //    cues ("--", "...") excluded.
  const corrected = new Map(CORRECTIONS.map(([b, t]) => [b.toFixed(3), t]))
  const words: Array<{ text: string; start: number; end: number }> = []
  for (const c of clipped) {
    const text = corrected.get(c.origStart.toFixed(3)) ?? c.text
    if (/^\s*[(\[]/.test(text)) continue // (Prayers) etc.
    if (/^Hon\.\s|Leader of the Opposition/.test(text)) continue // chair intro tag ("Hon. <Name>")
    const bare = text.replace(/[^A-Za-z0-9'\u2019 -]/g, ' ').trim()
    if (bare === '' || /^[-.\s]*$/.test(bare)) continue // silence fillers
    const toks = bare
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => /[a-z0-9]/.test(w))
    if (toks.length === 0) continue
    const span = (c.end - c.start) / toks.length
    toks.forEach((w, i) => {
      words.push({ text: w, start: +(c.start + span * i).toFixed(3), end: +(c.start + span * (i + 1)).toFixed(3) })
    })
  }
  const gtPath = join(repoRoot, 'fixtures', 'harness', 'ground-truth', 'senate-veterans-2min.json')
  out(gtPath, JSON.stringify({ transcript: words.map((w) => w.text).join(' '), language: 'en', words }, null, 1) + '\n')

  // 4. Video clip (re-encode for frame-accurate cut; 854×480 keeps the
  //    fixture ≈6 MB — WER tests only consume the audio).
  const mp4 = join(repoRoot, 'fixtures', 'senate-veterans-2min.mp4')
  if (!existsSync(mp4) || force) {
    const ss = EVENT.windowStart + EVENT.preRoll
    const t = EVENT.windowEnd - EVENT.windowStart
    const r = spawnSync(
      resolveFfmpeg(),
      [
        '-hide_banner',
        '-v',
        'error',
        '-y',
        '-ss',
        String(ss),
        '-t',
        String(t),
        '-i',
        EVENT.streamUrl,
        '-vf',
        'scale=854:-2',
        '-c:v',
        'libx264',
        '-crf',
        '28',
        '-preset',
        'medium',
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-movflags',
        '+faststart',
        mp4,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 600_000 },
    )
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString().slice(0, 500)}`)
    console.log('wrote fixtures/senate-veterans-2min.mp4')
  }

  // 5. Manifest entries (verify-fixtures requires every fixtures/** file to
  //    be in the manifest with a license recorded in LICENSES.md).
  const entries: Record<string, Record<string, unknown>> = {
    'senate-veterans-2min.mp4': {
      duration: +(EVENT.windowEnd - EVENT.windowStart).toFixed(3),
      kind: 'speech',
      language: 'en',
      category: 'senate-live-human-captions',
      groundTruth: 'fixtures/harness/ground-truth/senate-veterans-2min.json',
      generated: false,
      license: LICENSE,
      codec: 'h264+aac',
      sampleRate: 48000,
      channels: 1,
      expectedPath: 'webcodecs',
      sha256: sha256(readFileSync(mp4)),
    },
    'captions/senate-veterans-2min.vtt': {
      sha256: sha256(readFileSync(join(repoRoot, 'fixtures', 'captions', 'senate-veterans-2min.vtt'))),
      generated: false,
      license: LICENSE,
      kind: 'captions',
      language: 'en',
    },
    'captions/senate-veterans-2min.srt': {
      sha256: sha256(readFileSync(join(repoRoot, 'fixtures', 'captions', 'senate-veterans-2min.srt'))),
      generated: false,
      license: LICENSE,
      kind: 'captions',
      language: 'en',
    },
    [`sources/senate-${EVENT.id}.captions.json`]: {
      sha256: sha256(readFileSync(srcJson)),
      generated: false,
      license: LICENSE,
      kind: 'captions',
      language: 'en+fr',
    },
    'captions/senate-veterans-2min-blocked.vtt': blockedEntry,
  }
  mergeManifest(entries)
}

function mergeManifest(entries: Record<string, Record<string, unknown>>): void {
  const manifestPath = join(repoRoot, 'fixtures', 'harness', 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    files: Record<string, Record<string, unknown>>
  }
  for (const [name, entry] of Object.entries(entries)) {
    if (force || !manifest.files[name]?.sha256 || manifest.files[name].sha256 !== entry.sha256) {
      manifest.files[name] = { duration: null, codec: null, sampleRate: null, channels: null, expectedPath: null, ...manifest.files[name], ...entry }
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log('updated fixtures/harness/manifest.json')
}

main().catch((e) => {
  console.error(`fetch-vendor-fixtures: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
