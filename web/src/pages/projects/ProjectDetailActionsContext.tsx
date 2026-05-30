import { createContext, useContext, type ReactNode } from "react";

/**
 * Shared way for descendant cards inside ProjectDetail to open the
 * layout-level action modals (edit / members / delete). Replaces the
 * pre-redesign pattern of ``navigate('/projects/:id/settings')`` —
 * which is dead now that the Settings tab is gone.
 *
 * A null default (rather than throwing) keeps the consumers safe when
 * a card is rendered outside ProjectDetail (e.g. embedded in a list
 * preview). Consumers that need the actions just no-op when the
 * provider isn't there.
 */
export interface ProjectDetailActions {
  openEdit: () => void;
  openMembers: () => void;
  openDelete: () => void;
}

const ProjectDetailActionsContext = createContext<ProjectDetailActions | null>(
  null,
);

export function ProjectDetailActionsProvider({
  value,
  children,
}: {
  value: ProjectDetailActions;
  children: ReactNode;
}) {
  return (
    <ProjectDetailActionsContext.Provider value={value}>
      {children}
    </ProjectDetailActionsContext.Provider>
  );
}

export function useProjectDetailActions(): ProjectDetailActions | null {
  return useContext(ProjectDetailActionsContext);
}
