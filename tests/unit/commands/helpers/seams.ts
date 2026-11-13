// Shared RED-seam loader for the unit-105 suites: imports a production module
// through a VARIABLE specifier (vitest resolves the alias at runtime) and
// converts "module missing" into a clear RED message, so tsc — typing through
// tests/unit/commands/unit105-api-contract.d.ts — stays green while the
// builder has not shipped the module (keyboard-live-region.test.tsx
// `@vite-ignore` doctrine). Real syntax/type errors inside a shipped module
// still surface (the guard passes non-ERR_MODULE_NOT_FOUND errors through).

export async function loadSeamModule<T>(specifier: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Cannot find|Failed to load|does not exist|does not provide an export|not implemented/i.test(message)) {
      throw new Error(`unit-105 RED seam: "${specifier}" is not implemented yet — ${message.split('\n')[0]}`)
    }
    throw error
  }
}

/** Guard for an ADDITIVE export on an EXISTING module (registry
 *  augmentation): the module loads, the function does not exist YET. */
export function requireSeamApi<T>(candidate: T | undefined, seamName: string): T {
  if (typeof candidate !== 'function') {
    throw new Error(`unit-105 RED seam: "${seamName}" is not implemented yet`)
  }
  return candidate
}
