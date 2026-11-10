// Pure agglomerative AVERAGE-LINKAGE clustering on cosine distance (FR-06.1).
// Deterministic TypeScript: no SDK imports, no DOM globals, no I/O, no
// randomness. The exported surface is the frozen unit-06 contract
// (`tests/unit/diarization/unit06-api-contract.d.ts`).
//
// Semantics (frozen): pairwise cosine distance `1 − u·v/(‖u‖·‖v‖)`; a
// zero-norm embedding has distance `Infinity` to everything and therefore
// never merges. Merging picks the minimum average linkage (cluster-linkage =
// member-size-weighted mean of pairwise distances) and stops when that
// minimum exceeds `threshold` (FR-06.1 distance stop), or — when the input
// had more clusters than `maxSpeakers` — when the cluster count first
// reaches the cap (FR-06.1 over-clustering guard: "stops AT the cap, not
// below it"). A cap at or above the input count is inert: the threshold cut
// then governs and may legitimately land below the cap.
//
// Labels are canonical: integers `0 … k−1`, every label used, the FIRST
// embed's cluster is `0` (clusters relabel in first-member order), and the
// output is a pure function of the input (CC-06.5 determinism).
//
// FR-06.1 cross-check: `estimateSpeakerCount` runs an eigengap heuristic on
// the cosine-affinity matrix (top eigenvalues by deterministic power
// iteration with deflation — fixed iteration count, no RNG). Numbers only
// (SECURITY-03); it is NEVER used to cut the clustering — the caller reports
// it alongside the labels (worker-core forwards it into `job:done` stats).

/** Options for {@link agglomerativeCluster} (frozen shape + nothing else). */
export interface ClusterOptions {
  /** Stop merging when the minimum inter-cluster linkage exceeds this; default 0.5 (FR-06.1 tuning range). */
  threshold?: number
  /** Hard cap on the cluster count; default 6 (FR-06.1 over-clustering guard). */
  maxSpeakers?: number
}

/** Eigengap cross-check on the cosine-affinity matrix — numbers only (FR-06.1, SECURITY-03). */
export interface SpeakerCrossCheck {
  speakers: number
  eigengap: number
}

/** FR-06.1 default cosine-distance stop threshold (fixture-tuned working value). */
export const DEFAULT_CLUSTER_THRESHOLD = 0.5
/** FR-06.1 default speaker cap. */
export const DEFAULT_MAX_SPEAKERS = 6

const MAX_EIGEN_COUNT = 6
const POWER_ITERATIONS = 24
const NORM_EPS = 1e-12

function normOf(vector: Float32Array): number {
  let sum = 0
  for (let i = 0; i < vector.length; i++) {
    const v = vector[i]!
    sum += v * v
  }
  return Math.sqrt(sum)
}

/**
 * Agglomerative average-linkage clustering over cosine distance (FR-06.1).
 * Total: `embeds.length` labels out, `embeds.length === 0` → `[]`, a single
 * embed → `[0]`. `O(n²)` distance matrix over `n` embeds — fine for the
 * diarization window counts this consumes (tens to low hundreds).
 */
