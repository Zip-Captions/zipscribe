// unit-201 EXTENDS commands (FR-201.2, FR-201.6): style slice mutation via
// `style-patch` (controls commit on release — one dispatch, one undo step;
// no-op patches stay step-free through the store's reference equality),
// `style-preset` (project-wide re-style = one step), and `output-aspect-set`
// (FR-201.6 single source for letterbox + export). Validation rejects out of
// range values with a FIELD token (SECURITY-03: codes + structural tokens).

import type { CaptionStyle, OutputAspect, Project } from '../../engine/model'
import { CAPTION_PRESETS, type PresetId } from '../../engine/style/presets'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, OutputAspectSetPayload, StylePatchPayload, StylePresetPayload } from './types'
import { reject } from './validators'

const ASPECTS: readonly OutputAspect[] = ['source', '16:9', '9:16', '1:1', '4:5']
const WEIGHTS = new Set([400, 700])
const MAX_LINES = new Set([1, 2, 3])
const POSITIONS = new Set(['top', 'center', 'bottom'])
const ALIGNMENTS = new Set(['left', 'center', 'right'])
const TRANSFORMS = new Set(['none', 'lowercase', 'uppercase'])
const HIGHLIGHTS = new Set(['none', 'karaoke', 'bold-active'])

function invalidField(field: string): CommandReject {
  return reject('INVALID_PAYLOAD', field)
}

function validateStylePatch(patch: Partial<CaptionStyle>): CommandReject | null {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    switch (key) {
      case 'fontFamily':
        if (typeof value !== 'string' || value.trim() === '') return invalidField(key)
        break
      case 'fontWeight':
        if (!WEIGHTS.has(value as number)) return invalidField(key)
        break
      case 'fontSizePct':
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 20) return invalidField(key)
        break
      case 'textTransform':
        if (!TRANSFORMS.has(value as string)) return invalidField(key)
        break
      case 'color':
      case 'highlightColor':
      case 'outlineColor':
        if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return invalidField(key)
        break
      case 'outlineWidth':
        if (typeof value !== 'number' || value < 0 || value > 12) return invalidField(key)
        break
      case 'backgroundColor':
        if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return invalidField(key)
        break
      case 'backgroundOpacity':
        if (typeof value !== 'number' || value < 0 || value > 1) return invalidField(key)
        break
      case 'position':
        if (!POSITIONS.has(value as string)) return invalidField(key)
        break
      case 'marginVPct':
        if (typeof value !== 'number' || value < 0 || value > 45) return invalidField(key)
        break
      case 'alignment':
        if (!ALIGNMENTS.has(value as string)) return invalidField(key)
        break
      case 'maxLinesPerBlock':
        if (!MAX_LINES.has(value as number)) return invalidField(key)
        break
      case 'highlightMode':
        if (!HIGHLIGHTS.has(value as string)) return invalidField(key)
        break
      case 'showSpeakerBar':
        if (typeof value !== 'boolean') return invalidField(key)
        break
      case 'animationPreset':
        if (typeof value !== 'string') return invalidField(key)
        break
      default:
        return invalidField(key) // unknown key — style fields are a closed set
    }
  }
  return null
}

function isDeepEqualStyle(a: CaptionStyle, b: CaptionStyle): boolean {
  for (const key of Object.keys(a) as (keyof CaptionStyle)[]) if (a[key] !== b[key]) return false
  for (const key of Object.keys(b) as (keyof CaptionStyle)[]) if (a[key] !== b[key]) return false
  return true
}

export function createStylePatchCommand(deps: CommandDeps): EditorCommand<'style-patch'> {
  return {
    id: 'style-patch',
    reduce(state: EditorRootState, payload: StylePatchPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (payload.patch === null || typeof payload.patch !== 'object') return reject('INVALID_PAYLOAD', 'patch')
      const bad = validateStylePatch(payload.patch)
      if (bad !== null) return bad
      const next: CaptionStyle = { ...project.style }
      for (const [key, value] of Object.entries(payload.patch)) {
        if (value === undefined) continue
        Object.assign(next, { [key]: value })
      }
      if (isDeepEqualStyle(project.style, next)) return null // step-free (reference equality holds)
      project.style = next
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}

export function createStylePresetCommand(deps: CommandDeps): EditorCommand<'style-preset'> {
  return {
    id: 'style-preset',
    reduce(state: EditorRootState, payload: StylePresetPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      const preset = CAPTION_PRESETS[payload.presetId as PresetId]
      if (preset === undefined) return reject('INVALID_PAYLOAD', payload.presetId)
      const next = structuredClone(preset.patch)
      if (isDeepEqualStyle(project.style, next)) return null
      project.style = next
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}

export function createOutputAspectSetCommand(deps: CommandDeps): EditorCommand<'output-aspect-set'> {
  return {
    id: 'output-aspect-set',
    reduce(state: EditorRootState, payload: OutputAspectSetPayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (!ASPECTS.includes(payload.aspect)) return reject('INVALID_PAYLOAD', 'aspect')
      if (project.outputAspect === payload.aspect) return null
      project.outputAspect = payload.aspect
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
