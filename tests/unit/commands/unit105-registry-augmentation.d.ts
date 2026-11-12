// Unit-105 FROZEN API CONTRACT — registry AUGMENTATION (sidecar of
// unit105-api-contract.d.ts; the frozen acceptance shape is those two files
// together — augmentation of an EXISTING module must live in a module file,
// the ambient blocks of not-yet-existing modules in a script file).
//
// Additive surface only on `src/ui/commands/registry.ts`: the frozen
// unit-101/103/104 rows and every existing export stay untouched; see
// unit105-api-contract.d.ts for the frozen binding table, exemptions, error
// codes and catalog doctrine.

declare module '@ui/commands/registry' {
  /** FR-105.6: palette/docs JSON — one entry per UNIQUE command id. */
  export interface CommandCatalogEntry {
    id: string
    label: string
    /** Every chord registered for the id (frozen key-token spelling). */
    keys: readonly string[]
    when?: string
    category: 'Transport' | 'Edit' | 'Timeline' | 'Transcript' | 'View'
  }

  /** JSON-serializable, stable order, covers every registered id. */
  export function getCommandCatalog(): readonly CommandCatalogEntry[]

  export interface BindingRegistrationOptions {
    /** Dev mode (default true in DEV builds — tests pass it explicitly):
     *  duplicate (id, keys) or same-scope duplicate keys THROW
     *  `code: 'DUPLICATE_BINDING'`; browser-reserved chords always throw
     *  `code: 'BROWSER_RESERVED'`. Prod mode registers and relies on the
     *  precedence order below. */
    dev?: boolean
    /** FR-105.1 precedence: focused-panel scope > global (prod resolution,
     *  dev conflict detection is per-scope). */
    scope?: 'global' | 'panel'
  }

  export type RegisterBindingOptions = BindingRegistrationOptions

  export type CreateRegistryOptions = { dev?: boolean }

  /** The registration-time API (extends the slice-B `registerCommandHandler`
   *  precedent; unit-105 owns the final registration surface). */
  export function registerBinding(binding: { id: string; keys: string; when?: string }, options?: RegisterBindingOptions): void

  export interface RegistryResolveContext {
    timelineFocused?: boolean
    searchOpen?: boolean
    editing?: boolean
  }

  /** Isolated registry instance (conflict/precedence unit tests — L1, no
   *  global-registry mutation): the pure resolver freezes the precedence
   *  order open-gate timeline-focused > open-gate search-open > not-editing
   *  (while not editing) > ungated. */
  export interface CommandRegistry {
    register(binding: { id: string; keys: string; when?: string }, options?: { scope?: 'global' | 'panel' }): void
    bindings(): readonly { id: string; keys: string; when?: string }[]
    resolve(keys: string, ctx?: RegistryResolveContext): { id: string; keys: string; when?: string } | undefined
  }

  export function createRegistry(options?: { dev?: boolean }): CommandRegistry
}

export {}

export {}
