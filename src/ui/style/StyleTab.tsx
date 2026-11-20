// Style tab (FR-201.2/201.3/201.5/201.6 + US-3.1.2). Every control is a
// style-patch that commits ON RELEASE/BLUR (one undo step, no history spam —
// unit-102 coalescing rule); preset application is `style-preset` (project-
// wide re-style, one step); aspect selector is `output-aspect-set` (hidden
// for audio projects — FR-201.6). Contrast guard icon per FR-201.5 using the
// owner-signed sheet method. Thumbnails render through the SHARED overlay
// renderer (FR-201.3 — no static images).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CaptionStyle, MediaAsset, OutputAspect } from '@engine/model'
import type { EditorApp } from '@state/history'
import { CAPTION_PRESETS, PRESET_ORDER, renderPresetThumbnail } from './presets'
import { BUNDLED_FONT_FACES, enableRemoteFont, ensureDisplayFont, isInBundledCoverage } from './fonts'
import { captionContrast } from './contrast'

export interface StyleTabProps {
  app: EditorApp
}

const ASPECTS: readonly OutputAspect[] = ['source', '16:9', '9:16', '1:1', '4:5']
const FRAME_PROBE = '#808080' // worst-case mid-grey (design pass §1)

function Thumbnail({ preset }: { preset: (typeof CAPTION_PRESETS)[keyof typeof CAPTION_PRESETS] }): ReactNode {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d') ?? null
    if (canvas !== null && ctx !== null) renderPresetThumbnail(ctx, preset, 96, 54)
  }, [preset])
  return <canvas ref={ref} width={96} height={54} className="ws-preset-thumb" aria-hidden="true" />
}

