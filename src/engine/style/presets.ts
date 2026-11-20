// Preset patch table — VERBATIM from the unit-200 design pass (FR-201.7):
// `.ai-dlc/styling-and-export/mockups/README.md` §1 acceptance table +
// `presets/` SVG renders (owner-signed CC-200.5, 2026-11-19). The hex values
// are the dark-theme resolution of the named palette tokens (token identities
// in `tokens` — the UI resolves them live so presets stay theme-switch safe,
// owner decision Q1); engine keeps resolved literals because canvas cannot
// evaluate CSS variables.

import type { CaptionStyle } from '../model'

export type PresetId = 'karaoke' | 'broadcast-box' | 'bold-lower' | 'minimal'

export interface CaptionPreset {
  id: PresetId
  label: string
  /** complete CaptionStyle — every field explicit (README: missing rows are spec bugs) */
  patch: CaptionStyle
  /** palette-token identity per color field (owner decision 2026-11-19) */
  tokens: Partial<Record<'color' | 'highlightColor' | 'outlineColor' | 'backgroundColor', string>>
  note: string
}

export const PRESET_ORDER: readonly PresetId[] = ['karaoke', 'broadcast-box', 'bold-lower', 'minimal']

const DARK = {
  bgApp: '#0d0f12',
  bgPanel: '#15181d',
  accent: '#4c8dff',
  gold: '#ffd166',
  textPrimary: '#e8eaed',
  textOnSolid: '#ffffff',
} as const

export const CAPTION_PRESETS: Record<PresetId, CaptionPreset> = {
  karaoke: {
    id: 'karaoke',
    label: 'Karaoke',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSizePct: 7.0,
      textTransform: 'uppercase',
      color: DARK.textOnSolid,
      highlightColor: DARK.accent,
      outlineColor: DARK.bgApp,
      outlineWidth: 3,
      backgroundOpacity: 0,
      position: 'center',
      marginVPct: 45,
      alignment: 'center',
      maxLinesPerBlock: 2,
      highlightMode: 'karaoke',
      showSpeakerBar: false,
    },
    tokens: { color: '--text-on-solid', highlightColor: '--accent', outlineColor: '--bg-app' },
    note: 'Shorts hook: uppercase hero line mid-frame, active word turns accent-blue; heavy outline keeps it legible over any frame.',
  },
  'broadcast-box': {
    id: 'broadcast-box',
    label: 'Broadcast box',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSizePct: 4.2,
      textTransform: 'none',
      color: DARK.textOnSolid,
      highlightColor: DARK.gold,
      outlineColor: DARK.bgApp,
      outlineWidth: 0,
      backgroundColor: DARK.bgPanel,
      backgroundOpacity: 0.82,
      position: 'bottom',
      marginVPct: 6,
      alignment: 'center',
      maxLinesPerBlock: 3,
      highlightMode: 'none',
      showSpeakerBar: true,
    },
    tokens: { color: '--text-on-solid', highlightColor: '--gold', outlineColor: '--bg-app', backgroundColor: '--bg-panel' },
    note: 'Interview/talking-head default: boxed 3-line lower third, speaker bar in the block’s speaker colour at the box edge.',
  },
  'bold-lower': {
    id: 'bold-lower',
    label: 'Bold lowercase',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSizePct: 5.2,
      textTransform: 'lowercase',
      color: DARK.textOnSolid,
      highlightColor: DARK.textOnSolid,
      outlineColor: DARK.bgApp,
      outlineWidth: 2,
      backgroundOpacity: 0,
      position: 'bottom',
      marginVPct: 8,
      alignment: 'center',
      maxLinesPerBlock: 2,
      highlightMode: 'bold-active',
      showSpeakerBar: false,
    },
    tokens: { color: '--text-on-solid', highlightColor: '--text-on-solid', outlineColor: '--bg-app' },
    note: 'Clean social look: lowercase, thin outline; the active word gains emphasis via weight (bold-active — highlightColor is deliberately the same colour).',
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 400,
      fontSizePct: 4.0,
      textTransform: 'none',
      color: DARK.textPrimary,
      highlightColor: DARK.textPrimary,
      outlineColor: DARK.bgApp,
      outlineWidth: 1.5,
      backgroundOpacity: 0,
      position: 'bottom',
      marginVPct: 5,
      alignment: 'center',
      maxLinesPerBlock: 3,
      highlightMode: 'none',
      showSpeakerBar: false,
    },
    tokens: { color: '--text-primary', highlightColor: '--text-primary', outlineColor: '--bg-app' },
    note: 'Documentation/accessibility baseline: no effects, smallest safe text, AA against the outline over any frame.',
  },
}
