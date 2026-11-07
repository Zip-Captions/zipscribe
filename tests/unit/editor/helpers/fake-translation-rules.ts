// Recording TranslationRules spy (FR-102.1): every block command must route
// its invariant-10 hook through the injected rules, so the suites assert the
// hook CALLS happen with the right ids — while the production NO_OP stub keeps
// translations byte-identical until unit-301.
import type { Project } from '@engine/model@102'
import type { TranslationRules } from '@engine/translate/track@102'

export interface RuleCall {
  hook: keyof TranslationRules
  args: readonly (string | readonly string[])[]
}

export interface RecordingTranslationRules extends TranslationRules {
  readonly calls: RuleCall[]
}

export function createRecordingTranslationRules(): RecordingTranslationRules {
  const calls: RuleCall[] = []
  return {
    calls,
    onBlockDelete(project: Project, deletedBlockId: string): void {
      calls.push({ hook: 'onBlockDelete', args: [deletedBlockId] })
    },
    onBlockSplit(project: Project, sourceId: string, firstId: string, secondId: string): void {
      calls.push({ hook: 'onBlockSplit', args: [sourceId, firstId, secondId] })
    },
    onBlockMerge(project: Project, mergedId: string, sourceIds: readonly string[]): void {
      calls.push({ hook: 'onBlockMerge', args: [mergedId, sourceIds] })
    },
    onBlockRetime(project: Project, blockId: string): void {
      calls.push({ hook: 'onBlockRetime', args: [blockId] })
    },
  }
}
