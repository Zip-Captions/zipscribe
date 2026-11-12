// KeySpec parser (FR-105.2 / US-2.3.1): the one chord grammar the registry
// speaks. CmdOrCtrl resolves per platform (⌘ on macOS, Ctrl elsewhere —
// design.md § Platform modifiers); modifiers normalize to the frozen
// Meta+Ctrl+Alt+Shift+<key> order; held-letter chords ('KeyZ+ArrowLeft',
// design.md Z/C trims) keep the letter directly before the base key; CODE
// tokens (KeyS/Slash) bind by KeyboardEvent.code so non-QWERTY layouts keep
// positions (FR-105.2), key tokens (Space, F3, "'", digits, arrows) by
// KeyboardEvent.key. Browser-reserved chords (⌘W/T/N/Q, Ctrl+Tab — design.md
// rules) are rejected with a typed code-only error (SECURITY-03: messages
// carry codes, never key/user content).

export type CommandPlatform = 'mac' | 'windows' | 'linux'

export type CommandModifier = 'Meta' | 'Ctrl' | 'Alt' | 'Shift'

export interface KeySpec {
  readonly keys: string
  readonly base: string
  readonly modifiers: readonly CommandModifier[]
  readonly type: 'code' | 'key'
  readonly code: string | null
  readonly heldChord: 'Z' | 'C' | null
}

export class CommandKeyError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'CommandKeyError'
    this.code = code
  }
}

const MODIFIER_ORDER: readonly CommandModifier[] = ['Meta', 'Ctrl', 'Alt', 'Shift']

const CODE_GLYPHS: Readonly<Record<string, string>> = {
  Semicolon: ';',
  Equal: '=',
  Comma: ',',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Quote: "'",
}

const NAMED_KEY_TOKENS: ReadonlySet<string> = new Set(['Space', 'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

const HELD_LETTER_TOKENS: ReadonlySet<string> = new Set(['Z', 'C', 'KeyZ', 'KeyC'])

const BROWSER_RESERVED: ReadonlySet<string> = new Set(['Meta+W', 'Meta+T', 'Meta+N', 'Meta+Q', 'Ctrl+Tab'])

const MAC_GLYPHS: Readonly<Record<CommandModifier, string>> = { Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }

const ARROW_GLYPHS: Readonly<Record<string, string>> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }

const LAYOUT_FALLBACKS: Readonly<Record<string, string>> = { ...CODE_GLYPHS, Space: ' ' }

function resolveModifier(token: string, platform: CommandPlatform): CommandModifier | null {
  if (token === 'Meta') return 'Meta'
  if (token === 'Ctrl') return 'Ctrl'
  if (token === 'Alt') return 'Alt'
  if (token === 'Shift') return 'Shift'
  if (token === 'CmdOrCtrl' || token === 'Cmd') return platform === 'mac' ? 'Meta' : 'Ctrl'
  return null
}

interface BaseToken {
  readonly base: string
  readonly type: 'code' | 'key'
  readonly code: string | null
}

function parseBaseToken(token: string): BaseToken | null {
  if (/^Key[A-Z]$/.test(token)) return { base: token.slice(3), type: 'code', code: token }
  if (/^Digit[0-9]$/.test(token)) return { base: token.slice(5), type: 'code', code: token }
  const glyph = CODE_GLYPHS[token]
  if (glyph !== undefined) return { base: glyph, type: 'code', code: token }
  if (NAMED_KEY_TOKENS.has(token)) return { base: token, type: 'key', code: null }
  if (/^F\d+$/.test(token)) return { base: token, type: 'key', code: null }
  if (token === ' ') return { base: 'Space', type: 'key', code: null }
  if (token.length === 1) return { base: token.toUpperCase(), type: 'key', code: null }
  return null
}

function heldLetterOf(token: string): 'Z' | 'C' | null {
  if (!HELD_LETTER_TOKENS.has(token)) return null
  return (token.startsWith('Key') ? token.slice(3) : token) as 'Z' | 'C'
}

export function parseKeySpec(spec: string, platform: CommandPlatform): KeySpec {
  const tokens = spec.split('+')
  if (tokens.some((token) => token === '')) throw new CommandKeyError('INVALID_SPEC')

  const last = tokens[tokens.length - 1] as string
  const secondLast = tokens[tokens.length - 2]
  const heldChord = tokens.length >= 2 && last.startsWith('Arrow') && secondLast !== undefined ? heldLetterOf(secondLast) : null
  if (heldChord !== null && !NAMED_KEY_TOKENS.has(last)) throw new CommandKeyError('INVALID_SPEC')

  const modifiers = new Set<CommandModifier>()
  for (const token of tokens.slice(0, tokens.length - (heldChord !== null ? 2 : 1))) {
    const modifier = resolveModifier(token, platform)
    if (modifier === null) throw new CommandKeyError('INVALID_SPEC')
    modifiers.add(modifier)
  }

  const base = parseBaseToken(last)
  if (base === null) throw new CommandKeyError('INVALID_SPEC')

  const resolved = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
  if (BROWSER_RESERVED.has([...resolved, base.base].join('+'))) throw new CommandKeyError('BROWSER_RESERVED')

  const keys = [...resolved, ...(heldChord !== null ? [heldChord] : []), base.base].join('+')
  return Object.freeze({ keys, base: base.base, modifiers: Object.freeze(resolved), type: base.type, code: base.code, heldChord })
}

export function overlayLabel(spec: string, platform: CommandPlatform): string {
  const parsed = parseKeySpec(spec, platform)
  const base = parsed.base in ARROW_GLYPHS ? (ARROW_GLYPHS[parsed.base] as string) : parsed.base
  if (platform === 'mac') {
    return [...parsed.modifiers.map((modifier) => MAC_GLYPHS[modifier]), ...(parsed.heldChord !== null ? [parsed.heldChord] : []), base].join('')
  }
  return [...parsed.modifiers.map((modifier) => (modifier === 'Meta' ? 'Ctrl' : modifier)), ...(parsed.heldChord !== null ? [parsed.heldChord] : []), base].join('+')
}

interface KeyboardLayoutMap {
  get(key: string): string | null
}

interface NavigatorWithKeyboardLayout extends Navigator {
  keyboard?: { getLayoutMap?: () => Promise<KeyboardLayoutMap> }
}

export async function actualKeyLabel(codeToken: string): Promise<string> {
  if (typeof navigator !== 'undefined') {
    const getLayoutMap = (navigator as NavigatorWithKeyboardLayout).keyboard?.getLayoutMap
    if (getLayoutMap !== undefined) {
      try {
        const layout = await getLayoutMap.call((navigator as NavigatorWithKeyboardLayout).keyboard)
        const mapped = layout.get(codeToken)
        if (mapped !== null && mapped !== undefined && mapped !== '') return mapped
      } catch {
        // Layout map unavailable (unsupported/permission) — deterministic fallback below.
      }
    }
  }
  if (/^Key[A-Z]$/.test(codeToken)) return codeToken.slice(3)
  if (/^Digit[0-9]$/.test(codeToken)) return codeToken.slice(5)
  return LAYOUT_FALLBACKS[codeToken] ?? codeToken
}
