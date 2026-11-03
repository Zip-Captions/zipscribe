// Identifier helpers for store-created job/project/request records. Codes only,
// never user content (SECURITY-03). `crypto.randomUUID` is present in every
// target browser and in Node ≥ 19; the fallback keeps non-secure contexts
// (plain-http preview) and exotic test envs working.

function randomPart(): string {
  return Math.random().toString(36).slice(2)
}

export function newUuid(prefix: string): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID()}`
  }
  return `${prefix}_${randomPart()}${randomPart()}`
}

export function newJobId(): string {
  return newUuid('job')
}

export function newProjectId(): string {
  return newUuid('proj')
}
