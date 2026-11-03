// Ambient stub for the APPROVED-but-not-yet-installed axe scanner
// (`@axe-core/playwright`, settings.yml approved_devDeps). The builder
// installs it with `corepack pnpm add -D @axe-core/playwright` — until then
// `e2e/workbench/accessibility.spec.ts` fails at runtime on the unresolved
// import, which is the intended RED state (typecheck/lint stay green;
// unit-05 fast-check.d.ts precedent — the builder deletes this file once the
// real types resolve). The surface mirrors the official README:
// https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md

declare module '@axe-core/playwright' {
  import type { Page } from '@playwright/test'

  export interface AxeViolation {
    id: string
    impact: 'minor' | 'moderate' | 'serious' | 'critical' | null
    description: string
    helpUrl: string
  }

  export interface AxeResults {
    violations: AxeViolation[]
  }

  export class AxeBuilder {
    constructor(options: { page: Page })
    include(selector: string | string[]): this
    exclude(selector: string | string[]): this
    withTags(tags: string | string[]): this
    withRules(rules: string | string[]): this
    disableRules(rules: string | string[]): this
    analyze(): Promise<AxeResults>
  }
}
