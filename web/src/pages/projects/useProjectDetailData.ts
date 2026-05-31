/**
 * Project memory state-update event dispatch helper.
 *
 * Once upon a time this file owned a full client-side project-detail
 * cache + hook (`useProjectDetailData`) that the legacy project tabs
 * shared. The codex redesign replaced the whole consumer surface with
 * the simpler `useProjectDetail` in `codex/useProjectsApi.ts`, but
 * `ProjectMemorySettings` still broadcasts a global event whenever a
 * project's memory state changes so other parts of the app can react.
 * That broadcaster — `dispatchProjectMemoryStateUpdated` — is all
 * that remains here.
 */

export interface ProjectMemoryStateUpdate {
  memory_rebuild_failed_at?: string | null
  memory_rebuild_status?: string
  memory_stale: boolean
  memory_updated_at?: string | null
  memory_version: number
  projectId: number
  project_brief?: string
}

const PROJECT_MEMORY_STATE_UPDATED = 'aria:project-memory-state-updated'

export function dispatchProjectMemoryStateUpdated(update: ProjectMemoryStateUpdate) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<ProjectMemoryStateUpdate>(PROJECT_MEMORY_STATE_UPDATED, {
      detail: update,
    }),
  )
}
