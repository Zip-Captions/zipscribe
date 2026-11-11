// CC-06.1 CC-06.2 CC-06.6 (L1): pure agglomerative average-linkage clustering
// on cosine distance (FR-06.1) — the module `src/engine/diarize/clustering.ts`
// does not exist yet: every test here resolves it through a DYNAMIC import and
// fails with the module-resolution error (sanctioned unit-05 RED precedent;
// frozen shapes in ./unit06-api-contract.d.ts). Assertion bodies are complete
// — the moment the builder ships the module, they are the acceptance gate.
//
// The gates-child run (`pnpm test --coverage` under ZIPSCRIBE_CHILD=1, spawned
// by tests/unit/scaffold/gates.test.ts) must stay green, so the suites skip
// there exactly like the unit-04/05/07 RED-phase precedent — vitest.config.ts
// is builder-owned, so the guard is in-file (gates.test.ts:31 pattern).
//
// Semantics pinned by ./unit06-api-contract.d.ts + the unit-06 FR-06.1 spec
// line ("stopped by a distance threshold (tuned on fixtures), capped by
// maxSpeakers (default 6)"): average linkage over cosine distance
// `1 − u·v/(‖u‖·‖v‖)`; the THRESHOLD is the stop rule — merge while linkage ≤
// threshold. `maxSpeakers` is an UPPER BOUND, never a floor: when the
// threshold leaves the count above the cap, merges continue (beyond the
// threshold) until the count equals the cap; when the threshold already
// leaves the count at or below the cap (including 1), the cap is inert.
// Canonical labels `0..k−1`, first embed's cluster is 0; zero-norm vectors
// never merge.
import { describe, expect, test } from 'vitest'
import { isChildRun } from '../../helpers/repo'

const gated = isChildRun() ? describe.skip : describe

async function cluster(embeds: Float32Array[], opts: { threshold?: number; maxSpeakers?: number } = {}): Promise<number[]> {
  const mod = (await import('@engine/diarize/clustering')) as typeof import('@engine/diarize/clustering')
  return mod.agglomerativeCluster(embeds, opts)
}

function vec(...values: number[]): Float32Array {
  return new Float32Array(values)
}

/** k mutually orthogonal unit vectors → pairwise cosine distance exactly 1. */
function orthonormal(k: number, dim = k): Float32Array[] {
  return Array.from({ length: k }, (_, row) => {
    const v = new Float32Array(dim)
    v[row] = 1
    return v
  })
}

function distinctLabels(labels: number[]): number[] {
  return [...new Set(labels)].sort((a, b) => a - b)
}

gated('CC-06.1 CC-06.2 CC-06.6: FR-06.1 clustering — well-separated sets', () => {
  test('CC-06.1: k well-separated embedding sets collapse to exactly k labels', async () => {
    for (const k of [2, 3, 5]) {
      const labels = await cluster(orthonormal(k), { threshold: 0.5 })
      expect(labels, `k=${k}: one label per embed`).toHaveLength(k)
      expect(distinctLabels(labels), `k=${k}: exactly k distinct clusters`).toHaveLength(k)
    }
  })

  test('CC-06.1: identical vectors merge — opposite vectors never merge under the tuning range', async () => {
    const a = vec(1, 0, 0, 0)
    const b = vec(1, 0, 0, 0) // identical to a → cosine distance 0
    const c = vec(-1, 0, 0, 0) // opposite of a → cosine distance 2
    const d = vec(0, 1, 0, 0)
    const labels = await cluster([a, b, c, d], { threshold: 0.9 })
    expect(labels[0]).toBe(labels[1])
    expect(labels[0]).not.toBe(labels[2])
    expect(labels[0]).not.toBe(labels[3])
    expect(labels[2]).not.toBe(labels[3])
  })

  test('CC-06.1: cosine distance is scale-invariant (direction, not magnitude)', async () => {
    const u = vec(3, 0, 0, 0)
    const v = vec(0.002, 0, 0, 0) // same direction, wildly different norm
    const w = vec(0, 1, 0, 0)
    const labels = await cluster([u, v, w], { threshold: 0.5 })
    expect(labels[0], 'same direction merges regardless of magnitude').toBe(labels[1])
    expect(labels[0]).not.toBe(labels[2])
  })

  test('CC-06.1: tight pairs merge before far clusters (average linkage separates the groups)', async () => {
    // Two pairs with intra-pair cosine distance ≈ 0.005 and inter-pair distance ≈ 1.
    const p1 = vec(1, 0, 0, 0)
    const p2 = vec(Math.sqrt(1 - 0.005 ** 2), 0.005, 0, 0)
    const q1 = vec(0, 1, 0, 0)
    const q2 = vec(0, Math.sqrt(1 - 0.005 ** 2), 0.005, 0)
    const labels = await cluster([p1, p2, q1, q2], { threshold: 0.5 })
    expect(labels[0]).toBe(labels[1])
    expect(labels[2]).toBe(labels[3])
    expect(labels[0]).not.toBe(labels[2])
  })
})

