// Ambient stub for the APPROVED-but-not-yet-installed property-test runner
// (settings.yml approved_dependencies.dev includes `fast-check`). The builder
// installs it with `corepack pnpm add -D fast-check` (pinned to the current
// 4.x) — until then the property suites below fail at runtime on the
// unresolved import, which is the intended RED state (typecheck/lint stay
// green). The stub surface is exactly what these suites use (grounded against
// https://fast-check.dev/docs/core-blocks/runners/ and
// https://fast-check.dev/docs/api/ — v4 named exports). Once the real package
// is installed this file stays (ambient declarations win over node_modules
// resolution; the surface is a subset of the real API, so behaviour is
// unchanged).

declare module 'fast-check' {
  export interface Arbitrary<T> {
    map<U>(f: (t: T) => U): Arbitrary<U>
    filter(p: (t: T) => boolean): Arbitrary<T>
  }

  export interface AssertParams {
    /** Fixed seed → deterministic runs; `assert` prints it with the counterexample on failure. */
    seed?: string | number
    numRuns?: number
    timeout?: number
  }

  export function assert(property: unknown, params?: AssertParams): void
  export function property(...args: unknown[]): unknown
  export function array<T>(arb: Arbitrary<T>, params?: { minLength?: number; maxLength?: number }): Arbitrary<T[]>
  export function integer(params: { min: number; max: number }): Arbitrary<number>
  export function double(params?: { min?: number; max?: number; noNaN?: boolean; noDefaultInfinity?: boolean }): Arbitrary<number>
  export function constant<T>(value: T): Arbitrary<T>
  export function constantFrom<T>(...values: T[]): Arbitrary<T>
  export function boolean(): Arbitrary<boolean>
  export function record(shape: Record<string, Arbitrary<unknown>>, params?: { requiredKeys?: string[] }): Arbitrary<Record<string, unknown>>
  export function oneof(...arbs: Arbitrary<unknown>[]): Arbitrary<unknown>
  export function pre(condition: boolean): void
}
