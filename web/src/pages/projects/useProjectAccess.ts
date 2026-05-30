/**
 * Per-project access control hook.
 *
 * Stub for the upcoming "project permissions" sprint. Today every
 * authenticated user can see and edit every project; the hook returns
 * ``{ canView: true, canEdit: true, canDelete: true, isLoading: false }``
 * unconditionally. Components that gate write actions (edit, save,
 * delete, financial inputs, member management, …) should already
 * consume this hook so the permission rollout is a one-file change to
 * the hook body instead of a fan-out edit across project pages.
 *
 * When the sprint lands, replace the body with a call to (likely)
 * ``GET /projects/:id/access`` and map the response onto the same
 * ``ProjectAccess`` shape. The new logic can also surface
 * ``role: 'owner' | 'editor' | 'viewer'`` if needed.
 *
 * Usage:
 *   const { canEdit, canDelete } = useProjectAccess(projectId)
 *   {canEdit ? <EditButton /> : null}
 *   <DeleteButton disabled={!canDelete} />
 */
export interface ProjectAccess {
  /** Visible to current user — false routes to 403 in the future sprint. */
  canView: boolean
  /** Mutating actions: title/notes/stage/members/financials/etc. */
  canEdit: boolean
  /** Hard-delete the project. Usually a stricter check than canEdit. */
  canDelete: boolean
  /** Still resolving the access decision. Render skeletons / disable
   *  buttons until this flips to ``false``. */
  isLoading: boolean
}

const PERMISSIVE_DEFAULT: ProjectAccess = {
  canView: true,
  canEdit: true,
  canDelete: true,
  isLoading: false,
}

export function useProjectAccess(_projectId: number | string | null | undefined): ProjectAccess {
  // TODO(permissions-sprint): swap for real ACL lookup.
  // - Fetch /projects/:id/access on mount (keyed by projectId)
  // - Cache via tanstack-query or a manual ref so navigation doesn't refire
  // - Surface 403 by setting canView=false; ProjectDetail should then
  //   render <Navigate to="/403" /> instead of the layout
  // - Differentiate canEdit / canDelete by role
  return PERMISSIVE_DEFAULT
}
