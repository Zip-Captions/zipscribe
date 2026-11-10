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
// Semantics pinned by ./unit06-api-contract.d.ts: average linkage over cosine
// distance `1 − u·v/(‖u‖·‖v‖)`; merge while linkage ≤ threshold; canonical
// labels `0..k−1`, first embed's cluster is 0; zero-norm vectors never merge.
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

gated('FR-06.1 clustering: well-separated sets', () => {
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

gated('FR-06.1 clustering: threshold + maxSpeakers stops', () => {
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

  test('CC-06.2: maxSpeakers caps the cluster count (over-clustering guard, FR-06.1)', async () => {
    const embeds = orthonormal(8)
    const capped = await cluster(embeds, { threshold: 1.5, maxSpeakers: 3 })
    expect(capped).toHaveLength(8)
    expect(distinctLabels(capped), 'agglomeration stops AT the cap, not below it').toEqual([0, 1, 2])
  })

  test('CC-06.2: default cap is 6 speakers (FR-06.1 default maxSpeakers)', async () => {
    const embeds = orthonormal(8)
    const labels = await cluster(embeds, { threshold: 1.5 })
    expect(distinctLabels(labels), 'unbounded threshold still respects the default cap of 6').toEqual([0, 1, 2, 3, 4, 5])
  })

  test('CC-06.2: a cap above the natural cluster count is inert', async () => {
    const labels = await cluster(orthonormal(3), { threshold: 0.5, maxSpeakers: 6 })
    expect(distinctLabels(labels)).toEqual([0, 1, 2])
  })
})

gated('FR-06.1 clustering: edges, canonicity, determinism (CC-06.6 pure coverage)', () => {
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
