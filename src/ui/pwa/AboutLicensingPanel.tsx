// CC-I3.10 (unit-205 J9) — the About/licensing panel, reached from the header
// ⋯ menu (design.md § header line: "⋯ menu: Install app · Offline models ·
// About"). Lists EVERY `MODEL_REGISTRY` + `DIAR_MODEL_REGISTRY` row with its
// id, license and attribution (and the pinned provenance — repo/revision —
// the CC-02.10 owner licensing check verifies against), surfaced verbatim
// from the registry: the registry is the single source of truth, the panel
// never re-states or re-derives a license string.
//
// Reuses the Offline models panel vocabulary (design.md — no new CSS tokens;
// the fixed-overlay container, head and row chrome are the same classes).
//
// SECURITY-03: pure static registry metadata (ids, licenses, attributions,
// repo/revision pins); zero user/project content, zero async, zero logging.

import type { ReactNode } from 'react'
import { DIAR_MODEL_REGISTRY, MODEL_REGISTRY } from '../../engine/model/registry'
import type { ModelSpec } from '../../engine/model/registry'

export interface AboutLicensingPanelProps {
  onClose: () => void
}

function ModelRow({ spec }: { spec: ModelSpec }): ReactNode {
  return (
    <li data-testid={`about-model-row-${spec.id}`} className="ws-offline-model-row ws-about-model-row">
      <span className="ws-offline-model-id">{spec.id}</span>
      <span className="ws-about-license">{spec.license}</span>
      {spec.attribution !== undefined && <span className="ws-about-attribution">{spec.attribution}</span>}
      <span className="ws-about-provenance">
        {spec.repo} · {spec.revision}
      </span>
    </li>
  )
}

export function AboutLicensingPanel({ onClose }: AboutLicensingPanelProps): ReactNode {
  return (
    <div data-testid="about-licensing-panel" role="dialog" aria-label="About and licensing" className="ws-offline-panel">
      <div className="ws-offline-panel-head">
        <h2 className="ws-offline-panel-title">About &amp; licensing</h2>
        <button type="button" data-testid="about-licensing-close" className="ws-button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="ws-offline-panel-copy">Every model shipped with Zipscribe, its license and attribution, exactly as pinned in the model registry.</p>
      <h3 className="ws-about-group-title">ASR models</h3>
      <ul className="ws-offline-model-list">
        {Object.values(MODEL_REGISTRY).map((spec) => (
          <ModelRow key={spec.id} spec={spec} />
        ))}
      </ul>
      <h3 className="ws-about-group-title">Diarization models</h3>
      <ul className="ws-offline-model-list">
        {Object.values(DIAR_MODEL_REGISTRY).map((spec) => (
          <ModelRow key={spec.id} spec={spec} />
        ))}
      </ul>
    </div>
  )
}
