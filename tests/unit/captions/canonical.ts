// Canonical serialization for unit-07 goldens and purity comparisons.
//
// ASSUMPTIONS (unit report): this is the MINIMAL interim canonical serializer —
// domain invariant 8 names `state/services/serialize.ts` (unit-102) as the
// canonical serializer once it lands; goldens are byte-stable across that
// swap because both implement the same observable rules: sorted object keys,
// no `undefined` members, numbers via the 3-decimal rule (domain invariant 6).
//
// Golden mode additionally normalizes identity: block ids → `blk-<n>` by
// document order and speaker ids → `SPK_<n>` by first appearance, because
// `CaptionBlock.id` is `crypto.randomUUID()` (the engine takes no id factory —
// ids are durable but random). Randomness must not leak into goldens; identity
// *structure* (which block shares which speaker) stays fully asserted.

/** 3-decimal rule (domain invariant 6): round to the timing precision ceiling. */
export function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return rounded === 0 ? 0 : rounded
}

export interface CanonicalOptions {
  /** Golden mode: positional id/speakerId normalization (see file header). */
  normalizeIds?: boolean
}

function canonicalize(value: unknown, options: CanonicalOptions, idMaps: { block: Map<string, string>; speaker: Map<string, string> }): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return round3(value)
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, options, idMaps))
  if (typeof value !== 'object') throw new Error(`canonical: unsupported value type ${typeof value}`)
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  let blockIndex = -1
  if (options.normalizeIds && typeof source.id === 'string' && Array.isArray(source.words)) {
    // CaptionBlock: positional block id.
    blockIndex = idMaps.block.size
    const mapped = `blk-${blockIndex + 1}`
    idMaps.block.set(source.id, mapped)
    out.id = mapped
  }
  for (const key of Object.keys(source).sort()) {
    if (key === 'id' && out.id !== undefined) continue
    const member = source[key]
    if (member === undefined) continue
    if (options.normalizeIds && key === 'speakerId' && typeof member === 'string') {
      let mapped = idMaps.speaker.get(member)
      if (mapped === undefined) {
        mapped = `SPK_${idMaps.speaker.size + 1}`
        idMaps.speaker.set(member, mapped)
      }
      out[key] = mapped
      continue
    }
    out[key] = canonicalize(member, options, idMaps)
  }
  return out
}

/** Deterministic string form; two projects/blocks/reports are "byte-equal" when these strings are equal. */
export function canonical(value: unknown, options: CanonicalOptions = {}): string {
  return JSON.stringify(canonicalize(value, options, { block: new Map(), speaker: new Map() }))
}

/** Deep, id-normalized canonicalization for golden comparison of import results. */
export function canonicalGolden(value: unknown): string {
  return canonical(value, { normalizeIds: true })
}
