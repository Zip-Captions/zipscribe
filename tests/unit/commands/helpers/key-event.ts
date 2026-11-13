// Keyboard-event simulation for the DOM seam (US-2.3.1: "each binding is
// simulated (`dispatchKeyEvent`)"): translates a frozen registry chord
// ('Meta+Shift+M', 'Z+ArrowLeft', 'Space', "Meta+'") into the exact
// KeyboardEvent sequence useCommands' normalization consumes. Events go to
// WINDOW (the bridge listens there) with bubbles+cancelable set; `repeat`
// variants support the "repeat=true events ignored" assertions.

const MODIFIER_TOKENS = ['Meta', 'Ctrl', 'Alt', 'Shift'] as const
type ModifierToken = (typeof MODIFIER_TOKENS)[number]

function isModifier(token: string): token is ModifierToken {
  return (MODIFIER_TOKENS as readonly string[]).includes(token)
}

/** Registry chord → the base KeyboardEvent.key value (inverse of
 *  useCommands.keyNameOf: 'Space' is DOM ' ', letters dispatch lowercase —
 *  keyNameOf uppercases them). */
export function baseKeyOf(token: string): string {
  if (token === 'Space') return ' '
  return token.length === 1 ? token.toLowerCase() : token
}

export interface KeyEventInit {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
}

/** The keydown sequence a frozen chord consists of: held-letter chords are
 *  [letter keydown, arrow keydown] (design.md Z/C held-letter); plain chords
 *  are one event with the modifier flags set. */
export function chordToKeydownEvents(keys: string): KeyEventInit[] {
  const tokens = keys.split('+')
  const modifiers = new Set<ModifierToken>()
  const rest: string[] = []
  for (const token of tokens) {
    if (isModifier(token)) modifiers.add(token)
    else rest.push(token)
  }
  if (rest.length === 0) throw new Error(`chord "${keys}" has no base key`)
  const flags = {
    metaKey: modifiers.has('Meta'),
    ctrlKey: modifiers.has('Ctrl'),
    altKey: modifiers.has('Alt'),
    shiftKey: modifiers.has('Shift'),
  }
  // Held-letter chord: Z/C + arrow (unit-103 frozen ids timeline.trim-*).
  const first = rest[0]
  const second = rest[1]
  if (rest.length === 2 && first !== undefined && second !== undefined && (first === 'Z' || first === 'C') && (second === 'ArrowLeft' || second === 'ArrowRight')) {
    return [{ key: first.toLowerCase(), ...flags }, { key: second, ...flags }]
  }
  if (rest.length !== 1 || first === undefined) throw new Error(`chord "${keys}" is not a single key or held-letter chord`)
  return [{ key: baseKeyOf(first), ...flags }]
}

/** Dispatch one KeyboardEvent at `target` (window for the bridge). Returns
 *  the event so callers can inspect defaultPrevented. */
export function fireKey(target: EventTarget, init: KeyEventInit, type: 'keydown' | 'keyup' = 'keydown'): KeyboardEvent {
  const event = new window.KeyboardEvent(type, {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    repeat: init.repeat ?? false,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

/** Full chord simulation: the keydown(s) of a registry chord. `repeat: true`
 *  replays the final keydown with the repeat flag (must be ignored). */
export function fireChord(keys: string, target: EventTarget = window, options: { repeat?: boolean } = {}): KeyboardEvent[] {
  const events = chordToKeydownEvents(keys)
  return events.map((init, index) => fireKey(target, { ...init, repeat: options.repeat === true && index === events.length - 1 }))
}