gated('CC-06.1 CC-06.2 CC-06.6: FR-06.1 clustering — threshold stop + cap-as-upper-bound', () => {
  test('CC-06.1: the distance threshold stops merging', async () => {
    // Chain: near-duplicate pair + orthogonal singleton. Intra-pair distance
    // ≈ 0.02, pair→singleton distance ≈ 1.
    const embeds = [vec(1, 0, 0, 0), vec(Math.sqrt(1 - 0.02 ** 2), 0.02, 0, 0), vec(0, 0, 1, 0)]
    const low = await cluster(embeds, { threshold: 0.1 })
    expect(distinctLabels(low), 'tight pair merges, distant singleton does not').toEqual([0, 1])
    expect(low[0]).toBe(low[1])
    const high = await cluster(embeds, { threshold: 1.5 })
    expect(distinctLabels(high), 'a threshold above every linkage collapses to one cluster').toEqual([0])
  })

  test('CC-06.1: merging stops when linkage exceeds the threshold even without a cap', async () => {
    const embeds = orthonormal(4)
    const labels = await cluster(embeds, { threshold: 0.3 })
    expect(distinctLabels(labels)).toEqual([0, 1, 2, 3])
  })

  test('CC-06.1: average linkage does NOT chain where single linkage would (mean-of-pairwise discriminator)', async () => {
    // Three unit vectors on the unit circle at 0°/30°/61° (planar, exactly
    // realizable — the reviewer's 0/60/120° + d 0.2/0.2/1.5 triple violates
    // the Gram PSD constraint for unit vectors):
    //   d(a,b) = 1 − cos 30° ≈ 0.134  (unique global minimum → first merge)
    //   d(b,c) = 1 − cos 31° ≈ 0.144  (also under the threshold)
    //   d(a,c) = 1 − cos 61° ≈ 0.515
    // After merging (a,b), AVERAGE linkage reports
    // d({a,b},c) = (0.515 + 0.144)/2 ≈ 0.330 > threshold 0.25 → STOP at two
    // clusters. SINGLE linkage (mutating merge() to Math.min) would report
    // min(0.515, 0.144) = 0.144 ≤ 0.25 and chain a-b-c into ONE cluster — this
    // geometry is the kill-mutation discriminator (FR-06.1 average linkage).
    const at = (deg: number): Float32Array => vec(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180))
    const embeds = [at(0), at(30), at(61)]
    const labels = await cluster(embeds, { threshold: 0.25 })
    expect(labels, 'a stays merged with b; c is not chained in').toEqual([0, 0, 1])
    expect(distinctLabels(labels), 'average linkage stops at two clusters, single linkage would give one').toEqual([0, 1])
  })

  test('CC-06.2: the cap is an upper bound — count above the cap merges down TO it, not below (FR-06.1)', async () => {
    // Orthonormal(8): every pairwise/average linkage distance is 1, so the
    // tight threshold leaves the NATURAL count at 8 — ABOVE the cap. FR-06.1:
    // maxSpeakers is an upper bound, so merges continue beyond the threshold
    // until the count EQUALS the cap — exactly 3, not 2, not 8.
    const embeds = orthonormal(8)
    const capped = await cluster(embeds, { threshold: 0.3, maxSpeakers: 3 })
    expect(capped).toHaveLength(8)
    expect(distinctLabels(capped), 'cap forces merges down to exactly the cap — never below').toEqual([0, 1, 2])
  })

  test('CC-06.2: the default cap is an upper bound of 6 speakers (FR-06.1 default maxSpeakers)', async () => {
    // Same shape as the explicit-cap test with the DEFAULT options: the
    // permissive threshold is irrelevant here — the tight threshold leaves 8
    // natural clusters above the default cap of 6 → exactly 6 labels.
    const embeds = orthonormal(8)
    const labels = await cluster(embeds, { threshold: 0.3 })
    expect(distinctLabels(labels), 'count above the default cap merges down to exactly 6').toEqual([0, 1, 2, 3, 4, 5])
  })

  test('CC-06.2: the cap is INERT when the threshold already collapses the count below it', async () => {
    // The satisfiability pin for CC-06.2 (US-1.3.1: a single voice must emit
    // ONE speaker with NO maxSpeakers in the request): a permissive threshold
    // collapses orthonormal(8) to ONE cluster; an explicit cap of 3 must not
    // floor it back up to 3.
    const embeds = orthonormal(8)
    const labels = await cluster(embeds, { threshold: 1.5, maxSpeakers: 3 })
    expect(distinctLabels(labels), 'threshold stop at 1; the cap never floors above the natural count').toEqual([0])
  })

  test('CC-06.2: a cap above the natural cluster count is inert', async () => {
    const labels = await cluster(orthonormal(3), { threshold: 0.5, maxSpeakers: 6 })
    expect(distinctLabels(labels)).toEqual([0, 1, 2])
  })
})