export function StyleTab({ app }: StyleTabProps): ReactNode {
  const project = app.project.getState().project
  const [, bump] = useState(0)
  useEffect(() => app.project.subscribe(() => bump(v => v + 1)), [app])
  const [remoteOn, setRemoteOn] = useState<Record<string, boolean>>({})

  const patch = useCallback((p: Partial<CaptionStyle>): void => {
    app.dispatch('style-patch', { patch: p })
  }, [app])

  if (project === null) return <p className="ws-empty">Load a project to style captions.</p>
  const style = project.style
  const asset: MediaAsset | null = project.asset ?? null
  const isAudio = asset?.kind === 'audio'

  const rows: ReactNode[] = []
  const row = (label: string, control: ReactNode, key?: string): void => {
    rows.push(
      <div className="ws-style-row" key={key ?? label}>
        <label className="ws-style-label" htmlFor={`style-${key ?? label}`}>{label}</label>
        {control}
      </div>,
    )
  }

  const range = (label: string, key: string, value: number, min: number, max: number, step: number, apply: (v: number) => void, unit = ''): void => {
    row(label, (
      <span className="ws-style-range-wrap">
        <input
          id={`style-${key}`} type="range" min={min} max={max} step={step} defaultValue={value}
          onPointerUp={e => apply(Number((e.target as HTMLInputElement).value))}
          onKeyUp={e => e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? apply(Number((e.target as HTMLInputElement).value)) : undefined}
          onBlur={e => apply(Number(e.target.value))}
          aria-label={label}
        />
        <span className="ws-tabular ws-style-value">{value}{unit}</span>
      </span>
    ), key)
  }

  const select = <T extends string>(label: string, key: string, value: T, options: readonly { value: T; label: string }[], apply: (v: T) => void): void => {
    row(label, (
      <select id={`style-${key}`} value={value} onChange={e => apply(e.target.value as T)} aria-label={label}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ), key)
  }

  const colorInput = (label: string, key: string, value: string, apply: (v: string) => void): void => {
    row(label, <input id={`style-${key}`} type="color" value={value} onChange={e => apply(e.target.value)} aria-label={label} />, key)
  }

  const check = (label: string, key: string, checked: boolean, apply: (v: boolean) => void): void => {
    row(label, <input id={`style-${key}`} type="checkbox" checked={checked} onChange={e => apply(e.target.checked)} aria-label={label} />, key)
  }

  // preset gallery (US-3.1.2) — thumbnails via the shared renderer
  const gallery = (
    <div className="ws-preset-gallery" role="group" aria-label="Preset library">
      {PRESET_ORDER.map(id => (
        <button
          key={id} type="button" className="ws-preset-card" title={CAPTION_PRESETS[id].note}
          onClick={() => app.dispatch('style-preset', { presetId: id })}
          data-testid={`preset-${id}`}
        >
          <Thumbnail preset={CAPTION_PRESETS[id]} />
          <span>{CAPTION_PRESETS[id].label}</span>
        </button>
      ))}
    </div>
  )

  const fontFamilies = useMemo(() => Array.from(new Set(BUNDLED_FONT_FACES.map(f => f.family))), [])
  select('Font', 'fontFamily', style.fontFamily, fontFamilies.map(f => ({ value: f, label: f })), v => {
    if (BUNDLED_FONT_FACES.some(f => f.family === v && f.lazy)) void ensureDisplayFont(v)
    patch({ fontFamily: v })
  })
  select('Weight', 'fontWeight', String(style.fontWeight) as '400' | '700', [{ value: '400', label: 'Regular 400' }, { value: '700', label: 'Bold 700' }], v => patch({ fontWeight: Number(v) as 400 | 700 }))
  range('Size %', 'fontSizePct', style.fontSizePct, 1, 20, 0.1, v => patch({ fontSizePct: v }), '%')
  select('Case', 'textTransform', style.textTransform, [
    { value: 'none', label: 'As written' }, { value: 'uppercase', label: 'UPPER' }, { value: 'lowercase', label: 'lower' },
  ], v => patch({ textTransform: v }))
  colorInput('Text color', 'color', style.color, v => patch({ color: v }))
  colorInput('Highlight', 'highlightColor', style.highlightColor, v => patch({ highlightColor: v }))
  colorInput('Outline', 'outlineColor', style.outlineColor, v => patch({ outlineColor: v }))
  range('Outline px@1080', 'outlineWidth', style.outlineWidth, 0, 12, 0.5, v => patch({ outlineWidth: v }))
  check('Background box', 'backgroundColor', style.backgroundColor !== undefined && style.backgroundOpacity > 0, v =>
    patch(v ? { backgroundColor: '#15181d', backgroundOpacity: 0.82 } : { backgroundOpacity: 0 }))
  if (style.backgroundColor !== undefined && style.backgroundOpacity > 0) {
    range('Box opacity', 'backgroundOpacity', style.backgroundOpacity, 0, 1, 0.02, v => patch({ backgroundOpacity: v }))
  }
  select('Position', 'position', style.position, [
    { value: 'top', label: 'Top' }, { value: 'center', label: 'Center' }, { value: 'bottom', label: 'Bottom' },
  ], v => patch({ position: v }))
  range('Margin V %', 'marginVPct', style.marginVPct, 0, 45, 1, v => patch({ marginVPct: v }), '%')
  select('Alignment', 'alignment', style.alignment, [
    { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' },
  ], v => patch({ alignment: v }))
  select('Max lines', 'maxLinesPerBlock', String(style.maxLinesPerBlock) as '1' | '2' | '3', [
    { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
  ], v => patch({ maxLinesPerBlock: Number(v) as 1 | 2 | 3 }))
  select('Highlight', 'highlightMode', style.highlightMode, [
    { value: 'none', label: 'None' }, { value: 'karaoke', label: 'Karaoke' }, { value: 'bold-active', label: 'Bold active' },
  ], v => patch({ highlightMode: v }))
  check('Speaker bar', 'showSpeakerBar', style.showSpeakerBar, v => patch({ showSpeakerBar: v }))
  if (!isAudio) {
    select('Aspect', 'outputAspect', project.outputAspect, ASPECTS.map(a => ({ value: a, label: a })), v => app.dispatch('output-aspect-set', { aspect: v }))
  }

  const contrast = captionContrast(style, FRAME_PROBE)
  const sampleText = project.blocks[0]?.text ?? ''
  const fallbackHint = !isInBundledCoverage(sampleText)

  return (
    <div className="ws-style-panel" data-testid="style-panel">
      {gallery}
      {rows}
      <div className="ws-style-remote" role="group" aria-label="Google Fonts opt-in">
        <p className="ws-style-note">Google Fonts (opt-in — loads remotely, never by default):</p>
        {['Anton', 'Bebas Neue', 'Oswald', 'Poppins'].map(family => (
          <label key={family} className="ws-style-remote-row">
            <input
              type="checkbox" checked={remoteOn[family] ?? false}
              onChange={e => {
                const on = e.target.checked
                if (!on) {
                  setRemoteOn(prev => ({ ...prev, [family]: false }))
                  return
                }
                // reflect the RESULT — a failed remote load never shows as enabled
                void enableRemoteFont(family).then(ok => {
                  setRemoteOn(prev => ({ ...prev, [family]: ok }))
                })
              }}
            />
            <span>{family}</span>
          </label>
        ))}
      </div>
      <div className="ws-style-contrast" data-testid="contrast-guard">
        <span className="ws-tabular">{contrast.pair}: {contrast.ratio.toFixed(2)}:1</span>
        {contrast.warn && <span role="img" aria-label="Low contrast — below WCAG AA 4.5:1" data-testid="contrast-warning">⚠</span>}
        {contrast.nonText !== undefined && !contrast.nonText.pass && <span aria-label="Outline vs frame below 3:1">⚠ 3:1</span>}
      </div>
      {fallbackHint && <p className="ws-style-note" data-testid="system-font-hint">Text uses scripts outside the bundled subsets — rendering with a system font.</p>}
      {isAudio && <p className="ws-style-note">Audio project: aspect is fixed 16:9; style still shapes preview captions.</p>}
    </div>
  )
}
