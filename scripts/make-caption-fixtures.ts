// scripts/make-caption-fixtures.ts — unit-07 caption fixture generator
// (TEST-AUTHOR-OWNED, precedent unit-04 goldens ownership).
//
// Regenerates `fixtures/captions/**` byte-identically (all content is
// self-authored here or derived in-repo from `fixtures/harness/ground-truth/`,
// CC0) and MERGES the corresponding `fixtures/harness/manifest.json` rows
// (keys `captions/...` and `golden/captions/...`; every other row is
// preserved). NEVER run bare `pnpm fixtures` while unit-07 goldens are in
// play — it regenerates the manifest from make-fixtures.ts alone and drops
// these rows (see the unit report ASSUMPTIONS).
//
// The cue texts and timings are hand-designed so the pinned estimation rule
// (tests/unit/captions/unit07-api-contract.d.ts — character weight +
// punctuation pause, 3-decimal bounds) yields exactly the values recorded in
// `fixtures/golden/captions/*.expected.json`; the goldens are authored from
// the rule, never from an implementation.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(import.meta.url), '../..')
const captionsDir = join(repoRoot, 'fixtures', 'captions')
const manifestPath = join(repoRoot, 'fixtures', 'harness', 'manifest.json')
const LICENSE = 'CC0-1.0 (self-authored caption fixtures, unit-07)'

