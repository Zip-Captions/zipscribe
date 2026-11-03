// L1 (node): id helpers — codes-only identifiers for jobs/projects (SECURITY-03
// safe to assert). Covers both the crypto.randomUUID path and the
// non-secure-context fallback so the state coverage gate measures the seam,
// not dead code.
import { describe, expect, test, vi } from 'vitest'
import { newJobId, newProjectId, newUuid } from './ids'

describe('state id helpers', () => {
  test('ids carry their prefix and are unique per call (crypto.randomUUID path)', () => {
    const first = newJobId()
    const second = newJobId()
    expect(first).toMatch(/^job_/u)
    expect(first).not.toBe(second)
    expect(newProjectId()).toMatch(/^proj_/u)
    expect(newUuid('pre')).toMatch(/^pre_/u)
  })

  test('falls back to Math.random ids when crypto.randomUUID is unavailable (non-secure contexts)', () => {
    vi.stubGlobal('crypto', { getRandomValues: () => undefined })
    try {
      const id = newJobId()
      expect(id).toMatch(/^job_[a-z0-9]+$/u)
      expect(newJobId()).not.toBe(id)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('handles a missing crypto global entirely', () => {
    vi.stubGlobal('crypto', undefined)
    try {
      expect(newProjectId()).toMatch(/^proj_[a-z0-9]+$/u)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
