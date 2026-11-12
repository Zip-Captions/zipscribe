// CC-105.3 (L1, node): the KeySpec parser (FR-105.2 / US-2.3.1) — frozen seam
// '@ui/commands/keyspec'. CmdOrCtrl resolves per platform (mac → Meta, win/linux
// → Ctrl); modifier order is the frozen Meta+Ctrl+Alt+Shift+<key>; held-letter
// chords ('KeyZ+ArrowLeft') parse; code-vs-key tokens are distinguished (letters
// bind by CODE so non-QWERTY layouts keep positions — FR-105.2); the overlay
// glyph map is platform-correct; the browser-reserved set (⌘W/⌘T/⌘N/⌘Q,
// Ctrl+Tab — design.md rules) is REJECTED with a typed, code-only error
// (SECURITY-03: messages carry codes, never content).
import { describe, expect, test } from 'vitest'
import { loadSeamModule } from './helpers/seams'
import type { CommandPlatform, KeySpec } from '@ui/commands/keyspec'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

type KeyspecModule = {
  parseKeySpec: (spec: string, platform: CommandPlatform) => KeySpec
  overlayLabel: (spec: string, platform: CommandPlatform) => string
  actualKeyLabel: (codeToken: string) => Promise<string>
}

const load = () => loadSeamModule<KeyspecModule>('@ui/commands/keyspec')

describe('CC-105.3: platform variant resolution (CmdOrCtrl)', () => {
  test('CC-105.3: CmdOrCtrl+Shift+M → Meta+Shift+M on mac, Ctrl+Shift+M on windows/linux', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await load()
    expect(parseKeySpec('CmdOrCtrl+Shift+M', 'mac').keys, 'mac reports the ⌘ modifier').toBe('Meta+Shift+M')
    expect(parseKeySpec('CmdOrCtrl+Shift+M', 'windows').keys, 'windows reports Ctrl').toBe('Ctrl+Shift+M')
    expect(parseKeySpec('CmdOrCtrl+Shift+M', 'linux').keys, 'linux reports Ctrl').toBe('Ctrl+Shift+M')
  })

  test('CC-105.3: modifier order normalizes to Meta+Ctrl+Alt+Shift+<key> regardless of input order', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await load()
    expect(parseKeySpec('Shift+Ctrl+Meta+A', 'mac').keys).toBe('Meta+Shift+A')
    expect(parseKeySpec('Shift+Alt+Ctrl+Meta+2', 'mac').keys).toBe('Meta+Ctrl+Alt+Shift+2')
    expect(parseKeySpec('Shift+Alt+Ctrl+Meta+2', 'mac').modifiers).toEqual(['Meta', 'Ctrl', 'Alt', 'Shift'])
    expect(parseKeySpec('Shift+Alt+Ctrl+Meta+2', 'mac').base).toBe('2')
  })
})

describe('CC-105.3: held-letter chords + code-vs-key tokens (FR-105.2)', () => {
  test('CC-105.3: held-letter chord token KeyZ+ArrowLeft parses (design.md Z/C trims)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await load()
    const spec = parseKeySpec('KeyZ+ArrowLeft', 'mac')
    expect(spec.heldChord, 'the held prefix is recognized').toBe('Z')
    expect(spec.keys).toBe('Z+ArrowLeft')
    expect(spec.base).toBe('ArrowLeft')
    const c = parseKeySpec('KeyC+ArrowRight', 'windows')
    expect(c.heldChord).toBe('C')
    expect(c.keys).toBe('C+ArrowRight')
  })

  test('CC-105.3: letter bindings are CODE tokens; named/function keys are KEY tokens', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await load()
    expect(parseKeySpec('KeyS', 'mac').type, 'letters bind by code (non-QWERTY keeps positions)').toBe('code')
    expect(parseKeySpec('KeyS', 'mac').code).toBe('KeyS')
    expect(parseKeySpec('Slash', 'mac').type).toBe('code')
    expect(parseKeySpec('Space', 'mac').type, 'Space is a key token').toBe('key')
    expect(parseKeySpec('F3', 'mac').type).toBe('key')
    expect(parseKeySpec("'", 'mac').type, 'the quote key is a key token').toBe('key')
    expect(parseKeySpec('KeyS', 'mac').keys, 'the resolved chord keeps the frozen single-letter spelling').toBe('S')
  })
})

describe('CC-105.3: overlay glyph map (FR-105.2/FR-105.4)', () => {
  test('CC-105.3: mac renders ⌘ ⌥ ⇧ ⌃ glyphs; windows/linux render Ctrl/Alt/Shift text', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { overlayLabel } = await load()
    expect(overlayLabel('CmdOrCtrl+Shift+M', 'mac')).toBe('⌘⇧M')
    expect(overlayLabel('CmdOrCtrl+Shift+M', 'windows')).toBe('Ctrl+Shift+M')
    expect(overlayLabel('CmdOrCtrl+Alt+1', 'mac')).toBe('⌘⌥1')
    expect(overlayLabel('CmdOrCtrl+Alt+1', 'linux')).toBe('Ctrl+Alt+1')
    expect(overlayLabel('Ctrl+Alt+2', 'mac'), 'an explicit Ctrl stays the ⌃ glyph').toBe('⌃⌥2')
  })
})

describe('CC-105.3: browser-reserved keys are rejected at parse (design.md rules)', () => {
  const reserved = ['Meta+W', 'Meta+T', 'Meta+N', 'Meta+Q', 'Ctrl+Tab'] as const

  test('CC-105.3: parse of a browser-reserved chord throws a typed BROWSER_RESERVED error', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await load()
    for (const spec of reserved) {
      let caught: unknown = null
      try {
        parseKeySpec(spec, 'mac')
      } catch (error) {
        caught = error
      }
      expect(caught, `${spec} must be rejected`).toBeInstanceOf(Error)
      expect((caught as { code?: string }).code, `${spec} → typed code`).toBe('BROWSER_RESERVED')
    }
  })

  test('CC-105.3: reserved errors carry the CODE only — no chord/content in the message (SECURITY-03)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await load()
    for (const spec of reserved) {
      let caught: unknown = null
      try {
        parseKeySpec(spec, 'windows')
      } catch (error) {
        caught = error
      }
      expect(caught, `${spec} must be rejected`).toBeInstanceOf(Error)
      expect((caught as Error).message, `message of ${spec} is code-only`).toBe('BROWSER_RESERVED')
    }
  })

  test('CC-105.3: malformed specs throw INVALID_SPEC', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { parseKeySpec } = await load()
    for (const spec of ['Meta+', '++M', '', 'NotAKey++']) {
      let caught: unknown = null
      try {
        parseKeySpec(spec, 'mac')
      } catch (error) {
        caught = error
      }
      expect(caught, `${JSON.stringify(spec)} rejected`).toBeInstanceOf(Error)
      expect((caught as { code?: string }).code).toBe('INVALID_SPEC')
    }
  })
})