function srt(cues: { start: number; end: number; text: string }[]): string {
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n')
}
function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor(ms / 60_000) % 60
  const s = Math.floor(ms / 1000) % 60
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`
}
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** Minimal cp1252 encoder for the exact characters these fixtures use. */
const CP1252_EXTRA: Record<string, number> = { '—': 0x97, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '…': 0x85 }
function cp1252(text: string): Uint8Array {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code < 0x100) bytes.push(code)
    else if (CP1252_EXTRA[char] !== undefined) bytes.push(CP1252_EXTRA[char]!)
    else throw new Error(`cp1252 fixture character out of table: U+${code.toString(16)}`)
  }
  return new Uint8Array(bytes)
}
function utf16be(text: string): Uint8Array {
  const bytes: number[] = []
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    bytes.push((code >> 8) & 0xff, code & 0xff)
  }
  return new Uint8Array(bytes)
}
function bytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
const utf8 = new TextEncoder()

function files(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  const put = (name: string, content: string | Uint8Array): void => {
    out.set(name, typeof content === 'string' ? utf8.encode(content) : content)
  }

  // US-07.1 vendor case: Windows-1252 (é as a single 0xE9 byte), CRLF, <i> tags.
  const vendorLines = ['1', '00:00:00,000 --> 00:00:02,000', '<i>Café au lait</i>', '', '2', '00:00:03,000 --> 00:00:04,700', 'Two more lines now.', '']
  put('vendor.srt', cp1252(vendorLines.join('\r\n')))

  // US-07.1 WebVTT: <v> voices, NOTE/STYLE/REGION blocks, cue settings.
  put(
    'voices.vtt',
    [
      'WEBVTT',
      'Language: en',
      '',
      'NOTE vendor comment ignored by the importer',
      '',
      'STYLE',
      '::cue { color: #ffffff; }',
      'end',
      '',
      'REGION',
      'id:lowerthird',
      'width:80%',
      'lines:2',
      'regionanchor:0%,100%',
      'viewportanchor:10%,90%',
      'scroll:up',
      'end',
      '',
      'intro',
      '00:00:00.000 --> 00:00:01.400 position:10%',
      '<v Alex>Hi there friends</v>',
      '',
      '00:00:03.000 --> 00:00:04.000',
      '<v Jo>Hello again</v>',
      '',
    ].join('\n'),
  )

  // Baseline plain SRT (single default speaker) — golden 'simple'.
  put(
    'simple.srt',
    srt([
      { start: 0, end: 1.4, text: 'Hi there friends' },
      { start: 2, end: 3, text: 'Hello again' },
    ]),
  )

  // Manual line breaks (invariant 2 / breakAfter seeding).
  put('two-line.srt', srt([{ start: 0, end: 1, text: 'one two\nthree' }]))

  // Domain invariant 11 edge cases: overlap clamp, zero duration, empty cue.
  put(
    'overlap-zero-empty.srt',
    srt([
      { start: 0, end: 4, text: 'First long cue here' },
      { start: 3, end: 5, text: 'Second cue now' },
      { start: 6, end: 6, text: 'Tiny' },
      { start: 7, end: 8, text: '<i></i>' },
    ]),
  )

  // SBV (YouTube): H:MM:SS.mmm,H:MM:SS.mmm header lines.
  put(
    'sample.sbv',
    ['0:00:00.000,0:00:01.500', 'One two three four', '', '0:00:02.000,0:00:03.000', '<i>Italic SBV</i>', ''].join('\n'),
  )

  // TTML/DFXP text profile incl. ttp:frameRate (50f = 2.000 s at 25 fps) and xml:lang.
  put(
    'sample.ttml',
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tt xml:lang="en" xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25">',
      '  <body>',
      '    <div>',
      '      <p begin="0s" end="1s">Ready go now</p>',
      '      <p begin="50f" end="100f">Frames every second</p>',
      '    </div>',
      '  </body>',
      '</tt>',
      '',
    ].join('\n'),
  )

  // ASS/SSA: Dialogue lines only, {\…} override tags stripped.
  put(
    'sample.ass',
    [
      '[Script Info]',
      'Title: Zipscribe unit-07 sample',
      'ScriptType: v4.00+',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour',
      'Style: Default,Arial,16,&H00FFFFFF',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\pos(120,240)\\fad(200,200)}Karaoke tags gone',
      'Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,{\\b1}Bold{\\b0} text',
      '',
    ].join('\n'),
  )

  // Zipscribe JSON sidecar (cue-level shape per the frozen contract).
  put(
    'sample.zipscribe.json',
    `${JSON.stringify({ language: 'en', blocks: [{ start: 0, end: 1, text: 'Structured json here' }, { start: 2.5, end: 3.5, text: 'Second json cue' }] }, null, 2)}\n`,
  )

  // BOM variants (FR-07.1).
  put('bom-utf8.srt', bytes(new Uint8Array([0xef, 0xbb, 0xbf]), utf8.encode(srt([{ start: 0, end: 1, text: 'Bom utf eight' }]))))
  put(
    'bom-utf16le.srt',
    bytes(
      new Uint8Array([0xff, 0xfe]),
      new Uint8Array(
        Buffer.from(
          srt([
            { start: 0, end: 1, text: 'Utf sixteen le' },
          ]),
          'utf16le',
        ),
      ),
    ),
  )
  put('bom-utf16be.srt', bytes(new Uint8Array([0xfe, 0xff]), utf16be(srt([{ start: 0, end: 1, text: 'Utf sixteen be' }]))))

  // cp1252 accents: é/ï as single 0xE9/0xEF bytes, em dash 0x97 (invalid UTF-8 → fallback).
  put('accents-cp1252.srt', bytes(cp1252(srt([{ start: 0, end: 1.6, text: 'Café — naïve résumé' }]))))

  // RTL Arabic (text preserved verbatim, no shaping changes).
  put('arabic-rtl.srt', srt([{ start: 0, end: 1.2, text: 'مرحبا بالعالم' }]))

  // FR-07.5 speaker prefixes: 3 of 4 cues match (≥ 30 % → auto ON).
  put(
    'speakers-brackets.srt',
    srt([
      { start: 0, end: 1, text: '[Alex]: Ready now go' },
      { start: 1.5, end: 2.5, text: '[Jo]: Okay fine yes' },
      { start: 3, end: 4, text: '[Alex]: Again hello here' },
      { start: 4.5, end: 5.5, text: 'Plain words only' },
    ]),
  )

  // FR-07.5 dialogue-dash and NAME: variants (2/2 cues → auto ON).
  put(
    'speakers-dashes.srt',
    srt([
      { start: 0, end: 1, text: '- Ready now go' },
      { start: 1.5, end: 2.5, text: 'NARRATOR: Okay fine yes' },
    ]),
  )

  // Risks section: VTT inline timestamps are stripped from text (cue timing is the file's truth).
  put(
    'vtt-inline-timestamps.vtt',
    ['WEBVTT', '', '00:00:00.000 --> 00:00:02.000', '<00:00:00.500>Hello <00:00:01.000>there friends', ''].join('\n'),
  )

  // FR-07.2: content sniff beats the extension (WEBVTT body in a .srt name).
  put('mislabelled.srt', ['WEBVTT', '', '00:00:00.000 --> 00:00:01.000', 'Sniff wins here', ''].join('\n'))

  // Error fixtures (CC-07.6): no golden — the typed error IS the expectation.
  put('garbage.txt', 'This file is not captions at all, just prose.\nSecond line of unrelated prose.\n')
  put('bad-timestamps.srt', ['1', '00:00:00,000 --> 00:00:01,000', 'Good first cue', '', '2', '00:xx:00,000 --> nonsense', 'Broken second cue', ''].join('\n'))
  put(
    'undecodable.bin',
    // No BOM; 0xC3 0x28 breaks strict UTF-8; 0x81/0x8D/0x8F/0x90/0x9D are the
    // undefined windows-1252 positions → neither decoder can produce text.
    new Uint8Array([0x81, 0x8d, 0x8f, 0x90, 0x9d, 0xc3, 0x28, 0x20, 0x41, 0x42, 0x43]),
  )

  // Reference captions for the en-clean e2e (CC-07.3 honest-MAE case):
  // derived deterministically from the committed ground truth (6 words/cue).
  const groundTruth = JSON.parse(readFileSync(join(repoRoot, 'fixtures', 'harness', 'ground-truth', 'speech-2min.json'), 'utf8')) as { words: { text: string; start: number; end: number }[] }
  const cues: { start: number; end: number; text: string }[] = []
  for (let at = 0; at < groundTruth.words.length; at += 6) {
    const chunk = groundTruth.words.slice(at, at + 6)
    cues.push({ start: chunk[0]!.start, end: chunk[chunk.length - 1]!.end, text: chunk.map((word) => word.text).join(' ') })
  }
  put('en-clean-ref.srt', srt(cues))

  return out
}

interface ManifestEntry {
  sha256: string
  duration: number | null
  kind: string | null
  language: string | null
  category: string | null
  groundTruth: string | null
  generated: boolean
  license: string
  codec: string | null
  sampleRate: number | null
  channels: number | null
  expectedPath: string | null
}
interface Manifest {
  generatedBy: string
  root: string
  files: Record<string, ManifestEntry>
}

function walk(dir: string, prefix: string): string[] {
  const found: string[] = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) found.push(...walk(join(dir, item.name), `${prefix}${item.name}/`))
    else if (item.isFile()) found.push(`${prefix}${item.name}`)
  }
  return found.sort()
}

function main(): void {
  mkdirSync(captionsDir, { recursive: true })
  const produced = files()
  for (const [name, content] of produced) {
    writeFileSync(join(captionsDir, name), content)
    console.log(`captions/${name}: ${content.byteLength} bytes`)
  }

  // Merge manifest rows for fixtures/captions/** and fixtures/golden/captions/**.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  const keys = [...walk(captionsDir, 'captions/')]
  const goldenRoot = join(repoRoot, 'fixtures', 'golden', 'captions')
  try {
    keys.push(...walk(goldenRoot, 'golden/captions/'))
  } catch {
    /* goldens not written yet (authoring order) */
  }
  for (const key of keys) {
    const buffer = readFileSync(join(repoRoot, 'fixtures', key))
    const entry: ManifestEntry = {
      sha256: createHash('sha256').update(buffer).digest('hex'),
      duration: null,
      kind: key.startsWith('golden/') ? 'golden' : 'captions',
      language: null,
      category: null,
      groundTruth: null,
      generated: false,
      license: LICENSE,
      codec: null,
      sampleRate: null,
      channels: null,
      expectedPath: null,
    }
    manifest.files[key] = entry
    console.log(`manifest[${key}] = ${entry.sha256}`)
  }
  const sorted: Manifest = { generatedBy: manifest.generatedBy, root: manifest.root, files: {} }
  for (const key of Object.keys(manifest.files).sort()) sorted.files[key] = manifest.files[key]!
  writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`)
  console.log(`manifest: ${keys.length} unit-07 row(s) merged`)
}

main()