gated('CC-06.1 CC-06.5 CC-06.6: FR-06.1 clustering — edges, canonicity, determinism (pure coverage)', () => {
  test('CC-06.1 CC-06.6: single input → [0]; empty input → []', async () => {
    expect(await cluster([vec(1, 2, 3)], { threshold: 0.5 })).toEqual([0])
    expect(await cluster([], { threshold: 0.5 })).toEqual([])
    expect(await cluster([])).toEqual([])
  })

  test('CC-06.6: labels are canonical — integers 0..k−1, every label used, first embed is 0', async () => {
    const labels = await cluster(orthonormal(4), { threshold: 1.5, maxSpeakers: 3 })
    expect(labels[0], 'the first embed owns cluster 0 (deterministic label space)').toBe(0)
    const distinct = distinctLabels(labels)
    expect(distinct, 'contiguous label space').toEqual(Array.from({ length: distinct.length }, (_, i) => i))
    for (const label of labels) {
      expect(Number.isInteger(label), `label ${label} is an integer`).toBe(true)
      expect(label).toBeGreaterThanOrEqual(0)
      expect(label).toBeLessThan(distinct.length)
    }
  })

  test('CC-06.5 CC-06.6: identical input produces identical output (determinism)', async () => {
    const embeds = [vec(1, 0, 0, 0), vec(0.99, 0.01, 0, 0), vec(0, 1, 0, 0), vec(0, 0.99, 0.01, 0), vec(0, 0, 1, 0)]
    const opts = { threshold: 0.5, maxSpeakers: 4 }
    const first = await cluster(embeds, opts)
    const second = await cluster(embeds, opts)
    expect(second, 'clustering is a function of its input, not of call order').toEqual(first)
  })

  test('CC-06.6: label count equals input embed count (total function)', async () => {
    const embeds = [...orthonormal(5), vec(1, 1, 1, 1)]
    const labels = await cluster(embeds, { threshold: 0.7 })
    expect(labels).toHaveLength(embeds.length)
  })

  test('CC-06.6: zero-norm embedding is a singleton — never merges, never crashes', async () => {
    const labels = await cluster([vec(0, 0, 0, 0), vec(1, 0, 0, 0), vec(1, 0, 0, 0)], { threshold: 0.5 })
    expect(labels[0], 'zero vector stays its own cluster').not.toBe(labels[1])
    expect(labels[1], 'the true duplicate pair still merges').toBe(labels[2])
  })
})
