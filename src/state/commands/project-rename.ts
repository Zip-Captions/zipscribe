// `project-rename` (FR-102.1) — carried unit-101 MAJOR-7: the canonical
// rename surface is this undoable command (`ProjectStore.setProjectName`
// stays for the frozen 101 contract; the shell flows through here).

import type { Project } from '../../engine/model'
import type { CommandDeps } from './deps'
import type { CommandReject, EditorCommand, EditorRootState, ProjectRenamePayload } from './types'
import { reject } from './validators'

export function createProjectRenameCommand(deps: CommandDeps): EditorCommand<'project-rename'> {
  return {
    id: 'project-rename',
    reduce(state: EditorRootState, payload: ProjectRenamePayload): CommandReject | null {
      const project = state.project as Project | null
      if (project === null) return reject('INVALID_PAYLOAD', 'NO_PROJECT')
      if (typeof payload.name !== 'string') return reject('INVALID_PAYLOAD', 'name')
      project.name = payload.name
      project.updatedAt = deps.clock.now()
      return null
    },
  }
}
