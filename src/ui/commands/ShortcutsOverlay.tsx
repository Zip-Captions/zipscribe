// FR-105.4 / US-2.3.3 (design.md § Keyboard shortcuts): the ⌘/ overlay — a
// modal dialog listing every registered command grouped under the five
// categories (Transport / Edit / Timeline / Transcript / View) with
// platform-correct glyphs. Frozen seam:
// tests/unit/commands/unit105-api-contract.d.ts § @ui/commands/ShortcutsOverlay
// (testids shortcuts-overlay / shortcuts-filter / shortcuts-row +
// data-command-id; aria-label "Keyboard shortcuts"; one row per UNIQUE
// registered command id — the registry's ids are the oracle, editable-owned
// commands never enter it). The live filter narrows rows by command label
// AND by key token (case-insensitive substring). Tab/Shift+Tab cycle inside
// the dialog; Esc closes and restores focus to the opener (the element that
// had focus when the overlay opened). No animation — prefers-reduced-motion
// is N/A by construction.
//
// Keyboard handling lives here, on the src/ui/commands/** allowlist path
// (conventions § UI conventions): the dialog owns only its own Escape/Tab —
// everything else keeps flowing through useCommands → the registry.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { actualKeyLabel, detectPlatform, overlayLabel, parseKeySpec } from './keyspec'
import type { CommandPlatform } from './keyspec'
import { getCommandCatalog } from './registry'

export interface ShortcutsOverlayProps {
  /** Platform override (default: userAgent detection) — drives the glyph map. */
  platform?: CommandPlatform
  /** Called when the overlay closes (Esc / backdrop). */
  onClose?: () => void
}

const CATEGORIES: readonly ('Transport' | 'Edit' | 'Timeline' | 'Transcript' | 'View')[] = ['Transport', 'Edit', 'Timeline', 'Transcript', 'View']

const FOCUSABLE_SELECTOR = 'input, button, [href], [tabindex]:not([tabindex="-1"])'

function wrappedIndex(index: number, length: number): number {
  return ((index % length) + length) % length
}

// overlayLabel with the FR-105.2 layout override applied to code-token bases
// (actualKeyLabel resolves them through navigator.keyboard.getLayoutMap when
// present — keyspec feature-detects; absent → fallback identical to the
// parsed base, so the override branch is inert in node/jsdom).
function keyLabel(spec: string, platform: CommandPlatform, overrides: Readonly<Record<string, string>>): string {
  const label = overlayLabel(spec, platform)
  const parsed = parseKeySpec(spec, platform)
  const override = parsed.code === null ? undefined : overrides[parsed.code]
  if (override === undefined || override === parsed.base) return label
  if (platform === 'mac') return label.endsWith(parsed.base) ? `${label.slice(0, label.length - parsed.base.length)}${override}` : label
  const parts = label.split('+')
  parts[parts.length - 1] = override
  return parts.join('+')
}

export function ShortcutsOverlay(props: ShortcutsOverlayProps): ReactElement {
  const platform = props.platform ?? detectPlatform()
  const [filter, setFilter] = useState('')
  const [layoutOverrides, setLayoutOverrides] = useState<Readonly<Record<string, string>>>({})
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const filterRef = useRef<HTMLInputElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose

  const catalog = useMemo(() => getCommandCatalog(), [])

  // FR-105.2: actual layout labels for CODE-token bases only (the frozen
  // table has none, so this is inert there); applied only when a value
  // actually differs from the deterministic fallback (no needless commits).
  useEffect(() => {
    let cancelled = false
    const requests: { code: string; base: string }[] = []
    const seen = new Set<string>()
    for (const entry of catalog) {
      for (const keys of entry.keys) {
        const parsed = parseKeySpec(keys, platform)
        if (parsed.type === 'code' && parsed.code !== null && !seen.has(parsed.code)) {
          seen.add(parsed.code)
          requests.push({ code: parsed.code, base: parsed.base })
        }
      }
    }
    if (requests.length === 0) return
    void Promise.all(requests.map(async ({ code, base }) => ({ code, base, label: await actualKeyLabel(code) }))).then((resolved) => {
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const { code, base, label } of resolved) {
        if (label !== base) next[code] = label
      }
      if (Object.keys(next).length > 0) setLayoutOverrides(next)
    })
    return () => {
      cancelled = true
    }
  }, [catalog, platform])

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    filterRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (dialog === null) return
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusables.length === 0) return
      // jsdom never moves focus on Tab — the trap owns the cycle (in a real
      // browser preventDefault here replaces the native traversal with the
      // wrapped one, so focus can never leave the dialog).
      event.preventDefault()
      const index = focusables.indexOf(document.activeElement as HTMLElement)
      const target = index < 0 ? (event.shiftKey ? focusables[focusables.length - 1] : focusables[0]) : focusables[wrappedIndex(index + (event.shiftKey ? -1 : 1), focusables.length)]
      target?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  function close(): void {
    openerRef.current?.focus()
    onCloseRef.current?.()
  }

  const query = filter.trim().toLowerCase()
  // Label matches are case-insensitive substrings; key tokens compare
  // token-equal (splitting the chord on '+'), so 'space' never swallows the
  // 'Backspace' token (frozen CC-105.4 oracle).
  const matches = (label: string, chords: readonly string[]): boolean => query.length === 0 || label.toLowerCase().includes(query) || chords.some((chord) => chord.toLowerCase().split('+').includes(query))

  return (
    <div className="ws-shortcuts-backdrop" data-testid="shortcuts-backdrop" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="shortcuts-overlay" className="ws-shortcuts-dialog" onClick={(event) => event.stopPropagation()}>
        <input
          ref={filterRef}
          data-testid="shortcuts-filter"
          className="ws-shortcuts-filter"
          type="search"
          aria-label="Filter shortcuts"
          placeholder="Filter shortcuts"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {CATEGORIES.map((category) => {
          const entries = catalog.filter((entry) => entry.category === category && matches(entry.label, entry.keys))
          if (entries.length === 0) return null
          return (
            <section key={category} data-category={category} className="ws-shortcuts-group">
              <h2 className="ws-shortcuts-heading">{category}</h2>
              {entries.map((entry) => (
                <div key={entry.id} data-testid="shortcuts-row" data-command-id={entry.id} className="ws-shortcuts-row">
                  <span className="ws-shortcuts-label">{entry.label}</span>
                  <span className="ws-shortcuts-keys">{entry.keys.map((keys) => keyLabel(keys, platform, layoutOverrides)).join('  ')}</span>
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