export function agglomerativeCluster(embeds: Float32Array[], opts: ClusterOptions = {}): number[] {
  const n = embeds.length
  if (n === 0) return []
  const threshold = opts.threshold ?? DEFAULT_CLUSTER_THRESHOLD
  const cap = Math.max(1, Math.min(Math.trunc(opts.maxSpeakers ?? DEFAULT_MAX_SPEAKERS), n))

  // Pairwise cosine-distance matrix; zero-norm rows/columns are Infinity
  // (distance 1 is what "direction undefined" resolves to — Infinity makes
  // "never merges" total even against permissive thresholds).
  const norms = new Float64Array(embeds.map(normOf))
  const dist = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ni = norms[i]!
      const nj = norms[j]!
      const d = ni === 0 || nj === 0 ? Number.POSITIVE_INFINITY : Math.max(0, 1 - dot(embeds[i]!, embeds[j]!) / (ni * nj))
      dist[i * n + j] = d
      dist[j * n + i] = d
    }
  }

  const active = new Array<boolean>(n).fill(true)
  const sizes = new Int32Array(n).fill(1)
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  let count = n

  while (count > 1) {
    // Minimum inter-cluster linkage over the active cluster slots.
    let bi = -1
    let bj = -1
    let bestLinkage = Number.POSITIVE_INFINITY
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue
      for (let j = i + 1; j < n; j++) {
        if (!active[j]) continue
        const d = dist[i * n + j]!
        if (d <= bestLinkage) {
          bestLinkage = d
          bi = i
          bj = j
        }
      }
    }
    if (count > cap) {
      // Cap forcing: above the cap we agglomerate regardless of threshold.
      merge(bi, bj)
      continue
    }
    if (n > cap && count === cap) break
    if (bestLinkage > threshold) break
    merge(bi, bj)
  }

  function merge(i: number, j: number): void {
    const sizeI = sizes[i]!
    const sizeJ = sizes[j]!
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === i || k === j) continue
      const avg = (dist[i * n + k]! * sizeI + dist[j * n + k]! * sizeJ) / (sizeI + sizeJ)
      dist[i * n + k] = avg
      dist[k * n + i] = avg
    }
    sizes[i] = sizeI + sizeJ
    active[j] = false
    parent[j] = i
    count -= 1
  }

  // Canonical relabel: first-member order (merges always fold into the lower
  // index, so cluster identity is its minimum member index).
  const labels = new Array<number>(n).fill(0)
  const relabel = new Map<number, number>()
  let next = 0
  for (let x = 0; x < n; x++) {
    const root = find(x)
    let label = relabel.get(root)
    if (label === undefined) {
      label = next
      next += 1
      relabel.set(root, label)
    }
    labels[x] = label
  }
  return labels

  function find(x: number): number {
    let root = x
    while (parent[root] !== root) root = parent[root]!
    let walk = x
    while (parent[walk] !== root) {
      const nextWalk = parent[walk]!
      parent[walk] = root
      walk = nextWalk
    }
    return root
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < len; i++) sum += a[i]! * b[i]!
  return sum
}

/**
 * FR-06.1 eigengap cross-check: top eigenvalues of the cosine-AFFINITY
 * matrix (`u·v/(‖u‖·‖v‖)`, zero-norm rows → 0) by deterministic power
 * iteration with deflation, then the largest successive-eigenvalue gap →
 * "how many well-separated clusters does the affinity matrix suggest".
 * Cross-check only — never used to cut (FR-06.1); numbers only (SECURITY-03).
 * Deterministic: fixed initial vector and fixed iteration count.
 */
export function estimateSpeakerCount(embeds: Float32Array[]): SpeakerCrossCheck {
  const n = embeds.length
  if (n === 0) return { speakers: 0, eigengap: 0 }
  const k = Math.min(MAX_EIGEN_COUNT, n)

  const norms = new Float64Array(embeds.map(normOf))
  const aff = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const denom = norms[i]! * norms[j]! + NORM_EPS
      aff[i * n + j] = dot(embeds[i]!, embeds[j]!) / denom
    }
  }

  const eigens = new Float64Array(k)
  for (let e = 0; e < k; e++) {
    const v = new Float64Array(n)
    const seed = 1 / Math.sqrt(n)
    for (let i = 0; i < n; i++) v[i] = seed
    for (let iteration = 0; iteration < POWER_ITERATIONS; iteration++) {
      const bv = matVec(aff, v, n)
      let norm = 0
      for (let i = 0; i < n; i++) norm += bv[i]! * bv[i]!
      const inv = 1 / (Math.sqrt(norm) + NORM_EPS)
      for (let i = 0; i < n; i++) v[i] = bv[i]! * inv
    }
    const bv = matVec(aff, v, n)
    let lambda = 0
    for (let i = 0; i < n; i++) lambda += v[i]! * bv[i]!
    eigens[e] = lambda
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        aff[i * n + j] = aff[i * n + j]! - lambda * v[i]! * v[j]!
      }
    }
  }

  eigens.sort((a, b) => a - b)
  let bestGap = 0
  let bestAt = 0
  for (let g = 1; g < k; g++) {
    const gap = eigens[k - g]! - eigens[k - g - 1]!
    if (gap > bestGap) {
      bestGap = gap
      bestAt = g
    }
  }
  return { speakers: Math.min(k, Math.max(1, bestAt)), eigengap: bestGap }
}

function matVec(mat: Float64Array, v: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) sum += mat[i * n + j]! * v[j]!
    out[i] = sum
  }
  return out
}
