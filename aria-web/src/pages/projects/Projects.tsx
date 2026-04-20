import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { api } from "../../api/client";
import { PageTitle } from "../../components/PageTitle";
import { loadProjectDetail } from "../../routeLoaders";
import type { ProjectPhase } from "../../types/enums";
import type { Project } from "../../types/api";
import { ProjectsHeader } from "./ProjectsHeader";
import { PHASES, ProjectsPhaseSection, getProjectPhase } from "./ProjectsPhaseSection";
import { prefetchProjectDetailData } from "./useProjectDetailData";

const getTimestampValue = (value: string | null | undefined): number => {
  if (!value) return 0;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const compareProjectsByBusinessPriority = (left: Project, right: Project): number => {
  const phaseOrder = {
    business: 0,
    delivery: 1,
    archived: 2,
  } as const;

  const phaseDiff = phaseOrder[getProjectPhase(left)] - phaseOrder[getProjectPhase(right)];
  if (phaseDiff !== 0) return phaseDiff;

  return getTimestampValue(right.updated_at) - getTimestampValue(left.updated_at);
};

export function Projects() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPhase, setExpandedPhase] = useState<ProjectPhase | null>("business");
  const [users, setUsers] = useState<Array<{ id: number; display_name: string }>>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);

  useEffect(() => {
    void fetchProjects();
  }, [selectedMemberId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingUsers(true);
    api
      .get<Array<{ id: number; display_name: string }>>("/auth/users/simple")
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .catch((error) => console.error("Failed to load users:", error))
      .finally(() => {
        if (!cancelled) setIsLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const url =
        selectedMemberId != null ? `/projects?member_user_id=${selectedMemberId}` : "/projects";
      const data = await api.get<Project[]>(url);
      setProjects(data);
    } catch (error) {
      console.error("Failed to fetch projects:", error);
    } finally {
      setLoading(false);
    }
  };

  const prefetchProjectDetail = (projectId: number) => {
    void loadProjectDetail();
    void prefetchProjectDetailData(projectId);
  };

  const openProjectDetail = (projectId: number) => {
    prefetchProjectDetail(projectId);
    navigate(`/projects/${projectId}`);
  };

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return projects
      .filter((project) => {
        return (
          !query ||
          project.name.toLowerCase().includes(query) ||
          project.client.toLowerCase().includes(query) ||
          (project.description && project.description.toLowerCase().includes(query)) ||
          (project.context_summary && project.context_summary.toLowerCase().includes(query))
        );
      })
      .sort(compareProjectsByBusinessPriority);
  }, [projects, searchQuery]);

  const businessProjects = filteredProjects.filter((project) => getProjectPhase(project) === "business");
  const deliveryProjects = filteredProjects.filter((project) => getProjectPhase(project) === "delivery");
  const archivedProjects = filteredProjects.filter((project) => getProjectPhase(project) === "archived");

  if (loading) {
    return (
      <>
        <PageTitle title={t("projects.title")} />
        <div className="flex min-h-full items-center justify-center bg-gray-50">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("projects.title")} />
      <div className="min-h-full bg-gradient-to-b from-gray-50 to-white">
        <ProjectsHeader
          isLoadingUsers={isLoadingUsers}
          isZh={isZh}
          onCreateProject={() => navigate("/projects/new")}
          onSearchChange={setSearchQuery}
          onSelectedMemberChange={setSelectedMemberId}
          searchQuery={searchQuery}
          selectedMemberId={selectedMemberId}
          users={users}
        />

        <div className="mx-auto max-w-full px-6 py-8">
          <ProjectsPhaseSection
            isExpanded={expandedPhase === "business"}
            onProjectClick={openProjectDetail}
            onProjectPrefetch={prefetchProjectDetail}
            onToggle={() => setExpandedPhase(expandedPhase === "business" ? null : "business")}
            phase={PHASES.business}
            projects={businessProjects}
          />

          <ProjectsPhaseSection
            isExpanded={expandedPhase === "delivery"}
            onProjectClick={openProjectDetail}
            onProjectPrefetch={prefetchProjectDetail}
            onToggle={() => setExpandedPhase(expandedPhase === "delivery" ? null : "delivery")}
            phase={PHASES.delivery}
            projects={deliveryProjects}
          />

          <ProjectsPhaseSection
            isExpanded={expandedPhase === "archived"}
            onProjectClick={openProjectDetail}
            onProjectPrefetch={prefetchProjectDetail}
            onToggle={() => setExpandedPhase(expandedPhase === "archived" ? null : "archived")}
            phase={PHASES.archived}
            projects={archivedProjects}
          />
        </div>
      </div>
    </>
  );
}
